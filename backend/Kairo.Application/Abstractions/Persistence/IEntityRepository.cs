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

    /// <summary>
    /// Removes all MemoryEntities links for the specified memory.
    /// Called as part of soft-deletion to prevent orphan entity link rows.
    /// Does NOT delete the NamedEntity records themselves (entities are project-scoped).
    /// </summary>
    Task DeleteLinksForMemoryAsync(
        long memoryId,
        CancellationToken cancellationToken = default);

    // ── Phase 2: Graph Memory Methods ─────────────────────────────────────────

    /// <summary>
    /// Phase 2: Persists extracted entity relationships scoped to a MemoryScope and links
    /// them to the source Memory via RelationshipEvidence.
    /// Deduplication key: (ScopeId, SourceEntityId, TargetEntityId, RelationshipType).
    /// </summary>
    Task<List<GraphRelationData>> UpsertRelationshipsForMemoryAsync(
        long projectId,
        long scopeId,
        long memoryId,
        List<ExtractedRelationship> relationships,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Phase 2: Retrieves relationships involving the specified entities strictly
    /// within the given scopeId. Default depth is 1 (1-hop traversal).
    /// </summary>
    Task<List<GraphRelationData>> GetScopedRelationshipsForEntitiesAsync(
        long projectId,
        long scopeId,
        IEnumerable<string> normalizedEntityNames,
        int maxDepth = 1,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Phase 2: Removes relationship evidence associated with a soft-deleted memory,
    /// and cleans up any relationships that have no remaining active evidence.
    /// </summary>
    Task CleanupRelationshipsForMemoryAsync(
        long memoryId,
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
