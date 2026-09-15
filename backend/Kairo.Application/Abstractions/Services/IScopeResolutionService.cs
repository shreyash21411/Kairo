namespace Kairo.Application.Abstractions.Services;

public interface IScopeResolutionService
{
    /// <summary>
    /// Resolves the <c>ScopeId</c> for the given (projectId, actorId) pair.
    ///
    /// Lookup is always by the composite key (ProjectId, ActorId).
    /// The same ActorId value under different Projects maps to distinct
    /// MemoryScopes and must never be treated as globally unique.
    /// </summary>
    /// <param name="projectId">
    ///     The project that owns the requested scope.
    /// </param>
    /// <param name="actorId">
    ///     The actor identifier within that project.
    ///     Must not be null, empty, or whitespace.
    /// </param>
    /// <param name="cancellationToken">Propagates cancellation.</param>
    /// <returns>
    ///     The <c>ScopeId</c> for the resolved MemoryScope.
    /// </returns>
    /// <exception cref="ArgumentException">
    ///     Thrown when <paramref name="actorId"/> is null, empty, or whitespace.
    /// </exception>
    /// <exception cref="Kairo.Application.MemoryScopeNotFoundException">
    ///     Thrown when no MemoryScope exists for the given
    ///     (projectId, actorId) combination.
    /// </exception>
    Task<long> ResolveScopeAsync(
        long projectId,
        string actorId,
        CancellationToken cancellationToken = default);
}
