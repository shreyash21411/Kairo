using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kairo.API.Controllers;

/// <summary>
/// V1 Public Memory API.
///
/// The authenticated API key determines the current user.
/// Business logic and ownership validation are delegated to IMemoryService.
/// </summary>
[ApiController]
[Route("api/v1/memories")]
[Authorize]
[Produces("application/json")]
public class MemoryController : ControllerBase
{
    private readonly IMemoryService _memoryService;
    private readonly IApiKeyContext _apiKeyContext;

    public MemoryController(
        IMemoryService memoryService,
        IApiKeyContext apiKeyContext)
    {
        _memoryService = memoryService;
        _apiKeyContext = apiKeyContext;
    }

    // ── POST /api/v1/memories ────────────────────────────────────────────────

    /// <summary>
    /// Creates a new memory for the authenticated user.
    /// The user identity is determined by the API key.
    /// </summary>
    [HttpPost]
    [ProducesResponseType(
        typeof(MemoryResponse),
        StatusCodes.Status201Created)]
    [ProducesResponseType(
        typeof(MemoryDuplicateResult),
        StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> CreateMemory(
        [FromBody] CreateMemoryRequest request)
    {
        try
        {
            var userId = _apiKeyContext.UserId;

            var (memory, duplicate) =
                await _memoryService.CreateMemoryAsync(
                    request,
                    userId);

            if (duplicate != null)
            {
                return Ok(duplicate);
            }

            return CreatedAtAction(
                nameof(GetMemory),
                new
                {
                    memoryId = memory!.MemoryId
                },
                memory);
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

    // ── GET /api/v1/memories/{memoryId} ──────────────────────────────────────

    /// <summary>
    /// Retrieves a single memory belonging to the authenticated user.
    /// </summary>
    [HttpGet("{memoryId:long}")]
    [ProducesResponseType(
        typeof(MemoryResponse),
        StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetMemory(
        [FromRoute] long memoryId)
    {
        try
        {
            var userId = _apiKeyContext.UserId;

            var memory =
                await _memoryService.GetMemoryAsync(
                    memoryId,
                    userId);

            return Ok(memory);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new
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

    // ── GET /api/v1/memories ─────────────────────────────────────────────────

    /// <summary>
    /// Lists all active memories belonging to the authenticated user.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(
        typeof(List<MemoryResponse>),
        StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> ListMemories()
    {
        try
        {
            var userId = _apiKeyContext.UserId;

            var memories =
                await _memoryService.ListMemoriesAsync(userId);

            return Ok(new
            {
                userId,
                count = memories.Count,
                memories
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

    // ── PUT /api/v1/memories/{memoryId} ──────────────────────────────────────

    /// <summary>
    /// Updates a memory belonging to the authenticated user.
    /// </summary>
    [HttpPut("{memoryId:long}")]
    [ProducesResponseType(
        typeof(MemoryResponse),
        StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> UpdateMemory(
        [FromRoute] long memoryId,
        [FromBody] UpdateMemoryRequest request)
    {
        try
        {
            var userId = _apiKeyContext.UserId;

            var updated =
                await _memoryService.UpdateMemoryAsync(
                    memoryId,
                    request,
                    userId);

            return Ok(updated);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new
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

    // ── DELETE /api/v1/memories/{memoryId} ───────────────────────────────────

    /// <summary>
    /// Soft-deletes a memory belonging to the authenticated user.
    /// </summary>
    [HttpDelete("{memoryId:long}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> DeleteMemory(
        [FromRoute] long memoryId)
    {
        try
        {
            var userId = _apiKeyContext.UserId;

            await _memoryService.DeleteMemoryAsync(
                memoryId,
                userId);

            return Ok(new
            {
                memoryId,
                message =
                    "Memory deactivated. The record is preserved in the database."
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new
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

    // ── POST /api/v1/memories/search ─────────────────────────────────────────

    /// <summary>
    /// Performs semantic memory search for the authenticated user.
    /// </summary>
    [HttpPost("search")]
    [ProducesResponseType(
        typeof(MemorySearchResponse),
        StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> SearchMemories(
        [FromBody] MemorySearchRequest request)
    {
        try
        {
            var userId = _apiKeyContext.UserId;

            var result =
                await _memoryService.SearchMemoriesAsync(
                    request,
                    userId);

            return Ok(result);
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
}