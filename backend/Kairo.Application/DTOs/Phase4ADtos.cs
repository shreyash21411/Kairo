using System;
using System.Collections.Generic;

namespace Kairo.Application.DTOs;

/// <summary>
/// Phase 4A: Represents an ingestion job record passed between persistence and application services.
/// JobId is always database-generated (long / BIGINT IDENTITY).
/// </summary>
public class MemoryIngestionJobRecord
{
    public long JobId { get; set; }

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
}

/// <summary>
/// Response returned when a memory ingestion or creation is accepted asynchronously.
/// </summary>
public class AsyncJobAcceptedResponse
{
    public long JobId { get; set; }

    public string Status { get; set; } = "Pending";

    public long? MemoryId { get; set; }

    public DateTime CreatedAt { get; set; }

    public string Message { get; set; } = "Memory processing accepted for background execution.";
}

/// <summary>
/// Response returned when querying the status of a memory ingestion job.
/// </summary>
public class JobStatusResponse
{
    public long JobId { get; set; }

    public string JobType { get; set; } = null!;

    public string Status { get; set; } = null!;

    public long? MemoryId { get; set; }

    public int Attempts { get; set; }

    public int MaxAttempts { get; set; }

    public string? LastError { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? CompletedAt { get; set; }
}

/// <summary>
/// Internal payload serialized for asynchronous single-memory processing.
/// </summary>
public class CreateMemoryJobPayload
{
    public string Content { get; set; } = null!;

    public string MemoryType { get; set; } = null!;

    public string? Metadata { get; set; }

    public DateTime? OccurredAt { get; set; }

    public DateTime? ExpiresAt { get; set; }

    public List<string>? Categories { get; set; }
}

/// <summary>
/// Internal payload serialized for asynchronous conversational ingestion.
/// </summary>
public class IngestConversationJobPayload
{
    public string? ActorId { get; set; }

    public MemoryScopeKey? Scope { get; set; }

    public List<IngestMessageItem> Messages { get; set; } = new();
}
