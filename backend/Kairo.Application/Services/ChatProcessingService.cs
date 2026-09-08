using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Constants;
using Kairo.Application.DTOs;

namespace Kairo.Application.Services;

public class ChatProcessingService : IChatProcessingService
{
    private readonly IChatRepository _chatRepository;
    private readonly IMemoryRepository _memoryRepository;
    private readonly IMemoryExtractor _memoryExtractor;
    private readonly IEmbeddingGenerator _embeddingGenerator;
    private readonly SemanticSimilarityService _similarityService;

    public ChatProcessingService(
        IChatRepository chatRepository,
        IMemoryExtractor memoryExtractor,
        IMemoryRepository memoryRepository,
        IEmbeddingGenerator embeddingGenerator,
        SemanticSimilarityService similarityService)
    {
        _chatRepository = chatRepository;
        _memoryExtractor = memoryExtractor;
        _memoryRepository = memoryRepository;
        _embeddingGenerator = embeddingGenerator;
        _similarityService = similarityService;
    }

    public async Task<bool> ProcessChatAsync(long chatId)
    {
        try
        {
            var processingStarted =
                await _chatRepository.MarkProcessingAsync(chatId);

            if (!processingStarted)
            {
                return false;
            }

            var messages =
                await _chatRepository.GetMessagesAsync(chatId);

            var extractedMemories =
                await _memoryExtractor.ExtractAsync(messages);

            var userId =
                await _chatRepository.GetUserIdByChatIdAsync(chatId);

            if (!userId.HasValue)
            {
                throw new InvalidOperationException(
                    $"Chat {chatId} does not exist.");
            }

            // Load existing memory embeddings ONCE.
            var existingEmbeddings =
                await _memoryRepository
                    .GetActiveMemoryEmbeddingsAsync(
                        userId.Value);

            foreach (var memory in extractedMemories)
            {
                // Step 1: Exact duplicate check.
                var exists =
                    await _memoryRepository.ExistsAsync(
                        userId.Value,
                        memory.Content);

                if (exists)
                {
                    continue;
                }

                // Step 2: Generate embedding for the new memory.
                var embedding =
                    await _embeddingGenerator.GenerateAsync(
                        memory.Content);

                // Step 3: Check semantic similarity.
                var isSemanticDuplicate = false;

                foreach (var existing in existingEmbeddings)
                {
                    if (existing.Dimensions != embedding.Length)
                    {
                        continue;
                    }

                    var similarity =
                        _similarityService.CalculateCosineSimilarity(
                            embedding,
                            existing.Embedding);

                    if (similarity >=
                        SemanticMemoryConstants
                            .DuplicateSimilarityThreshold)
                    {
                        isSemanticDuplicate = true;
                        break;
                    }
                }

                // Step 4: Skip semantic duplicate.
                if (isSemanticDuplicate)
                {
                    continue;
                }

                // Step 5: Create genuinely new memory.
                var memoryId =
                    await _memoryRepository.CreateAsync(
                        userId.Value,
                        memory,
                        chatId);

                // Step 6: Save its embedding.
                await _memoryRepository.SaveEmbeddingAsync(
                    memoryId,
                    "mistral-embed",
                    embedding);

                // Step 7: Add the newly-created memory to the
                // in-memory working set.
                existingEmbeddings.Add(
                    new MemoryEmbeddingData
                    {
                        MemoryId = memoryId,
                        Content = memory.Content,
                        MemoryType = memory.MemoryType,
                        Model = "mistral-embed",
                        Dimensions = embedding.Length,
                        Embedding = embedding
                    });
            }

            var processed =
                await _chatRepository.MarkProcessedAsync(chatId);

            return processed;
        }
        catch (Exception ex)
        {
            await _chatRepository.MarkProcessingFailedAsync(
                chatId,
                ex.Message);

            return false;
        }
    }

    public async Task<WorkingSetTestResult> TestWorkingSetDedupAsync(
    WorkingSetTestRequest request)
{
    if (request.UserId <= 0)
    {
        throw new ArgumentException(
            "Invalid userId.",
            nameof(request.UserId));
    }

    if (request.MemoryA == null || request.MemoryB == null)
    {
        throw new ArgumentException(
            "Both MemoryA and MemoryB are required.");
    }

    var existingEmbeddings =
        await _memoryRepository
            .GetActiveMemoryEmbeddingsAsync(request.UserId);

    var result = new WorkingSetTestResult
    {
        InputMemoryCount = 2
    };

    var memories = new[]
    {
        request.MemoryA,
        request.MemoryB
    };

    foreach (var memory in memories)
    {
        // Step 1: Exact duplicate check.
        var exists =
            await _memoryRepository.ExistsAsync(
                request.UserId,
                memory.Content);

        if (exists)
        {
            result.ExactDuplicateCount++;
            continue;
        }

        // Step 2: Generate embedding.
        var embedding =
            await _embeddingGenerator.GenerateAsync(
                memory.Content);

        // Step 3: Semantic duplicate check.
        var isSemanticDuplicate = false;

        foreach (var existing in existingEmbeddings)
        {
            if (existing.Dimensions != embedding.Length)
            {
                continue;
            }

            var similarity =
                _similarityService.CalculateCosineSimilarity(
                    embedding,
                    existing.Embedding);

            if (similarity >=
                SemanticMemoryConstants
                    .DuplicateSimilarityThreshold)
            {
                isSemanticDuplicate = true;
                break;
            }
        }

        // Step 4: Skip semantic duplicate.
        if (isSemanticDuplicate)
        {
            result.SemanticDuplicateCount++;
            continue;
        }

        // Step 5: Create genuinely new memory.
        var memoryId =
            await _memoryRepository.CreateAsync(
                request.UserId,
                memory,
                null);

        await _memoryRepository.SaveEmbeddingAsync(
            memoryId,
            "mistral-embed",
            embedding);

        result.CreatedMemoryCount++;
        result.CreatedMemoryIds.Add(memoryId);

        // ⭐ Step 6: THIS IS THE WORKING-SET TEST.
        existingEmbeddings.Add(
            new MemoryEmbeddingData
            {
                MemoryId = memoryId,
                Content = memory.Content,
                MemoryType = memory.MemoryType,
                Model = "mistral-embed",
                Dimensions = embedding.Length,
                Embedding = embedding
            });
    }

    return result;
}


}