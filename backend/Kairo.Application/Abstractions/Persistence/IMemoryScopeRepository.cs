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
