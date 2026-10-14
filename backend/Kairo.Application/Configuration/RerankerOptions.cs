namespace Kairo.Application.Configuration;

/// <summary>
/// Phase 5.6 Task 5.6.1: Configuration options for the dedicated reranking stage.
/// </summary>
public class RerankerOptions
{
    public const string SectionName = "Reranker";

    /// <summary>
    /// When true, the dedicated reranker stage executes after hybrid candidate fusion.
    /// When false, the retrieval pipeline bypasses reranking and preserves original fused scores.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Configured reranker provider name (e.g. "Mistral", "Cohere", "BGE"). Defaults to "Mistral".
    /// </summary>
    public string Provider { get; set; } = "Mistral";

    /// <summary>
    /// Model identifier to supply to the provider (optional override).
    /// </summary>
    public string? Model { get; set; }

    /// <summary>
    /// Execution timeout in milliseconds before falling back to pre-rerank candidate scores.
    /// Default is 3000ms (3 seconds).
    /// </summary>
    public int TimeoutMs { get; set; } = 3000;

    /// <summary>
    /// Phase 5.6 Task 5.6.3: Maximum number of candidates forwarded to the reranker provider
    /// in a single call. Prevents unbounded LLM token usage when the fusion stage produces
    /// a large candidate set. Candidates are taken in descending fused-score order before
    /// the cap is applied, so the most-relevant items are always sent.
    /// Default is 50. Minimum effective value is 1.
    /// </summary>
    public int MaxCandidates { get; set; } = 50;
}
