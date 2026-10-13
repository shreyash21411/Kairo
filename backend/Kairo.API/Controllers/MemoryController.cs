using Kairo.Application;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
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
    private readonly IMemoryIngestionService _ingestionService;
    private readonly IApiKeyContext _apiKeyContext;
    private readonly HybridRetrievalService _hybridRetrieval;
    private readonly IMemoryJobService? _memoryJobService;

    public MemoryController(
        IMemoryService memoryService,
        IMemoryIngestionService ingestionService,
        IApiKeyContext apiKeyContext,
        HybridRetrievalService hybridRetrieval,
        IMemoryJobService? memoryJobService = null)
    {
        _memoryService    = memoryService;
        _ingestionService = ingestionService;
        _apiKeyContext    = apiKeyContext;
        _hybridRetrieval  = hybridRetrieval;
        _memoryJobService = memoryJobService;
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
    [ProducesResponseType(
        typeof(AsyncJobAcceptedResponse),
        StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> CreateMemory(
        [FromBody] CreateMemoryRequest request,
        [FromQuery] string? mode = null)
    {
        try
        {
            var userId = _apiKeyContext.UserId;
            var projectId = _apiKeyContext.ProjectId;

            bool isAsync = string.Equals(mode, "async", StringComparison.OrdinalIgnoreCase)
                || string.Equals(Request?.Headers["X-Kairo-Mode"], "async", StringComparison.OrdinalIgnoreCase);

            if (isAsync && _memoryJobService != null)
            {
                var asyncResult = await _memoryJobService.EnqueueAsyncCreateMemoryAsync(
                    request,
                    userId,
                    projectId,
                    HttpContext.RequestAborted);

                return AcceptedAtAction(
                    nameof(GetJobStatus),
                    new { jobId = asyncResult.JobId },
                    asyncResult);
            }

            var (memory, duplicate) =
                await _memoryService.CreateMemoryAsync(
                    request,
                    userId,
                    projectId);

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
        catch (MemoryScopeNotFoundException ex)
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
            var projectId = _apiKeyContext.ProjectId;

            var memory =
                await _memoryService.GetMemoryAsync(
                    memoryId,
                    userId,
                    projectId);

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
            var projectId = _apiKeyContext.ProjectId;

            var memories =
                await _memoryService.ListMemoriesAsync(userId, projectId);

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
            var projectId = _apiKeyContext.ProjectId;

            var updated =
                await _memoryService.UpdateMemoryAsync(
                    memoryId,
                    request,
                    userId,
                    projectId);

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
            var projectId = _apiKeyContext.ProjectId;

            await _memoryService.DeleteMemoryAsync(
                memoryId,
                userId,
                projectId);

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
    /// Performs semantic memory search for the authenticated user and resolved MemoryScope.
    /// </summary>
    [HttpPost("search")]
    [ProducesResponseType(
        typeof(MemorySearchResponse),
        StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> SearchMemories(
        [FromBody] MemorySearchRequest request)
    {
        try
        {
            var userId    = _apiKeyContext.UserId;
            var projectId = _apiKeyContext.ProjectId;

            // Phase 1 & 2: Route to hybrid retrieval when explicitly requested.
            if (request.Hybrid == true)
            {
                long? scopeId = null;
                if (request.Scope != null && !request.Scope.IsEmpty)
                {
                    try
                    {
                        var scopeResolver = HttpContext.RequestServices
                            .GetRequiredService<IScopeResolutionService>();
                        scopeId = await scopeResolver.ResolveFromScopeKeyAsync(
                            projectId, request.Scope);
                    }
                    catch (MemoryScopeNotFoundException)
                    {
                        return Ok(new MemorySearchResponse
                        {
                            Query = request.Query,
                            Count = 0,
                            Memories = [],
                            Relations = []
                        });
                    }
                }
                else if (!string.IsNullOrWhiteSpace(request.ActorId))
                {
                    try
                    {
                        var scopeResolver = HttpContext.RequestServices
                            .GetRequiredService<IScopeResolutionService>();
                        scopeId = await scopeResolver.ResolveScopeAsync(
                            projectId, request.ActorId!);
                    }
                    catch (MemoryScopeNotFoundException)
                    {
                        return Ok(new MemorySearchResponse
                        {
                            Query = request.Query,
                            Count = 0,
                            Memories = [],
                            Relations = []
                        });
                    }
                }

                int depth = request.GraphDepth.GetValueOrDefault(1);
                var metadataConditions = request.GetEffectiveMetadataFilters();
                var effectiveCategories = request.GetEffectiveCategories();
                var hybridResult = await _hybridRetrieval.RetrieveWithRelationsAsync(
                    userId,
                    projectId,
                    request.Query,
                    request.TopK,
                    scopeId,
                    temporalFilter: request.Temporal,
                    metadataFilters: metadataConditions,
                    recencyBoost: request.RecencyBoost.GetValueOrDefault(false),
                    graphDepth: depth,
                    categoryFilters: effectiveCategories.Count > 0 ? effectiveCategories : null,
                    cancellationToken: HttpContext.RequestAborted);

                return Ok(new MemorySearchResponse
                {
                    Query     = request.Query,
                    Count     = hybridResult.Memories.Count,
                    Memories  = hybridResult.Memories,
                    Relations = hybridResult.Relations
                });
            }

            // V1 semantic-only path (unchanged)
            var result = await _memoryService.SearchMemoriesAsync(
                request, userId, projectId);

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
        catch (MemoryScopeNotFoundException ex)
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

    // ── POST /api/v1/memories/ingest ────────────────────────────────────────

    /// <summary>
    /// Accepts raw conversation messages, extracts durable memories using Mistral,
    /// evaluates against existing memories, and persists only the appropriate ones.
    ///
    /// Authentication: Bearer API key in Authorization header.
    /// ProjectId and UserId are sourced from the authenticated API key.
    /// ActorId is sourced from the request body.
    /// </summary>
    [HttpPost("ingest")]
    [ProducesResponseType(
        typeof(MemoryIngestionResponse),
        StatusCodes.Status200OK)]
    [ProducesResponseType(
        typeof(AsyncJobAcceptedResponse),
        StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> IngestConversation(
        [FromBody] IngestConversationRequest request,
        [FromQuery] string? mode = null)
    {
        // ── Controller-level validation ────────────────────────────────────────

        if (string.IsNullOrWhiteSpace(request?.ActorId) && (request?.Scope == null || request.Scope.IsEmpty))
        {
            return BadRequest(new { message = "actorId or scope is required and must not be empty." });
        }

        if (request.Messages == null || request.Messages.Count == 0)
        {
            return BadRequest(new { message = "messages must contain at least one entry." });
        }

        for (var i = 0; i < request.Messages.Count; i++)
        {
            var msg = request.Messages[i];

            if (msg == null)
            {
                return BadRequest(new
                {
                    message = $"messages[{i}] must not be null."
                });
            }

            if (string.IsNullOrWhiteSpace(msg.Role))
            {
                return BadRequest(new
                {
                    message = $"messages[{i}].role is required and must not be empty."
                });
            }

            if (string.IsNullOrWhiteSpace(msg.Content))
            {
                return BadRequest(new
                {
                    message = $"messages[{i}].content is required and must not be empty."
                });
            }
        }

        // ── Delegate to ingestion or async job service ────────────────────────

        try
        {
            var userId    = _apiKeyContext.UserId;
            var projectId = _apiKeyContext.ProjectId;

            bool isAsync = string.Equals(mode, "async", StringComparison.OrdinalIgnoreCase)
                || string.Equals(Request?.Headers["X-Kairo-Mode"], "async", StringComparison.OrdinalIgnoreCase);

            if (isAsync && _memoryJobService != null)
            {
                var asyncResult = await _memoryJobService.EnqueueAsyncIngestConversationAsync(
                    request,
                    userId,
                    projectId,
                    HttpContext.RequestAborted);

                return AcceptedAtAction(
                    nameof(GetJobStatus),
                    new { jobId = asyncResult.JobId },
                    asyncResult);
            }

            var result = await _ingestionService.IngestAsync(
                request,
                userId,
                projectId);

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            // Extraction or pipeline failure — safe message, no internal details.
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new { message = ex.Message });
        }
        catch (Exception)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new { message = "An unexpected error occurred during ingestion." });
        }
    }

    // ── Phase 4A: Job Status Endpoint ─────────────────────────────────────────

    /// <summary>
    /// Retrieves the execution status of a background memory processing job.
    /// Access is authorized to the job's owning user and project.
    /// </summary>
    [HttpGet("jobs/{jobId:long}")]
    [ProducesResponseType(typeof(JobStatusResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetJobStatus([FromRoute] long jobId)
    {
        try
        {
            var userId = _apiKeyContext.UserId;
            var projectId = _apiKeyContext.ProjectId;

            if (_memoryJobService == null)
            {
                return NotFound(new { message = $"Job {jobId} not found." });
            }

            var status = await _memoryJobService.GetJobStatusAsync(
                jobId,
                userId,
                projectId,
                HttpContext.RequestAborted);

            if (status == null)
            {
                return NotFound(new
                {
                    message = $"Job {jobId} not found or does not belong to the authenticated user/project."
                });
            }

            return Ok(status);
        }
        catch (Exception)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new { message = "An unexpected error occurred while querying job status." });
        }
    }

    // ── Phase 3: Batch Endpoints ──────────────────────────────────────────────

    /// <summary>
    /// Creates a batch of memories atomically for the authenticated user and project.
    /// </summary>
    [HttpPost("batch")]
    [ProducesResponseType(typeof(BatchCreateResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> BatchCreate([FromBody] BatchCreateMemoryRequest request)
    {
        try
        {
            var userId = _apiKeyContext.UserId;
            var projectId = _apiKeyContext.ProjectId;

            var result = await _memoryService.BatchCreateMemoriesAsync(
                request,
                userId,
                projectId,
                HttpContext.RequestAborted);

            return StatusCode(StatusCodes.Status201Created, result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new { message = "An unexpected error occurred during batch creation." });
        }
    }

    /// <summary>
    /// Updates a batch of memories for the authenticated user and project.
    /// </summary>
    [HttpPut("batch")]
    [ProducesResponseType(typeof(BatchUpdateResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> BatchUpdate([FromBody] BatchUpdateMemoryRequest request)
    {
        try
        {
            var userId = _apiKeyContext.UserId;
            var projectId = _apiKeyContext.ProjectId;

            var result = await _memoryService.BatchUpdateMemoriesAsync(
                request,
                userId,
                projectId,
                HttpContext.RequestAborted);

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new { message = "An unexpected error occurred during batch update." });
        }
    }

    /// <summary>
    /// Soft-deletes a batch of memories for the authenticated user and project.
    /// </summary>
    [HttpDelete("batch")]
    [ProducesResponseType(typeof(BatchDeleteResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> BatchDelete([FromBody] BatchDeleteMemoryRequest request)
    {
        try
        {
            var userId = _apiKeyContext.UserId;
            var projectId = _apiKeyContext.ProjectId;

            var result = await _memoryService.BatchDeleteMemoriesAsync(
                request,
                userId,
                projectId,
                HttpContext.RequestAborted);

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new { message = "An unexpected error occurred during batch delete." });
        }
    }
}