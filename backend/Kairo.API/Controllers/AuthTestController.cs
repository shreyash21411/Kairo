using Kairo.Application.Abstractions.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kairo.API.Controllers;

[ApiController]
[Route("api/v1/auth-test")]
public class AuthTestController : ControllerBase
{
    private readonly IApiKeyContext _apiKeyContext;

    public AuthTestController(
        IApiKeyContext apiKeyContext)
    {
        _apiKeyContext = apiKeyContext;
    }

    [HttpGet]
    [Authorize]
    public IActionResult TestAuthentication()
    {
        return Ok(new
        {
            message = "API key authentication successful.",
            userId = _apiKeyContext.UserId,
            projectId = _apiKeyContext.ProjectId,
            apiKeyId = _apiKeyContext.ApiKeyId
        });
    }
}