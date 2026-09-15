using Kairo.Application;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Kairo.API.Controllers;

[ApiController]
[Route("api/auth")]
[Produces("application/json")]
public class AuthController : ControllerBase
{
    private readonly IAccountService _accountService;

    public AuthController(IAccountService accountService)
    {
        _accountService = accountService;
    }

    /// <summary>
    /// Registers a new user account.
    /// </summary>
    [HttpPost("register")]
    [AllowAnonymous]
    [EnableRateLimiting("auth-policy")]
    [ProducesResponseType(typeof(RegisterResult), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Register(
        [FromBody] RegisterRequest request,
        CancellationToken cancellationToken)
    {
        if (request is null ||
            string.IsNullOrWhiteSpace(request.Email) ||
            string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new { message = "Email and password are required." });
        }

        try
        {
            var result = await _accountService.RegisterAsync(
                request.Email,
                request.Password,
                cancellationToken);

            return StatusCode(StatusCodes.Status201Created, result);
        }
        catch (DuplicateEmailException ex)
        {
            return Conflict(new { message = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// Authenticates a user with email and password.
    /// </summary>
    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("auth-policy")]
    [ProducesResponseType(typeof(LoginResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Login(
        [FromBody] LoginRequest request,
        CancellationToken cancellationToken)
    {
        if (request is null ||
            string.IsNullOrWhiteSpace(request.Email) ||
            string.IsNullOrWhiteSpace(request.Password))
        {
            return Unauthorized(new { message = "Invalid email or password." });
        }

        var result = await _accountService.LoginAsync(
            request.Email,
            request.Password,
            cancellationToken);

        if (result is null)
        {
            return Unauthorized(new { message = "Invalid email or password." });
        }

        return Ok(result);
    }

    /// <summary>
    /// Rotates a refresh token and issues a new access/refresh token pair.
    /// </summary>
    [HttpPost("refresh")]
[AllowAnonymous]
[EnableRateLimiting("auth-policy")]
[ProducesResponseType(typeof(TokenPair), StatusCodes.Status200OK)]
[ProducesResponseType(StatusCodes.Status401Unauthorized)]
public async Task<IActionResult> Refresh(
    [FromBody] RefreshTokenRequest request,
    CancellationToken cancellationToken)
{
    if (request is null || string.IsNullOrWhiteSpace(request.RefreshToken))
    {
        return Unauthorized(new { message = "Refresh token is required." });
    }

    try
    {
        var tokenPair = await _accountService.RefreshAsync(
            request.RefreshToken,
            cancellationToken);

        return Ok(tokenPair);
    }
    catch (UnauthorizedAccessException ex)
    {
        return Unauthorized(new { message = ex.Message });
    }
}

    /// <summary>
    /// Revokes the refresh token family for the supplied token.
    /// </summary>
    [HttpPost("logout")]
    [AllowAnonymous]
    [EnableRateLimiting("auth-policy")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Logout(
        [FromBody] LogoutRequest request,
        CancellationToken cancellationToken)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.RefreshToken))
        {
            return BadRequest(new { message = "Refresh token is required." });
        }

        await _accountService.LogoutAsync(
            request.RefreshToken,
            cancellationToken);

        return Ok(new { message = "Logged out successfully." });
    }

    /// <summary>
    /// Returns the authenticated account profile and projects.
    /// Requires a valid JWT bearer token using the KairoJwt scheme.
    /// </summary>
    [HttpGet("me")]
    [Authorize(AuthenticationSchemes = "KairoJwt")]
    [ProducesResponseType(typeof(AccountMeResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        try
        {
            var result = await _accountService.GetMeAsync(cancellationToken);
            return Ok(result);
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new { message = ex.Message });
        }
    }
}
