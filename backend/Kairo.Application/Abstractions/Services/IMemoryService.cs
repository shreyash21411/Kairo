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
    /// then persists the memory and its embedding for the specified user.
    /// </summary>
    Task<(MemoryResponse? Memory, MemoryDuplicateResult? Duplicate)>
        CreateMemoryAsync(
            CreateMemoryRequest request,
            long userId);

    /// <summary>
    /// Returns a single memory belonging to the specified user.
    /// </summary>
    Task<MemoryResponse> GetMemoryAsync(
        long memoryId,
        long userId);

    /// <summary>
    /// Returns all active memories for the specified user, newest first.
    /// </summary>
    Task<List<MemoryResponse>> ListMemoriesAsync(
        long userId);

    /// <summary>
    /// Updates a memory belonging to the specified user.
    /// </summary>
    Task<MemoryResponse> UpdateMemoryAsync(
        long memoryId,
        UpdateMemoryRequest request,
        long userId);

    /// <summary>
    /// Soft-deletes a memory belonging to the specified user.
    /// </summary>
    Task DeleteMemoryAsync(
        long memoryId,
        long userId);

    /// <summary>
    /// Performs semantic memory search for the specified user.
    /// </summary>
    Task<MemorySearchResponse> SearchMemoriesAsync(
        MemorySearchRequest request,
        long userId);
}