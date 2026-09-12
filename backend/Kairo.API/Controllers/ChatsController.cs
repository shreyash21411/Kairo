using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kairo.API.Controllers;

/// <summary>
/// Chat ingestion endpoint — application/agent authenticated boundary.
///
/// Authentication: KairoApiKey (default scheme).
/// The caller's UserId is resolved exclusively from IApiKeyContext populated
/// by KairoApiKeyAuthenticationHandler. Callers cannot supply their own UserId.
/// </summary>
[ApiController]
[Route("api/chats")]
[Authorize]
[Produces("application/json")]
public class ChatsController : ControllerBase
{
    private readonly IChatService _chatService;
    private readonly IApiKeyContext _apiKeyContext;

    public ChatsController(
        IChatService chatService,
        IApiKeyContext apiKeyContext)
    {
        _chatService = chatService;
        _apiKeyContext = apiKeyContext;
    }

    /// <summary>
    /// Ingests a chat conversation for the authenticated user.
    /// The user identity is determined by the API key — callers cannot supply a UserId.
    /// </summary>
    [HttpPost]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> CreateChat(
        [FromBody] CreateChatRequest request)
    {
        try
        {
            // UserId is always derived from the authenticated API key context.
            // Callers cannot supply or override the identity.
            var userId = _apiKeyContext.UserId;

            var chatId = await _chatService.IngestChatAsync(
                userId,
                request);

            return Ok(new
            {
                chatId,
                message = "Chat ingested successfully."
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