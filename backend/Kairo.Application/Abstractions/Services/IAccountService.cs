using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Application-level service for human account authentication.
/// Completely separate from the Kairo API-key system used by memory/MCP APIs.
/// All operations are free of HTTP types — the caller (AuthController) is
/// responsible for mapping results to the appropriate HTTP status codes.
/// </summary>
public interface IAccountService
{
    /// <summary>
    /// Registers a new user account with a Password identity.
    /// Creates a Users record, a Password AuthenticationIdentity, and a default
    /// Project inside a single atomic transaction.
    /// Does NOT issue tokens — authentication must occur through LoginAsync.
    /// </summary>
    /// <exception cref="DuplicateEmailException">
    /// Thrown when the normalized email is already registered.
    /// Caller maps to HTTP 409 Conflict.
    /// </exception>
    /// <exception cref="ArgumentException">
    /// Thrown for invalid input (blank email or password).
    /// Caller maps to HTTP 400 Bad Request.
    /// </exception>
    Task<RegisterResult> RegisterAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Authenticates a user with email and password.
    /// Supports legacy lazy migration: if no Password AuthenticationIdentity exists,
    /// falls back to verifying against Users.PasswordHash and migrates on success.
    /// Returns tokens on success.
    /// Returns null on authentication failure (invalid credentials).
    /// Invalid credentials must produce the SAME response regardless of the
    /// actual failure reason (email not found, wrong password, no identity, etc.)
    /// to avoid user-enumeration.
    /// </summary>
    Task<LoginResult?> LoginAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Delegates to ITokenService.RefreshTokenAsync.
    /// Rotation, hashing, and JWT creation all remain in TokenService.
    /// Throws UnauthorizedAccessException on invalid/expired/reused tokens.
    /// </summary>
    Task<TokenPair> RefreshAsync(
        string rawRefreshToken,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Revokes the refresh-token family associated with the supplied raw token.
    /// Delegates entirely to ITokenService.RevokeRefreshTokenFamilyByTokenAsync.
    /// Safe to call with an unknown or already-revoked token (idempotent).
    /// </summary>
    Task LogoutAsync(
        string rawRefreshToken,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the authenticated account's profile and projects.
    /// Uses IAccountContext to obtain the authenticated identity.
    /// Never returns password hashes, API keys, tokens, or memory contents.
    /// </summary>
    Task<AccountMeResult> GetMeAsync(
        CancellationToken cancellationToken = default);
}
