using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

public interface ITokenService
{
    Task<TokenPair> CreateTokenPairAsync(
        long userId,
        string email,
        CancellationToken cancellationToken = default);

    Task<TokenPair> RefreshTokenAsync(
        string refreshToken,
        CancellationToken cancellationToken = default);

    Task RevokeRefreshTokenFamilyAsync(
        long userId,
        Guid familyId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Resolves the raw refresh token to its family and revokes all tokens in
    /// that family. Safe to call with an unknown or already-revoked token
    /// (completes silently). Raw token is never logged.
    /// </summary>
    Task RevokeRefreshTokenFamilyByTokenAsync(
        string rawRefreshToken,
        CancellationToken cancellationToken = default);
}