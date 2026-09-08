using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Kairo.Application.Abstractions.Security;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Kairo.API.Security;

namespace Kairo.API.Authentication;

public class KairoApiKeyAuthenticationHandler
    : AuthenticationHandler<AuthenticationSchemeOptions>
{
    private readonly IApiKeyValidator _apiKeyValidator;
    private readonly ApiKeyContext _apiKeyContext;

    public KairoApiKeyAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        IApiKeyValidator apiKeyValidator,
        ApiKeyContext apiKeyContext)
        : base(options, logger, encoder)
    {
        _apiKeyValidator = apiKeyValidator;
        _apiKeyContext = apiKeyContext;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(
                "Authorization",
                out var authorizationHeader))
        {
            return AuthenticateResult.NoResult();
        }

        if (!AuthenticationHeaderValue.TryParse(
                authorizationHeader.ToString(),
                out var authHeader))
        {
            return AuthenticateResult.Fail(
                "Invalid Authorization header.");
        }

        if (!string.Equals(
                authHeader.Scheme,
                "Bearer",
                StringComparison.OrdinalIgnoreCase))
        {
            return AuthenticateResult.Fail(
                "Authorization scheme must be Bearer.");
        }

        var rawApiKey = authHeader.Parameter;

        if (string.IsNullOrWhiteSpace(rawApiKey))
        {
            return AuthenticateResult.Fail(
                "API key is missing.");
        }

        var validationResult =
            await _apiKeyValidator.ValidateAsync(rawApiKey);

        if (!validationResult.IsValid)
        {
            return AuthenticateResult.Fail(
                "Invalid or expired API key.");
        }

        // Populate the request context.
        _apiKeyContext.SetContext(
            validationResult.UserId,
            validationResult.ProjectId,
            validationResult.ApiKeyId);

        // Create ClaimsPrincipal.
        var claims = new List<Claim>
        {
            new Claim(
                ClaimTypes.NameIdentifier,
                validationResult.UserId.ToString()),

            new Claim(
                "project_id",
                validationResult.ProjectId.ToString()),

            new Claim(
                "api_key_id",
                validationResult.ApiKeyId.ToString())
        };

        var identity = new ClaimsIdentity(
            claims,
            Scheme.Name);

        var principal = new ClaimsPrincipal(identity);

        var ticket = new AuthenticationTicket(
            principal,
            Scheme.Name);

        return AuthenticateResult.Success(ticket);
    }
}