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
