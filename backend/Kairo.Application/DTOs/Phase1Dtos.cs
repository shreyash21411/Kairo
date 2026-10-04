namespace Kairo.Application.DTOs;

// ── Phase 1: Multi-dimensional Scope DTOs ─────────────────────────────────────

/// <summary>
/// Represents the full Phase 1 multi-dimensional memory scope.
/// All dimensions are optional except that at least one must be provided.
/// Backward compatibility: V1 callers that use only <c>ActorId</c> continue
/// to work — the <c>ActorId</c> field maps to the existing legacy actor identifier.
/// </summary>
public class MemoryScopeKey
{
    /// <summary>
    /// V1 legacy actor identifier. Preserved for backward compatibility.
    /// When provided, scope resolution uses the existing (ProjectId, ActorId) path.
    /// </summary>
    public string? ActorId { get; set; }

    /// <summary>Application-level user identifier (Phase 1+).</summary>
    public string? UserId { get; set; }

    /// <summary>Application-level agent identifier (Phase 1+).</summary>
    public string? AgentId { get; set; }

    /// <summary>Conversation session identifier (Phase 1+).</summary>
    public string? SessionId { get; set; }

    /// <summary>Execution run identifier (Phase 1+).</summary>
    public string? RunId { get; set; }

    /// <summary>
    /// Returns true if the scope key has at least one non-empty dimension.
    /// </summary>
    public bool IsEmpty =>
        string.IsNullOrWhiteSpace(ActorId) &&
        string.IsNullOrWhiteSpace(UserId) &&
        string.IsNullOrWhiteSpace(AgentId) &&
        string.IsNullOrWhiteSpace(SessionId) &&
        string.IsNullOrWhiteSpace(RunId);

    /// <summary>
    /// Returns a human-readable representation for logging (no secrets).
    /// </summary>
    public override string ToString() =>
        $"actor={ActorId ?? "(null)"} user={UserId ?? "(null)"} agent={AgentId ?? "(null)"} session={SessionId ?? "(null)"} run={RunId ?? "(null)"}";
}

/// <summary>
/// Phase 1: Data for a resolved scope, returned from the repository.
/// </summary>
public class MemoryScopeKeyData
{
    public long ScopeId { get; set; }
    public long ProjectId { get; set; }
    public string ActorId { get; set; } = null!;
    public string? UserId { get; set; }
    public string? AgentId { get; set; }
    public string? SessionId { get; set; }
    public string? RunId { get; set; }
}

// ── Phase 1: Entity DTOs ──────────────────────────────────────────────────────

/// <summary>
/// A single extracted entity returned from the entity extraction service.
/// </summary>
public class ExtractedEntity
{
    /// <summary>Canonical display form as written in the text. E.g. "Microsoft".</summary>
    public string DisplayName { get; set; } = null!;

    /// <summary>
    /// Lowercase, trimmed normalized form. E.g. "microsoft".
    /// Used for deduplication within a project.
    /// </summary>
    public string NormalizedName { get; set; } = null!;

    /// <summary>
    /// Entity type. One of: PERSON, ORGANIZATION, PRODUCT, TECHNOLOGY,
    /// LOCATION, PROJECT, COMPANY, TOOL, CONCEPT.
    /// </summary>
    public string EntityType { get; set; } = null!;
}

/// <summary>
/// Summary of entities persisted during a single ingestion call.
/// </summary>
public class IngestionEntitySummary
{
    public int TotalExtracted { get; set; }
    public int Persisted { get; set; }
    public int Deduplicated { get; set; }
    public List<ExtractedEntity> Entities { get; set; } = new();
}

// ── Phase 1: Hybrid Search DTOs ───────────────────────────────────────────────

/// <summary>
/// A memory candidate from any retrieval channel with its individual signal scores.
/// Used internally by the hybrid retrieval pipeline before fusion.
/// </summary>
public class HybridCandidate
{
    public long MemoryId { get; set; }
    public string Content { get; set; } = null!;
    public string MemoryType { get; set; } = null!;

    /// <summary>Semantic cosine similarity score (0–1). Null if not retrieved semantically.</summary>
    public double? SemanticScore { get; set; }

    /// <summary>BM25 / keyword relevance score (raw, before normalization). Null if not retrieved by keyword.</summary>
    public double? KeywordScore { get; set; }

    /// <summary>Entity overlap signal score (0–1). Null if no entity signals.</summary>
    public double? EntityScore { get; set; }

    /// <summary>Final fused score after normalization and weighted combination.</summary>
    public double FusedScore { get; set; }
}
