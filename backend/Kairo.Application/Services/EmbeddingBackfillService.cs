using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Microsoft.Extensions.Options;

namespace Kairo.Application.Services;

public class EmbeddingBackfillService : IEmbeddingBackfillService
{
    private readonly IMemoryRepository _memoryRepository;
    private readonly IEmbeddingGenerator _embeddingGenerator;
    private readonly string _embeddingModel;

    public EmbeddingBackfillService(
        IMemoryRepository memoryRepository,
        IEmbeddingGenerator embeddingGenerator,
        IOptions<MistralEmbeddingOptions> embeddingOptions)
    {
        _memoryRepository = memoryRepository;
        _embeddingGenerator = embeddingGenerator;
        _embeddingModel = embeddingOptions.Value.Model;
    }

    public async Task<EmbeddingBackfillResult> BackfillAsync(long userId)
    {
        if (userId <= 0)
        {
            throw new ArgumentException(
                "Invalid userId.",
                nameof(userId));
        }

        // Memories that already have embeddings (used only for count reporting).
        var alreadyPresent =
            await _memoryRepository
                .GetActiveMemoryEmbeddingsAsync(userId);

        // Memories that need backfill.
        var missing =
            await _memoryRepository
                .GetActiveMemoriesWithoutEmbeddingsAsync(userId);

        var result = new EmbeddingBackfillResult
        {
            UserId = userId,
            MemoriesAnalyzed = alreadyPresent.Count + missing.Count,
            EmbeddingsAlreadyPresent = alreadyPresent.Count
        };

        foreach (var memory in missing)
        {
            try
            {
                var embedding =
                    await _embeddingGenerator.GenerateAsync(memory.Content);

                await _memoryRepository.SaveEmbeddingAsync(
                    memory.MemoryId,
                    _embeddingModel,
                    embedding);

                result.EmbeddingsGenerated++;
            }
            catch (Exception ex)
            {
                result.EmbeddingFailures++;
                result.Failures.Add(new EmbeddingBackfillFailure
                {
                    MemoryId = memory.MemoryId,
                    Content = memory.Content,
                    ErrorMessage = ex.Message
                });
            }
        }

        return result;
    }
}
