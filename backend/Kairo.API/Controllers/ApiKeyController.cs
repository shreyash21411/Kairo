using Kairo.Application.Abstractions.Authentication;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kairo.API.Controllers;

[ApiController]
[Route("api/v1/api-keys")]
[Authorize(AuthenticationSchemes = "KairoJwt,KairoApiKey")]
[Produces("application/json")]
public class ApiKeyController : ControllerBase
{
    private readonly IApiKeyService _apiKeyService;
    private readonly IAccountContext _accountContext;
    private readonly IApiKeyValidator _apiKeyValidator;
    private readonly IApiKeyContext? _apiKeyContext;

    public ApiKeyController(
        IApiKeyService apiKeyService,
        IAccountContext accountContext,
        IApiKeyValidator apiKeyValidator,
        IApiKeyContext? apiKeyContext = null)
    {
        _apiKeyService = apiKeyService;
        _accountContext = accountContext;
        _apiKeyValidator = apiKeyValidator;
        _apiKeyContext = apiKeyContext;
    }

    // POST: /api/v1/api-keys
    // Body: { "projectId": 1, "name": "My Key", "expiresAt": null }
    // UserId is resolved from the authenticated account (JWT) — not from the request body.
    [HttpPost]
    [Authorize(AuthenticationSchemes = "KairoJwt")]
    [ProducesResponseType(typeof(CreatedApiKeyResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> Create(
        [FromBody] CreateApiKeyRequest request)
    {
        try
        {
            var userId = _accountContext.UserId;

            var result = await _apiKeyService.CreateAsync(userId, request);

            return Ok(result);
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new
            {
                message = ex.Message
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
        catch (Exception)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new
                {
                    message = "An unexpected error occurred."
                });
        }
    }

    // GET: /api/v1/api-keys?projectId=1
    // Lists API keys for the given project.
    // The authenticated user must own the project — enforced in the service.
    [HttpGet]
    [Authorize(AuthenticationSchemes = "KairoJwt")]
    [ProducesResponseType(typeof(List<ApiKeyResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetByProject(
        [FromQuery] long projectId)
    {
        try
        {
            var userId = _accountContext.UserId;

            var result = await _apiKeyService.GetByProjectAsync(
                userId,
                projectId);

            return Ok(result);
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new
            {
                message = ex.Message
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
        catch (Exception)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new
                {
                    message = "An unexpected error occurred."
                });
        }
    }

    // DELETE: /api/v1/api-keys/{apiKeyId}
    // Revokes an API key belonging to the authenticated user's project.
    [HttpDelete("{apiKeyId:long}")]
    [Authorize(AuthenticationSchemes = "KairoJwt")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> Revoke(
        long apiKeyId)
    {
        try
        {
            var userId = _accountContext.UserId;

            var result = await _apiKeyService.RevokeAsync(
                userId,
                apiKeyId);

            if (!result)
            {
                return NotFound(new
                {
                    message = "API key not found."
                });
            }

            return Ok(new
            {
                message = "API key revoked successfully."
            });
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new
            {
                message = ex.Message
            });
        }
        catch (Exception)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new
                {
                    message = "An unexpected error occurred."
                });
        }
    }

    // POST: /api/v1/api-keys/validate
    // Validates a raw API key against the database, checks account ownership,
    // and returns the owning ProjectId without ever exposing the key or key hash.
    [HttpPost("validate")]
    [Authorize(AuthenticationSchemes = "KairoJwt")]
    [ProducesResponseType(typeof(ValidateApiKeyResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Validate(
        [FromBody] ValidateApiKeyRequest request)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.ApiKey))
        {
            return BadRequest(new { message = "ApiKey is required." });
        }

        var userId = _accountContext.UserId;
        var validation = await _apiKeyValidator.ValidateAsync(request.ApiKey.Trim());

        if (!validation.IsValid)
        {
            return Ok(new ValidateApiKeyResponse
            {
                IsValid = false,
                Message = "Invalid or expired API key."
            });
        }

        if (validation.UserId != userId)
        {
            return Ok(new ValidateApiKeyResponse
            {
                IsValid = false,
                Message = "API key does not belong to the authenticated user."
            });
        }

        return Ok(new ValidateApiKeyResponse
        {
            IsValid = true,
            ProjectId = validation.ProjectId,
            ApiKeyId = validation.ApiKeyId
        });
    }

    // GET: /api/v1/api-keys/verify
    // Direct API-Key authentication check. Resolves project context from validated key.
    [HttpGet("verify")]
    [Authorize(AuthenticationSchemes = "KairoApiKey")]
    [ProducesResponseType(typeof(VerifyApiKeyResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public IActionResult Verify()
    {
        if (_apiKeyContext == null || _apiKeyContext.ProjectId <= 0)
        {
            return Unauthorized(new { message = "Invalid or missing API key context." });
        }

        return Ok(new VerifyApiKeyResponse
        {
            Valid = true,
            ProjectId = _apiKeyContext.ProjectId,
            UserId = _apiKeyContext.UserId,
            ApiKeyId = _apiKeyContext.ApiKeyId
        });
    }
}