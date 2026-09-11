using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace Kairo.Infrastructure.Security;

/// <summary>
/// Implements JWT access-token creation and refresh-token rotation for human
/// account authentication. This service is completely separate from the
/// Kairo API-key mechanism used by memory/MCP APIs.
///
/// Refresh-token rotation is DB-atomic: an ExecuteUpdateAsync with a
/// WHERE RevokedAt IS NULL predicate ensures only one concurrent request
/// can consume a given token — the SQL UPDATE's row-level X-lock prevents
/// two requests from both succeeding the compare-and-swap.
/// </summary>
public sealed class TokenService : ITokenService
{
    private const int AccessTokenLifetimeSeconds = 900;       // 15 minutes
    private const int RefreshTokenLifetimeDays = 7;
    private const int RefreshTokenRawBytes = 64;              // 512-bit raw entropy

    private readonly IRefreshTokenRepository _refreshTokenRepository;
    private readonly KairoDbContext _dbContext;
    private readonly IConfiguration _configuration;

    public TokenService(
        IRefreshTokenRepository refreshTokenRepository,
        KairoDbContext dbContext,
        IConfiguration configuration)
    {
        _refreshTokenRepository = refreshTokenRepository;
        _dbContext = dbContext;
        _configuration = configuration;
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<TokenPair> CreateTokenPairAsync(
        long userId,
        string email,
        CancellationToken cancellationToken = default)
    {
        var (rawRefreshToken, tokenHash) = GenerateRefreshToken();
        var familyId = Guid.NewGuid();
        var now = DateTime.UtcNow;

        var refreshTokenRecord = new RefreshTokenData(
            RefreshTokenId: 0,          // DB-generated; not used after AddAsync
            UserId: userId,
            TokenHash: tokenHash,
            FamilyId: familyId,
            ExpiresAt: now.AddDays(RefreshTokenLifetimeDays),
            CreatedAt: now,
            RevokedAt: null,
            ReplacedByTokenId: null);

        await _refreshTokenRepository.AddAsync(refreshTokenRecord, cancellationToken);

        var accessToken = GenerateAccessToken(userId, email);

        return new TokenPair(accessToken, AccessTokenLifetimeSeconds, rawRefreshToken);
    }

    /// <inheritdoc />
    /// <remarks>
    /// Atomic rotation protocol:
    ///
    /// 1. Hash the supplied raw token and look it up (pre-flight, outside transaction).
    /// 2. Reject immediately if not found, expired, or already revoked.
    ///    An already-revoked token that arrives here (before the transaction) indicates
    ///    a second reuse attempt — revoke the entire family and reject.
    /// 3. Open a READ COMMITTED transaction.
    /// 4. ExecuteUpdateAsync: UPDATE RefreshTokens SET RevokedAt = @now
    ///    WHERE RefreshTokenId = @id AND RevokedAt IS NULL
    ///    → SQL issues a row-level X-lock; only one concurrent UPDATE wins.
    /// 5. If 0 rows affected → concurrent rotation detected: rollback, nuke family, reject.
    /// 6. If 1 row affected → we own the rotation:
    ///    a. Insert new token (same FamilyId), SaveChanges within the open transaction.
    ///    b. ExecuteUpdateAsync links old.ReplacedByTokenId → new token's DB-generated ID.
    ///    c. Commit.
    /// 7. Generate and return a new JWT + new raw refresh token.
    /// </remarks>
    public async Task<TokenPair> RefreshTokenAsync(
        string rawRefreshToken,
        CancellationToken cancellationToken = default)
    {
        var tokenHash = HashToken(rawRefreshToken);

        // ── Pre-flight checks (outside transaction, fast path) ─────────────
        var tokenData = await _refreshTokenRepository.GetByTokenHashAsync(tokenHash, cancellationToken);

        if (tokenData is null)
        {
            throw new UnauthorizedAccessException("Refresh token not found.");
        }

        var now = DateTime.UtcNow;

        if (tokenData.ExpiresAt < now)
        {
            throw new UnauthorizedAccessException("Refresh token has expired.");
        }

        if (tokenData.RevokedAt is not null)
        {
            // The token was already revoked before we entered. This is a reuse
            // attempt — nuke the entire family immediately.
            await _refreshTokenRepository.RevokeFamilyAsync(
                tokenData.UserId, tokenData.FamilyId, now, cancellationToken);

            throw new UnauthorizedAccessException(
                "Refresh token has already been used. All sessions have been revoked.");
        }

        // ── Atomic rotation (inside transaction) ───────────────────────────
        bool concurrentReuseDetected = false;
        RefreshTokens? newTokenEntity = null;
        string? rawNewToken = null;

        await using var tx = await _dbContext.Database
            .BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);

        // Compare-and-swap: mark the old token revoked only if it is still active.
        // Because SQL's UPDATE acquires a row-level X-lock before writing, exactly
        // one concurrent request can succeed here; the other gets 0 rows affected.
        var rowsAffected = await _dbContext.RefreshTokens
            .Where(rt => rt.RefreshTokenId == tokenData.RefreshTokenId && rt.RevokedAt == null)
            .ExecuteUpdateAsync(
                s => s.SetProperty(rt => rt.RevokedAt, now),
                cancellationToken);

        if (rowsAffected == 0)
        {
            // Another request already consumed this token between our pre-flight
            // read and this update. Treat as reuse — we roll back (nothing was
            // written inside this transaction) and nuke the family afterwards.
            concurrentReuseDetected = true;
            await tx.RollbackAsync(cancellationToken);
        }
        else
        {
            // We own the rotation. Issue a replacement token in the same family.
            string newTokenHash;
            (rawNewToken, newTokenHash) = GenerateRefreshToken();

            newTokenEntity = new RefreshTokens
            {
                UserId = tokenData.UserId,
                TokenHash = newTokenHash,
                FamilyId = tokenData.FamilyId,
                ExpiresAt = now.AddDays(RefreshTokenLifetimeDays),
                CreatedAt = now,
                RevokedAt = null,
                ReplacedByTokenId = null
            };

            // SaveChangesAsync participates in the open transaction (same DbContext).
            // After this call, newTokenEntity.RefreshTokenId is DB-populated.
            _dbContext.RefreshTokens.Add(newTokenEntity);
            await _dbContext.SaveChangesAsync(cancellationToken);

            // Link old → new for audit/chain tracing.
            await _dbContext.RefreshTokens
                .Where(rt => rt.RefreshTokenId == tokenData.RefreshTokenId)
                .ExecuteUpdateAsync(
                    s => s.SetProperty(rt => rt.ReplacedByTokenId, newTokenEntity.RefreshTokenId),
                    cancellationToken);

            await tx.CommitAsync(cancellationToken);
        }

        // ── Post-transaction: handle reuse after transaction is fully closed ─
        if (concurrentReuseDetected)
        {
            await _refreshTokenRepository.RevokeFamilyAsync(
                tokenData.UserId, tokenData.FamilyId, now, cancellationToken);

            throw new UnauthorizedAccessException(
                "Refresh token was already consumed by a concurrent request. All sessions have been revoked.");
        }

        // Retrieve the user's email to embed in the new access token.
        var user = await _dbContext.Users
            .AsNoTracking()
            .Where(u => u.UserId == tokenData.UserId)
            .Select(u => new { u.Email })
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedAccessException("User account not found.");

        var accessToken = GenerateAccessToken(tokenData.UserId, user.Email);

        return new TokenPair(accessToken, AccessTokenLifetimeSeconds, rawNewToken!);
    }

    /// <inheritdoc />
    public async Task RevokeRefreshTokenFamilyAsync(
        long userId,
        Guid familyId,
        CancellationToken cancellationToken = default)
    {
        await _refreshTokenRepository.RevokeFamilyAsync(
            userId, familyId, DateTime.UtcNow, cancellationToken);
    }

    /// <inheritdoc />
    /// <remarks>
    /// Safe to call with an unknown, expired, or already-revoked token.
    /// Completes silently without revealing whether the token existed.
    /// The raw token is never written to logs or exception messages.
    /// </remarks>
    public async Task RevokeRefreshTokenFamilyByTokenAsync(
        string rawRefreshToken,
        CancellationToken cancellationToken = default)
    {
        var tokenHash = HashToken(rawRefreshToken);

        var tokenData = await _refreshTokenRepository
            .GetByTokenHashAsync(tokenHash, cancellationToken);

        if (tokenData is null)
        {
            // Unknown token — complete silently; do not reveal non-existence.
            return;
        }

        await _refreshTokenRepository.RevokeFamilyAsync(
            tokenData.UserId, tokenData.FamilyId, DateTime.UtcNow, cancellationToken);
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    /// <summary>
    /// Generates a cryptographically secure raw refresh token and its SHA-256 hash.
    /// Returns (rawBase64UrlToken, sha256Hash).
    /// The raw token is returned to the client; only the hash is ever persisted.
    /// </summary>
    private static (string Raw, string Hash) GenerateRefreshToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(RefreshTokenRawBytes);
        var raw = Convert.ToBase64String(bytes)
            .Replace('+', '-').Replace('/', '_').TrimEnd('='); // URL-safe Base64
        var hash = HashToken(raw);
        return (raw, hash);
    }

    /// <summary>
    /// Computes SHA-256(token) and returns it as a lowercase hex string.
    /// This is the value stored in RefreshTokens.TokenHash.
    /// </summary>
    private static string HashToken(string raw)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    /// <summary>
    /// Generates a signed 15-minute HS256 JWT containing sub (UserId) and email claims.
    /// Reads the signing key from configuration key Kairo:Jwt:SigningKey.
    /// Throws InvalidOperationException if the key is missing or too short.
    /// </summary>
    private string GenerateAccessToken(long userId, string email)
    {
        var signingKeyRaw = _configuration["Kairo:Jwt:SigningKey"];

        if (string.IsNullOrWhiteSpace(signingKeyRaw))
        {
            throw new InvalidOperationException(
                "JWT signing key is not configured. Set Kairo:Jwt:SigningKey " +
                "(or environment variable Kairo__Jwt__SigningKey) before starting the application.");
        }

        if (signingKeyRaw.Length < 32)
        {
            throw new InvalidOperationException(
                "JWT signing key must be at least 32 characters for HS256 security.");
        }

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKeyRaw));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var now = DateTime.UtcNow;
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, email),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new Claim(JwtRegisteredClaimNames.Iat,
                new DateTimeOffset(now).ToUnixTimeSeconds().ToString(),
                ClaimValueTypes.Integer64)
        };

        var token = new JwtSecurityToken(
            issuer: null,   // Issuer/Audience validation configured in AUTH-7
            audience: null,
            claims: claims,
            notBefore: now,
            expires: now.AddSeconds(AccessTokenLifetimeSeconds),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
