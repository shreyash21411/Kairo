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

    public async Task<List<RetrievedMemory>> RetrieveAsync(
        long userId,
        string query,
        int topK = 5,
        long? scopeId = null)
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
        // for this user (filtered by ScopeId if provided).
        var existingMemories =
            await _memoryRepository
                .GetActiveMemoryEmbeddingsAsync(userId, scopeId);

        // Step 3: Calculate semantic similarity
        // between the query and every memory.
        var results = new List<RetrievedMemory>();

        foreach (var memory in existingMemories)
        {
            if (memory.Dimensions != queryEmbedding.Length)
            {
                continue;
            }

            var similarity =
                _similarityService.CalculateCosineSimilarity(
                    queryEmbedding,
                    memory.Embedding);

            results.Add(new RetrievedMemory
            {
                MemoryId = memory.MemoryId,
                Content = memory.Content,
                MemoryType = memory.MemoryType,
                Similarity = similarity
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