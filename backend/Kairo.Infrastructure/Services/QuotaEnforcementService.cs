using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Kairo.Infrastructure.Services;

/// <summary>
/// Phase 5.8.3: Quota enforcement implementation.
///
/// Reads <see cref="ProjectQuota"/> from the database and counts usage ledger
/// rows in the current window. Fail-open: if any error occurs the check returns
/// <see cref="QuotaCheckResult.Allowed"/>.
/// </summary>
public sealed class QuotaEnforcementService : IQuotaEnforcementService
{
    private readonly KairoDbContext _dbContext;
    private readonly ILogger<QuotaEnforcementService> _logger;

    public QuotaEnforcementService(KairoDbContext dbContext, ILogger<QuotaEnforcementService> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    /// <inheritdoc/>
    public async Task<QuotaCheckResult> CheckAsync(
        long projectId,
        string operationType,
        int unitCount = 1,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var quota = await _dbContext.ProjectQuotas
                .AsNoTracking()
                .FirstOrDefaultAsync(q => q.ProjectId == projectId, cancellationToken);

            // No quota configured → always allow.
            if (quota == null) return QuotaCheckResult.Allowed;

            var now = DateTime.UtcNow;

            // ── Per-minute check ──────────────────────────────────────────────
            if (quota.MaxOperationsPerMinute.HasValue)
            {
                var windowStart = now.AddMinutes(-1);
                var minuteCount = await _dbContext.UsageLedger
                    .AsNoTracking()
                    .Where(e => e.ProjectId == projectId
                             && e.OccurredAt >= windowStart
                             && e.Outcome != UsageOutcome.Throttled)
                    .SumAsync(e => e.UnitCount, cancellationToken);

                if (minuteCount + unitCount > quota.MaxOperationsPerMinute.Value)
                {
                    return QuotaCheckResult.Exceeded(
                        $"Rate limit exceeded: {minuteCount}/{quota.MaxOperationsPerMinute.Value} operations per minute.",
                        retryAfterSeconds: 60);
                }
            }

            // ── Per-day check ─────────────────────────────────────────────────
            if (quota.MaxOperationsPerDay.HasValue)
            {
                var dayStart = now.Date;
                var dayCount = await _dbContext.UsageLedger
                    .AsNoTracking()
                    .Where(e => e.ProjectId == projectId
                             && e.OccurredAt >= dayStart
                             && e.Outcome != UsageOutcome.Throttled)
                    .SumAsync(e => e.UnitCount, cancellationToken);

                if (dayCount + unitCount > quota.MaxOperationsPerDay.Value)
                {
                    var secondsUntilMidnight = (int)(dayStart.AddDays(1) - now).TotalSeconds;
                    return QuotaCheckResult.Exceeded(
                        $"Daily limit exceeded: {dayCount}/{quota.MaxOperationsPerDay.Value} operations per day.",
                        retryAfterSeconds: secondsUntilMidnight);
                }
            }

            return QuotaCheckResult.Allowed;
        }
        catch (Exception ex)
        {
            // Fail-open: quota check failure must never block a legitimate request.
            _logger.LogWarning(
                ex,
                "Quota check failed for projectId={ProjectId}. Failing open.",
                projectId);
            return QuotaCheckResult.Allowed;
        }
    }
}
