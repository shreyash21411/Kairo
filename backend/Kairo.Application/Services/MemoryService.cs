using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Constants;
using Kairo.Application.DTOs;

namespace Kairo.Application.Services;

/// <summary>
/// Implements all V1 public memory API operations.
///
/// Duplicate-safety on Create mirrors the existing pipeline in
/// <see cref="ChatProcessingService"/> exactly:
///   1. Exact text duplicate check   → skip
///   2. Semantic similarity check    → skip if ≥ DuplicateSimilarityThreshold
///   3. Persist memory + embedding
///
/// No embedding, cosine-similarity, or Mistral logic is duplicated here;
/// those concerns are fully delegated to <see cref="IEmbeddingGenerator"/>,
/// <see cref="SemanticSimilarityService"/>, and
/// <see cref="MemoryRetrievalService"/>.
/// </summary>
public class MemoryService : IMemoryService
{
    // ── Dependencies ──────────────────────────────────────────────────────────

    private readonly IMemoryRepository _memoryRepository;
    private readonly IUserRepository _userRepository;
    private readonly IEmbeddingGenerator _embeddingGenerator;
    private readonly SemanticSimilarityService _similarityService;
    private readonly MemoryRetrievalService _retrievalService;
    private readonly IScopeResolutionService _scopeResolutionService;

    // Model name used consistently across the existing pipeline.
    private const string EmbeddingModel = "mistral-embed";

    // ── Valid memory type values ───────────────────────────────────────────────

    private static readonly HashSet<string> ValidMemoryTypes = new(
        StringComparer.OrdinalIgnoreCase)
    {
        "Preference",
        "Fact",
        "Goal",
        "Context",
        "Skill",
        "Relationship",
        "Other"
    };

    public MemoryService(
        IMemoryRepository memoryRepository,
        IUserRepository userRepository,
        IEmbeddingGenerator embeddingGenerator,
        SemanticSimilarityService similarityService,
        MemoryRetrievalService retrievalService,
        IScopeResolutionService scopeResolutionService)
    {
        _memoryRepository = memoryRepository;
        _userRepository = userRepository;
        _embeddingGenerator = embeddingGenerator;
        _similarityService = similarityService;
        _retrievalService = retrievalService;
        _scopeResolutionService = scopeResolutionService;
    }

    // ── CreateMemoryAsync ─────────────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<(MemoryResponse? Memory, MemoryDuplicateResult? Duplicate)>
        CreateMemoryAsync(
            CreateMemoryRequest request,
            long userId,
            long? projectId = null,
            CancellationToken cancellationToken = default)
    {
        // ── Validate authenticated user ───────────────────────────────────────

        ValidateUserId(userId);

        // ── Validate input ────────────────────────────────────────────────────

        if (string.IsNullOrWhiteSpace(request.Content))
        {
            throw new ArgumentException(
                "Content cannot be empty.",
                nameof(request.Content));
        }

        if (request.Content.Length > 10_000)
        {
            throw new ArgumentException(
                "Content must not exceed 10,000 characters.",
                nameof(request.Content));
        }

        if (string.IsNullOrWhiteSpace(request.MemoryType))
        {
            throw new ArgumentException(
                "MemoryType cannot be empty.",
                nameof(request.MemoryType));
        }

        if (!ValidMemoryTypes.Contains(request.MemoryType))
        {
            throw new ArgumentException(
                $"MemoryType '{request.MemoryType}' is not valid. " +
                $"Accepted values: {string.Join(", ", ValidMemoryTypes)}.",
                nameof(request.MemoryType));
        }

        // ── Step 0: Resolve MemoryScope (if project context is provided) ───────

        long? scopeId = null;
        if (projectId.HasValue)
        {
            if (request.Scope != null && !request.Scope.IsEmpty)
            {
                scopeId = await _scopeResolutionService.GetOrCreateFromScopeKeyAsync(
                    projectId.Value,
                    request.Scope,
                    cancellationToken);
            }
            else if (!string.IsNullOrWhiteSpace(request.ActorId))
            {
                scopeId = await _scopeResolutionService.GetOrCreateScopeAsync(
                    projectId.Value,
                    request.ActorId,
                    cancellationToken);
            }
            else
            {
                throw new ArgumentException(
                    "ActorId or Scope must be provided.",
                    nameof(request.ActorId));
            }
        }

        // ── Verify authenticated user exists ──────────────────────────────────

        var userExists = await _userRepository.ExistsByIdAsync(userId);

        if (!userExists)
        {
            throw new ArgumentException(
                $"User {userId} does not exist.",
                nameof(userId));
        }

        // ── Step 1: Exact duplicate check ─────────────────────────────────────

        var exactDuplicate = await _memoryRepository.ExistsAsync(
            userId,
            request.Content,
            scopeId);

        if (exactDuplicate)
        {
            return (null, new MemoryDuplicateResult
            {
                IsDuplicate = true,
                Reason = "An identical memory already exists for this user."
            });
        }

        // ── Step 2: Generate embedding ────────────────────────────────────────

        var embedding = await _embeddingGenerator.GenerateAsync(
            request.Content);

        // ── Step 3: Semantic duplicate check ──────────────────────────────────

        var existingEmbeddings =
            await _memoryRepository.GetActiveMemoryEmbeddingsAsync(
                userId,
                scopeId);

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
                SemanticMemoryConstants.DuplicateSimilarityThreshold)
            {
                return (null, new MemoryDuplicateResult
                {
                    IsDuplicate = true,
                    Reason =
                        $"Semantically equivalent to existing memory " +
                        $"{existing.MemoryId} " +
                        $"(similarity: {similarity:F4})."
                });
            }
        }

        // ── Step 4: Persist memory ────────────────────────────────────────────

        var extractedMemory = new ExtractedMemory
        {
            Content = request.Content.Trim(),
            MemoryType = request.MemoryType
        };

        var memoryId = await _memoryRepository.CreateAsync(
            userId,
            extractedMemory,
            sourceChatId: null,
            scopeId: scopeId);

        // ── Step 5: Persist embedding ─────────────────────────────────────────

        await _memoryRepository.SaveEmbeddingAsync(
            memoryId,
            EmbeddingModel,
            embedding);

        // ── Return the created memory ─────────────────────────────────────────

        var snapshot =
            await _memoryRepository.GetMemorySnapshotForUserAsync(
                memoryId,
                userId);

        return (SnapshotToResponse(snapshot!), null);
    }

    // ── GetMemoryAsync ────────────────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<MemoryResponse> GetMemoryAsync(
        long memoryId,
        long userId,
        long? projectId = null,
        long? scopeId = null)
    {
        ValidateMemoryId(memoryId);
        ValidateUserId(userId);

        var snapshot =
            await _memoryRepository.GetMemorySnapshotForUserAsync(
                memoryId,
                userId,
                projectId,
                scopeId);

        if (snapshot == null)
        {
            throw new KeyNotFoundException(
                $"Memory {memoryId} was not found or does not belong to the current project.");
        }

        return SnapshotToResponse(snapshot);
    }

    // ── ListMemoriesAsync ─────────────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<List<MemoryResponse>> ListMemoriesAsync(
        long userId,
        long? projectId = null)
    {
        ValidateUserId(userId);

        var items =
            await _memoryRepository.GetActiveMemoriesAsync(userId, projectId);

        return items.Select(item => new MemoryResponse
        {
            MemoryId = item.MemoryId,
            UserId = userId,
            Content = item.Content,
            MemoryType = item.MemoryType,
            IsActive = true,
            CreatedAt = item.CreatedAt,
            UpdatedAt = item.UpdatedAt
        }).ToList();
    }

    // ── UpdateMemoryAsync ─────────────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<MemoryResponse> UpdateMemoryAsync(
        long memoryId,
        UpdateMemoryRequest request,
        long userId,
        long? projectId = null,
        long? scopeId = null)
    {
        ValidateMemoryId(memoryId);
        ValidateUserId(userId);

        // ── Validate input ────────────────────────────────────────────────────

        if (string.IsNullOrWhiteSpace(request.Content))
        {
            throw new ArgumentException(
                "Content cannot be empty.",
                nameof(request.Content));
        }

        if (request.Content.Length > 10_000)
        {
            throw new ArgumentException(
                "Content must not exceed 10,000 characters.",
                nameof(request.Content));
        }

        if (string.IsNullOrWhiteSpace(request.MemoryType))
        {
            throw new ArgumentException(
                "MemoryType cannot be empty.",
                nameof(request.MemoryType));
        }

        if (!ValidMemoryTypes.Contains(request.MemoryType))
        {
            throw new ArgumentException(
                $"MemoryType '{request.MemoryType}' is not valid. " +
                $"Accepted values: {string.Join(", ", ValidMemoryTypes)}.",
                nameof(request.MemoryType));
        }

        // ── Ownership check ───────────────────────────────────────────────────

        var snapshot =
            await _memoryRepository.GetMemorySnapshotForUserAsync(
                memoryId,
                userId,
                projectId,
                scopeId);

        if (snapshot == null)
        {
            throw new KeyNotFoundException(
                $"Memory {memoryId} was not found or does not belong " +
                $"to the current project.");
        }

        // ── Step 1: Archive the current state BEFORE mutating ─────────────────

        await _memoryRepository.CreateMemoryVersionAsync(
            memoryId,
            snapshot.Content,
            "ApiUpdate");

        // ── Step 2: Update canonical content ──────────────────────────────────

        await _memoryRepository.UpdateMemoryContentAsync(
            memoryId,
            request.Content.Trim());

        // ── Step 3: Regenerate and replace the embedding ──────────────────────

        var freshEmbedding =
            await _embeddingGenerator.GenerateAsync(
                request.Content);

        await _memoryRepository.ReplaceEmbeddingAsync(
            memoryId,
            EmbeddingModel,
            freshEmbedding);

        // ── Return the updated snapshot ────────────────────────────────────────

        var updated =
            await _memoryRepository.GetMemorySnapshotForUserAsync(
                memoryId,
                userId,
                projectId,
                scopeId);

        return SnapshotToResponse(updated!);
    }

    // ── DeleteMemoryAsync ─────────────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task DeleteMemoryAsync(
        long memoryId,
        long userId,
        long? projectId = null,
        long? scopeId = null)
    {
        ValidateMemoryId(memoryId);
        ValidateUserId(userId);

        // ── Ownership check ───────────────────────────────────────────────────

        var snapshot =
            await _memoryRepository.GetMemorySnapshotForUserAsync(
                memoryId,
                userId,
                projectId,
                scopeId);

        if (snapshot == null)
        {
            throw new KeyNotFoundException(
                $"Memory {memoryId} was not found or does not belong to the current project.");
        }

        // ── Step 1: Archive current state BEFORE deactivating ─────────────────

        await _memoryRepository.CreateMemoryVersionAsync(
            memoryId,
            snapshot.Content,
            "ApiDelete");

        // ── Step 2: Soft delete ───────────────────────────────────────────────

        await _memoryRepository.DeactivateMemoryAsync(memoryId);
    }

    // ── SearchMemoriesAsync ───────────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<MemorySearchResponse> SearchMemoriesAsync(
        MemorySearchRequest request,
        long userId,
        long? projectId = null,
        CancellationToken cancellationToken = default)
    {
        ValidateUserId(userId);

        if (string.IsNullOrWhiteSpace(request.Query))
        {
            throw new ArgumentException(
                "Query cannot be empty.",
                nameof(request.Query));
        }

        if (request.TopK <= 0)
        {
            throw new ArgumentException(
                "TopK must be greater than zero.",
                nameof(request.TopK));
        }

        if (request.TopK > 100)
        {
            throw new ArgumentException(
                "TopK must not exceed 100.",
                nameof(request.TopK));
        }

        long? scopeId = null;
        if (projectId.HasValue)
        {
            if (request.Scope != null && !request.Scope.IsEmpty)
            {
                try
                {
                    scopeId = await _scopeResolutionService.ResolveFromScopeKeyAsync(
                        projectId.Value,
                        request.Scope,
                        cancellationToken);
                }
                catch (MemoryScopeNotFoundException)
                {
                    return new MemorySearchResponse
                    {
                        Query = request.Query,
                        Count = 0,
                        Memories = []
                    };
                }
            }
            else if (!string.IsNullOrWhiteSpace(request.ActorId))
            {
                try
                {
                    scopeId = await _scopeResolutionService.ResolveScopeAsync(
                        projectId.Value,
                        request.ActorId,
                        cancellationToken);
                }
                catch (MemoryScopeNotFoundException)
                {
                    // An actor who has never created a memory has no MemoryScope record yet.
                    // A search for an actor with no memories is a valid read-only query that returns empty results.
                    return new MemorySearchResponse
                    {
                        Query = request.Query,
                        Count = 0,
                        Memories = []
                    };
                }
            }
            else
            {
                throw new ArgumentException(
                    "ActorId or Scope must be provided.",
                    nameof(request.ActorId));
            }
        }

        // Delegate entirely to the existing retrieval pipeline:
        //
        // embedding → cosine similarity → Mistral relevance evaluation.
        var memories =
            await _retrievalService.RetrieveAsync(
                userId,
                request.Query,
                request.TopK,
                scopeId);

        return new MemorySearchResponse
        {
            Query = request.Query,
            Count = memories.Count,
            Memories = memories
        };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static void ValidateMemoryId(long memoryId)
    {
        if (memoryId <= 0)
        {
            throw new ArgumentException(
                "memoryId must be a positive integer.",
                nameof(memoryId));
        }
    }

    private static void ValidateUserId(long userId)
    {
        if (userId <= 0)
        {
            throw new ArgumentException(
                "userId must be a positive integer.",
                nameof(userId));
        }
    }

    private static MemoryResponse SnapshotToResponse(
        MemorySnapshot snapshot)
    {
        return new MemoryResponse
        {
            MemoryId = snapshot.MemoryId,
            UserId = snapshot.UserId,
            Content = snapshot.Content,
            MemoryType = snapshot.MemoryType,
            IsActive = snapshot.IsActive,
            CreatedAt = snapshot.CreatedAt,
            UpdatedAt = snapshot.UpdatedAt
        };
    }
}