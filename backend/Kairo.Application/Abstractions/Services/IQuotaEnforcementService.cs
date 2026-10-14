using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Phase 5.8.3: Quota enforcement service.
/// Checks whether a project has exceeded its configured rate/count limits.
/// </summary>
public interface IQuotaEnforcementService
{
    /// <summary>
    /// Returns true if the project is allowed to proceed with the requested operation count.
    /// Returns false (quota exceeded) if the project has hit a per-minute or per-day limit.
    /// Must never throw — on internal error, allows the request (fail-open).
    /// </summary>
    Task<QuotaCheckResult> CheckAsync(
        long projectId,
        string operationType,
        int unitCount = 1,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Phase 5.8.3: Result of a quota enforcement check.
/// </summary>
public class QuotaCheckResult
{
    public static readonly QuotaCheckResult Allowed = new() { IsAllowed = true };

    public bool IsAllowed { get; init; }
    public string? Reason { get; init; }
    public int? RetryAfterSeconds { get; init; }

    public static QuotaCheckResult Exceeded(string reason, int retryAfterSeconds = 60)
        => new() { IsAllowed = false, Reason = reason, RetryAfterSeconds = retryAfterSeconds };
}
