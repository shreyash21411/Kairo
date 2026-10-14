using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Kairo.Application.Services;

/// <summary>
/// Phase 5.6 Task 5.6.1: Service coordinating continuous relevance reranking.
/// Applies validation, deduplication, timeout management, score calibration,
/// deterministic tie-breaking, and resilient fallback to pre-rerank order.
/// </summary>
public class RerankerService : IRerankerService
{
    private readonly IRerankProvider _rerankProvider;
    private readonly IOptions<RerankerOptions> _options;
    private readonly ILogger<RerankerService> _logger;

    public RerankerService(
        IRerankProvider rerankProvider,
        IOptions<RerankerOptions> options,
        ILogger<RerankerService> logger)
    {
        _rerankProvider = rerankProvider ?? throw new ArgumentNullException(nameof(rerankProvider));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<List<RetrievedMemory>> RerankAsync(
        string query,
        List<RetrievedMemory> candidates,
        CancellationToken cancellationToken = default)
    {
        if (candidates == null || candidates.Count == 0)
            return new List<RetrievedMemory>();

        var options = _options.Value;
        if (!options.Enabled)
        {
            return candidates;
        }

        if (string.IsNullOrWhiteSpace(query))
        {
            return candidates;
        }

        // Deduplicate candidate memory IDs to guard against duplicate entries
        var distinctCandidates = candidates
            .GroupBy(c => c.MemoryId)
            .Select(g => g.First())
            .ToList();

        // Phase 5.6.3: Enforce safe effective MaxCandidates bound to prevent unbounded LLM token usage.
        // - If MaxCandidates <= 0: use documented default of 50.
        // - Otherwise: cap at safe ceiling of 200.
        const int DefaultMaxCandidates = 50;
        const int UpperBoundMaxCandidates = 200;

        var maxCandidates = options.MaxCandidates <= 0
            ? DefaultMaxCandidates
            : Math.Min(options.MaxCandidates, UpperBoundMaxCandidates);

        var candidatesForProvider = distinctCandidates.Count <= maxCandidates
            ? distinctCandidates
            : distinctCandidates
                .OrderByDescending(c => c.Similarity)
                .Take(maxCandidates)
                .ToList();

        if (candidatesForProvider.Count < distinctCandidates.Count)
        {
            _logger.LogWarning(
                "[RerankerService] Candidate set ({Total}) exceeds MaxCandidates ({Max}). " +
                "Forwarding top {Max} by fused score; remaining {Excluded} candidates will receive RerankScore=0.",
                distinctCandidates.Count, maxCandidates, maxCandidates, distinctCandidates.Count - candidatesForProvider.Count);
        }

        var request = new RerankRequest
        {
            Query = query,
            Candidates = candidatesForProvider.Select(c => new RerankCandidate
            {
                MemoryId = c.MemoryId,
                Content = c.Content
            }).ToList(),
            Model = options.Model
        };

        RerankResponse? response;

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromMilliseconds(options.TimeoutMs));

            response = await _rerankProvider.RerankAsync(request, cts.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // Timeout occurred (CTS timed out, but caller did not cancel)
            _logger.LogWarning(
                "[RerankerService] Reranking timed out after {TimeoutMs}ms. Falling back to original candidate ordering.",
                options.TimeoutMs);
            return candidates;
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "[RerankerService] Reranker provider failed. Falling back to original candidate ordering.");
            return candidates;
        }

        if (response == null || response.ScoredCandidates.Count == 0)
        {
            _logger.LogWarning("[RerankerService] Reranker returned empty scores. Falling back to original candidate ordering.");
            return candidates;
        }

        // Map scores by MemoryId, handling duplicate IDs from provider
        var scoreMap = new Dictionary<long, double>();
        foreach (var scored in response.ScoredCandidates)
        {
            if (!scoreMap.ContainsKey(scored.MemoryId))
            {
                scoreMap[scored.MemoryId] = Math.Clamp(scored.RelevanceScore, 0.0, 1.0);
            }
        }

        // Assign continuous rerank scores to candidates without overwriting original Similarity
        foreach (var candidate in distinctCandidates)
        {
            if (scoreMap.TryGetValue(candidate.MemoryId, out var score))
            {
                candidate.RerankScore = score;
            }
            else
            {
                // Explicit handling for candidates missing from provider response:
                // assign minimum relevance (0.0)
                candidate.RerankScore = 0.0;
            }
        }

        // Deterministic ordering:
        // 1. Primary: RerankScore DESC (scored items take precedence; unscored/omitted/excluded default to 0.0)
        // 2. Secondary: Similarity DESC (preserves relative fused-score order among tied/zero-score candidates)
        // 3. Final tie-breaker: MemoryId ASC (deterministic stability)
        return distinctCandidates
            .OrderByDescending(c => c.RerankScore ?? 0.0)
            .ThenByDescending(c => c.Similarity)
            .ThenBy(c => c.MemoryId)
            .ToList();
    }
}
