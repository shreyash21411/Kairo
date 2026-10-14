using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Kairo.Infrastructure.Providers;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Phase 5.6 Task 5.6.1: Unit tests for continuous-scoring reranker provider abstraction and service.
/// </summary>
public class Phase5RerankerUnitTests
{
    [Fact]
    public async Task MistralLlmRerankProvider_EmptyQueryOrCandidates_ReturnsEmptyResponse()
    {
        var mockLlm = new Mock<ILlmProvider>();
        var provider = new MistralLlmRerankProvider(mockLlm.Object);

        // Empty query
        var res1 = await provider.RerankAsync(new RerankRequest
        {
            Query = "",
            Candidates = new List<RerankCandidate> { new() { MemoryId = 1, Content = "A" } }
        });
        Assert.Empty(res1.ScoredCandidates);

        // Empty candidates
        var res2 = await provider.RerankAsync(new RerankRequest
        {
            Query = "test",
            Candidates = new List<RerankCandidate>()
        });
        Assert.Empty(res2.ScoredCandidates);

        mockLlm.Verify(l => l.GenerateChatCompletionAsync(It.IsAny<LlmCompletionRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task MistralLlmRerankProvider_ValidInput_ParsesScoresAndEnforcesClamping()
    {
        var mockLlm = new Mock<ILlmProvider>();
        mockLlm.Setup(l => l.DefaultModel).Returns("mistral-small-latest");

        // Provider response has one valid score, one > 1.0 (needs clamp to 1.0), and one negative (needs clamp to 0.0)
        var jsonResponse = """
        {
          "scores": [
            { "memoryId": 1, "score": 0.95 },
            { "memoryId": 2, "score": 1.45 },
            { "memoryId": 3, "score": -0.20 }
          ]
        }
        """;

        mockLlm.Setup(l => l.GenerateChatCompletionAsync(It.IsAny<LlmCompletionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(jsonResponse);

        var provider = new MistralLlmRerankProvider(mockLlm.Object);
        var response = await provider.RerankAsync(new RerankRequest
        {
            Query = "best database",
            Candidates = new List<RerankCandidate>
            {
                new() { MemoryId = 1, Content = "Postgres" },
                new() { MemoryId = 2, Content = "SQL Server" },
                new() { MemoryId = 3, Content = "MongoDB" }
            }
        });

        Assert.Equal(3, response.ScoredCandidates.Count);
        Assert.Equal(0.95, response.ScoredCandidates[0].RelevanceScore);
        Assert.Equal(1.0, response.ScoredCandidates[1].RelevanceScore); // clamped
        Assert.Equal(0.0, response.ScoredCandidates[2].RelevanceScore); // clamped
    }

    [Fact]
    public async Task MistralLlmRerankProvider_StringFormattedScoresAndIds_ParsesWithInvariantCulture()
    {
        var mockLlm = new Mock<ILlmProvider>();

        // Provider response formatted with string scores, string memoryId, and string out-of-range scores
        var jsonResponse = """
        {
          "scores": [
            { "memoryId": "10", "score": "0.85" },
            { "memoryId": 20, "score": "1.75" },
            { "memoryId": 30, "score": "-0.50" }
          ]
        }
        """;

        mockLlm.Setup(l => l.GenerateChatCompletionAsync(It.IsAny<LlmCompletionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(jsonResponse);

        var provider = new MistralLlmRerankProvider(mockLlm.Object);
        var response = await provider.RerankAsync(new RerankRequest
        {
            Query = "query",
            Candidates = new List<RerankCandidate>
            {
                new() { MemoryId = 10, Content = "A" },
                new() { MemoryId = 20, Content = "B" },
                new() { MemoryId = 30, Content = "C" }
            }
        });

        Assert.Equal(3, response.ScoredCandidates.Count);
        Assert.Equal(10, response.ScoredCandidates[0].MemoryId);
        Assert.Equal(0.85, response.ScoredCandidates[0].RelevanceScore);

        Assert.Equal(20, response.ScoredCandidates[1].MemoryId);
        Assert.Equal(1.0, response.ScoredCandidates[1].RelevanceScore); // clamped

        Assert.Equal(30, response.ScoredCandidates[2].MemoryId);
        Assert.Equal(0.0, response.ScoredCandidates[2].RelevanceScore); // clamped
    }

    [Fact]
    public async Task MistralLlmRerankProvider_NullMissingAndMalformedScores_DefaultsToZeroScoreWithoutThrowing()
    {
        var mockLlm = new Mock<ILlmProvider>();

        // Item 1: null score
        // Item 2: missing score property
        // Item 3: non-numeric string score ("high")
        // Item 4: boolean score (true)
        var jsonResponse = """
        {
          "scores": [
            { "memoryId": 1, "score": null },
            { "memoryId": 2 },
            { "memoryId": 3, "score": "high" },
            { "memoryId": 4, "score": true }
          ]
        }
        """;

        mockLlm.Setup(l => l.GenerateChatCompletionAsync(It.IsAny<LlmCompletionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(jsonResponse);

        var provider = new MistralLlmRerankProvider(mockLlm.Object);
        var response = await provider.RerankAsync(new RerankRequest
        {
            Query = "query",
            Candidates = new List<RerankCandidate>
            {
                new() { MemoryId = 1, Content = "A" },
                new() { MemoryId = 2, Content = "B" },
                new() { MemoryId = 3, Content = "C" },
                new() { MemoryId = 4, Content = "D" }
            }
        });

        Assert.Equal(4, response.ScoredCandidates.Count);
        Assert.All(response.ScoredCandidates, s => Assert.Equal(0.0, s.RelevanceScore));
    }

    [Fact]
    public async Task MistralLlmRerankProvider_DuplicateIdsFromProvider_Deduplicates()
    {
        var mockLlm = new Mock<ILlmProvider>();
        var jsonResponse = """
        {
          "scores": [
            { "memoryId": 1, "score": 0.90 },
            { "memoryId": 1, "score": 0.50 }
          ]
        }
        """;

        mockLlm.Setup(l => l.GenerateChatCompletionAsync(It.IsAny<LlmCompletionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(jsonResponse);

        var provider = new MistralLlmRerankProvider(mockLlm.Object);
        var response = await provider.RerankAsync(new RerankRequest
        {
            Query = "query",
            Candidates = new List<RerankCandidate> { new() { MemoryId = 1, Content = "Fact" } }
        });

        Assert.Single(response.ScoredCandidates);
        Assert.Equal(0.90, response.ScoredCandidates[0].RelevanceScore);
    }

    [Fact]
    public async Task MistralLlmRerankProvider_MalformedJson_ReturnsGracefullyWithoutThrowing()
    {
        var mockLlm = new Mock<ILlmProvider>();
        mockLlm.Setup(l => l.GenerateChatCompletionAsync(It.IsAny<LlmCompletionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("Not valid json at all");

        var provider = new MistralLlmRerankProvider(mockLlm.Object);
        var response = await provider.RerankAsync(new RerankRequest
        {
            Query = "query",
            Candidates = new List<RerankCandidate> { new() { MemoryId = 1, Content = "Fact" } }
        });

        Assert.Empty(response.ScoredCandidates);
    }

    [Fact]
    public async Task RerankerService_Disabled_ReturnsOriginalCandidates()
    {
        var mockProvider = new Mock<IRerankProvider>();
        var options = Options.Create(new RerankerOptions { Enabled = false });
        var logger = new Mock<ILogger<RerankerService>>();

        var service = new RerankerService(mockProvider.Object, options, logger.Object);
        var candidates = new List<RetrievedMemory>
        {
            new() { MemoryId = 1, Content = "A", Similarity = 0.5 },
            new() { MemoryId = 2, Content = "B", Similarity = 0.8 }
        };

        var result = await service.RerankAsync("query", candidates);

        Assert.Equal(candidates, result);
        mockProvider.Verify(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task RerankerService_EmptyCandidates_ReturnsEmptyList()
    {
        var mockProvider = new Mock<IRerankProvider>();
        var options = Options.Create(new RerankerOptions { Enabled = true });
        var logger = new Mock<ILogger<RerankerService>>();

        var service = new RerankerService(mockProvider.Object, options, logger.Object);
        var result = await service.RerankAsync("query", new List<RetrievedMemory>());

        Assert.Empty(result);
    }

    [Fact]
    public async Task RerankerService_DeduplicatesInputCandidates_AndPreservesOriginalSimilarity()
    {
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider.Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RerankResponse
            {
                ScoredCandidates = new List<RerankCandidateScore>
                {
                    new() { MemoryId = 1, RelevanceScore = 0.9 }
                }
            });

        var options = Options.Create(new RerankerOptions { Enabled = true });
        var logger = new Mock<ILogger<RerankerService>>();
        var service = new RerankerService(mockProvider.Object, options, logger.Object);

        var candidates = new List<RetrievedMemory>
        {
            new() { MemoryId = 1, Content = "A", Similarity = 0.5 },
            new() { MemoryId = 1, Content = "A duplicate", Similarity = 0.4 }
        };

        var result = await service.RerankAsync("query", candidates);

        Assert.Single(result);
        Assert.Equal(1, result[0].MemoryId);
        Assert.Equal(0.5, result[0].Similarity); // Original similarity preserved!
        Assert.Equal(0.9, result[0].RerankScore); // Continuous rerank score stored separately
    }

    [Fact]
    public async Task RerankerService_ReranksAndSortsByRerankScoreThenMemoryId_PreservingOriginalSimilarity()
    {
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider.Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RerankResponse
            {
                ScoredCandidates = new List<RerankCandidateScore>
                {
                    new() { MemoryId = 1, RelevanceScore = 0.60 },
                    new() { MemoryId = 2, RelevanceScore = 0.95 },
                    new() { MemoryId = 3, RelevanceScore = 0.40 }
                }
            });

        var options = Options.Create(new RerankerOptions { Enabled = true });
        var logger = new Mock<ILogger<RerankerService>>();
        var service = new RerankerService(mockProvider.Object, options, logger.Object);

        var candidates = new List<RetrievedMemory>
        {
            new() { MemoryId = 1, Content = "Candidate 1", Similarity = 0.90 },
            new() { MemoryId = 2, Content = "Candidate 2", Similarity = 0.50 },
            new() { MemoryId = 3, Content = "Candidate 3", Similarity = 0.70 }
        };

        var result = await service.RerankAsync("query", candidates);

        // Candidate 2 has highest rerank score (0.95) -> must be ranked first, original similarity 0.50 preserved
        Assert.Equal(3, result.Count);
        Assert.Equal(2, result[0].MemoryId);
        Assert.Equal(0.50, result[0].Similarity); // Original preserved!
        Assert.Equal(0.95, result[0].RerankScore);

        // Candidate 1 has next highest rerank score (0.60), original similarity 0.90 preserved
        Assert.Equal(1, result[1].MemoryId);
        Assert.Equal(0.90, result[1].Similarity); // Original preserved!
        Assert.Equal(0.60, result[1].RerankScore);

        // Candidate 3 has lowest rerank score (0.40), original similarity 0.70 preserved
        Assert.Equal(3, result[2].MemoryId);
        Assert.Equal(0.70, result[2].Similarity); // Original preserved!
        Assert.Equal(0.40, result[2].RerankScore);
    }

    [Fact]
    public async Task RerankerService_TiedScores_BreaksTiesByMemoryIdAscending()
    {
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider.Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RerankResponse
            {
                ScoredCandidates = new List<RerankCandidateScore>
                {
                    new() { MemoryId = 20, RelevanceScore = 0.85 },
                    new() { MemoryId = 10, RelevanceScore = 0.85 }
                }
            });

        var options = Options.Create(new RerankerOptions { Enabled = true });
        var logger = new Mock<ILogger<RerankerService>>();
        var service = new RerankerService(mockProvider.Object, options, logger.Object);

        var candidates = new List<RetrievedMemory>
        {
            new() { MemoryId = 20, Content = "Twenty", Similarity = 0.5 },
            new() { MemoryId = 10, Content = "Ten", Similarity = 0.5 }
        };

        var result = await service.RerankAsync("query", candidates);

        Assert.Equal(2, result.Count);
        // Both have score 0.85 -> deterministic tie-breaking on MemoryId ASC puts 10 before 20
        Assert.Equal(10, result[0].MemoryId);
        Assert.Equal(0.85, result[0].RerankScore);
        Assert.Equal(0.5, result[0].Similarity);

        Assert.Equal(20, result[1].MemoryId);
        Assert.Equal(0.85, result[1].RerankScore);
        Assert.Equal(0.5, result[1].Similarity);
    }

    [Fact]
    public async Task RerankerService_MissingCandidateFromProvider_AssignsZeroScoreAndSorts()
    {
        var mockProvider = new Mock<IRerankProvider>();
        // Provider only returns score for MemoryId 1, omits MemoryId 2
        mockProvider.Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RerankResponse
            {
                ScoredCandidates = new List<RerankCandidateScore>
                {
                    new() { MemoryId = 1, RelevanceScore = 0.75 }
                }
            });

        var options = Options.Create(new RerankerOptions { Enabled = true });
        var logger = new Mock<ILogger<RerankerService>>();
        var service = new RerankerService(mockProvider.Object, options, logger.Object);

        var candidates = new List<RetrievedMemory>
        {
            new() { MemoryId = 1, Content = "Present", Similarity = 0.5 },
            new() { MemoryId = 2, Content = "Missing from provider", Similarity = 0.9 }
        };

        var result = await service.RerankAsync("query", candidates);

        Assert.Equal(2, result.Count);
        // Candidate 1 has 0.75, original similarity 0.5 preserved
        Assert.Equal(1, result[0].MemoryId);
        Assert.Equal(0.5, result[0].Similarity);
        Assert.Equal(0.75, result[0].RerankScore);

        // Candidate 2 was missing from provider -> assigned 0.0, original similarity 0.9 preserved
        Assert.Equal(2, result[1].MemoryId);
        Assert.Equal(0.9, result[1].Similarity);
        Assert.Equal(0.0, result[1].RerankScore);
    }

    [Fact]
    public async Task RerankerService_ProviderThrows_FallsBackToOriginalCandidates()
    {
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider.Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ProviderTransientException("Mistral", "Service unavailable", 503));

        var options = Options.Create(new RerankerOptions { Enabled = true });
        var logger = new Mock<ILogger<RerankerService>>();
        var service = new RerankerService(mockProvider.Object, options, logger.Object);

        var candidates = new List<RetrievedMemory>
        {
            new() { MemoryId = 1, Content = "First", Similarity = 0.9 },
            new() { MemoryId = 2, Content = "Second", Similarity = 0.8 }
        };

        var result = await service.RerankAsync("query", candidates);

        // Must gracefully fall back to original candidate ordering
        Assert.Equal(2, result.Count);
        Assert.Equal(1, result[0].MemoryId);
        Assert.Equal(2, result[1].MemoryId);
        Assert.Equal(0.9, result[0].Similarity);
        Assert.Null(result[0].RerankScore);
    }

    [Fact]
    public async Task RerankerService_Timeout_FallsBackToOriginalCandidates()
    {
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider.Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .Returns<RerankRequest, CancellationToken>(async (_, ct) =>
            {
                await Task.Delay(500, ct); // delay longer than TimeoutMs
                return new RerankResponse();
            });

        // Set TimeoutMs to 20ms
        var options = Options.Create(new RerankerOptions { Enabled = true, TimeoutMs = 20 });
        var logger = new Mock<ILogger<RerankerService>>();
        var service = new RerankerService(mockProvider.Object, options, logger.Object);

        var candidates = new List<RetrievedMemory>
        {
            new() { MemoryId = 1, Content = "A", Similarity = 0.9 },
            new() { MemoryId = 2, Content = "B", Similarity = 0.8 }
        };

        var result = await service.RerankAsync("query", candidates);

        // Fallback to original candidates
        Assert.Equal(2, result.Count);
        Assert.Equal(1, result[0].MemoryId);
        Assert.Equal(2, result[1].MemoryId);
        Assert.Equal(0.9, result[0].Similarity);
    }

    [Fact]
    public async Task RerankerService_CallerCancellation_RethrowsOperationCanceledException()
    {
        var mockProvider = new Mock<IRerankProvider>();
        mockProvider.Setup(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new OperationCanceledException());

        var options = Options.Create(new RerankerOptions { Enabled = true, TimeoutMs = 5000 });
        var logger = new Mock<ILogger<RerankerService>>();
        var service = new RerankerService(mockProvider.Object, options, logger.Object);

        using var cts = new CancellationTokenSource();
        cts.Cancel(); // caller cancelled

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            service.RerankAsync("query", new List<RetrievedMemory> { new() { MemoryId = 1, Content = "A" } }, cts.Token));
    }

    // ── Phase 5.6 Task 5.6.2: HybridRetrievalService Integration Tests ─────────

    private static HybridRetrievalService BuildHybridServiceWithReranker(
        Mock<IMemoryRepository>? memoryRepo = null,
        Mock<IEmbeddingGenerator>? embeddingGen = null,
        Mock<IMemoryRelevanceEvaluator>? relevanceEval = null,
        Mock<IKeywordSearchRepository>? keywordSearch = null,
        Mock<IEntityRepository>? entityRepo = null,
        Mock<IEntityExtractionService>? entityExtractionService = null,
        Mock<ILogger<HybridRetrievalService>>? logger = null,
        IRerankerService? rerankerService = null)
    {
        var memRepo = memoryRepo ?? new Mock<IMemoryRepository>();
        var embGen = embeddingGen ?? new Mock<IEmbeddingGenerator>();
        var relEval = relevanceEval ?? new Mock<IMemoryRelevanceEvaluator>();
        var kwSearch = keywordSearch ?? new Mock<IKeywordSearchRepository>();
        var entRepo = entityRepo ?? new Mock<IEntityRepository>();
        var entExtract = entityExtractionService ?? new Mock<IEntityExtractionService>();
        var log = logger ?? new Mock<ILogger<HybridRetrievalService>>();

        if (relevanceEval == null)
        {
            relEval.Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
                .ReturnsAsync((string _, List<RetrievedMemory> candidates) => candidates);
        }

        return new HybridRetrievalService(
            memRepo.Object,
            embGen.Object,
            new SemanticSimilarityService(),
            relEval.Object,
            kwSearch.Object,
            entRepo.Object,
            entExtract.Object,
            log.Object,
            rerankerService);
    }

    [Fact]
    public async Task HybridRetrieval_WithReranker_RerankingChangesFinalOrdering_WhilePreservingOriginalSimilarity()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var rerankerMock = new Mock<IRerankerService>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        // Memory 1 has high similarity (0.90), Memory 2 has lower similarity (0.50)
        memRepoMock.Setup(r => r.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(),
                It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 1L, Content = "Memory One", Similarity = 0.90, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { MemoryId = 2L, Content = "Memory Two", Similarity = 0.50, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            });

        // Reranker assigns higher score to Memory 2 (0.95) and lower to Memory 1 (0.60)
        rerankerMock.Setup(r => r.RerankAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string _, List<RetrievedMemory> candidates, CancellationToken _) =>
            {
                var m1 = candidates.First(c => c.MemoryId == 1L);
                var m2 = candidates.First(c => c.MemoryId == 2L);
                m1.RerankScore = 0.60;
                m2.RerankScore = 0.95;
                return new List<RetrievedMemory> { m2, m1 };
            });

        var hybrid = BuildHybridServiceWithReranker(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            rerankerService: rerankerMock.Object);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 2);

        Assert.Equal(2, result.Memories.Count);

        // Memory 2 is ranked first because of higher RerankScore (0.95)
        Assert.Equal(2L, result.Memories[0].MemoryId);
        Assert.Equal(0.95, result.Memories[0].RerankScore);
        Assert.True(result.Memories[0].Similarity > 0); // Original fused score preserved!

        // Memory 1 is ranked second
        Assert.Equal(1L, result.Memories[1].MemoryId);
        Assert.Equal(0.60, result.Memories[1].RerankScore);
        Assert.True(result.Memories[1].Similarity > result.Memories[0].Similarity); // Original fused similarity was higher
    }

    [Fact]
    public async Task HybridRetrieval_WithReranker_TopKAppliedAfterReranking()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var rerankerMock = new Mock<IRerankerService>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        // 3 candidates
        memRepoMock.Setup(r => r.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(),
                It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 1L, Content = "One", Similarity = 0.90, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { MemoryId = 2L, Content = "Two", Similarity = 0.80, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { MemoryId = 3L, Content = "Three", Similarity = 0.70, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            });

        // Reranker promotes candidate 3 to top, then candidate 2, demotes candidate 1 to bottom
        rerankerMock.Setup(r => r.RerankAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string _, List<RetrievedMemory> candidates, CancellationToken _) =>
            {
                var c1 = candidates.First(c => c.MemoryId == 1L);
                var c2 = candidates.First(c => c.MemoryId == 2L);
                var c3 = candidates.First(c => c.MemoryId == 3L);
                c3.RerankScore = 0.99;
                c2.RerankScore = 0.88;
                c1.RerankScore = 0.10;
                return new List<RetrievedMemory> { c3, c2, c1 };
            });

        var hybrid = BuildHybridServiceWithReranker(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            rerankerService: rerankerMock.Object);

        // Request topK = 2
        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 2);

        // Exactly topK=2 returned, candidate 3 then candidate 2, candidate 1 excluded
        Assert.Equal(2, result.Memories.Count);
        Assert.Equal(3L, result.Memories[0].MemoryId);
        Assert.Equal(0.99, result.Memories[0].RerankScore);
        Assert.Equal(2L, result.Memories[1].MemoryId);
        Assert.Equal(0.88, result.Memories[1].RerankScore);
        Assert.DoesNotContain(result.Memories, m => m.MemoryId == 1L);
    }

    [Fact]
    public async Task HybridRetrieval_WithRerankerDisabled_PreservesOriginalFusedScoreOrder()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        memRepoMock.Setup(r => r.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(),
                It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 1L, Content = "One", Similarity = 0.90, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { MemoryId = 2L, Content = "Two", Similarity = 0.50, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            });

        // Real RerankerService configured with Enabled = false
        var mockRerankProvider = new Mock<IRerankProvider>();
        var options = Options.Create(new RerankerOptions { Enabled = false });
        var rerankerService = new RerankerService(mockRerankProvider.Object, options, new Mock<ILogger<RerankerService>>().Object);

        var hybrid = BuildHybridServiceWithReranker(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            rerankerService: rerankerService);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 2);

        Assert.Equal(2, result.Memories.Count);
        // Preserves fused score order (Memory 1 before Memory 2)
        Assert.Equal(1L, result.Memories[0].MemoryId);
        Assert.Null(result.Memories[0].RerankScore);
        Assert.Equal(2L, result.Memories[1].MemoryId);
        Assert.Null(result.Memories[1].RerankScore);

        mockRerankProvider.Verify(p => p.RerankAsync(It.IsAny<RerankRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task HybridRetrieval_EmptyCandidates_DoesNotInvokeReranker()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var rerankerMock = new Mock<IRerankerService>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        // Zero semantic results
        memRepoMock.Setup(r => r.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(),
                It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>());

        var hybrid = BuildHybridServiceWithReranker(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            rerankerService: rerankerMock.Object);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 5);

        Assert.Empty(result.Memories);
        // Reranker must NEVER be called when candidate list is empty
        rerankerMock.Verify(r => r.RerankAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task HybridRetrieval_RerankerThrows_FallsBackToRelevanceEvaluatedFusedOrder()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var rerankerMock = new Mock<IRerankerService>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        memRepoMock.Setup(r => r.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(),
                It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 1L, Content = "One", Similarity = 0.90, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { MemoryId = 2L, Content = "Two", Similarity = 0.50, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            });

        // Reranker throws exception
        rerankerMock.Setup(r => r.RerankAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("External reranker error"));

        var hybrid = BuildHybridServiceWithReranker(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            rerankerService: rerankerMock.Object);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 2);

        Assert.Equal(2, result.Memories.Count);
        // Falls back seamlessly to fused score order without failing
        Assert.Equal(1L, result.Memories[0].MemoryId);
        Assert.Equal(2L, result.Memories[1].MemoryId);
    }

    [Fact]
    public async Task HybridRetrieval_CallerCancellation_PropagatesOperationCanceledException()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var rerankerMock = new Mock<IRerankerService>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        memRepoMock.Setup(r => r.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(),
                It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 1L, Content = "One", Similarity = 0.90, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            });

        rerankerMock.Setup(r => r.RerankAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new OperationCanceledException());

        var hybrid = BuildHybridServiceWithReranker(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            rerankerService: rerankerMock.Object);

        using var cts = new CancellationTokenSource();
        cts.Cancel(); // caller cancelled

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 2, cancellationToken: cts.Token));
    }

    [Fact]
    public async Task HybridRetrieval_TiedRerankScores_OrdersDeterministicallyByMemoryIdAscending()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var rerankerMock = new Mock<IRerankerService>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        memRepoMock.Setup(r => r.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(),
                It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 20L, Content = "Twenty", Similarity = 0.85, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { MemoryId = 10L, Content = "Ten", Similarity = 0.85, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            });

        // Tied rerank scores: both 0.90
        rerankerMock.Setup(r => r.RerankAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string _, List<RetrievedMemory> candidates, CancellationToken _) =>
            {
                foreach (var c in candidates) c.RerankScore = 0.90;
                return candidates;
            });

        var hybrid = BuildHybridServiceWithReranker(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            rerankerService: rerankerMock.Object);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 2);

        Assert.Equal(2, result.Memories.Count);
        // Ties on RerankScore broken deterministically by MemoryId ASC: 10 before 20
        Assert.Equal(10L, result.Memories[0].MemoryId);
        Assert.Equal(20L, result.Memories[1].MemoryId);
    }
}
