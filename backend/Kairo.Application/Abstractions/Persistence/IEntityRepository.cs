using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Persistence;

/// <summary>
/// Phase 1: Persists and retrieves entities and memory-entity associations.
/// </summary>
public interface IEntityRepository
{
    /// <summary>
    /// Resolves or creates each extracted entity within a project,
    /// then links them to the given memory.
    /// Idempotent: if an entity or link already exists, it is reused.
    /// </summary>
    Task<List<EntityData>> UpsertEntitiesForMemoryAsync(
        long projectId,
        long memoryId,
        List<ExtractedEntity> entities,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns entities linked to the specified memories, grouped by MemoryId.
    /// Used during retrieval to compute entity overlap signals.
    /// </summary>
    Task<Dictionary<long, List<EntityData>>> GetEntitiesForMemoriesAsync(
        IEnumerable<long> memoryIds,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns entities extracted from a given text query, normalized to project scope.
    /// Used to compute entity overlap signals during hybrid retrieval.
    /// </summary>
    Task<List<string>> GetNormalizedNamesForProjectAsync(
        long projectId,
        IEnumerable<string> normalizedNames,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Represents a persisted entity returned from the entity repository.
/// </summary>
public class EntityData
{
    public long EntityId { get; set; }
    public string NormalizedName { get; set; } = null!;
    public string DisplayName { get; set; } = null!;
    public string EntityType { get; set; } = null!;
}
