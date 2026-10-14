using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Phase 5.6 Task 5.6.1: Service contract for the continuous relevance reranking stage.
/// Coordinates validation, deduplication, timeout handling, provider invocation,
/// score normalization, deterministic tie-breaking, and resilient fallback.
/// </summary>
public interface IRerankerService
{
    /// <summary>
    /// Reranks the candidate memories against the query using the configured reranker provider.
    /// Returns the candidates ordered by continuous relevance score descending, tie-broken by MemoryId ascending.
    /// If reranking is disabled or fails, returns the candidates in their original fused order.
    /// </summary>
    /// <param name="query">The user query.</param>
    /// <param name="candidates">The bounded candidate memories from hybrid fusion.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Scored and sorted list of candidates.</returns>
    Task<List<RetrievedMemory>> RerankAsync(
        string query,
        List<RetrievedMemory> candidates,
        CancellationToken cancellationToken = default);
}
