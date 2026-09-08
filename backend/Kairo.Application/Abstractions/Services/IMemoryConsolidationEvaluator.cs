using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

public interface IMemoryConsolidationEvaluator
{
    /// <summary>
    /// Asks Mistral to determine whether the two memories in
    /// <paramref name="candidate"/> encode the same real-world knowledge.
    /// Always fails safe: a malformed or unexpected LLM response results
    /// in <see cref="ConsolidationEvaluationResult.IsSameKnowledge"/> = false.
    /// </summary>
    Task<ConsolidationEvaluationResult> EvaluateAsync(
        MemoryConsolidationCandidate candidate);
}
