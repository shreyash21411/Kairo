using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;

namespace Kairo.Application.Services;

public class MemoryRetrievalService
{
    private readonly IMemoryRepository _memoryRepository;
    private readonly IEmbeddingGenerator _embeddingGenerator;
    private readonly SemanticSimilarityService _similarityService;
    private readonly IMemoryRelevanceEvaluator _relevanceEvaluator;

    public MemoryRetrievalService(
        IMemoryRepository memoryRepository,
        IEmbeddingGenerator embeddingGenerator,
        SemanticSimilarityService similarityService,
        IMemoryRelevanceEvaluator relevanceEvaluator)
    {
        _memoryRepository = memoryRepository;
        _embeddingGenerator = embeddingGenerator;
        _similarityService = similarityService;
        _relevanceEvaluator = relevanceEvaluator;
    }

    public Task<List<RetrievedMemory>> RetrieveAsync(
        long userId,
        string query,
        int topK = 5,
        long? scopeId = null)
    {
        return RetrieveAsync(userId, query, topK, scopeId, null, null, false, null);
    }

    public Task<List<RetrievedMemory>> RetrieveAsync(
        long userId,
        string query,
        int topK,
        long? scopeId,
        List<string>? categoryFilters)
    {
        return RetrieveAsync(userId, query, topK, scopeId, null, null, false, categoryFilters);
    }

    public Task<List<RetrievedMemory>> RetrieveAsync(
        long userId,
        string query,
        int topK,
        long? scopeId,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        bool recencyBoost = false)
    {
        return RetrieveAsync(userId, query, topK, scopeId, temporalFilter, metadataFilters, recencyBoost, null);
    }

    public async Task<List<RetrievedMemory>> RetrieveAsync(
        long userId,
        string query,
        int topK,
        long? scopeId,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        bool recencyBoost,
        List<string>? categoryFilters)
    {
        if (userId <= 0)
        {
            throw new ArgumentException(
                "Invalid userId.",
                nameof(userId));
        }

        if (string.IsNullOrWhiteSpace(query))
        {
            throw new ArgumentException(
                "Query cannot be empty.",
                nameof(query));
        }

        if (topK <= 0)
        {
            throw new ArgumentException(
                "TopK must be greater than zero.",
                nameof(topK));
        }

        // Step 1: Generate embedding for the user's query.
        var queryEmbedding =
            await _embeddingGenerator.GenerateAsync(query);

        // Step 2: Load active memory embeddings
        // for this user (filtered by ScopeId, temporalFilter, metadataFilters, and categoryFilters if provided).
        var hasCategoryFilter = categoryFilters != null && categoryFilters.Count > 0;
        var hasMemFilters = temporalFilter != null || (metadataFilters != null && metadataFilters.Count > 0);
        List<MemoryEmbeddingData> existingMemories;
        if (hasCategoryFilter)
        {
            existingMemories = await _memoryRepository.GetFilteredActiveMemoryEmbeddingsAsync(userId, scopeId, temporalFilter, metadataFilters, categoryFilters);
        }
        else if (hasMemFilters)
        {
            existingMemories = await _memoryRepository.GetFilteredActiveMemoryEmbeddingsAsync(userId, scopeId, temporalFilter, metadataFilters);
        }
        else
        {
            existingMemories = await _memoryRepository.GetActiveMemoryEmbeddingsAsync(userId, scopeId);
        }

        existingMemories ??= new List<MemoryEmbeddingData>();

        // Step 3: Calculate semantic similarity
        // between the query and every memory.
        var results = new List<RetrievedMemory>();
        var now = DateTime.UtcNow;

        foreach (var memory in existingMemories)
        {
            if (memory.Dimensions != queryEmbedding.Length)
            {
                continue;
            }

            if (!ExpirationHelper.IsNotExpired(memory.ExpiresAt, now))
            {
                continue;
            }

            var similarity =
                _similarityService.CalculateCosineSimilarity(
                    queryEmbedding,
                    memory.Embedding);

            if (recencyBoost)
            {
                var refDate = memory.OccurredAt ?? memory.CreatedAt;
                var ageInDays = Math.Max(0, (now - refDate).TotalDays);
                var recencyScore = Math.Exp(-0.05 * ageInDays);
                similarity = (0.85 * similarity) + (0.15 * recencyScore);
            }

            results.Add(new RetrievedMemory
            {
                MemoryId = memory.MemoryId,
                Content = memory.Content,
                MemoryType = memory.MemoryType,
                Similarity = similarity,
                CreatedAt = memory.CreatedAt,
                UpdatedAt = memory.UpdatedAt,
                OccurredAt = memory.OccurredAt,
                Metadata = memory.Metadata,
                ExpiresAt = memory.ExpiresAt,
                Categories = memory.Categories
            });
        }

        // Step 4: Select a larger candidate set.
        //
        // We use Math.Max(topK * 2, 10) candidates.
        // This gives the relevance evaluator enough memories to work with
        // without prematurely truncating when topK > 10 is requested.
        var candidateLimit = Math.Max(topK * 2, 10);
        var candidates =
            results
                .OrderByDescending(x => x.Similarity)
                .Take(candidateLimit)
                .ToList();

        if (candidates.Count == 0)
        {
            return new List<RetrievedMemory>();
        }

        // Step 5: Ask the relevance evaluator to determine
        // which candidate memories are genuinely relevant
        // to the user's query.
        var relevantMemories =
            await _relevanceEvaluator.EvaluateAsync(
                query,
                candidates);

        if (relevantMemories == null || relevantMemories.Count == 0)
        {
            return new List<RetrievedMemory>();
        }

        // Step 6: Preserve semantic similarity ranking
        // and return only the requested number of relevant
        // memories.
        return relevantMemories
            .OrderByDescending(x => x.Similarity)
            .Take(topK)
            .ToList();
    }
}