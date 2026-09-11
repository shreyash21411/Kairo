using Kairo.Application.DTOs;

namespace Kairo.Application.DTOs;

// ─── Registration ──────────────────────────────────────────────────────────────

/// <summary>
/// Result returned by a successful account registration.
/// No tokens are issued at registration; the caller must login separately.
/// </summary>
public sealed record RegisterResult(
    long UserId,
    string Email,
    bool IsEmailVerified);

// ─── Login ────────────────────────────────────────────────────────────────────

/// <summary>
/// Summarises the authenticated user embedded inside <see cref="LoginResult"/>.
/// </summary>
public sealed record AuthenticatedUserInfo(
    long UserId,
    string Email,
    bool IsEmailVerified);

/// <summary>
/// Full response returned by a successful login.
/// Mapped to the agreed API contract by the future AuthController.
/// </summary>
public sealed record LoginResult(
    string AccessToken,
    string TokenType,
    int ExpiresIn,
    string RefreshToken,
    AuthenticatedUserInfo User);

// ─── Me ───────────────────────────────────────────────────────────────────────

/// <summary>
/// Response for GET /api/auth/me.
/// Projects are the caller's existing projects — no password hashes,
/// tokens, API keys, or memory contents are included.
/// </summary>
public sealed record AccountMeResult(
    long UserId,
    string Email,
    bool IsEmailVerified,
    IReadOnlyList<ProjectResponse> Projects);
