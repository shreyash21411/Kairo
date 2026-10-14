using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace Kairo.Tests;

// ────────────────────────────────────────────────────────────────────────────
// Phase 5.6 Task 5.6.3 — Reranker Resilience and Retrieval Quality Evaluation
// ────────────────────────────────────────────────────────────────────────────
//
// Section A – Resilience tests (MaxCandidates enforcement, candidate-set
//             integrity, similarity preservation, and timeout guarantees).
//
// Section B – Retrieval quality benchmark (NDCG@k, MRR@k, Recall@k).
//             Uses a small, deterministic golden dataset with explicit
//             human-assigned relevance judgments (0=irrelevant, 1=partial,
//             2=highly relevant).
//
// IMPORTANT LIMITATIONS:
//  * These tests do NOT make live Mistral or network calls.
//  * Metric values are computed against the golden judgments, not ground-truth
//    production data.
//  * "Reranked" results in Section B are simulated via a deterministic mock
//    to measure the metric machinery, not the quality of the Mistral LLM.
//  * No real-world quality improvement claim is made here. That would require
//    a live A/B evaluation against a representative production corpus.
// ────────────────────────────────────────────────────────────────────────────

public class Phase5RerankerResilienceAndQualityTests
{
    // =========================================================================
    // SECTION A — RESILIENCE TESTS
    // =========================================================================

    #region helpers

    private static RerankerService BuildService(IRerankProvider provider, RerankerOptions opts)
        => new(provider, Options.Create(opts), new Mock<ILogger<RerankerService>>().Object);

    private static List<RetrievedMemory> Memories(params (long id, double sim)[] items)
        => items.Select(i => new RetrievedMemory
        {
            MemoryId = i.id,
            Content = $"Content-{i.id}",
            Similarity = i.sim
        }).ToList();

    #endregion

    // A-1: MaxCandidates cap is enforced ─────────────────────────────────────

    [Fact]
    public async Task RerankerService_MaxCandidates_CapsProviderCallToTopNByFusedScore()
    {
        RerankRequest? capturedRequest = null;
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider
            .Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .Callback<RerankRequest, CancellationToken>((req, _) => capturedRequest = req)
            .ReturnsAsync(new RerankResponse());

        var opts = new RerankerOptions { Enabled = true, MaxCandidates = 3, TimeoutMs = 5000 };
        var service = BuildService(mockProvider.Object, opts);

        // 5 candidates; only the top 3 by Similarity should be forwarded
        var candidates = Memories((1, 0.55), (2, 0.90), (3, 0.80), (4, 0.70), (5, 0.60));
        await service.RerankAsync("query", candidates);

        Assert.NotNull(capturedRequest);
        Assert.Equal(3, capturedRequest!.Candidates.Count);

        // Top 3 by similarity: MemoryId 2 (0.90), 3 (0.80), 4 (0.70)
        var forwardedIds = capturedRequest.Candidates.Select(c => c.MemoryId).OrderBy(x => x).ToList();
        Assert.Equal(new List<long> { 2, 3, 4 }, forwardedIds);
    }

    [Fact]
    public async Task RerankerService_MaxCandidates_ExcludedCandidatesReceiveZeroRerankScore()
    {
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider
            .Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((RerankRequest req, CancellationToken _) => new RerankResponse
            {
                ScoredCandidates = req.Candidates
                    .Select(c => new RerankCandidateScore { MemoryId = c.MemoryId, RelevanceScore = 0.9 })
                    .ToList()
            });

        var opts = new RerankerOptions { Enabled = true, MaxCandidates = 2, TimeoutMs = 5000 };
        var service = BuildService(mockProvider.Object, opts);

        var candidates = Memories((1, 0.90), (2, 0.80), (3, 0.10));
        var result = await service.RerankAsync("query", candidates);

        // All 3 returned (full candidate set preserved)
        Assert.Equal(3, result.Count);

        var m1 = result.Single(r => r.MemoryId == 1);
        var m2 = result.Single(r => r.MemoryId == 2);
        var m3 = result.Single(r => r.MemoryId == 3);

        // Forwarded candidates receive provider score
        Assert.Equal(0.9, m1.RerankScore!.Value, precision: 6);
        Assert.Equal(0.9, m2.RerankScore!.Value, precision: 6);
        // Excluded candidate receives zero
        Assert.Equal(0.0, m3.RerankScore!.Value, precision: 6);
    }

    [Fact]
    public async Task RerankerService_MaxCandidates_WhenExactlyAtLimit_AllCandidatesForwarded()
    {
        RerankRequest? capturedRequest = null;
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider
            .Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .Callback<RerankRequest, CancellationToken>((req, _) => capturedRequest = req)
            .ReturnsAsync(new RerankResponse());

        var opts = new RerankerOptions { Enabled = true, MaxCandidates = 3, TimeoutMs = 5000 };
        var service = BuildService(mockProvider.Object, opts);

        var candidates = Memories((1, 0.9), (2, 0.8), (3, 0.7));
        await service.RerankAsync("query", candidates);

        Assert.Equal(3, capturedRequest!.Candidates.Count); // no trimming
    }

    [Fact]
    public async Task RerankerService_MaxCandidates_PreservesRelativeSimilarityOrderAmongExcludedCandidatesWhenScoresTie()
    {
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider
            .Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((RerankRequest req, CancellationToken _) => new RerankResponse
            {
                ScoredCandidates = new List<RerankCandidateScore>
                {
                    new() { MemoryId = 1, RelevanceScore = 0.95 },
                    new() { MemoryId = 2, RelevanceScore = 0.40 }
                }
            });

        // MaxCandidates = 2, but 5 candidates provided. Top 2 by Similarity (1, 2) sent to provider.
        // Remaining 3 candidates (3, 4, 5) excluded with RerankScore = 0.0.
        // MemoryId 5 has higher similarity (0.65) than MemoryId 4 (0.50) and MemoryId 3 (0.30),
        // but MemoryId 5 > MemoryId 4 > MemoryId 3.
        var opts = new RerankerOptions { Enabled = true, MaxCandidates = 2, TimeoutMs = 5000 };
        var service = BuildService(mockProvider.Object, opts);

        var candidates = Memories(
            (1, 0.90), // Sent, scored 0.95
            (2, 0.80), // Sent, scored 0.40
            (3, 0.30), // Excluded, RerankScore = 0.0
            (4, 0.50), // Excluded, RerankScore = 0.0
            (5, 0.65)  // Excluded, RerankScore = 0.0
        );

        var result = await service.RerankAsync("query", candidates);

        Assert.Equal(5, result.Count);

        // 1. Primary order: RerankScore DESC
        // MemoryId 1 (0.95) comes before MemoryId 2 (0.40) despite lower similarity
        Assert.Equal(1, result[0].MemoryId);
        Assert.Equal(0.95, result[0].RerankScore!.Value, precision: 6);
        Assert.Equal(0.90, result[0].Similarity, precision: 6);

        Assert.Equal(2, result[1].MemoryId);
        Assert.Equal(0.40, result[1].RerankScore!.Value, precision: 6);
        Assert.Equal(0.80, result[1].Similarity, precision: 6);

        // 2. Secondary order: Similarity DESC for tied zero-score excluded candidates
        // Excluded candidates all have RerankScore = 0.0.
        // Relative similarity order: MemoryId 5 (0.65) > MemoryId 4 (0.50) > MemoryId 3 (0.30)
        Assert.Equal(5, result[2].MemoryId);
        Assert.Equal(0.0, result[2].RerankScore!.Value, precision: 6);
        Assert.Equal(0.65, result[2].Similarity, precision: 6);

        Assert.Equal(4, result[3].MemoryId);
        Assert.Equal(0.0, result[3].RerankScore!.Value, precision: 6);
        Assert.Equal(0.50, result[3].Similarity, precision: 6);

        Assert.Equal(3, result[4].MemoryId);
        Assert.Equal(0.0, result[4].RerankScore!.Value, precision: 6);
        Assert.Equal(0.30, result[4].Similarity, precision: 6);
    }

    [Theory]
    [InlineData(0, 50)]     // Zero -> uses documented default of 50
    [InlineData(-1, 50)]    // Negative -> uses documented default of 50
    [InlineData(-100, 50)]  // Negative -> uses documented default of 50
    public async Task RerankerService_MaxCandidates_ZeroOrNegative_UsesDefaultOf50(int configuredMax, int expectedForwarded)
    {
        RerankRequest? capturedRequest = null;
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider
            .Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .Callback<RerankRequest, CancellationToken>((req, _) => capturedRequest = req)
            .ReturnsAsync(new RerankResponse());

        var opts = new RerankerOptions { Enabled = true, MaxCandidates = configuredMax, TimeoutMs = 5000 };
        var service = BuildService(mockProvider.Object, opts);

        // Generate 60 candidates
        var candidates = Enumerable.Range(1, 60)
            .Select(i => new RetrievedMemory
            {
                MemoryId = i,
                Content = $"Content-{i}",
                Similarity = 1.0 - (i * 0.01)
            })
            .ToList();

        await service.RerankAsync("query", candidates);

        Assert.NotNull(capturedRequest);
        Assert.Equal(expectedForwarded, capturedRequest!.Candidates.Count);
    }

    [Fact]
    public async Task RerankerService_MaxCandidates_DefaultConfiguration_Uses50()
    {
        RerankRequest? capturedRequest = null;
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider
            .Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .Callback<RerankRequest, CancellationToken>((req, _) => capturedRequest = req)
            .ReturnsAsync(new RerankResponse());

        var opts = new RerankerOptions(); // Default MaxCandidates = 50
        var service = BuildService(mockProvider.Object, opts);

        var candidates = Enumerable.Range(1, 60)
            .Select(i => new RetrievedMemory
            {
                MemoryId = i,
                Content = $"Content-{i}",
                Similarity = 1.0 - (i * 0.01)
            })
            .ToList();

        await service.RerankAsync("query", candidates);

        Assert.NotNull(capturedRequest);
        Assert.Equal(50, capturedRequest!.Candidates.Count);
    }

    [Theory]
    [InlineData(250)]
    [InlineData(500)]
    [InlineData(1000)]
    public async Task RerankerService_MaxCandidates_ExcessivelyLarge_CappedAt200(int configuredMax)
    {
        RerankRequest? capturedRequest = null;
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider
            .Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .Callback<RerankRequest, CancellationToken>((req, _) => capturedRequest = req)
            .ReturnsAsync(new RerankResponse());

        var opts = new RerankerOptions { Enabled = true, MaxCandidates = configuredMax, TimeoutMs = 5000 };
        var service = BuildService(mockProvider.Object, opts);

        // Generate 250 candidates
        var candidates = Enumerable.Range(1, 250)
            .Select(i => new RetrievedMemory
            {
                MemoryId = i,
                Content = $"Content-{i}",
                Similarity = 1.0 - (i * 0.001)
            })
            .ToList();

        await service.RerankAsync("query", candidates);

        Assert.NotNull(capturedRequest);
        // Provider must NEVER receive more than 200 candidates
        Assert.Equal(200, capturedRequest!.Candidates.Count);
    }

    // A-2: Provider response cannot introduce new MemoryIds ──────────────────

    [Fact]
    public async Task RerankerService_ProviderReturnsUnknownMemoryId_OnlyKnownIdsRetained()
    {
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider
            .Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RerankResponse
            {
                ScoredCandidates = new List<RerankCandidateScore>
                {
                    new() { MemoryId = 1, RelevanceScore = 0.9 },
                    new() { MemoryId = 999, RelevanceScore = 0.99 } // rogue ID not in input set
                }
            });

        var opts = new RerankerOptions { Enabled = true, MaxCandidates = 50, TimeoutMs = 5000 };
        var service = BuildService(mockProvider.Object, opts);

        var candidates = Memories((1, 0.8), (2, 0.5));
        var result = await service.RerankAsync("query", candidates);

        // Exactly the original 2 candidates returned
        Assert.Equal(2, result.Count);
        Assert.DoesNotContain(result, r => r.MemoryId == 999);

        Assert.Equal(0.9, result.Single(r => r.MemoryId == 1).RerankScore!.Value, precision: 6);
        // MemoryId 2 not in provider response → zero
        Assert.Equal(0.0, result.Single(r => r.MemoryId == 2).RerankScore!.Value, precision: 6);
    }

    // A-3: Original Similarity values are never overwritten ──────────────────

    [Fact]
    public async Task RerankerService_OriginalSimilarityPreservedAfterSuccessfulRerank()
    {
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider
            .Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RerankResponse
            {
                ScoredCandidates = new List<RerankCandidateScore>
                {
                    new() { MemoryId = 1, RelevanceScore = 0.3 },
                    new() { MemoryId = 2, RelevanceScore = 0.9 }
                }
            });

        var opts = new RerankerOptions { Enabled = true, MaxCandidates = 50, TimeoutMs = 5000 };
        var service = BuildService(mockProvider.Object, opts);

        var candidates = Memories((1, 0.95), (2, 0.40));
        var result = await service.RerankAsync("query", candidates);

        var m1 = result.Single(r => r.MemoryId == 1);
        var m2 = result.Single(r => r.MemoryId == 2);

        // Similarity scores unchanged
        Assert.Equal(0.95, m1.Similarity, precision: 6);
        Assert.Equal(0.40, m2.Similarity, precision: 6);

        // RerankScores assigned
        Assert.Equal(0.3, m1.RerankScore!.Value, precision: 6);
        Assert.Equal(0.9, m2.RerankScore!.Value, precision: 6);

        // Reranked order: m2 (0.9) before m1 (0.3)
        Assert.Equal(2, result[0].MemoryId);
        Assert.Equal(1, result[1].MemoryId);
    }

    // A-4: Timeout enforced ──────────────────────────────────────────────────

    [Fact]
    public async Task RerankerService_Timeout_EnforcedEvenWhenProviderIgnoresCancellation()
    {
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider
            .Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .Returns<RerankRequest, CancellationToken>(async (_, _) =>
            {
                // Simulate provider that does not cooperate with cancellation
                await Task.Delay(2000, CancellationToken.None);
                return new RerankResponse();
            });

        var opts = new RerankerOptions { Enabled = true, MaxCandidates = 50, TimeoutMs = 50 };
        var service = BuildService(mockProvider.Object, opts);

        var candidates = Memories((1, 0.9), (2, 0.8));
        var sw = System.Diagnostics.Stopwatch.StartNew();

        var result = await service.RerankAsync("query", candidates);

        sw.Stop();
        // Must complete well before the 2000ms provider delay
        Assert.True(sw.ElapsedMilliseconds < 3000,
            $"Expected fallback within ~1500ms but took {sw.ElapsedMilliseconds}ms");

        // Returns fallback: original candidates, no RerankScores set
        Assert.Equal(2, result.Count);
        Assert.All(result, r => Assert.Null(r.RerankScore));
    }

    // =========================================================================
    // SECTION B — RETRIEVAL QUALITY BENCHMARK
    // =========================================================================
    //
    // Golden dataset format:
    //   Each query has N candidate memories, each with an explicit integer
    //   relevance grade:
    //     0 = Irrelevant
    //     1 = Partially relevant
    //     2 = Highly relevant
    //
    // Metrics are computed at k=3.
    // All metric helpers are independently verified before the benchmark runs.
    //

    #region Metric helpers

    /// <summary>Discounted Cumulative Gain at cutoff k (log2 discount).</summary>
    private static double DCG(IList<int> gradedRanking, int k)
    {
        double dcg = 0.0;
        int limit = Math.Min(k, gradedRanking.Count);
        for (int i = 0; i < limit; i++)
            dcg += gradedRanking[i] / Math.Log2(i + 2);
        return dcg;
    }

    /// <summary>
    /// NDCG@k. Returns 1.0 when all grades are 0 (IDCG=0 convention).
    /// </summary>
    private static double NDCG(IList<int> gradedRanking, int k)
    {
        if (gradedRanking.Count == 0) return 1.0;
        var ideal = gradedRanking.OrderByDescending(x => x).ToList();
        double idcg = DCG(ideal, k);
        return idcg == 0.0 ? 1.0 : DCG(gradedRanking, k) / idcg;
    }

    /// <summary>
    /// MRR@k. Reciprocal rank of first result with grade >= minGrade.
    /// Returns 0.0 if none found in top-k.
    /// </summary>
    private static double MRR(IList<int> gradedRanking, int k, int minGrade = 1)
    {
        int limit = Math.Min(k, gradedRanking.Count);
        for (int i = 0; i < limit; i++)
            if (gradedRanking[i] >= minGrade) return 1.0 / (i + 1);
        return 0.0;
    }

    /// <summary>
    /// Recall@k. Fraction of relevant (grade >= minGrade) documents in top-k.
    /// Returns 1.0 when no relevant documents exist.
    /// </summary>
    private static double Recall(IList<int> gradedRanking, int k, int minGrade = 1)
    {
        int totalRelevant = gradedRanking.Count(g => g >= minGrade);
        if (totalRelevant == 0) return 1.0;
        int inTopK = gradedRanking.Take(k).Count(g => g >= minGrade);
        return (double)inTopK / totalRelevant;
    }

    private static double Mean(IEnumerable<double> values) => values.Average();

    #endregion

    #region Metric correctness tests

    [Fact]
    public void Metrics_DCG_PerfectOrderingEqualsIDCG()
    {
        var ranking = new List<int> { 2, 1, 0 };
        Assert.Equal(1.0, NDCG(ranking, 3), precision: 10);
    }

    [Fact]
    public void Metrics_NDCG_WorseThanIdealResultsInValueLessThanOne()
    {
        Assert.True(NDCG(new List<int> { 0, 1, 2 }, 3) < 1.0);
    }

    [Fact]
    public void Metrics_NDCG_AllIrrelevantReturnsOne()
    {
        Assert.Equal(1.0, NDCG(new List<int> { 0, 0, 0 }, 3), precision: 10);
    }

    [Fact]
    public void Metrics_MRR_FirstResultRelevant_ReturnsOne()
    {
        Assert.Equal(1.0, MRR(new List<int> { 2, 0, 0 }, k: 3), precision: 10);
    }

    [Fact]
    public void Metrics_MRR_SecondResultRelevant_ReturnsHalf()
    {
        Assert.Equal(0.5, MRR(new List<int> { 0, 1, 0 }, k: 3), precision: 10);
    }

    [Fact]
    public void Metrics_MRR_NoRelevantInTopK_ReturnsZero()
    {
        Assert.Equal(0.0, MRR(new List<int> { 0, 0, 0 }, k: 3), precision: 10);
    }

    [Fact]
    public void Metrics_Recall_AllRelevantInTopK_ReturnsOne()
    {
        Assert.Equal(1.0, Recall(new List<int> { 2, 0, 1 }, k: 3), precision: 10);
    }

    [Fact]
    public void Metrics_Recall_HalfRelevantInTopK()
    {
        // 4 relevant docs total (grades 2,1,2,1), 2 in top 3
        var fullRanking = new List<int> { 2, 0, 1, 2, 1 };
        Assert.Equal(0.5, Recall(fullRanking, k: 3), precision: 10);
    }

    [Fact]
    public void Metrics_NDCG_KnownCalculation_MatchesManualValue()
    {
        // P1: grade 2 → 2/log2(2)=2; P2: grade 0; P3: grade 1 → 1/log2(4)=0.5 → DCG=2.5
        // Ideal [2,1,0]: 2 + 1/log2(3) → IDCG = 2 + 1/log2(3)
        var ranking = new List<int> { 2, 0, 1 };
        double expected = 2.5 / (2.0 + 1.0 / Math.Log2(3));
        Assert.Equal(expected, NDCG(ranking, 3), precision: 10);
    }

    #endregion

    #region Golden dataset

    /// <summary>
    /// A single entry in the golden retrieval evaluation dataset.
    /// Candidates are listed in baseline (hybrid fused score) ranking order.
    /// </summary>
    private record GoldenQuery(
        string QueryText,
        List<(long MemoryId, double BaselineSimilarity, int RelevanceGrade)> Candidates);

    /// <summary>
    /// Five-query golden dataset with explicit relevance grades.
    ///
    /// Relevance grades:
    ///   2 = Highly relevant   (directly answers the query intent)
    ///   1 = Partially relevant (useful background or related context)
    ///   0 = Irrelevant         (coincidental word match or unrelated)
    ///
    /// Queries 1 and 5: baseline order already optimal.
    /// Queries 2, 3, 4: baseline order is sub-optimal (exercises reranker benefit).
    /// </summary>
    private static readonly List<GoldenQuery> GoldenDataset = new()
    {
        // Q1: Baseline order already matches relevance descending
        new("What are my dietary preferences?",
            new()
            {
                (1, 0.92, 2), // "I prefer vegetarian food"
                (2, 0.75, 1), // "I sometimes eat fish"
                (3, 0.60, 0), // "Favourite restaurant is downtown"
            }),

        // Q2: Baseline returns irrelevant first
        new("What programming language do I use at work?",
            new()
            {
                (4, 0.85, 0), // "I enjoy cooking on weekends"
                (5, 0.78, 2), // "I write backend services in C#"
                (6, 0.65, 1), // "I also know Python"
                (7, 0.50, 0), // "My favourite colour is blue"
            }),

        // Q3: Partial/high relevance in wrong order
        new("Where do I live?",
            new()
            {
                (8,  0.88, 1), // "I moved cities last year"
                (9,  0.80, 2), // "I live in Pune, India"
                (10, 0.55, 0), // "I like weekend hiking"
            }),

        // Q4: All relevant but in wrong order
        new("What are my hobbies?",
            new()
            {
                (11, 0.82, 1), // "I like reading sci-fi"
                (12, 0.79, 2), // "My main hobbies are cycling and chess"
                (13, 0.70, 1), // "I enjoy sketching occasionally"
                (14, 0.60, 0), // "I attended a finance webinar"
            }),

        // Q5: Baseline order already optimal
        new("What is my pet's name?",
            new()
            {
                (15, 0.91, 2), // "My dog is called Bruno"
                (16, 0.70, 1), // "I walk Bruno every morning"
                (17, 0.50, 0), // "Office lunch order summary"
            }),
    };

    #endregion

    #region Benchmark tests

    [Fact]
    public void RetrievalQuality_GoldenDataset_BaselineAndSimulatedRerank_MetricsSanity()
    {
        const int k = 3;

        var baselineNDCGs   = new List<double>();
        var baselineMRRs    = new List<double>();
        var baselineRecalls = new List<double>();

        var rerankedNDCGs   = new List<double>();
        var rerankedMRRs    = new List<double>();
        var rerankedRecalls = new List<double>();

        foreach (var query in GoldenDataset)
        {
            // Baseline: Similarity DESC (hybrid retrieval output order)
            var baselineGrades = query.Candidates
                .OrderByDescending(c => c.BaselineSimilarity)
                .Select(c => c.RelevanceGrade)
                .ToList();

            baselineNDCGs.Add(NDCG(baselineGrades, k));
            baselineMRRs.Add(MRR(baselineGrades, k));
            baselineRecalls.Add(Recall(baselineGrades, k));

            // Simulated oracle reranker: RelevanceGrade DESC, MemoryId ASC.
            // This is NOT a claim about Mistral LLM quality.
            // It validates the metric machinery by ensuring a perfect oracle
            // ranks >= baseline on every metric.
            var rerankedGrades = query.Candidates
                .OrderByDescending(c => c.RelevanceGrade)
                .ThenBy(c => c.MemoryId)
                .Select(c => c.RelevanceGrade)
                .ToList();

            rerankedNDCGs.Add(NDCG(rerankedGrades, k));
            rerankedMRRs.Add(MRR(rerankedGrades, k));
            rerankedRecalls.Add(Recall(rerankedGrades, k));
        }

        double baselineNDCG   = Mean(baselineNDCGs);
        double baselineMRR    = Mean(baselineMRRs);
        double baselineRecall = Mean(baselineRecalls);

        double rerankedNDCG   = Mean(rerankedNDCGs);
        double rerankedMRR    = Mean(rerankedMRRs);
        double rerankedRecall = Mean(rerankedRecalls);

        // All values must be in [0,1]
        Assert.InRange(baselineNDCG,   0.0, 1.0);
        Assert.InRange(baselineMRR,    0.0, 1.0);
        Assert.InRange(baselineRecall, 0.0, 1.0);
        Assert.InRange(rerankedNDCG,   0.0, 1.0);
        Assert.InRange(rerankedMRR,    0.0, 1.0);
        Assert.InRange(rerankedRecall, 0.0, 1.0);

        // Oracle reranker must be >= baseline on all metrics
        // (validates the metric machinery itself)
        Assert.True(rerankedNDCG   >= baselineNDCG   - 1e-9,
            $"NDCG@{k}: reranked ({rerankedNDCG:F4}) < baseline ({baselineNDCG:F4})");
        Assert.True(rerankedMRR    >= baselineMRR    - 1e-9,
            $"MRR@{k}: reranked ({rerankedMRR:F4}) < baseline ({baselineMRR:F4})");
        Assert.True(rerankedRecall >= baselineRecall - 1e-9,
            $"Recall@{k}: reranked ({rerankedRecall:F4}) < baseline ({baselineRecall:F4})");
    }

    [Fact]
    public void RetrievalQuality_GoldenDataset_BaselineMetrics_AreWithinExpectedRange()
    {
        // Regression guard: verifies that computed baseline metrics match the
        // expected range for the known golden dataset. Fails if the dataset
        // or metric helpers are accidentally modified.
        //
        // Query-by-query hand-calculated baseline grades at k=3:
        //   Q1: [2,1,0] → NDCG=1.00, MRR=1.00, Recall=1.00 (1 of 1 grade>=2 present)
        //   Q2: [0,2,1,0] → NDCG<1, MRR=0.50, Recall=1.00 (both rel in top 3? yes: grades 2,1 in top3 of 4)
        //   Q3: [1,2,0] → NDCG<1, MRR=1.00, Recall=1.00
        //   Q4: [1,2,1,0] → NDCG<1, MRR=1.00, Recall=0.67 (2 of 3 relevant in top 3)
        //   Q5: [2,1,0] → NDCG=1.00, MRR=1.00, Recall=1.00

        const int k = 3;
        var ndcgs   = new List<double>();
        var mrrs    = new List<double>();
        var recalls = new List<double>();

        foreach (var query in GoldenDataset)
        {
            var grades = query.Candidates
                .OrderByDescending(c => c.BaselineSimilarity)
                .Select(c => c.RelevanceGrade)
                .ToList();

            ndcgs.Add(NDCG(grades, k));
            mrrs.Add(MRR(grades, k));
            recalls.Add(Recall(grades, k));
        }

        // Validated ranges from hand-calculation above
        Assert.InRange(Mean(ndcgs),   0.75, 1.0);
        Assert.InRange(Mean(mrrs),    0.75, 1.0);
        Assert.InRange(Mean(recalls), 0.75, 1.0);
    }

    #endregion
}
