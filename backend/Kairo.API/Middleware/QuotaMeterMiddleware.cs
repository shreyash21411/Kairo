using System;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Kairo.API.Middleware;

/// <summary>
/// Phase 5.8.3: Quota enforcement middleware.
///
/// Checks project quotas before memory operation routes are processed.
/// On quota exceeded, writes HTTP 429 with a structured JSON body and
/// sets the Retry-After header. Quota failures are metered (Throttled).
///
/// Scope: applied to routes under /api/v1/memories (excluding job-polling).
/// Runs AFTER Authentication and Authorization so that IApiKeyContext is
/// established and unauthenticated requests are stopped before quota evaluation.
/// MCP tools manage their own tool-level quota enforcement with exact attribution.
/// </summary>
public sealed class QuotaMeterMiddleware
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    private readonly RequestDelegate _next;

    public QuotaMeterMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? string.Empty;

        // Apply only to /api/v1/memories routes. Exclude non-billable job status polling.
        var isMemoryRoute = path.StartsWith("/api/v1/memories", StringComparison.OrdinalIgnoreCase);
        if (!isMemoryRoute || path.Contains("/jobs", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        // Resolve authenticated context.
        var apiKeyContext = context.RequestServices.GetService<IApiKeyContext>();
        if (apiKeyContext is null || apiKeyContext.ProjectId == 0)
        {
            // Allow downstream authorization handler to reject unauthenticated requests.
            await _next(context);
            return;
        }

        // Derive operation type from HTTP method and path
        var operationType = DeriveOperationType(context.Request);
        var unitCount = DeriveUnitCount(context.Request, operationType);

        var quotaService = context.RequestServices.GetRequiredService<IQuotaEnforcementService>();
        var result = await quotaService.CheckAsync(
            apiKeyContext.ProjectId,
            operationType,
            unitCount,
            context.RequestAborted);

        if (!result.IsAllowed)
        {
            // Await metering the throttled attempt to guarantee completion within the request lifecycle.
            var meterService = context.RequestServices.GetService<IUsageMeterService>();
            if (meterService is not null)
            {
                await meterService.RecordAsync(
                    apiKeyContext.UserId,
                    apiKeyContext.ProjectId,
                    operationType,
                    UsageOutcome.Throttled,
                    unitCount,
                    tokensUsed: null,
                    cancellationToken: CancellationToken.None);
            }

            context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
            context.Response.ContentType = "application/json";

            if (result.RetryAfterSeconds.HasValue)
            {
                context.Response.Headers["Retry-After"] = result.RetryAfterSeconds.Value.ToString();
            }

            var body = JsonSerializer.Serialize(new
            {
                error = "quota_exceeded",
                message = result.Reason ?? "Request rate limit exceeded.",
                retryAfterSeconds = result.RetryAfterSeconds
            }, JsonOpts);

            await context.Response.WriteAsync(body, context.RequestAborted);
            return;
        }

        await _next(context);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static string DeriveOperationType(HttpRequest request)
    {
        var method = request.Method;
        var path   = request.Path.Value ?? string.Empty;

        if (path.Contains("/memories/ingest", StringComparison.OrdinalIgnoreCase))
            return UsageOperationType.DialogueIngest;

        if (path.Contains("/memories/batch", StringComparison.OrdinalIgnoreCase) && method == "POST")
            return UsageOperationType.BatchCreate;

        if (path.Contains("/memories/batch", StringComparison.OrdinalIgnoreCase) && method == "DELETE")
            return UsageOperationType.BatchDelete;

        if (path.Contains("/memories/search", StringComparison.OrdinalIgnoreCase))
            return UsageOperationType.MemoryRecall;

        return method switch
        {
            "GET"    => UsageOperationType.MemoryGet,
            "POST"   => UsageOperationType.MemoryCreate,
            "PUT"    => UsageOperationType.MemoryUpdate,
            "PATCH"  => UsageOperationType.MemoryUpdate,
            "DELETE" => UsageOperationType.MemoryDelete,
            _        => UsageOperationType.MemoryGet
        };
    }

    private static int DeriveUnitCount(HttpRequest request, string operationType)
    {
        return 1;
    }
}
