using System;
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
/// Dedicated controller for the BERU Voice Agent.
/// Exposes:
///   POST api/voidzone/beru/chat
///
/// Authentication: KairoApiKey (default scheme).
/// Feature flag: Beru:Enabled (defaults to false).
/// When disabled, immediately returns HTTP 503 without executing any downstream calls.
/// </summary>
[ApiController]
[Route("api/voidzone/beru")]
[Authorize]
public class BeruController : ControllerBase
{
    private readonly IBeruService _beruService;
    private readonly IApiKeyContext _apiKeyContext;
    private readonly BeruOptions _beruOptions;

    public BeruController(
        IBeruService beruService,
        IApiKeyContext apiKeyContext,
        IOptions<BeruOptions> beruOptions)
    {
        _beruService   = beruService   ?? throw new ArgumentNullException(nameof(beruService));
        _apiKeyContext = apiKeyContext ?? throw new ArgumentNullException(nameof(apiKeyContext));
        _beruOptions   = beruOptions?.Value ?? throw new ArgumentNullException(nameof(beruOptions));
    }

    /// <summary>
    /// Processes a user voice transcript or text query with the BERU voice reasoning agent.
    /// Returns voice-friendly conversational text and token metrics.
    /// Requires Beru:Enabled = true in configuration.
    /// </summary>
    [HttpPost("chat")]
    public async Task<IActionResult> Chat(
        [FromBody] BeruChatRequest request,
        CancellationToken cancellationToken)
    {
        // ── Guard: Feature isolation flag ──────────────────────────────────────
        if (!_beruOptions.Enabled)
            return StatusCode(503, new { error = "beru_disabled", message = "BERU voice agent is disabled in configuration." });

        if (request is null || string.IsNullOrWhiteSpace(request.Message))
            return BadRequest(new { error = "message_required" });

        var userId    = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;

        try
        {
            var result = await _beruService.ProcessChatAsync(request, cancellationToken).ConfigureAwait(false);
            return Ok(new { userId, projectId, result });
        }
        catch (InvalidOperationException) when (!_beruOptions.Enabled)
        {
            return StatusCode(503, new { error = "beru_disabled" });
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

