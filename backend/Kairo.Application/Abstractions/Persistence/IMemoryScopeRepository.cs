namespace Kairo.Application.Abstractions.Persistence;

public interface IMemoryScopeRepository
{
    /// <summary>
    /// Looks up a MemoryScope by the composite key (ProjectId, ActorId).
    /// Returns the scope data if found, or null if no scope exists for that
    /// exact Project + Actor combination.
    ///
    /// The lookup is ALWAYS by ProjectId AND ActorId together. ActorId is
    /// scoped within a Project, so the same ActorId value under different
    /// Projects resolves to different MemoryScopes.
    ///
    /// This method is read-only and does NOT create a scope.
    /// </summary>
    Task<MemoryScopeData?> GetByProjectAndActorAsync(
        long projectId,
        string actorId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Looks up a MemoryScope by the composite key (ProjectId, ActorId).
    /// If found, returns the existing scope data.
    /// If not found, creates and persists a new MemoryScope record and returns the created scope data.
    /// Handles concurrency and race conditions safely using the database unique constraint
    /// UX_MemoryScopes_ProjectId_ActorId.
    /// </summary>
    Task<MemoryScopeData> GetOrCreateAsync(
        long projectId,
        string actorId,
        CancellationToken cancellationToken = default);
}

// ── Data contract returned by IMemoryScopeRepository ─────────────────────────

/// <summary>
/// Represents the resolved MemoryScope identity as returned by the repository.
/// Contains only the minimum fields required by the application layer.
/// This is an Application data contract; it does not expose any EF Core entity.
/// </summary>
public class MemoryScopeData
{
    public long ScopeId { get; set; }

    public long ProjectId { get; set; }

    public string ActorId { get; set; } = null!;
}
