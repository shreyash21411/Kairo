using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kairo.Infrastructure.Repositories;

public class RefreshTokenRepository : IRefreshTokenRepository
{
    private readonly KairoDbContext _dbContext;

    public RefreshTokenRepository(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <summary>
    /// Finds a refresh token record by its SHA-256 hash.
    /// Raw tokens are never stored; callers must hash before querying.
    /// </summary>
    public async Task<RefreshTokenData?> GetByTokenHashAsync(
        string tokenHash,
        CancellationToken cancellationToken = default)
    {
        return await _dbContext.RefreshTokens
            .AsNoTracking()
            .Where(rt => rt.TokenHash == tokenHash)
            .Select(rt => new RefreshTokenData(
                rt.RefreshTokenId,
                rt.UserId,
                rt.TokenHash,
                rt.FamilyId,
                rt.ExpiresAt,
                rt.CreatedAt,
                rt.RevokedAt,
                rt.ReplacedByTokenId))
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// Persists a new refresh token record.
    /// The caller is responsible for managing any outer transaction when
    /// this is part of a multi-step atomic operation (e.g. token rotation).
    /// Only the hash of the raw token must be supplied — never the raw token.
    /// </summary>
    public async Task AddAsync(
        RefreshTokenData refreshToken,
        CancellationToken cancellationToken = default)
    {
        var entity = new RefreshTokens
        {
            UserId = refreshToken.UserId,
            TokenHash = refreshToken.TokenHash,
            FamilyId = refreshToken.FamilyId,
            ExpiresAt = refreshToken.ExpiresAt,
            CreatedAt = refreshToken.CreatedAt,
            RevokedAt = refreshToken.RevokedAt,
            ReplacedByTokenId = refreshToken.ReplacedByTokenId
        };

        _dbContext.RefreshTokens.Add(entity);

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Revokes a single refresh token by its primary key.
    /// Optionally records the ID of the token that replaced it, supporting
    /// forward-chain tracing of the rotation history.
    /// </summary>
    public async Task RevokeAsync(
        long refreshTokenId,
        DateTime revokedAt,
        long? replacedByTokenId = null,
        CancellationToken cancellationToken = default)
    {
        var entity = await _dbContext.RefreshTokens
            .FirstOrDefaultAsync(rt => rt.RefreshTokenId == refreshTokenId, cancellationToken);

        if (entity is null)
        {
            return;
        }

        entity.RevokedAt = revokedAt;
        entity.ReplacedByTokenId = replacedByTokenId;

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Revokes every active token belonging to the specified family for the
    /// given user. Used during reuse detection: when an already-used refresh
    /// token is presented, the entire family is invalidated to protect against
    /// token theft.
    /// ExecuteUpdateAsync is used here because an unbounded number of rows may
    /// be affected, and loading each entity individually would be wasteful.
    /// </summary>
    public async Task RevokeFamilyAsync(
        long userId,
        Guid familyId,
        DateTime revokedAt,
        CancellationToken cancellationToken = default)
    {
        await _dbContext.RefreshTokens
            .Where(rt =>
                rt.UserId == userId &&
                rt.FamilyId == familyId &&
                rt.RevokedAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(rt => rt.RevokedAt, revokedAt),
                cancellationToken);
    }
}
