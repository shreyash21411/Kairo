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

    public async Task<ChatProcessingResult> ProcessChatAsync(long chatId)
    {
        try
        {
            var processingStarted =
                await _chatRepository.MarkProcessingAsync(chatId);

            if (!processingStarted)
            {
                return new ChatProcessingResult
                {
                    Success = false,
                    Message = $"Chat {chatId} could not be marked as processing."
                };
            }

            var userId =
                await _chatRepository.GetUserIdByChatIdAsync(chatId);

            if (!userId.HasValue)
            {
                throw new InvalidOperationException(
                    $"Chat {chatId} does not exist.");
            }

            var projectId =
                await _chatRepository.GetProjectIdByChatIdAsync(chatId);

            // Phase 11.3 Decision 1: Scoped Chat without ActorId guard.
            // Evaluated BEFORE memory extraction to avoid unnecessary LLM calls, token usage,
            // and latency on chats that cannot produce scoped memories.
            // Under no circumstances may a NULL-Scope memory be created for a Project.
            if (projectId.HasValue)
            {
                await _chatRepository.MarkProcessedAsync(chatId);

                return new ChatProcessingResult
                {
                    Success = true,
                    Message = "Chat processed successfully. Memory creation skipped: Chat belongs to a Project but ActorId is unavailable in chat pipeline.",
                    ExtractedMemoryCount = 0,
                    CreatedMemoryCount = 0,
                    SkippedMemoryCount = 0,
                    MemorySkipReason = $"Chat belongs to ProjectId {projectId.Value} but ActorId is unavailable. ScopeId=NULL memories are blocked for scoped projects."
                };
            }

            // Legacy chat (ProjectId == null): Allow historical unscoped behavior for backward compatibility.
            var messages =
                await _chatRepository.GetMessagesAsync(chatId);

            var extractedMemories =
                await _memoryExtractor.ExtractAsync(messages);

            var existingEmbeddings =
                await _memoryRepository
                    .GetActiveMemoryEmbeddingsAsync(
                        userId.Value);

            var createdCount = 0;
            var skippedCount = 0;

            foreach (var memory in extractedMemories)
            {
                // Step 1: Exact duplicate check.
                var exists =
                    await _memoryRepository.ExistsAsync(
                        userId.Value,
                        memory.Content);

                if (exists)
                {
                    skippedCount++;
                    continue;
                }

                // Step 2: Generate embedding for the new memory.
                var embedding =
                    await _embeddingGenerator.GenerateAsync(
                        memory.Content);

                // Step 3: Check semantic similarity.
                var isSemanticDuplicate = false;
                var activeModel = _embeddingGenerator.GetModelName();

                foreach (var existing in existingEmbeddings)
                {
                    if (existing.Dimensions != embedding.Length ||
                        !EmbeddingGeneratorExtensions.IsModelCompatible(existing.Model, activeModel))
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
                    skippedCount++;
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

                createdCount++;

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

            return new ChatProcessingResult
            {
                Success = processed,
                Message = processed ? "Chat processed successfully." : "Failed to mark chat as processed.",
                ExtractedMemoryCount = extractedMemories.Count,
                CreatedMemoryCount = createdCount,
                SkippedMemoryCount = skippedCount
            };
        }
        catch (Exception ex)
        {
            await _chatRepository.MarkProcessingFailedAsync(
                chatId,
                ex.Message);

            return new ChatProcessingResult
            {
                Success = false,
                Message = ex.Message
            };
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

        long simulatedCounter = 1;

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
            var activeModel = _embeddingGenerator.GetModelName();

            foreach (var existing in existingEmbeddings)
            {
                if (existing.Dimensions != embedding.Length ||
                    !EmbeddingGeneratorExtensions.IsModelCompatible(existing.Model, activeModel))
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

            // Phase 11.3 Decision 2: SIMULATION-ONLY.
            // Diagnostic endpoints must never write real memories to the database.
            // Simulate creation without persisting to _memoryRepository.
            var simulatedMemoryId = -simulatedCounter++;

            result.CreatedMemoryCount++;
            result.CreatedMemoryIds.Add(simulatedMemoryId);

            // Step 6: Test working-set deduplication in-memory.
            existingEmbeddings.Add(
                new MemoryEmbeddingData
                {
                    MemoryId = simulatedMemoryId,
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