using System.Security.Claims;
using Kairo.Application.Abstractions.Authentication;
using Microsoft.AspNetCore.Http;

namespace Kairo.API.Security;

/// <summary>
/// Implements IAccountContext by extracting the authenticated user identity
/// from HttpContext.User claims populated by the KairoJwt authentication scheme.
/// </summary>
public sealed class AccountContext : IAccountContext
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public AccountContext(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    /// <inheritdoc />
    public long UserId
    {
        get
        {
            var user = _httpContextAccessor.HttpContext?.User;
            if (user?.Identity == null || !user.Identity.IsAuthenticated)
            {
                throw new UnauthorizedAccessException("Account is not authenticated.");
            }

            var subClaim = user.FindFirst("sub")?.Value;

            if (string.IsNullOrWhiteSpace(subClaim) || !long.TryParse(subClaim, out var userId))
            {
                throw new UnauthorizedAccessException("User ID claim ('sub') is missing or invalid.");
            }

            return userId;
        }
    }

    /// <inheritdoc />
    public string Email
    {
        get
        {
            var user = _httpContextAccessor.HttpContext?.User;
            if (user?.Identity == null || !user.Identity.IsAuthenticated)
            {
                throw new UnauthorizedAccessException("Account is not authenticated.");
            }

            var emailClaim = user.FindFirst("email")?.Value;

            if (string.IsNullOrWhiteSpace(emailClaim))
            {
                throw new UnauthorizedAccessException("Email claim is missing or invalid.");
            }

            return emailClaim;
        }
    }
}
