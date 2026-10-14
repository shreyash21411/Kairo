using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Services;
using Kairo.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Kairo.Infrastructure.Services;

/// <summary>
/// Phase 5.8.4: Usage reporting implementation.
/// Aggregates UsageLedger rows for a given project and time window.
/// </summary>
public sealed class UsageReportingService : IUsageReportingService
{
    private readonly KairoDbContext _dbContext;

    public UsageReportingService(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <inheritdoc/>
    public async Task<ProjectUsageReport> GetProjectUsageAsync(
        long projectId,
        long requestingUserId,
        DateTime? fromUtc = null,
        DateTime? toUtc = null,
        CancellationToken cancellationToken = default)
    {
        var effectiveFrom = fromUtc ?? DateTime.UtcNow.AddDays(-30);
        var effectiveTo   = toUtc   ?? DateTime.UtcNow;

        // Verify the requesting user owns this project (basic ownership check).
        var projectExists = await _dbContext.Projects
            .AsNoTracking()
            .AnyAsync(p => p.ProjectId == projectId
                        && p.UserId == requestingUserId
                        && !p.IsDeleted, cancellationToken);

        if (!projectExists)
        {
            throw new UnauthorizedAccessException(
                $"Project {projectId} was not found or does not belong to the current user.");
        }

        var entries = await _dbContext.UsageLedger
            .AsNoTracking()
            .Where(e => e.ProjectId == projectId
                     && e.OccurredAt >= effectiveFrom
                     && e.OccurredAt < effectiveTo)
            .ToListAsync(cancellationToken);

        var byOperation = entries
            .GroupBy(e => e.OperationType)
            .Select(g => new UsageBreakdownEntry
            {
                Label          = g.Key,
                OperationCount = g.Count(),
                UnitCount      = g.Sum(e => e.UnitCount)
            })
            .OrderByDescending(x => x.OperationCount)
            .ToList();

        var byOutcome = entries
            .GroupBy(e => e.Outcome)
            .Select(g => new UsageBreakdownEntry
            {
                Label          = g.Key,
                OperationCount = g.Count(),
                UnitCount      = g.Sum(e => e.UnitCount)
            })
            .OrderByDescending(x => x.OperationCount)
            .ToList();

        int? totalTokens = entries.Any(e => e.TokensUsed.HasValue)
            ? entries.Sum(e => e.TokensUsed ?? 0)
            : null;

        return new ProjectUsageReport
        {
            ProjectId       = projectId,
            FromUtc         = effectiveFrom,
            ToUtc           = effectiveTo,
            TotalOperations = entries.Count,
            TotalUnits      = entries.Sum(e => e.UnitCount),
            TotalTokensUsed = totalTokens,
            ByOperation     = byOperation,
            ByOutcome       = byOutcome
        };
    }
}
