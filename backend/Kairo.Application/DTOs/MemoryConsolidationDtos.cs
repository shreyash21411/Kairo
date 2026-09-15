namespace Kairo.Application.DTOs;

public class MemoryConsolidationRequest
{
    public long UserId { get; set; }

    /// <summary>
    /// The external actor identifier to resolve the target MemoryScope within the authenticated project.
    /// </summary>
    public string? ActorId { get; set; }

    /// <summary>
    /// The resolved MemoryScope identifier. When specified, consolidation is partitioned strictly to this scope.
    /// </summary>
    public long? ScopeId { get; set; }
}

public class MemoryConsolidationResult
{
    public int MemoriesAnalyzed { get; set; }

    public int CandidatePairs { get; set; }

    public int ConsolidatedPairs { get; set; }

    public int DeactivatedMemories { get; set; }

    public List<long> DeactivatedMemoryIds { get; set; } = new();

    public List<MemoryConsolidationCandidate> Candidates { get; set; } = new();
}

public class MemoryConsolidationCandidate
{
    public long MemoryIdA { get; set; }

    public long MemoryIdB { get; set; }

    public double Similarity { get; set; }

    public string ContentA { get; set; } = null!;

    public string ContentB { get; set; } = null!;
}

// ── Evaluator result (Task 3) ────────────────────────────────────────────────

public class ConsolidationEvaluationResult
{
    public bool IsSameKnowledge { get; set; }

    public string? CanonicalContent { get; set; }

    public string? Reason { get; set; }
}

// ── Full consolidation result (Task 4) ───────────────────────────────────────

public class FullConsolidationResult
{
    public int MemoriesAnalyzed { get; set; }

    public int CandidatePairs { get; set; }

    public int EvaluatedPairs { get; set; }

    public int ConsolidatedPairs { get; set; }

    public int DeactivatedMemories { get; set; }

    public List<long> DeactivatedMemoryIds { get; set; } = new();

    public List<FullConsolidationDetail> Details { get; set; } = new();
}

public class FullConsolidationDetail
{
    public long MemoryIdA { get; set; }

    public long MemoryIdB { get; set; }

    public double Similarity { get; set; }

    public bool WasEvaluated { get; set; }

    public bool WasConsolidated { get; set; }

    public long? CanonicalMemoryId { get; set; }

    public long? DeactivatedMemoryId { get; set; }

    public string? Reason { get; set; }
}