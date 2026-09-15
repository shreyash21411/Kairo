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
}