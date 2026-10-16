using Kairo.Application;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Kairo.Infrastructure.Repositories;

public class AuthenticationIdentityRepository : IAuthenticationIdentityRepository
{
    private const int SqlErrorUniqueIndexViolation = 2601;
    private const int SqlErrorUniqueConstraintViolation = 2627;
    private const string PostgresErrorUniqueViolation = PostgresErrorCodes.UniqueViolation; // "23505"

    private readonly KairoDbContext _dbContext;

    public AuthenticationIdentityRepository(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <summary>
    /// Looks up an authentication identity by provider + providerSubject.
    /// Used during login to find the relevant credential record.
    /// </summary>
    public async Task<AuthenticationIdentityData?> GetByProviderSubjectAsync(
        string provider,
        string providerSubject,
        CancellationToken cancellationToken = default)
    {
        return await _dbContext.AuthenticationIdentities
            .AsNoTracking()
            .Where(ai => ai.Provider == provider && ai.ProviderSubject == providerSubject)
            .Select(ai => new AuthenticationIdentityData(
                ai.AuthenticationIdentityId,
                ai.UserId,
                ai.Provider,
                ai.ProviderSubject,
                ai.PasswordHash))
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// Returns the Password-provider identity for a given user.
    /// Used during lazy migration: if an identity does not exist yet we fall
    /// back to the legacy Users.PasswordHash column.
    /// </summary>
    public async Task<AuthenticationIdentityData?> GetPasswordIdentityByUserIdAsync(
        long userId,
        CancellationToken cancellationToken = default)
    {
        return await _dbContext.AuthenticationIdentities
            .AsNoTracking()
            .Where(ai => ai.UserId == userId && ai.Provider == "Password")
            .Select(ai => new AuthenticationIdentityData(
                ai.AuthenticationIdentityId,
                ai.UserId,
                ai.Provider,
                ai.ProviderSubject,
                ai.PasswordHash))
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// Persists a new authentication identity record.
    /// Translates SQL Server unique-constraint violations (2601/2627) to
    /// <see cref="UniqueConstraintViolationException"/> so callers in the
    /// application layer can handle races cleanly without referencing EF Core.
    /// </summary>
    public async Task AddAsync(
        AuthenticationIdentityData identity,
        CancellationToken cancellationToken = default)
    {
        var entity = new AuthenticationIdentities
        {
            UserId = identity.UserId,
            Provider = identity.Provider,
            ProviderSubject = identity.ProviderSubject,
            PasswordHash = identity.PasswordHash,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _dbContext.AuthenticationIdentities.Add(entity);

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException dbEx) when (IsUniqueConstraintViolation(dbEx))
        {
            throw new UniqueConstraintViolationException();
        }
    }

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
