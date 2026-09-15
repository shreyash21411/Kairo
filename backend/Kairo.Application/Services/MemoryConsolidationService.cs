using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;

namespace Kairo.Application.Services;

public class MemoryConsolidationService : IMemoryConsolidationService
{
    private readonly IMemoryRepository _memoryRepository;
    private readonly SemanticSimilarityService _similarityService;

    public MemoryConsolidationService(
        IMemoryRepository memoryRepository,
        SemanticSimilarityService similarityService)
    {
        _memoryRepository = memoryRepository;
        _similarityService = similarityService;
    }

    public async Task<MemoryConsolidationResult> ConsolidateAsync(
        MemoryConsolidationRequest request,
        long? scopeId = null)
    {
        if (request.UserId <= 0)
        {
            throw new ArgumentException(
                "Invalid userId.",
                nameof(request.UserId));
        }

        var effectiveScopeId = scopeId ?? request.ScopeId;

        var memories =
            await _memoryRepository
                .GetActiveMemoryEmbeddingsAsync(
                    request.UserId,
                    effectiveScopeId);

    var result = new MemoryConsolidationResult
    {
        MemoriesAnalyzed = memories.Count
    };

    const double candidateThreshold = 0.85;

    for (var i = 0; i < memories.Count; i++)
    {
        for (var j = i + 1; j < memories.Count; j++)
        {
            var memoryA = memories[i];
            var memoryB = memories[j];

            if (memoryA.Dimensions != memoryB.Dimensions)
            {
                continue;
            }

            var similarity =
                _similarityService.CalculateCosineSimilarity(
                    memoryA.Embedding,
                    memoryB.Embedding);

            if (similarity >= candidateThreshold)
{
    result.CandidatePairs++;

    result.Candidates.Add(
        new MemoryConsolidationCandidate
        {
            MemoryIdA = memoryA.MemoryId,
            MemoryIdB = memoryB.MemoryId,
            Similarity = similarity,
            ContentA = memoryA.Content,
            ContentB = memoryB.Content
        });
}
        }
    }

    return result;
}
}