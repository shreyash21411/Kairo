using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.Extensions.Logging;

namespace Kairo.Application.Services;

/// <summary>
/// Phase 1: Hybrid retrieval service that fuses semantic, keyword, and entity signals.
///
/// Fusion weights (configurable, defaults):
///   - Semantic:  0.60
///   - Keyword:   0.25
///   - Entity:    0.15
///
/// Score normalization:
///   - Semantic scores (cosine, 0-1) are used directly.
///   - Keyword raw scores are min-max normalized to [0, 1].
///   - Entity overlap is Jaccard similarity of entity name sets.
///   - Final score = weighted sum of normalized signals.
/// </summary>
public class HybridRetrievalService
{
    private const double SemanticWeight = 0.60;
    private const double KeywordWeight  = 0.25;
    private const double EntityWeight   = 0.15;

    private readonly IMemoryRepository _memoryRepository;
    private readonly IEmbeddingGenerator _embeddingGenerator;
    private readonly SemanticSimilarityService _similarityService;
    private readonly IMemoryRelevanceEvaluator _relevanceEvaluator;
    private readonly IKeywordSearchRepository _keywordSearch;
    private readonly IEntityRepository _entityRepository;
    private readonly ILogger<HybridRetrievalService> _logger;

    public HybridRetrievalService(
        IMemoryRepository memoryRepository,
        IEmbeddingGenerator embeddingGenerator,
        SemanticSimilarityService similarityService,
        IMemoryRelevanceEvaluator relevanceEvaluator,
        IKeywordSearchRepository keywordSearch,
        IEntityRepository entityRepository,
        ILogger<HybridRetrievalService> logger)
    {
        _memoryRepository  = memoryRepository;
        _embeddingGenerator = embeddingGenerator;
        _similarityService  = similarityService;
        _relevanceEvaluator = relevanceEvaluator;
        _keywordSearch      = keywordSearch;
        _entityRepository   = entityRepository;
        _logger             = logger;
    }

    /// <summary>
    /// Performs hybrid retrieval: semantic + keyword + entity signals fused.
    /// </summary>
    public async Task<List<RetrievedMemory>> RetrieveAsync(
        long userId,
        long projectId,
        string query,
        int topK = 5,
        long? scopeId = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query))
            throw new ArgumentException("Query cannot be empty.", nameof(query));
        if (topK <= 0)
            throw new ArgumentException("TopK must be greater than zero.", nameof(topK));

        var candidateLimit = Math.Max(topK * 3, 15);

        // ── Channel 1: Semantic ────────────────────────────────────────────────

        float[] queryEmbedding;
        try
        {
            queryEmbedding = await _embeddingGenerator.GenerateAsync(query);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[HybridRetrieval] Embedding generation failed. Falling back to keyword-only.");
            queryEmbedding = Array.Empty<float>();
        }

        var semanticScores = new Dictionary<long, double>();

        if (queryEmbedding.Length > 0)
        {
            var existingMemories = await _memoryRepository.GetActiveMemoryEmbeddingsAsync(userId, scopeId);

            foreach (var mem in existingMemories)
            {
                if (mem.Dimensions != queryEmbedding.Length) continue;
                var sim = _similarityService.CalculateCosineSimilarity(queryEmbedding, mem.Embedding);
                semanticScores[mem.MemoryId] = sim;
            }
        }

        // ── Channel 2: Keyword ────────────────────────────────────────────────

        var keywordResults = await _keywordSearch.SearchAsync(
            userId, query, scopeId, candidateLimit, cancellationToken);

        var keywordRaw = keywordResults.ToDictionary(r => r.MemoryId, r => r.RawScore);

        // Normalize keyword scores to [0, 1]
        var keywordNorm = NormalizeMinMax(keywordRaw);

        // ── Union candidates ─────────────────────────────────────────────────

        var allMemoryIds = semanticScores.Keys.Union(keywordRaw.Keys).ToHashSet();

        // Build a content lookup from semantic results (already in memory)
        var semanticContentMap = new Dictionary<long, (string Content, string MemoryType)>();
        {
            var existingMemories = await _memoryRepository.GetActiveMemoryEmbeddingsAsync(userId, scopeId);
            foreach (var mem in existingMemories)
                semanticContentMap[mem.MemoryId] = (mem.Content, mem.MemoryType);
        }

        var keywordContentMap = keywordResults.ToDictionary(r => r.MemoryId,
            r => (r.Content, r.MemoryType));

        // ── Channel 3: Entity signal ──────────────────────────────────────────

        // Extract query entities (normalize to lowercase tokens for overlap)
        var queryEntityTokens = ExtractQueryEntityTokens(query);
        var entityScores = new Dictionary<long, double>();

        if (queryEntityTokens.Count > 0 && allMemoryIds.Count > 0)
        {
            try
            {
                var memoryEntities = await _entityRepository
                    .GetEntitiesForMemoriesAsync(allMemoryIds, cancellationToken);

                foreach (var (memoryId, entities) in memoryEntities)
                {
                    var memEntityTokens = entities
                        .Select(e => e.NormalizedName)
                        .ToHashSet(StringComparer.OrdinalIgnoreCase);

                    // Jaccard similarity = |intersection| / |union|
                    var intersect = queryEntityTokens.Intersect(memEntityTokens).Count();
                    var union = queryEntityTokens.Union(memEntityTokens).Count();
                    entityScores[memoryId] = union > 0 ? (double)intersect / union : 0.0;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[HybridRetrieval] Entity signal computation failed. Skipping entity channel.");
            }
        }

        // ── Fusion ────────────────────────────────────────────────────────────

        var candidates = new List<HybridCandidate>();

        foreach (var memoryId in allMemoryIds)
        {
            // Resolve content and type
            string content;
            string memoryType;

            if (semanticContentMap.TryGetValue(memoryId, out var semContent))
            {
                content = semContent.Content;
                memoryType = semContent.MemoryType;
            }
            else if (keywordContentMap.TryGetValue(memoryId, out var kwContent))
            {
                content = kwContent.Content;
                memoryType = kwContent.MemoryType;
            }
            else continue;

            var semScore   = semanticScores.TryGetValue(memoryId, out var ss) ? ss : 0.0;
            var kwScore    = keywordNorm.TryGetValue(memoryId, out var ks) ? ks : 0.0;
            var entScore   = entityScores.TryGetValue(memoryId, out var es) ? es : 0.0;

            var fused = (semScore * SemanticWeight)
                      + (kwScore  * KeywordWeight)
                      + (entScore * EntityWeight);

            candidates.Add(new HybridCandidate
            {
                MemoryId      = memoryId,
                Content       = content,
                MemoryType    = memoryType,
                SemanticScore = semScore > 0 ? semScore : null,
                KeywordScore  = keywordRaw.TryGetValue(memoryId, out var kr) ? kr : null,
                EntityScore   = entScore > 0 ? entScore : null,
                FusedScore    = fused
            });
        }

        // Top candidates by fused score for relevance evaluation
        var topCandidates = candidates
            .OrderByDescending(c => c.FusedScore)
            .Take(candidateLimit)
            .ToList();

        if (topCandidates.Count == 0)
            return new List<RetrievedMemory>();

        // ── LLM Relevance evaluation ──────────────────────────────────────────

        var retrievedForEval = topCandidates.Select(c => new RetrievedMemory
        {
            MemoryId   = c.MemoryId,
            Content    = c.Content,
            MemoryType = c.MemoryType,
            Similarity = c.FusedScore
        }).ToList();

        List<RetrievedMemory> relevant;
        try
        {
            relevant = await _relevanceEvaluator.EvaluateAsync(query, retrievedForEval);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "[HybridRetrieval] Relevance evaluation failed. Returning top candidates by fused score.");
            relevant = retrievedForEval;
        }

        if (relevant == null || relevant.Count == 0)
            return new List<RetrievedMemory>();

        // Preserve fused score ordering
        return relevant
            .OrderByDescending(r => r.Similarity)
            .Take(topK)
            .ToList();
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private static Dictionary<long, double> NormalizeMinMax(Dictionary<long, double> raw)
    {
        if (raw.Count == 0) return raw;

        var min = raw.Values.Min();
        var max = raw.Values.Max();
        var range = max - min;

        if (range < 1e-9)
            return raw.ToDictionary(kv => kv.Key, _ => 1.0);

        return raw.ToDictionary(kv => kv.Key, kv => (kv.Value - min) / range);
    }

    private static HashSet<string> ExtractQueryEntityTokens(string query)
    {
        // Simple heuristic: extract capitalized words as likely entity signals
        var tokens = query
            .Split(new[] { ' ', '\t', '\n', ',', '.', '?', '!' }, StringSplitOptions.RemoveEmptyEntries)
            .Where(t => t.Length >= 3 && char.IsLetter(t[0]))
            .Select(t => t.Trim('.', ',', '?', '!').ToLowerInvariant())
            .ToHashSet();

        return tokens;
    }
}
