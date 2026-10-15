using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Orchestrates all V1 public memory API operations.
///
/// The authenticated API key determines the user identity.
/// Business logic and ownership validation remain inside the service.
/// </summary>
public interface IMemoryService
{
    /// <summary>
    /// Validates the request, applies exact and semantic duplicate guards,
    /// resolves the target MemoryScope via (ProjectId, ActorId) when projectId is supplied,
    /// then persists the memory and its embedding for the specified user.
    /// </summary>
    Task<(MemoryResponse? Memory, MemoryDuplicateResult? Duplicate)>
        CreateMemoryAsync(
            CreateMemoryRequest request,
            long userId,
            long? projectId = null,
            CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns a single memory belonging to the specified user, project, and scope.
    /// Returns a not-found result when the memory belongs to a different project or scope.
    /// </summary>
    Task<MemoryResponse> GetMemoryAsync(
        long memoryId,
        long userId,
        long? projectId = null,
        long? scopeId = null);

    /// <summary>
    /// Returns all active memories for the specified user scoped to the
    /// given project. When projectId is null all user memories are returned
    /// (legacy / internal use only).
    /// </summary>
    Task<List<MemoryResponse>> ListMemoriesAsync(
        long userId,
        long? projectId = null);

    /// <summary>
    /// Updates a memory belonging to the specified user, project, and scope.
    /// </summary>
    Task<MemoryResponse> UpdateMemoryAsync(
        long memoryId,
        UpdateMemoryRequest request,
        long userId,
        long? projectId = null,
        long? scopeId = null);

    /// <summary>
    /// Soft-deletes a memory belonging to the specified user, project, and scope.
    /// </summary>
    Task DeleteMemoryAsync(
        long memoryId,
        long userId,
        long? projectId = null,
        long? scopeId = null);

    /// <summary>
    /// Performs semantic memory search for the specified user and resolved MemoryScope.
    /// </summary>
    Task<MemorySearchResponse> SearchMemoriesAsync(
        MemorySearchRequest request,
        long userId,
        long? projectId = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Phase 3: Atomically creates a batch of memories for the authenticated user and project.
    /// </summary>
    Task<BatchCreateResponse> BatchCreateMemoriesAsync(
        BatchCreateMemoryRequest request,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Phase 3: Updates a batch of memories belonging to the authenticated user and project.
    /// </summary>
    Task<BatchUpdateResponse> BatchUpdateMemoriesAsync(
        BatchUpdateMemoryRequest request,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Phase 3: Soft-deletes a batch of memories belonging to the authenticated user and project.
    /// </summary>
    Task<BatchDeleteResponse> BatchDeleteMemoriesAsync(
        BatchDeleteMemoryRequest request,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default);

    // ── Phase 6.3: History & Purge Service Methods ────────────────────────────

    /// <summary>
    /// Phase 6.3 (GAP-01): Retrieves version history for a memory belonging to the specified user and project.
    /// Throws KeyNotFoundException if the memory does not exist or does not belong to the user/project.
    /// </summary>
    Task<MemoryHistoryResponse> GetMemoryHistoryAsync(
        long memoryId,
        long userId,
        long? projectId = null,
        long? scopeId = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Phase 6.3 (GAP-02): Purges (soft-deletes) all active memories belonging to the specified actor in the authorized project.
    /// </summary>
    Task<ActorPurgeResponse> PurgeActorMemoriesAsync(
        string actorId,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default);
}