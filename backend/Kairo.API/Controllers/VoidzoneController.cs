using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Meta;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Kairo.API.Controllers;

/// <summary>
/// VOIDZONE dedicated controller — the only controller permitted to call
/// the Meta Model API integration layer.
///
/// Exposes exactly two capabilities:
///   POST api/voidzone/memory/extract     — Memory Engine
///   POST api/voidzone/continuity/generate — Continuity Engine
///
/// Authentication: KairoApiKey (default scheme — same as all other controllers).
/// Identity is always derived from IApiKeyContext; no actorId is accepted from the client.
///
/// MetaAI:Enabled must be true in configuration for any call to proceed.
/// Both endpoints return HTTP 503 without calling any service when disabled.
///
/// IMPORTANT: This controller does NOT modify any existing controller,
/// Mistral integration, MemoryIngestionService, or database schema.
/// </summary>
[ApiController]
[Route("api/voidzone")]
[Authorize]
public class VoidzoneController : ControllerBase
{
    private readonly IMetaMemoryService _memoryService;
    private readonly IMetaContinuityService _continuityService;
    private readonly IApiKeyContext _apiKeyContext;
    private readonly MetaAIOptions _metaOptions;

    public VoidzoneController(
        IMetaMemoryService memoryService,
        IMetaContinuityService continuityService,
        IApiKeyContext apiKeyContext,
        IOptions<MetaAIOptions> metaOptions)
    {
        _memoryService      = memoryService      ?? throw new ArgumentNullException(nameof(memoryService));
        _continuityService  = continuityService  ?? throw new ArgumentNullException(nameof(continuityService));
        _apiKeyContext       = apiKeyContext      ?? throw new ArgumentNullException(nameof(apiKeyContext));
        _metaOptions         = metaOptions?.Value ?? throw new ArgumentNullException(nameof(metaOptions));
    }

    // ── Memory Engine ──────────────────────────────────────────────────────────

    /// <summary>
    /// Extracts structured project memory from a raw conversation transcript.
    /// Returns a MetaMemoryResult — not persisted to the database.
    /// Requires MetaAI:Enabled = true in configuration.
    /// </summary>
    [HttpPost("memory/extract")]
    public async Task<IActionResult> ExtractMemory(
        [FromBody] MemoryExtractRequest request,
        CancellationToken cancellationToken)
    {
        // ── Enabled guard (no service call when disabled) ──────────────────────
        if (!_metaOptions.Enabled)
            return StatusCode(503, new { error = "meta_ai_disabled" });

        if (request is null || string.IsNullOrWhiteSpace(request.RawTranscript))
            return BadRequest(new { error = "raw_transcript_required" });

        // Identity from authenticated credentials — never from client input.
        var userId    = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;

        try
        {
            var result = await _memoryService.ExtractAsync(
                request.RawTranscript,
                request.Messages ?? new List<MetaConversationMessage>(),
                cancellationToken).ConfigureAwait(false);

            return Ok(new { userId, projectId, result });
        }
        catch (MetaAIExceptions.MetaAIInputTooLargeException ex)
        {
            return StatusCode(413, new
            {
                error           = "input_too_large",
                estimatedTokens = ex.EstimatedTokens,
                maxTokens       = ex.MaxTokens,
                message         = ex.Message
            });
        }
        catch (MetaAIExceptions.MetaAIAuthException)
        {
            return StatusCode(502, new { error = "meta_ai_auth_failure" });
        }
        catch (MetaAIExceptions.MetaAIRateLimitException)
        {
            return StatusCode(429, new { error = "meta_ai_rate_limited" });
        }
        catch (MetaAIExceptions.MetaAIMalformedResponseException)
        {
            return StatusCode(502, new { error = "meta_ai_malformed_response" });
        }
        catch (MetaAIExceptions.MetaAIException)
        {
            return StatusCode(502, new { error = "meta_ai_error" });
        }
    }

    // ── Continuity Engine ──────────────────────────────────────────────────────

    /// <summary>
    /// Generates a structured continuity summary from a raw conversation transcript.
    /// Returns a MetaContinuityResult — standalone document, not embedded in ContinuityArchive.
    /// Archive schemaVersion (1.0), format identifier, and SHA-256 hashing are unchanged.
    /// Requires MetaAI:Enabled = true in configuration.
    /// </summary>
    [HttpPost("continuity/generate")]
    public async Task<IActionResult> GenerateContinuity(
        [FromBody] ContinuityGenerateRequest request,
        CancellationToken cancellationToken)
    {
        // ── Enabled guard (no service call when disabled) ──────────────────────
        if (!_metaOptions.Enabled)
            return StatusCode(503, new { error = "meta_ai_disabled" });

        if (request is null || string.IsNullOrWhiteSpace(request.RawTranscript))
            return BadRequest(new { error = "raw_transcript_required" });

        // Identity from authenticated credentials — never from client input.
        var userId    = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;

        try
        {
            var result = await _continuityService.GenerateAsync(
                request.RawTranscript,
                request.Platform ?? string.Empty,
                request.Title    ?? string.Empty,
                cancellationToken).ConfigureAwait(false);

            return Ok(new { userId, projectId, result });
        }
        catch (MetaAIExceptions.MetaAIInputTooLargeException ex)
        {
            return StatusCode(413, new
            {
                error           = "input_too_large",
                estimatedTokens = ex.EstimatedTokens,
                maxTokens       = ex.MaxTokens,
                message         = ex.Message
            });
        }
        catch (MetaAIExceptions.MetaAIAuthException)
        {
            return StatusCode(502, new { error = "meta_ai_auth_failure" });
        }
        catch (MetaAIExceptions.MetaAIRateLimitException)
        {
            return StatusCode(429, new { error = "meta_ai_rate_limited" });
        }
        catch (MetaAIExceptions.MetaAIMalformedResponseException)
        {
            return StatusCode(502, new { error = "meta_ai_malformed_response" });
        }
        catch (MetaAIExceptions.MetaAIException)
        {
            return StatusCode(502, new { error = "meta_ai_error" });
        }
    }
}

// ── Request DTOs (controller-local; not persisted, not shared with other controllers) ──

/// <summary>Request body for POST api/voidzone/memory/extract.</summary>
public sealed class MemoryExtractRequest
{
    /// <summary>Full raw transcript text to extract memory from.</summary>
    public string RawTranscript { get; set; } = string.Empty;

    /// <summary>Optional ordered conversation messages. When provided, preferred over raw text.</summary>
    public List<MetaConversationMessage>? Messages { get; set; }
}

/// <summary>Request body for POST api/voidzone/continuity/generate.</summary>
public sealed class ContinuityGenerateRequest
{
    /// <summary>Full raw transcript text.</summary>
    public string RawTranscript { get; set; } = string.Empty;

    /// <summary>Source platform (e.g. "chatgpt", "claude").</summary>
    public string? Platform { get; set; }

    /// <summary>Conversation or project title.</summary>
    public string? Title { get; set; }
}

