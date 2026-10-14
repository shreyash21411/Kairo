using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Kairo.Application.Abstractions.Providers;

/// <summary>
/// Phase 5.6 Task 5.6.1: Candidate memory item presented for relevance reranking.
/// Contains the unique memory identifier and the canonical text content to compare against the query.
/// </summary>
public class RerankCandidate
{
    public long MemoryId { get; set; }
    public string Content { get; set; } = string.Empty;
}

/// <summary>
/// Phase 5.6 Task 5.6.1: Request payload for continuous-scoring reranking.
/// Bounded to candidates pre-filtered by hybrid vector and keyword generation.
/// </summary>
public class RerankRequest
{
    /// <summary>
    /// Natural language retrieval query.
    /// </summary>
    public string Query { get; set; } = string.Empty;

    /// <summary>
    /// Bounded set of candidate memories to be scored.
    /// </summary>
    public List<RerankCandidate> Candidates { get; set; } = new();

    /// <summary>
    /// Optional model override. When null, the provider's default model is used.
    /// </summary>
    public string? Model { get; set; }
}

/// <summary>
/// Phase 5.6 Task 5.6.1: Scored candidate result emitted by an IRerankProvider.
/// </summary>
public class RerankCandidateScore
{
    public long MemoryId { get; set; }

    /// <summary>
    /// Continuous relevance score strictly bounded to [0.0, 1.0].
    /// Higher values indicate stronger relevance to the query.
    /// </summary>
    public double RelevanceScore { get; set; }
}

/// <summary>
/// Phase 5.6 Task 5.6.1: Response payload from an IRerankProvider.
/// </summary>
public class RerankResponse
{
    public List<RerankCandidateScore> ScoredCandidates { get; set; } = new();
}

/// <summary>
/// Phase 5.6 Task 5.6.1: Low-level provider contract for continuous relevance reranking.
/// Concrete implementations may use external reranker APIs (e.g. Cohere, BGE) or
/// LLM-guided continuous scoring. Implementations must document their actual scoring mechanism.
/// </summary>
public interface IRerankProvider
{
    /// <summary>
    /// Identifier of the provider implementation (e.g. "Mistral-LLM", "Cohere", "BGE").
    /// </summary>
    string ProviderName { get; }

    /// <summary>
    /// Default model configured for this rerank provider.
    /// </summary>
    string DefaultModel { get; }

    /// <summary>
    /// Scores the supplied candidate memories against the query on a continuous [0, 1] scale.
    /// </summary>
    Task<RerankResponse> RerankAsync(
        RerankRequest request,
        CancellationToken cancellationToken = default);
}
