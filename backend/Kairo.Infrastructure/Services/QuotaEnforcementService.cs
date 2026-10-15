using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Services;

/// <summary>
/// Phase 5.8.3: Quota enforcement implementation.
///
/// Reads <see cref="Entities.ProjectQuota"/> from the database and evaluates usage ledger
/// records in the current window.
/// Concurrency safety: per-project synchronization and in-flight tracking prevent race
/// conditions where concurrent requests all pass on a stale usage snapshot.
/// Configurable fail-open / fail-closed behavior via <see cref="QuotaOptions"/>.
/// </summary>
public sealed class QuotaEnforcementService : IQuotaEnforcementService
{
    private static readonly ConcurrentDictionary<long, SemaphoreSlim> ProjectLocks = new();
    private static readonly ConcurrentDictionary<long, int> InFlightUnits = new();

    private readonly KairoDbContext _dbContext;
    private readonly ILogger<QuotaEnforcementService> _logger;
    private readonly IOptions<QuotaOptions>? _options;

    public QuotaEnforcementService(
        KairoDbContext dbContext,
        ILogger<QuotaEnforcementService> logger,
        IOptions<QuotaOptions>? options = null)
    {
        _dbContext = dbContext ?? throw new ArgumentNullException(nameof(dbContext));
        _logger    = logger ?? throw new ArgumentNullException(nameof(logger));
        _options   = options;
    }

    /// <inheritdoc/>
    public async Task<QuotaCheckResult> CheckAsync(
        long projectId,
        string operationType,
        int unitCount = 1,
        CancellationToken cancellationToken = default)
    {
        var sem = ProjectLocks.GetOrAdd(projectId, _ => new SemaphoreSlim(1, 1));
        await sem.WaitAsync(cancellationToken);

        try
        {
            var quota = await _dbContext.ProjectQuotas
                .AsNoTracking()
                .FirstOrDefaultAsync(q => q.ProjectId == projectId, cancellationToken);

            // No quota configured → always allow.
            if (quota == null) return QuotaCheckResult.Allowed;

            // ── MaxBatchSize check ────────────────────────────────────────────
            if (quota.MaxBatchSize.HasValue && unitCount > quota.MaxBatchSize.Value)
            {
                return QuotaCheckResult.Exceeded(
                    $"Batch size {unitCount} exceeds maximum allowed batch size of {quota.MaxBatchSize.Value}.",
                    retryAfterSeconds: 0);
            }

            var now = DateTime.UtcNow;
            InFlightUnits.TryGetValue(projectId, out var inFlight);

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

                var totalMinute = minuteCount + inFlight;
                if (totalMinute + unitCount > quota.MaxOperationsPerMinute.Value)
                {
                    return QuotaCheckResult.Exceeded(
                        $"Rate limit exceeded: {totalMinute}/{quota.MaxOperationsPerMinute.Value} operations per minute.",
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

                var totalDay = dayCount + inFlight;
                if (totalDay + unitCount > quota.MaxOperationsPerDay.Value)
                {
                    var secondsUntilMidnight = Math.Max(1, (int)(dayStart.AddDays(1) - now).TotalSeconds);
                    return QuotaCheckResult.Exceeded(
                        $"Daily limit exceeded: {totalDay}/{quota.MaxOperationsPerDay.Value} operations per day.",
                        retryAfterSeconds: secondsUntilMidnight);
                }
            }

            // Permitted: register in-flight units
            InFlightUnits.AddOrUpdate(projectId, unitCount, (_, current) => current + unitCount);
            return QuotaCheckResult.Allowed;
        }
        catch (Exception ex)
        {
            var failOpen = _options?.Value?.FailOpen ?? true;
            _logger.LogError(
                ex,
                "Quota check storage error for projectId={ProjectId}, operationType={OperationType}. FailOpen={FailOpen}.",
                projectId, operationType, failOpen);

            if (failOpen)
            {
                return QuotaCheckResult.Allowed;
            }

            return QuotaCheckResult.Exceeded("Quota check service temporarily unavailable.", retryAfterSeconds: 30);
        }
        finally
        {
            sem.Release();
        }
    }

    /// <inheritdoc/>
    public void ReleaseReservation(long projectId, int unitCount)
    {
        InFlightUnits.AddOrUpdate(projectId, 0, (_, current) => Math.Max(0, current - unitCount));
    }

    /// <summary>
    /// Test helper to reset in-memory concurrency states between unit test runs.
    /// </summary>
    public static void ResetConcurrencyState()
    {
        InFlightUnits.Clear();
        ProjectLocks.Clear();
    }
}
