using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Mvc;

namespace Kairo.API.Controllers;

[ApiController]
[Route("api/chats")]
public class ChatsController : ControllerBase
{
    private readonly IChatService _chatService;

    public ChatsController(IChatService chatService)
    {
        _chatService = chatService;
    }

    [HttpPost]
    public async Task<IActionResult> CreateChat(
        [FromQuery] long userId,
        [FromBody] CreateChatRequest request)
    {
        try
        {
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