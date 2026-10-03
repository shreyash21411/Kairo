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

// ── Evaluator result (Phase 2 & Phase 3) ────────────────────────────────────

public enum ConsolidationAction
{
    /// <summary>Candidate is distinct/compatible knowledge. Persist as new memory.</summary>
    Add,

    /// <summary>Candidate supersedes, contradicts, or updates an existing memory.</summary>
    Update,

    /// <summary>Candidate and existing memory represent compatible knowledge that merges into canonical form.</summary>
    Merge,

    /// <summary>Candidate adds no meaningful persistent knowledge (duplicate or non-salient).</summary>
    NoAction
}

public class ConsolidationEvaluationResult
{
    public ConsolidationAction Action { get; set; } = ConsolidationAction.Add;

    public bool IsSameKnowledge
    {
        get => Action == ConsolidationAction.Merge || Action == ConsolidationAction.NoAction;
        set
        {
            if (value && Action == ConsolidationAction.Add)
            {
                Action = ConsolidationAction.Merge;
            }
        }
    }

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