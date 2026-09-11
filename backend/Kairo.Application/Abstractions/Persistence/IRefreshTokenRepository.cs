using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Persistence;

public interface IRefreshTokenRepository
{
    Task<RefreshTokenData?> GetByTokenHashAsync(
        string tokenHash,
        CancellationToken cancellationToken = default);

    Task AddAsync(
        RefreshTokenData refreshToken,
        CancellationToken cancellationToken = default);

    Task RevokeAsync(
        long refreshTokenId,
        DateTime revokedAt,
        long? replacedByTokenId = null,
        CancellationToken cancellationToken = default);

    Task RevokeFamilyAsync(
        long userId,
        Guid familyId,
        DateTime revokedAt,
        CancellationToken cancellationToken = default);
}