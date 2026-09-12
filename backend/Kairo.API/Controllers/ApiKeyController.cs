using Kairo.Application.Abstractions.Authentication;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kairo.API.Controllers;

[ApiController]
[Route("api/v1/api-keys")]
[Authorize(AuthenticationSchemes = "KairoJwt")]
[Produces("application/json")]
public class ApiKeyController : ControllerBase
{
    private readonly IApiKeyService _apiKeyService;
    private readonly IAccountContext _accountContext;

    public ApiKeyController(
        IApiKeyService apiKeyService,
        IAccountContext accountContext)
    {
        _apiKeyService = apiKeyService;
        _accountContext = accountContext;
    }

    // POST: /api/v1/api-keys
    // Body: { "projectId": 1, "name": "My Key", "expiresAt": null }
    // UserId is resolved from the authenticated account (JWT) — not from the request body.
    [HttpPost]
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
}