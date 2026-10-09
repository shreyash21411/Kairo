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
    private readonly IEntityRepository? _entityRepository;
    private readonly IEntityExtractionService? _entityExtractionService;

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
        IScopeResolutionService scopeResolutionService,
        IEntityRepository? entityRepository = null,
        IEntityExtractionService? entityExtractionService = null)
    {
        _memoryRepository = memoryRepository;
        _userRepository = userRepository;
        _embeddingGenerator = embeddingGenerator;
        _similarityService = similarityService;
        _retrievalService = retrievalService;
        _scopeResolutionService = scopeResolutionService;
        _entityRepository = entityRepository;
        _entityExtractionService = entityExtractionService;
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

        var metadataJson = request.Metadata != null && request.Metadata.Count > 0
            ? System.Text.Json.JsonSerializer.Serialize(request.Metadata)
            : null;

        if (metadataJson != null && metadataJson.Length > 8_192)
        {
            throw new ArgumentException(
                "Metadata must not exceed 8,192 characters when serialized as JSON.",
                nameof(request.Metadata));
        }

        var normalizedCategories = CategoryValidator.ValidateAndNormalize(request.Categories);
        var expiresAt = ExpirationHelper.ResolveExpiresAt(request.ExpiresAt, request.Ttl);

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
            scopeId: scopeId,
            occurredAt: request.OccurredAt,
            metadata: metadataJson,
            expiresAt: expiresAt,
            categories: normalizedCategories);

        // ── Step 5: Persist embedding ─────────────────────────────────────────

        await _memoryRepository.SaveEmbeddingAsync(
            memoryId,
            EmbeddingModel,
            embedding);

        // ── Step 6: Entity & Graph extraction (non-fatal) ─────────────────────
        if (_entityRepository != null && _entityExtractionService != null && projectId.HasValue && scopeId.HasValue)
        {
            try
            {
                var extraction = await _entityExtractionService.ExtractFullAsync(request.Content.Trim(), cancellationToken);
                var entities = extraction?.Entities ?? await _entityExtractionService.ExtractAsync(request.Content.Trim(), cancellationToken);
                if (entities != null && entities.Count > 0)
                {
                    await _entityRepository.UpsertEntitiesForMemoryAsync(projectId.Value, memoryId, entities, cancellationToken);
                }
                if (extraction?.Relationships != null && extraction.Relationships.Count > 0)
                {
                    await _entityRepository.UpsertRelationshipsForMemoryAsync(projectId.Value, scopeId.Value, memoryId, extraction.Relationships, cancellationToken);
                }
            }
            catch
            {
                // Non-fatal
            }
        }

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
            UpdatedAt = item.UpdatedAt,
            OccurredAt = item.OccurredAt,
            Metadata = item.Metadata,
            ExpiresAt = item.ExpiresAt,
            Categories = item.Categories
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

        var metadataJson = request.Metadata != null && request.Metadata.Count > 0
            ? System.Text.Json.JsonSerializer.Serialize(request.Metadata)
            : null;

        if (metadataJson != null && metadataJson.Length > 8_192)
        {
            throw new ArgumentException(
                "Metadata must not exceed 8,192 characters when serialized as JSON.",
                nameof(request.Metadata));
        }

        var updateCategories = request.Categories != null;
        var normalizedCategories = updateCategories ? CategoryValidator.ValidateAndNormalize(request.Categories) : null;
        var updateExpiresAt = request.ExpiresAt.HasValue || request.Ttl.HasValue;
        var expiresAt = updateExpiresAt ? ExpirationHelper.ResolveExpiresAt(request.ExpiresAt, request.Ttl) : null;

        await _memoryRepository.UpdateMemoryContentAsync(
            memoryId,
            request.Content.Trim(),
            request.OccurredAt,
            metadataJson,
            updateExpiresAt,
            expiresAt,
            updateCategories,
            normalizedCategories);

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

        var metadataConditions = request.GetEffectiveMetadataFilters();
        var effectiveCategories = request.GetEffectiveCategories();

        // Delegate to retrieval pipeline (with temporalFilter, metadataFilters, recencyBoost, categoryFilters):
        var memories =
            await _retrievalService.RetrieveAsync(
                userId,
                request.Query,
                request.TopK,
                scopeId,
                request.Temporal,
                metadataConditions,
                request.RecencyBoost.GetValueOrDefault(false),
                effectiveCategories.Count > 0 ? effectiveCategories : null);

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
            UpdatedAt = snapshot.UpdatedAt,
            OccurredAt = snapshot.OccurredAt,
            Metadata = snapshot.Metadata,
            ExpiresAt = snapshot.ExpiresAt,
            Categories = snapshot.Categories
        };
    }

    // ── Phase 3: Batch Operations ─────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<BatchCreateResponse> BatchCreateMemoriesAsync(
        BatchCreateMemoryRequest request,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default)
    {
        ValidateUserId(userId);

        if (request == null || request.Memories == null || request.Memories.Count == 0 || request.Memories.Count > BatchCreateMemoryRequest.MaxBatchSize)
        {
            throw new ArgumentException(
                $"Batch size must be between 1 and {BatchCreateMemoryRequest.MaxBatchSize} items.");
        }

        var userExists = await _userRepository.ExistsByIdAsync(userId);
        if (!userExists)
            throw new ArgumentException($"User {userId} does not exist.", nameof(userId));

        // ── Phase 1 of batch: Validate all items before any writes ────────────
        var preparedItems = new List<(BatchCreateMemoryItem item, string? metadataJson, List<string> categories, DateTime? expiresAt, long scopeId, float[] embedding, List<ExtractedEntity>? entities, List<ExtractedRelationship>? relationships)>();

        for (int i = 0; i < request.Memories.Count; i++)
        {
            var item = request.Memories[i];

            if (string.IsNullOrWhiteSpace(item.Content))
                throw new ArgumentException($"Batch item at index {i} has empty content.");
            if (item.Content.Length > 10_000)
                throw new ArgumentException($"Batch item at index {i} exceeds 10,000 characters.");
            if (string.IsNullOrWhiteSpace(item.MemoryType) || !ValidMemoryTypes.Contains(item.MemoryType))
                throw new ArgumentException($"Batch item at index {i} has invalid MemoryType '{item.MemoryType}'.");

            var metadataJson = item.Metadata != null && item.Metadata.Count > 0
                ? System.Text.Json.JsonSerializer.Serialize(item.Metadata)
                : null;

            if (metadataJson != null && metadataJson.Length > 8_192)
                throw new ArgumentException($"Batch item at index {i} metadata exceeds 8,192 characters.");

            var normalizedCategories = CategoryValidator.ValidateAndNormalize(item.Categories);
            var expiresAt = ExpirationHelper.ResolveExpiresAt(item.ExpiresAt, item.Ttl);

            // Resolve scope within authenticated project
            long scopeId;
            if (item.Scope != null && !item.Scope.IsEmpty)
            {
                scopeId = await _scopeResolutionService.GetOrCreateFromScopeKeyAsync(projectId, item.Scope, cancellationToken);
            }
            else if (!string.IsNullOrWhiteSpace(item.ActorId))
            {
                scopeId = await _scopeResolutionService.GetOrCreateScopeAsync(projectId, item.ActorId, cancellationToken);
            }
            else
            {
                throw new ArgumentException($"Batch item at index {i} must specify ActorId or Scope.");
            }

            // Generate embedding
            var embedding = await _embeddingGenerator.GenerateAsync(item.Content.Trim());

            // Extract entities/relationships if available
            List<ExtractedEntity>? entities = null;
            List<ExtractedRelationship>? relationships = null;
            if (_entityExtractionService != null && _entityRepository != null)
            {
                try
                {
                    var extraction = await _entityExtractionService.ExtractFullAsync(item.Content.Trim(), cancellationToken);
                    entities = extraction?.Entities ?? await _entityExtractionService.ExtractAsync(item.Content.Trim(), cancellationToken);
                    relationships = extraction?.Relationships;
                }
                catch
                {
                    // Non-fatal extraction
                }
            }

            preparedItems.Add((item, metadataJson, normalizedCategories, expiresAt, scopeId, embedding, entities, relationships));
        }

        // ── Phase 2 of batch: Persist all prepared items ──────────────────────
        var createdMemories = new List<MemoryResponse>();

        foreach (var p in preparedItems)
        {
            var extractedMemory = new ExtractedMemory
            {
                Content = p.item.Content.Trim(),
                MemoryType = p.item.MemoryType
            };

            var memoryId = await _memoryRepository.CreateAsync(
                userId,
                extractedMemory,
                sourceChatId: null,
                scopeId: p.scopeId,
                occurredAt: p.item.OccurredAt,
                metadata: p.metadataJson,
                expiresAt: p.expiresAt,
                categories: p.categories);

            await _memoryRepository.SaveEmbeddingAsync(memoryId, EmbeddingModel, p.embedding);

            if (_entityRepository != null)
            {
                if (p.entities != null && p.entities.Count > 0)
                {
                    await _entityRepository.UpsertEntitiesForMemoryAsync(projectId, memoryId, p.entities, cancellationToken);
                }
                if (p.relationships != null && p.relationships.Count > 0)
                {
                    await _entityRepository.UpsertRelationshipsForMemoryAsync(projectId, p.scopeId, memoryId, p.relationships, cancellationToken);
                }
            }

            var snapshot = await _memoryRepository.GetMemorySnapshotForUserAsync(memoryId, userId, projectId);
            if (snapshot != null)
                createdMemories.Add(SnapshotToResponse(snapshot));
        }

        return new BatchCreateResponse
        {
            Success = true,
            CreatedCount = createdMemories.Count,
            Memories = createdMemories
        };
    }

    /// <inheritdoc/>
    public async Task<BatchUpdateResponse> BatchUpdateMemoriesAsync(
        BatchUpdateMemoryRequest request,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default)
    {
        ValidateUserId(userId);

        if (request == null || request.Memories == null || request.Memories.Count == 0 || request.Memories.Count > BatchUpdateMemoryRequest.MaxBatchSize)
        {
            throw new ArgumentException(
                $"Batch size must be between 1 and {BatchUpdateMemoryRequest.MaxBatchSize} items.");
        }

        // Check duplicate memory IDs
        var ids = request.Memories.Select(m => m.MemoryId).ToList();
        if (ids.Distinct().Count() != ids.Count)
        {
            throw new ArgumentException("Duplicate MemoryId in batch update request.");
        }

        // ── Ownership and IDOR check for ALL memories first ───────────────────
        var snapshots = new Dictionary<long, MemorySnapshot>();
        foreach (var item in request.Memories)
        {
            ValidateMemoryId(item.MemoryId);

            var snapshot = await _memoryRepository.GetMemorySnapshotForUserAsync(item.MemoryId, userId, projectId);
            if (snapshot == null)
            {
                throw new KeyNotFoundException(
                    $"Memory {item.MemoryId} was not found or does not belong to the current project.");
            }
            snapshots[item.MemoryId] = snapshot;
        }

        // Validate items
        var preparedUpdates = new List<(BatchUpdateMemoryItem item, MemorySnapshot snapshot, string content, string? metadataJson, bool updateCategories, List<string>? categories, bool updateExpiresAt, DateTime? expiresAt)>();

        for (int i = 0; i < request.Memories.Count; i++)
        {
            var item = request.Memories[i];
            var snapshot = snapshots[item.MemoryId];

            var content = !string.IsNullOrWhiteSpace(item.Content)
                ? item.Content.Trim()
                : snapshot.Content;

            if (content.Length > 10_000)
                throw new ArgumentException($"Batch item at index {i} content exceeds 10,000 characters.");

            if (!string.IsNullOrWhiteSpace(item.MemoryType) && !ValidMemoryTypes.Contains(item.MemoryType))
                throw new ArgumentException($"Batch item at index {i} has invalid MemoryType '{item.MemoryType}'.");

            var metadataJson = item.Metadata != null && item.Metadata.Count > 0
                ? System.Text.Json.JsonSerializer.Serialize(item.Metadata)
                : snapshot.Metadata;

            if (metadataJson != null && metadataJson.Length > 8_192)
                throw new ArgumentException($"Batch item at index {i} metadata exceeds 8,192 characters.");

            var updateCategories = item.Categories != null;
            var normalizedCategories = updateCategories ? CategoryValidator.ValidateAndNormalize(item.Categories) : null;

            var updateExpiresAt = item.ExpiresAt.HasValue || item.Ttl.HasValue;
            var expiresAt = updateExpiresAt ? ExpirationHelper.ResolveExpiresAt(item.ExpiresAt, item.Ttl) : null;

            preparedUpdates.Add((item, snapshot, content, metadataJson, updateCategories, normalizedCategories, updateExpiresAt, expiresAt));
        }

        // ── Apply updates ─────────────────────────────────────────────────────
        var updatedMemories = new List<MemoryResponse>();

        foreach (var p in preparedUpdates)
        {
            await _memoryRepository.CreateMemoryVersionAsync(p.item.MemoryId, p.snapshot.Content, "ApiBatchUpdate");

            await _memoryRepository.UpdateMemoryContentAsync(
                p.item.MemoryId,
                p.content,
                p.item.OccurredAt ?? p.snapshot.OccurredAt,
                p.metadataJson,
                p.updateExpiresAt,
                p.expiresAt,
                p.updateCategories,
                p.categories);

            if (!string.IsNullOrWhiteSpace(p.item.Content) && p.item.Content.Trim() != p.snapshot.Content)
            {
                var freshEmbedding = await _embeddingGenerator.GenerateAsync(p.content);
                await _memoryRepository.ReplaceEmbeddingAsync(p.item.MemoryId, EmbeddingModel, freshEmbedding);
            }

            var updatedSnapshot = await _memoryRepository.GetMemorySnapshotForUserAsync(p.item.MemoryId, userId, projectId);
            if (updatedSnapshot != null)
                updatedMemories.Add(SnapshotToResponse(updatedSnapshot));
        }

        return new BatchUpdateResponse
        {
            Success = true,
            UpdatedCount = updatedMemories.Count,
            Memories = updatedMemories
        };
    }

    /// <inheritdoc/>
    public async Task<BatchDeleteResponse> BatchDeleteMemoriesAsync(
        BatchDeleteMemoryRequest request,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default)
    {
        ValidateUserId(userId);

        if (request == null || request.MemoryIds == null || request.MemoryIds.Count == 0 || request.MemoryIds.Count > BatchDeleteMemoryRequest.MaxBatchSize)
        {
            throw new ArgumentException(
                $"Batch size must be between 1 and {BatchDeleteMemoryRequest.MaxBatchSize} items.");
        }

        var distinctIds = request.MemoryIds.Distinct().ToList();

        // ── Ownership and IDOR check for ALL memories first ───────────────────
        var snapshots = new Dictionary<long, MemorySnapshot>();
        foreach (var id in distinctIds)
        {
            ValidateMemoryId(id);

            var snapshot = await _memoryRepository.GetMemorySnapshotForUserAsync(id, userId, projectId);
            if (snapshot == null)
            {
                throw new KeyNotFoundException(
                    $"Memory {id} was not found or does not belong to the current project.");
            }
            snapshots[id] = snapshot;
        }

        // ── Apply soft deletes ────────────────────────────────────────────────
        var deletedIds = new List<long>();
        foreach (var id in distinctIds)
        {
            var snapshot = snapshots[id];
            await _memoryRepository.CreateMemoryVersionAsync(id, snapshot.Content, "ApiBatchDelete");
            await _memoryRepository.DeactivateMemoryAsync(id);
            deletedIds.Add(id);
        }

        return new BatchDeleteResponse
        {
            Success = true,
            DeletedCount = deletedIds.Count,
            DeletedIds = deletedIds
        };
    }
}