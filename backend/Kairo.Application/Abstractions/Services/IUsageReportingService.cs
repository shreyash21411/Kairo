using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Phase 5.8.4: Usage reporting service — aggregates ledger data for reporting.
/// </summary>
public interface IUsageReportingService
{
    /// <summary>
    /// Returns an aggregated usage report for a project within the specified time window.
    /// </summary>
    Task<ProjectUsageReport> GetProjectUsageAsync(
        long projectId,
        long requestingUserId,
        DateTime? fromUtc = null,
        DateTime? toUtc = null,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Phase 5.8.4: Aggregated usage report for a project.
/// </summary>
public class ProjectUsageReport
{
    public long ProjectId { get; set; }
    public DateTime FromUtc { get; set; }
    public DateTime ToUtc { get; set; }
    public int TotalOperations { get; set; }
    public int TotalUnits { get; set; }
    public int? TotalTokensUsed { get; set; }
    public List<UsageBreakdownEntry> ByOperation { get; set; } = new();
    public List<UsageBreakdownEntry> ByOutcome { get; set; } = new();
}

/// <summary>
/// Phase 5.8.4: A single row in an aggregated usage breakdown.
/// </summary>
public class UsageBreakdownEntry
{
    public string Label { get; set; } = null!;
    public int OperationCount { get; set; }
    public int UnitCount { get; set; }
}
