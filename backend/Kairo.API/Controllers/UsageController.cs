using System;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Kairo.API.Controllers;

/// <summary>
/// Phase 5.8.4: Usage reporting endpoint.
///
/// GET /api/v1/projects/{projectId}/usage
///
/// Returns an aggregated usage report for the specified project over an
/// optional time window. Authorization: the requesting user must own
/// the project (enforced in UsageReportingService).
/// </summary>
[ApiController]
[Route("api/v1/projects")]
[Authorize]
[Produces("application/json")]
public class UsageController : ControllerBase
{
    private readonly IUsageReportingService _reportingService;
    private readonly IApiKeyContext _apiKeyContext;
    private readonly ILogger<UsageController> _logger;

    public UsageController(
        IUsageReportingService reportingService,
        IApiKeyContext apiKeyContext,
        ILogger<UsageController> logger)
    {
        _reportingService = reportingService;
        _apiKeyContext    = apiKeyContext;
        _logger           = logger;
    }

    /// <summary>
    /// Returns an aggregated usage report for the specified project.
    /// Optional query parameters: from (UTC ISO 8601), to (UTC ISO 8601).
    /// Defaults to the last 30 days when neither is specified.
    /// </summary>
    [HttpGet("{projectId:long}/usage")]
    [ProducesResponseType(typeof(ProjectUsageReport), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetUsage(
        long projectId,
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to   = null,
        CancellationToken cancellationToken = default)
    {
        if (from.HasValue && to.HasValue && from.Value > to.Value)
        {
            return BadRequest(new { error = "from cannot be after to." });
        }

        try
        {
            var report = await _reportingService.GetProjectUsageAsync(
                projectId,
                _apiKeyContext.UserId,
                from,
                to,
                cancellationToken);

            return Ok(report);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }
}
