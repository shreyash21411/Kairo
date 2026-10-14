using System;

namespace Kairo.Infrastructure.Persistence.Entities;

/// <summary>
/// Phase 5.8: Append-only ledger record for every metered API operation.
/// One row per operation. UserId + ProjectId are denormalized for fast
/// time-windowed aggregation without joins. Compatible with SQL Server and PostgreSQL.
/// </summary>
public class UsageLedgerEntry
{
    /// <summary>Auto-generated surrogate key (BIGINT IDENTITY / SERIAL).</summary>
    public long EntryId { get; set; }

    /// <summary>The authenticated user who triggered this operation.</summary>
    public long UserId { get; set; }

    /// <summary>The project context from the API key.</summary>
    public long ProjectId { get; set; }

    /// <summary>
    /// Operation type string (see <see cref="UsageOperationType"/>).
    /// Stored as a compact string for SQL portability.
    /// </summary>
    public string OperationType { get; set; } = null!;

    /// <summary>Outcome of the operation: Success, Failure, Throttled.</summary>
    public string Outcome { get; set; } = "Success";

    /// <summary>UTC timestamp when the operation completed.</summary>
    public DateTime OccurredAt { get; set; }

    /// <summary>Number of logical units consumed (e.g., 1 per single op, N for batch).</summary>
    public int UnitCount { get; set; } = 1;

    /// <summary>
    /// LLM/embedding tokens consumed (null when provider does not reliably report).
    /// </summary>
    public int? TokensUsed { get; set; }

    // ── Navigation properties ──────────────────────────────────────────────

    public virtual Users User { get; set; } = null!;
    public virtual Projects Project { get; set; } = null!;
}
