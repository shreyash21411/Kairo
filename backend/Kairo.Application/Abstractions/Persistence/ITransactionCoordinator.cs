namespace Kairo.Application.Abstractions.Persistence;

/// <summary>
/// Provides a lightweight mechanism to execute multiple repository operations
/// inside a single database transaction without exposing EF Core or
/// infrastructure types to the Application layer.
///
/// Use this only when multiple repository calls must succeed or fail atomically
/// (e.g., registration: User + AuthenticationIdentity + default Project).
/// </summary>
public interface ITransactionCoordinator
{
    /// <summary>
    /// Executes <paramref name="operation"/> inside a database transaction.
    /// Commits on success; rolls back if an exception is thrown.
    /// </summary>
    Task ExecuteInTransactionAsync(
        Func<Task> operation,
        CancellationToken cancellationToken = default);
}
