using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;

using Microsoft.AspNetCore.Mvc;

namespace Kairo.API.Controllers;

[ApiController]
[Route("api/users")]
public class UsersController : ControllerBase
{
    private readonly IUserService _userService;

    public UsersController(IUserService userService)
    {
        _userService = userService;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register(
        [FromBody] RegisterUserRequest request)
    {
        try
        {
            var userId = await _userService.RegisterAsync(
                request.Email,
                request.Password);

            return Ok(new
            {
                userId,
                message = "User registered successfully."
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new
            {
                message = ex.Message
            });
        }
    }
    [HttpPost("login")]
    public async Task<IActionResult> Login(
        [FromBody] LoginUserRequest request)
    {
        try
        {
            var isValid = await _userService.LoginAsync(
                request.Email,
                request.Password);

            if (!isValid)
            {
                return Unauthorized(new
                {
                    message = "Invalid email or password."
                });
            }

            return Ok(new
            {
                message = "Login successful."
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
    }
}