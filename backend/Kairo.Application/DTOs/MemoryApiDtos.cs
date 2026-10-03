namespace Kairo.Application.DTOs;

// ── Request DTOs ─────────────────────────────────────────────────────────────

/// <summary>
/// Request body for POST /api/v1/memories.
/// The authenticated API key determines ProjectId and UserId.
/// ActorId identifies the memory partition (MemoryScope) within the project.
/// ProjectId is never accepted from the client — it is sourced from IApiKeyContext.
/// </summary>
public class CreateMemoryRequest
{
    public string Content { get; set; } = null!;

    public string MemoryType { get; set; } = null!;

    /// <summary>
    /// The actor identifier for this memory within the authenticated project.
    /// Combined with the project's ProjectId to resolve the target MemoryScope.
    /// Must not be null, empty, or whitespace.
    /// </summary>
    public string ActorId { get; set; } = null!;
}

/// <summary>
/// Request body for PUT /api/v1/memories/{memoryId}.
/// The authenticated API key determines the memory owner.
/// </summary>
public class UpdateMemoryRequest
{

    public string Content { get; set; } = null!;

    public string MemoryType { get; set; } = null!;
}

/// <summary>
/// Request body for POST /api/v1/memories/search.
/// The authenticated API key determines ProjectId and UserId.
/// ActorId identifies the memory partition (MemoryScope) to search within the project.
/// ProjectId is never accepted from the client — it is sourced from IApiKeyContext.
/// </summary>
public class MemorySearchRequest
{
    public string Query { get; set; } = null!;

    public int TopK { get; set; } = 5;

    /// <summary>
    /// The actor identifier for the memory scope to search within the authenticated project.
    /// Combined with the project's ProjectId to resolve the target MemoryScope.
    /// Must not be null, empty, or whitespace.
    /// </summary>
    public string ActorId { get; set; } = null!;
}

// ── Response DTOs ─────────────────────────────────────────────────────────────

/// <summary>
/// Represents a single memory returned from any read/write endpoint.
/// </summary>
public class MemoryResponse
{
    public long MemoryId { get; set; }

    public long UserId { get; set; }

    public string Content { get; set; } = null!;

    public string? MemoryType { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// Envelope for the search endpoint response.
/// </summary>
public class MemorySearchResponse
{
    public string Query { get; set; } = null!;

    public int Count { get; set; }

    public List<RetrievedMemory> Memories { get; set; } = new();
}

/// <summary>
/// Returned when a create/update is skipped due to duplication.
/// </summary>
public class MemoryDuplicateResult
{
    public bool IsDuplicate { get; set; }

    public string Reason { get; set; } = null!;
}

// ── Phase 2: Conversational Ingestion DTOs ────────────────────────────────────

/// <summary>
/// A single message in the conversation submitted to POST /api/v1/memories/ingest.
/// </summary>
public class IngestMessageItem
{
    /// <summary>
    /// The role of the speaker. Accepted values: "user", "assistant", "system".
    /// </summary>
    public string Role { get; set; } = null!;

    /// <summary>
    /// The text content of the message. Must not be empty.
    /// </summary>
    public string Content { get; set; } = null!;
}

/// <summary>
/// Request body for POST /api/v1/memories/ingest.
/// The authenticated API key determines ProjectId and UserId.
/// ActorId identifies the memory partition (MemoryScope) within the project.
/// ProjectId is never accepted from the client — it is sourced from IApiKeyContext.
/// </summary>
public class IngestConversationRequest
{
    /// <summary>
    /// The actor identifier for this ingestion within the authenticated project.
    /// Combined with the project's ProjectId to resolve or create the target MemoryScope.
    /// Must not be null, empty, or whitespace.
    /// </summary>
    public string ActorId { get; set; } = null!;

    /// <summary>
    /// The conversation messages to analyze. Must contain at least one message.
    /// </summary>
    public List<IngestMessageItem> Messages { get; set; } = new();
}

/// <summary>
/// Describes the operation performed for a single ingested memory candidate.
/// </summary>
public enum IngestionOperation
{
    /// <summary>A new memory was created.</summary>
    Add,

    /// <summary>An existing memory was superseded, contradicted, or updated with new canonical facts.</summary>
    Update,

    /// <summary>An existing memory was updated with canonical content from the consolidation evaluator.</summary>
    Merge,

    /// <summary>No memory was created or updated (duplicate or non-salient).</summary>
    NoAction
}

/// <summary>
/// The result for a single memory candidate processed during ingestion.
/// </summary>
public class IngestionMemoryResult
{
    /// <summary>The consolidation operation performed.</summary>
    public IngestionOperation Action { get; set; }

    /// <summary>The memory ID when action is Add or Merge. Null for NoAction.</summary>
    public long? MemoryId { get; set; }

    /// <summary>The persisted or canonical memory content.</summary>
    public string Content { get; set; } = null!;

    /// <summary>Optional reason for the action (especially for Merge and NoAction).</summary>
    public string? Reason { get; set; }
}

/// <summary>
/// Response from POST /api/v1/memories/ingest.
/// </summary>
public class MemoryIngestionResponse
{
    /// <summary>Whether the ingestion pipeline completed without fatal error.</summary>
    public bool Processed { get; set; }

    /// <summary>Number of candidates extracted from the conversation.</summary>
    public int ExtractedCount { get; set; }

    /// <summary>Per-candidate results. Empty when extraction found nothing worth remembering.</summary>
    public List<IngestionMemoryResult> Memories { get; set; } = new();
}
