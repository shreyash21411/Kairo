using System;

namespace Kairo.Infrastructure.Persistence.Entities;

/// <summary>
/// Phase 4A: Represents a durable background memory processing job.
/// Stored in the database to support reliable claiming, concurrency leasing,
/// retries, and failure tracking without external brokers.
/// </summary>
public partial class MemoryIngestionJob
{
    public Guid JobId { get; set; }

    public long ProjectId { get; set; }

    public long UserId { get; set; }

    public long? ScopeId { get; set; }

    public long? MemoryId { get; set; }

    public string JobType { get; set; } = null!;

    public string Status { get; set; } = "Pending";

    public string? Payload { get; set; }

    public int Attempts { get; set; } = 0;

    public int MaxAttempts { get; set; } = 3;

    public DateTime AvailableAt { get; set; }

    public DateTime? LockedUntil { get; set; }

    public string? LockOwner { get; set; }

    public string? LastError { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? CompletedAt { get; set; }

    public virtual Projects? Project { get; set; }

    public virtual Users? User { get; set; }

    public virtual Memories? Memory { get; set; }

    public virtual MemoryScopes? Scope { get; set; }
}
