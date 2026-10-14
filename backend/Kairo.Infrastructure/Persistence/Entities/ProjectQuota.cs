using System;

namespace Kairo.Infrastructure.Persistence.Entities;

/// <summary>
/// Phase 5.8: Per-project configurable quota thresholds.
/// One row per project. A missing row means "no quota enforced".
/// Both SQL Server and PostgreSQL compatible.
/// </summary>
public class ProjectQuota
{
    /// <summary>FK and PK — one quota row per project.</summary>
    public long ProjectId { get; set; }

    /// <summary>Maximum operations per minute. NULL = unlimited.</summary>
    public int? MaxOperationsPerMinute { get; set; }

    /// <summary>Maximum operations per day. NULL = unlimited.</summary>
    public int? MaxOperationsPerDay { get; set; }

    /// <summary>Maximum memories this project can hold. NULL = unlimited.</summary>
    public int? MaxTotalMemories { get; set; }

    /// <summary>Maximum batch size override. NULL = use global default (100).</summary>
    public int? MaxBatchSize { get; set; }

    /// <summary>When this quota configuration was last modified.</summary>
    public DateTime UpdatedAt { get; set; }

    // ── Navigation properties ──────────────────────────────────────────────

    public virtual Projects Project { get; set; } = null!;
}
