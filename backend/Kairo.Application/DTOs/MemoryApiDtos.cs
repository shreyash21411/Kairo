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
    /// V1 legacy actor identifier for this memory within the authenticated project.
    /// Combined with the project's ProjectId to resolve the target MemoryScope.
    /// Must not be null, empty, or whitespace when Scope is not provided.
    /// </summary>
    public string ActorId { get; set; } = null!;

    /// <summary>
    /// Phase 1: Optional multi-dimensional scope key. When provided, takes precedence
    /// over ActorId for scope resolution. ActorId is still used for V1 backward compat.
    /// </summary>
    public MemoryScopeKey? Scope { get; set; }

    /// <summary>Phase 2: Event or fact occurrence timestamp (optional).</summary>
    public DateTime? OccurredAt { get; set; }

    /// <summary>Phase 2: Arbitrary application-defined metadata dictionary.</summary>
    public Dictionary<string, object>? Metadata { get; set; }

    /// <summary>Phase 3: Extensible categories assigned to this memory.</summary>
    public List<string>? Categories { get; set; }

    /// <summary>Phase 3: Expiration timestamp in UTC (optional).</summary>
    public DateTime? ExpiresAt { get; set; }

    /// <summary>Phase 3: Time-to-live in seconds from creation (optional).</summary>
    public long? Ttl { get; set; }
}

/// <summary>
/// Request body for PUT /api/v1/memories/{memoryId}.
/// The authenticated API key determines the memory owner.
/// </summary>
public class UpdateMemoryRequest
{

    public string Content { get; set; } = null!;

    public string MemoryType { get; set; } = null!;

    /// <summary>Phase 2: Event or fact occurrence timestamp (optional).</summary>
    public DateTime? OccurredAt { get; set; }

    /// <summary>Phase 2: Arbitrary application-defined metadata dictionary.</summary>
    public Dictionary<string, object>? Metadata { get; set; }

    /// <summary>Phase 3: Extensible categories assigned to this memory.</summary>
    public List<string>? Categories { get; set; }

    /// <summary>Phase 3: Expiration timestamp in UTC (optional).</summary>
    public DateTime? ExpiresAt { get; set; }

    /// <summary>Phase 3: Time-to-live in seconds from update (optional).</summary>
    public long? Ttl { get; set; }
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
    /// V1 legacy actor identifier for the memory scope to search within the authenticated project.
    /// Combined with the project's ProjectId to resolve the target MemoryScope.
    /// Must not be null, empty, or whitespace when Scope is not provided.
    /// </summary>
    public string? ActorId { get; set; }

    /// <summary>
    /// Phase 1: Optional multi-dimensional scope key. When provided, takes precedence
    /// over ActorId for scope resolution.
    /// </summary>
    public MemoryScopeKey? Scope { get; set; }

    /// <summary>
    /// Phase 1: When true, uses hybrid retrieval (semantic + keyword + entity).
    /// When false or omitted, falls back to semantic-only retrieval (V1 compat).
    /// </summary>
    public bool? Hybrid { get; set; }

    /// <summary>Phase 2: Temporal boundary and relative window constraints.</summary>
    public MemoryTemporalFilter? Temporal { get; set; }

    /// <summary>Phase 2: Key-value metadata equality/membership filter constraints.</summary>
    public Dictionary<string, object>? MetadataFilters { get; set; }

    /// <summary>Phase 2: Structured metadata filter conditions with explicit operators.</summary>
    public List<MetadataFilterCondition>? StructuredFilters { get; set; }

    /// <summary>Phase 2: When true, enables recency-aware relevance score boosting.</summary>
    public bool? RecencyBoost { get; set; }

    /// <summary>Phase 2: Traversal depth for graph relationship retrieval (default: 1, max: 2).</summary>
    public int? GraphDepth { get; set; }

    /// <summary>Phase 3: Filter by a single category.</summary>
    public string? Category { get; set; }

    /// <summary>Phase 3: Filter by one or more categories (inclusion match).</summary>
    public List<string>? Categories { get; set; }

    /// <summary>
    /// Returns unified list of normalized categories for filtering.
    /// </summary>
    public List<string> GetEffectiveCategories()
    {
        var list = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(Category))
            list.Add(Category.Trim().ToLowerInvariant());
        if (Categories != null)
        {
            foreach (var c in Categories)
            {
                if (!string.IsNullOrWhiteSpace(c))
                    list.Add(c.Trim().ToLowerInvariant());
            }
        }
        return new List<string>(list);
    }

    /// <summary>
    /// Compiles key-value MetadataFilters and explicit StructuredFilters into a unified list of filter conditions.
    /// </summary>
    public List<MetadataFilterCondition> GetEffectiveMetadataFilters()
    {
        var list = new List<MetadataFilterCondition>();
        if (StructuredFilters != null && StructuredFilters.Count > 0)
        {
            list.AddRange(StructuredFilters);
        }
        if (MetadataFilters != null && MetadataFilters.Count > 0)
        {
            foreach (var (k, v) in MetadataFilters)
            {
                list.Add(new MetadataFilterCondition
                {
                    Key = k,
                    Operator = "eq",
                    Value = v?.ToString()
                });
            }
        }
        return list;
    }
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

    /// <summary>Phase 2: Event or fact occurrence timestamp.</summary>
    public DateTime? OccurredAt { get; set; }

    /// <summary>Phase 2: Arbitrary application-defined metadata JSON.</summary>
    public string? Metadata { get; set; }

    /// <summary>Phase 3: Expiration timestamp in UTC (optional).</summary>
    public DateTime? ExpiresAt { get; set; }

    /// <summary>Phase 3: Extensible categories assigned to this memory.</summary>
    public List<string> Categories { get; set; } = new();
}

/// <summary>
/// Envelope for the search endpoint response.
/// </summary>
public class MemorySearchResponse
{
    public string Query { get; set; } = null!;

    public int Count { get; set; }

    public List<RetrievedMemory> Memories { get; set; } = new();

    /// <summary>Phase 2: Graph relationships connecting extracted query entities.</summary>
    public List<GraphRelationDto> Relations { get; set; } = new();
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
    /// V1 legacy actor identifier for this ingestion within the authenticated project.
    /// Combined with the project's ProjectId to resolve or create the target MemoryScope.
    /// Must not be null, empty, or whitespace when Scope is not provided.
    /// </summary>
    public string ActorId { get; set; } = null!;

    /// <summary>
    /// Phase 1: Optional multi-dimensional scope key. When provided, takes precedence
    /// over ActorId for scope resolution/creation.
    /// </summary>
    public MemoryScopeKey? Scope { get; set; }

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
