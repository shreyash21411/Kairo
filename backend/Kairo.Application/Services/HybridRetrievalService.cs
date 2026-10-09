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
///   - Keyword raw BM25 scores are min-max normalized to [0, 1].
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
    private readonly IEntityExtractionService _entityExtractionService;
    private readonly ILogger<HybridRetrievalService> _logger;

    public HybridRetrievalService(
        IMemoryRepository memoryRepository,
        IEmbeddingGenerator embeddingGenerator,
        SemanticSimilarityService similarityService,
        IMemoryRelevanceEvaluator relevanceEvaluator,
        IKeywordSearchRepository keywordSearch,
        IEntityRepository entityRepository,
        IEntityExtractionService entityExtractionService,
        ILogger<HybridRetrievalService> logger)
    {
        _memoryRepository        = memoryRepository;
        _embeddingGenerator      = embeddingGenerator;
        _similarityService       = similarityService;
        _relevanceEvaluator      = relevanceEvaluator;
        _keywordSearch           = keywordSearch;
        _entityRepository        = entityRepository;
        _entityExtractionService = entityExtractionService;
        _logger                  = logger;
    }

    /// <summary>
    /// Performs hybrid retrieval: semantic + keyword + entity signals fused.
    /// Backward-compatible overload returning memories only.
    /// </summary>
    public async Task<List<RetrievedMemory>> RetrieveAsync(
        long userId,
        long projectId,
        string query,
        int topK = 5,
        long? scopeId = null,
        CancellationToken cancellationToken = default)
    {
        var result = await RetrieveWithRelationsAsync(
            userId, projectId, query, topK, scopeId,
            temporalFilter: null, metadataFilters: null,
            recencyBoost: false, graphDepth: 1,
            cancellationToken: cancellationToken);

        return result.Memories;
    }

    /// <summary>
    /// Phase 2 & 3: Performs hybrid retrieval with temporal filtering, metadata filtering,
    /// category filtering, controlled recency boost, and scoped 1-hop graph relationship retrieval.
    /// </summary>
    public Task<HybridRetrievalResult> RetrieveWithRelationsAsync(
        long userId,
        long projectId,
        string query,
        int topK = 5,
        long? scopeId = null,
        MemoryTemporalFilter? temporalFilter = null,
        List<MetadataFilterCondition>? metadataFilters = null,
        bool recencyBoost = false,
        int graphDepth = 1,
        CancellationToken cancellationToken = default)
    {
        return RetrieveWithRelationsAsync(
            userId, projectId, query, topK, scopeId,
            temporalFilter, metadataFilters, recencyBoost,
            graphDepth, null, cancellationToken);
    }

    public async Task<HybridRetrievalResult> RetrieveWithRelationsAsync(
        long userId,
        long projectId,
        string query,
        int topK,
        long? scopeId,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        bool recencyBoost,
        int graphDepth,
        List<string>? categoryFilters,
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

        var semanticScores   = new Dictionary<long, double>();
        var memoryDetailsMap = new Dictionary<long, (string Content, string MemoryType, DateTime CreatedAt, DateTime UpdatedAt, DateTime? OccurredAt, string? Metadata, DateTime? ExpiresAt, List<string> Categories)>();

        var hasCategoryFilter = categoryFilters != null && categoryFilters.Count > 0;
        var hasMemFilters = temporalFilter != null || (metadataFilters != null && metadataFilters.Count > 0);

        List<MemoryEmbeddingData> scopeMemories;
        if (hasCategoryFilter)
        {
            scopeMemories = await _memoryRepository.GetFilteredActiveMemoryEmbeddingsAsync(
                userId, scopeId, temporalFilter, metadataFilters, categoryFilters);
        }
        else if (hasMemFilters)
        {
            scopeMemories = await _memoryRepository.GetFilteredActiveMemoryEmbeddingsAsync(
                userId, scopeId, temporalFilter, metadataFilters);
        }
        else
        {
            scopeMemories = await _memoryRepository.GetActiveMemoryEmbeddingsAsync(userId, scopeId);
        }

        scopeMemories ??= new List<MemoryEmbeddingData>();
        var activeModel = _embeddingGenerator.GetModelName();

        if (scopeMemories != null)
        {
            foreach (var mem in scopeMemories)
            {
                memoryDetailsMap[mem.MemoryId] = (mem.Content, mem.MemoryType, mem.CreatedAt, mem.UpdatedAt, mem.OccurredAt, mem.Metadata, mem.ExpiresAt, mem.Categories);

                if (queryEmbedding.Length > 0 &&
                    mem.Dimensions == queryEmbedding.Length &&
                    EmbeddingGeneratorExtensions.IsModelCompatible(mem.Model, activeModel))
                {
                    var sim = _similarityService.CalculateCosineSimilarity(queryEmbedding, mem.Embedding);
                    semanticScores[mem.MemoryId] = sim;
                }
            }
        }

        // ── Channel 2: Keyword (BM25) ─────────────────────────────────────────

        List<KeywordSearchResult> keywordResults;
        if (hasCategoryFilter)
        {
            keywordResults = await _keywordSearch.SearchAsync(
                userId, query, scopeId, candidateLimit, temporalFilter, metadataFilters, categoryFilters, cancellationToken);
        }
        else if (hasMemFilters)
        {
            keywordResults = await _keywordSearch.SearchAsync(
                userId, query, scopeId, candidateLimit, temporalFilter, metadataFilters, cancellationToken);
        }
        else
        {
            keywordResults = await _keywordSearch.SearchAsync(
                userId, query, scopeId, candidateLimit, cancellationToken);
        }

        keywordResults ??= new List<KeywordSearchResult>();

        var keywordRaw = keywordResults.ToDictionary(r => r.MemoryId, r => r.RawScore);

        // Normalize keyword scores to [0, 1]
        var keywordNorm = NormalizeMinMax(keywordRaw);

        // ── Union candidates ─────────────────────────────────────────────────

        var allMemoryIds = semanticScores.Keys.Union(keywordRaw.Keys).ToHashSet();

        var keywordContentMap = keywordResults
            .GroupBy(r => r.MemoryId)
            .ToDictionary(g => g.Key, g => (g.First().Content, g.First().MemoryType));

        // ── Channel 3: Entity signal (Mistral NER on query) ──────────────────

        var queryEntityTokens = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var entityScores      = new Dictionary<long, double>();
        Dictionary<long, List<EntityData>> memoryEntities = new();

        if (allMemoryIds.Count > 0)
        {
            try
            {
                var queryEntities = await _entityExtractionService.ExtractAsync(query, cancellationToken);
                if (queryEntities != null)
                {
                    foreach (var e in queryEntities)
                        queryEntityTokens.Add(e.NormalizedName.Trim().ToLowerInvariant());
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "[HybridRetrieval] Query entity extraction failed. Entity signal will be 0.");
            }

            if (queryEntityTokens.Count > 0)
            {
                try
                {
                    memoryEntities = await _entityRepository
                        .GetEntitiesForMemoriesAsync(allMemoryIds, cancellationToken);

                    foreach (var (memoryId, entities) in memoryEntities)
                    {
                        var memEntityTokens = entities
                            .Select(e => e.NormalizedName)
                            .ToHashSet(StringComparer.OrdinalIgnoreCase);

                        // Jaccard similarity = |intersection| / |union|
                        var intersect = queryEntityTokens.Intersect(memEntityTokens).Count();
                        var union     = queryEntityTokens.Union(memEntityTokens).Count();
                        entityScores[memoryId] = union > 0 ? (double)intersect / union : 0.0;
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "[HybridRetrieval] Entity signal computation failed. Skipping entity channel.");
                }
            }
        }

        // ── Fusion ────────────────────────────────────────────────────────────

        var candidates = new List<HybridCandidate>();
        var now = DateTime.UtcNow;

        foreach (var memoryId in allMemoryIds)
        {
            string content;
            string memoryType;

            if (memoryDetailsMap.TryGetValue(memoryId, out var details))
            {
                if (!ExpirationHelper.IsNotExpired(details.ExpiresAt, now))
                    continue;

                content = details.Content;
                memoryType = details.MemoryType;
            }
            else if (keywordContentMap.TryGetValue(memoryId, out var kwContent))
            {
                content = kwContent.Content;
                memoryType = kwContent.MemoryType;
                memoryDetailsMap[memoryId] = (content, memoryType, now, now, null, null, null, new List<string>());
            }
            else continue;

            var semScore   = semanticScores.TryGetValue(memoryId, out var ss) ? ss : 0.0;
            var kwScore    = keywordNorm.TryGetValue(memoryId, out var ks) ? ks : 0.0;
            var entScore   = entityScores.TryGetValue(memoryId, out var es) ? es : 0.0;

            var fused = (semScore * SemanticWeight)
                      + (kwScore  * KeywordWeight)
                      + (entScore * EntityWeight);

            // Phase 2: Controlled recency boosting
            if (recencyBoost)
            {
                var refDate = memoryDetailsMap.TryGetValue(memoryId, out var d) && d.OccurredAt.HasValue
                    ? d.OccurredAt.Value
                    : (memoryDetailsMap.TryGetValue(memoryId, out var d2) ? d2.CreatedAt : now);

                var ageInDays = Math.Max(0, (now - refDate).TotalDays);
                var recencyScore = Math.Exp(-0.05 * ageInDays);
                fused = (0.85 * fused) + (0.15 * recencyScore);
            }

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
            return new HybridRetrievalResult();

        // ── LLM Relevance evaluation ──────────────────────────────────────────

        var retrievedForEval = topCandidates.Select(c =>
        {
            var details = memoryDetailsMap.TryGetValue(c.MemoryId, out var d) ? d : default;
            return new RetrievedMemory
            {
                MemoryId   = c.MemoryId,
                Content    = c.Content,
                MemoryType = c.MemoryType,
                Similarity = c.FusedScore,
                CreatedAt  = details.CreatedAt != default ? details.CreatedAt : null,
                UpdatedAt  = details.UpdatedAt != default ? details.UpdatedAt : null,
                OccurredAt = details.OccurredAt,
                Metadata   = details.Metadata,
                ExpiresAt  = details.ExpiresAt,
                Categories = details.Categories ?? new()
            };
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
            return new HybridRetrievalResult();

        // Preserve fused score ordering and take topK
        var finalMemories = relevant
            .OrderByDescending(r => r.Similarity)
            .Take(topK)
            .ToList();

        // Ensure temporal, metadata, and Phase 3 properties are fully populated on final results
        foreach (var mem in finalMemories)
        {
            if (memoryDetailsMap.TryGetValue(mem.MemoryId, out var d))
            {
                mem.CreatedAt  ??= d.CreatedAt;
                mem.UpdatedAt  ??= d.UpdatedAt;
                mem.OccurredAt ??= d.OccurredAt;
                mem.Metadata   ??= d.Metadata;
                mem.ExpiresAt  ??= d.ExpiresAt;
                if (d.Categories != null && d.Categories.Count > 0)
                    mem.Categories = d.Categories;
            }
        }

        // ── Graph Memory (1-hop / multi-hop scoped entity relationships) ──────
        var discoveredRelations = new List<GraphRelationDto>();
        if (scopeId.HasValue && finalMemories.Count > 0)
        {
            try
            {
                var candidateEntityNames = new HashSet<string>(queryEntityTokens, StringComparer.OrdinalIgnoreCase);

                var finalMemoryIds = finalMemories.Select(m => m.MemoryId).ToHashSet();
                if (memoryEntities.Count == 0 && finalMemoryIds.Count > 0)
                {
                    memoryEntities = await _entityRepository.GetEntitiesForMemoriesAsync(finalMemoryIds, cancellationToken);
                }

                foreach (var memId in finalMemoryIds)
                {
                    if (memoryEntities.TryGetValue(memId, out var entities))
                    {
                        foreach (var ent in entities)
                            candidateEntityNames.Add(ent.NormalizedName);
                    }
                }

                if (candidateEntityNames.Count > 0)
                {
                    var rawRelations = await _entityRepository.GetScopedRelationshipsForEntitiesAsync(
                        projectId,
                        scopeId.Value,
                        candidateEntityNames,
                        maxDepth: Math.Clamp(graphDepth, 1, 2),
                        cancellationToken: cancellationToken);

                    discoveredRelations = rawRelations.Select(r => new GraphRelationDto
                    {
                        Source       = r.SourceDisplayName,
                        Relationship = r.RelationshipType,
                        Target       = r.TargetDisplayName,
                        Confidence   = r.Confidence
                    }).ToList();
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[HybridRetrieval] Graph relationship traversal failed. Returning memories without relations.");
            }
        }

        return new HybridRetrievalResult
        {
            Memories  = finalMemories,
            Relations = discoveredRelations
        };
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
}
