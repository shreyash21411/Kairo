using System.Net;
using System.Text.Json;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Kairo.API.Middleware;

/// <summary>
/// Phase 5.8.3: Quota enforcement middleware.
///
/// Checks project quotas before any memory operation route is processed.
/// On quota exceeded, writes HTTP 429 with a structured JSON body and
/// sets the Retry-After header. Quota failures are metered (Throttled).
///
/// Scope: applied only to routes under /api/v1/memories and /mcp.
/// Health-check, auth, and usage-reporting routes bypass this middleware.
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
        // Only apply to /api/v1/memories and /mcp routes.
        var path = context.Request.Path.Value ?? string.Empty;
        var isTargetRoute = path.StartsWith("/api/v1/memories", StringComparison.OrdinalIgnoreCase)
                         || path.StartsWith("/mcp", StringComparison.OrdinalIgnoreCase);

        if (!isTargetRoute)
        {
            await _next(context);
            return;
        }

        // Resolve authenticated context (may be null for unauthenticated requests).
        var apiKeyContext = context.RequestServices.GetService<IApiKeyContext>();
        if (apiKeyContext is null || apiKeyContext.ProjectId == 0)
        {
            await _next(context);
            return;
        }

        // Derive the operation type from the HTTP method + path.
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
            // Meter the throttled attempt (fire-and-forget).
            var meterService = context.RequestServices.GetService<IUsageMeterService>();
            if (meterService is not null)
            {
                _ = meterService.RecordAsync(
                    apiKeyContext.UserId,
                    apiKeyContext.ProjectId,
                    operationType,
                    UsageOutcome.Throttled,
                    unitCount);
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
        // For batch routes we count the path segment if available.
        // Without reading the body we can only return 1 here; the per-minute
        // quota is coarse and batch metering happens in the service layer.
        return 1;
    }
}
