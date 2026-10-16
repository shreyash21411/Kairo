using Kairo.Application;
using Kairo.Application.Abstractions.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Kairo.Infrastructure.Persistence;

/// <summary>
/// Implements <see cref="ITransactionCoordinator"/> using the scoped
/// <see cref="KairoDbContext"/>.
///
/// Because <see cref="KairoDbContext"/> is registered as Scoped, this
/// coordinator shares the exact same DbContext instance as every other
/// scoped repository within the same HTTP request. Any SaveChangesAsync
/// calls made by repositories inside <c>ExecuteInTransactionAsync</c>
/// automatically participate in the open transaction.
/// </summary>
public sealed class EfTransactionCoordinator : ITransactionCoordinator
{
    // SQL Server error numbers for unique index / primary key violations.
    private const int SqlErrorUniqueIndexViolation    = 2601;
    private const int SqlErrorUniqueConstraintViolation = 2627;
    private const string PostgresErrorUniqueViolation = PostgresErrorCodes.UniqueViolation; // "23505"

    private readonly KairoDbContext _dbContext;

    public EfTransactionCoordinator(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <inheritdoc />
    public async Task ExecuteInTransactionAsync(
        Func<Task> operation,
        CancellationToken cancellationToken = default)
    {
        var strategy = _dbContext.Database.CreateExecutionStrategy();

        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await _dbContext.Database
                .BeginTransactionAsync(cancellationToken);

            try
            {
                await operation();
                await tx.CommitAsync(cancellationToken);
            }
            catch (DbUpdateException dbEx) when (IsUniqueConstraintViolation(dbEx))
            {
                // Roll back first — never leave an open transaction.
                await tx.RollbackAsync(cancellationToken);

                // Translate to the Application-layer exception so callers do not
                // need to reference EF Core or SqlClient.
                throw new UniqueConstraintViolationException();
            }
            catch
            {
                await tx.RollbackAsync(cancellationToken);
                throw;
            }
        });
    }

    /// <summary>
    /// Returns true when the <see cref="DbUpdateException"/> wraps a SQL Server
    /// unique index (2601) or unique constraint (2627) violation, or a PostgreSQL
    /// unique constraint violation (SQLSTATE 23505).
    /// All other database errors return false and propagate unchanged.
    /// </summary>
    internal static bool IsUniqueConstraintViolation(DbUpdateException ex)
    {
        if (ex.InnerException is SqlException sqlEx)
        {
            return sqlEx.Number == SqlErrorUniqueIndexViolation
                || sqlEx.Number == SqlErrorUniqueConstraintViolation;
        }

        if (ex.InnerException is PostgresException pgEx)
        {
            return pgEx.SqlState == PostgresErrorUniqueViolation;
        }

        return false;
    }
}
