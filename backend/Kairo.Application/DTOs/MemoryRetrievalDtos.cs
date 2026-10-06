namespace Kairo.Application.DTOs;

public class MemoryRetrievalRequest
{
    public string Query { get; set; } = null!;

    public int TopK { get; set; } = 5;
}

public class RetrievedMemory
{
    public long MemoryId { get; set; }

    public string Content { get; set; } = null!;

    public string MemoryType { get; set; } = null!;

    public double Similarity { get; set; }

    /// <summary>Phase 2: Memory creation timestamp.</summary>
    public DateTime? CreatedAt { get; set; }

    /// <summary>Phase 2: Memory last-updated timestamp.</summary>
    public DateTime? UpdatedAt { get; set; }

    /// <summary>Phase 2: Event or fact occurrence timestamp (optional).</summary>
    public DateTime? OccurredAt { get; set; }

    /// <summary>Phase 2: Arbitrary application-defined metadata JSON.</summary>
    public string? Metadata { get; set; }
}
