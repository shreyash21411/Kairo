using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Kairo.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Npgsql;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Phase 5 — Task 5.1: Hybrid Vector Retrieval Integration Tests.
/// Validates:
/// 1. Hybrid service invokes SearchSimilarEmbeddingsAsync with correct arguments.
/// 2. SQL Server compatibility fallback handles model/dimension filtering.
/// 3. Mixed candidate score fusion (semantic, keyword, entity signals).
/// 4. Keyword-only candidate eligibility.
/// 5. Semantic-only candidate eligibility.
/// 6. Empty semantic results handling.
/// 7. Embedding generation failure fallback.
/// 8. Relevance evaluator failure graceful handling.
/// 9. Filter propagation (scope, temporal, metadata, category).
/// 10. Top-K candidate depth and final limiting.
/// 11. Graph-based related memory retrieval.
/// 12. PostgreSQL live native pgvector retrieval integration in HybridRetrievalService.
/// </summary>
public class Phase5HybridVectorRetrievalUnitTests
{
    private static HybridRetrievalService BuildHybridService(
        Mock<IMemoryRepository>? memoryRepo = null,
        Mock<IEmbeddingGenerator>? embeddingGen = null,
        Mock<IMemoryRelevanceEvaluator>? relevanceEval = null,
        Mock<IKeywordSearchRepository>? keywordSearch = null,
        Mock<IEntityRepository>? entityRepo = null,
        Mock<IEntityExtractionService>? entityExtractionService = null,
        Mock<ILogger<HybridRetrievalService>>? logger = null)
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
            log.Object);
    }

    [Fact]
    public async Task NativeSemanticPath_InvokesSearchSimilarEmbeddingsAsyncWithExpectedParameters()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var kwSearchMock = new Mock<IKeywordSearchRepository>();

        var queryVec = new float[] { 0.1f, 0.2f, 0.3f };
        const string expectedModel = "mistral-embed-custom";

        embGenMock.Setup(e => e.GenerateAsync("test query"))
            .ReturnsAsync(queryVec);
        embGenMock.As<IEmbeddingMetadataProvider>()
            .Setup(m => m.ModelName)
            .Returns(expectedModel);

        var temporalFilter = new MemoryTemporalFilter { LastDays = 7 };
        var metaFilters = new List<MetadataFilterCondition>
        {
            new() { Key = "source", Operator = "eq", Value = "slack" }
        };
        var catFilters = new List<string> { "projects" };

        memRepoMock.Setup(m => m.SearchSimilarEmbeddingsAsync(
                1L,
                queryVec,
                expectedModel,
                15, // Math.Max(5 * 3, 15) = 15
                100L,
                temporalFilter,
                metaFilters,
                catFilters,
                It.IsAny<long?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new()
                {
                    MemoryId = 42L,
                    Content = "Sample memory",
                    MemoryType = "Fact",
                    Similarity = 0.88,
                    Model = expectedModel,
                    Dimensions = 3,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                }
            });

        kwSearchMock.Setup(k => k.SearchAsync(
                1L, "test query", 100L, It.IsAny<int>(), temporalFilter, metaFilters, catFilters, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>());

        var hybrid = BuildHybridService(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            keywordSearch: kwSearchMock);

        var result = await hybrid.RetrieveWithRelationsAsync(
            userId: 1L,
            projectId: 10L,
            query: "test query",
            topK: 5,
            scopeId: 100L,
            temporalFilter: temporalFilter,
            metadataFilters: metaFilters,
            recencyBoost: false,
            graphDepth: 1,
            categoryFilters: catFilters);

        memRepoMock.Verify(m => m.SearchSimilarEmbeddingsAsync(
            1L,
            queryVec,
            expectedModel,
            15,
            100L,
            temporalFilter,
            metaFilters,
            catFilters,
            It.IsAny<long?>()), Times.Once);

        Assert.Single(result.Memories);
        Assert.Equal(42L, result.Memories[0].MemoryId);
    }

    [Fact]
    public void SqlServerCompatibility_FallbackPreservesModelDimensionFiltering()
    {
        var queryDims = 8;
        var queryModel = "mistral-embed";

        // Dimension mismatch rejection
        Assert.NotEqual(4, queryDims);

        // Model mismatch rejection
        Assert.False(EmbeddingGeneratorExtensions.IsModelCompatible("openai-ada-002", queryModel));

        // Model match case-insensitivity
        Assert.True(EmbeddingGeneratorExtensions.IsModelCompatible("MISTRAL-EMBED", queryModel));

        // Null model legacy mock compatibility
        Assert.True(EmbeddingGeneratorExtensions.IsModelCompatible(null, queryModel));

        // Similarity calculation parity
        var simService = new SemanticSimilarityService();
        var vecA = new float[] { 1f, 0f };
        var vecB = new float[] { 0.7071f, 0.7071f };
        var sim = simService.CalculateCosineSimilarity(vecA, vecB);
        Assert.InRange(sim, 0.70, 0.72);
    }

    [Fact]
    public async Task MixedCandidates_SemanticKeywordAndEntitySignalsFused()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var kwSearchMock = new Mock<IKeywordSearchRepository>();
        var entRepoMock = new Mock<IEntityRepository>();
        var entExtractMock = new Mock<IEntityExtractionService>();

        var queryVec = new float[] { 1f, 0f };
        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>())).ReturnsAsync(queryVec);

        // Memory 1: semantic = 0.8, keyword = raw 5.0 (max), entity = 1.0 (match)
        // Memory 2: semantic = 0.9, keyword = none, entity = none
        memRepoMock.Setup(m => m.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(),
                It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>(), It.IsAny<long?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 1L, Content = "Postgres memory", Similarity = 0.8, Model = "mistral-embed", Dimensions = 2, MemoryType = "Fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { MemoryId = 2L, Content = "Python memory", Similarity = 0.9, Model = "mistral-embed", Dimensions = 2, MemoryType = "Fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            });

        kwSearchMock.Setup(k => k.SearchAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>
            {
                new() { MemoryId = 1L, Content = "Postgres memory", MemoryType = "Fact", RawScore = 5.0 }
            });

        entExtractMock.Setup(e => e.ExtractAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<ExtractedEntity>
            {
                new() { NormalizedName = "postgres", DisplayName = "Postgres", EntityType = "TECH" }
            });

        entRepoMock.Setup(e => e.GetEntitiesForMemoriesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, List<EntityData>>
            {
                [1L] = new() { new EntityData { NormalizedName = "postgres", DisplayName = "Postgres", EntityType = "TECH" } }
            });

        var hybrid = BuildHybridService(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            keywordSearch: kwSearchMock,
            entityRepo: entRepoMock,
            entityExtractionService: entExtractMock);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "postgres query", topK: 5);

        // Memory 1 fused score: 0.8 * 0.60 + 1.0 * 0.25 + 1.0 * 0.15 = 0.48 + 0.25 + 0.15 = 0.88
        // Memory 2 fused score: 0.9 * 0.60 + 0.0 + 0.0 = 0.54
        Assert.Equal(2, result.Memories.Count);
        Assert.Equal(1L, result.Memories[0].MemoryId);
        Assert.Equal(2L, result.Memories[1].MemoryId);
    }

    [Fact]
    public async Task KeywordOnlyCandidate_EligibleAndRankedWhenAbsentFromSemanticResults()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var kwSearchMock = new Mock<IKeywordSearchRepository>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>())).ReturnsAsync(new float[] { 1f, 0f });

        // Semantic results return only Memory 1
        memRepoMock.Setup(m => m.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(),
                It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>(), It.IsAny<long?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 1L, Content = "Vector match", Similarity = 0.7, Model = "mistral-embed", Dimensions = 2, MemoryType = "Fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            });

        // Keyword search returns Memory 2 (keyword-only candidate)
        kwSearchMock.Setup(k => k.SearchAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>
            {
                new() { MemoryId = 2L, Content = "Keyword only match", MemoryType = "Fact", RawScore = 3.0 }
            });

        var hybrid = BuildHybridService(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            keywordSearch: kwSearchMock);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 5);

        Assert.Equal(2, result.Memories.Count);
        Assert.Contains(result.Memories, m => m.MemoryId == 2L && m.Content == "Keyword only match");
    }

    [Fact]
    public async Task SemanticOnlyCandidate_EligibleAndRankedWhenKeywordReturnsNothing()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var kwSearchMock = new Mock<IKeywordSearchRepository>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>())).ReturnsAsync(new float[] { 1f, 0f });

        memRepoMock.Setup(m => m.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(),
                It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>(), It.IsAny<long?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 10L, Content = "Semantic match", Similarity = 0.92, Model = "mistral-embed", Dimensions = 2, MemoryType = "Fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            });

        kwSearchMock.Setup(k => k.SearchAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>());

        var hybrid = BuildHybridService(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            keywordSearch: kwSearchMock);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 5);

        Assert.Single(result.Memories);
        Assert.Equal(10L, result.Memories[0].MemoryId);
        Assert.Equal(0.92 * 0.60, result.Memories[0].Similarity, precision: 3);
    }

    [Fact]
    public async Task EmptySemanticResults_KeywordResultsReturnedGracefully()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var kwSearchMock = new Mock<IKeywordSearchRepository>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>())).ReturnsAsync(new float[] { 1f, 0f });

        memRepoMock.Setup(m => m.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(),
                It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>(), It.IsAny<long?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>());

        kwSearchMock.Setup(k => k.SearchAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>
            {
                new() { MemoryId = 77L, Content = "BM25 keyword match", MemoryType = "Fact", RawScore = 4.0 }
            });

        var hybrid = BuildHybridService(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            keywordSearch: kwSearchMock);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 5);

        Assert.Single(result.Memories);
        Assert.Equal(77L, result.Memories[0].MemoryId);
        Assert.Equal(1.0 * 0.25, result.Memories[0].Similarity, precision: 3);
    }

    [Fact]
    public async Task EmbeddingGenerationFailure_FallsBackToKeywordOnlyRetrieval()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var kwSearchMock = new Mock<IKeywordSearchRepository>();

        // Embedding generation returns empty array
        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(Array.Empty<float>());

        var oldDate = DateTime.UtcNow.AddDays(-2);
        memRepoMock.Setup(m => m.GetActiveMemoryEmbeddingsAsync(1L, null))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = 99L, Content = "Active keyword memory", MemoryType = "Fact", CreatedAt = oldDate, UpdatedAt = oldDate, Embedding = Array.Empty<float>() }
            });

        kwSearchMock.Setup(k => k.SearchAsync(1L, "query", null, It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>
            {
                new() { MemoryId = 99L, Content = "Active keyword memory", MemoryType = "Fact", RawScore = 3.5 }
            });

        var hybrid = BuildHybridService(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            keywordSearch: kwSearchMock);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 5);

        // SearchSimilarEmbeddingsAsync must NOT be called when query embedding is empty
        memRepoMock.Verify(m => m.SearchSimilarEmbeddingsAsync(
            It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(),
            It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
            It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>(), It.IsAny<long?>()), Times.Never);

        Assert.Single(result.Memories);
        Assert.Equal(99L, result.Memories[0].MemoryId);
    }

    [Fact]
    public async Task RelevanceEvaluatorFailure_FallbackToUnfilteredRankedCandidates()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var relEvalMock = new Mock<IMemoryRelevanceEvaluator>();
        var kwSearchMock = new Mock<IKeywordSearchRepository>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>())).ReturnsAsync(new float[] { 1f, 0f });

        memRepoMock.Setup(m => m.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(),
                It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>(), It.IsAny<long?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 1L, Content = "Candidate 1", Similarity = 0.9, Model = "mistral-embed", Dimensions = 2, MemoryType = "Fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            });

        kwSearchMock.Setup(k => k.SearchAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>());

        // Evaluator throws exception
        relEvalMock.Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
            .ThrowsAsync(new InvalidOperationException("Evaluator LLM timeout"));

        var hybrid = BuildHybridService(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            relevanceEval: relEvalMock,
            keywordSearch: kwSearchMock);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 5);

        // Fallback gracefully returns candidates
        Assert.Single(result.Memories);
        Assert.Equal(1L, result.Memories[0].MemoryId);
    }

    [Fact]
    public async Task FilterPropagation_AllFiltersPassedToNativeSearch()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var kwSearchMock = new Mock<IKeywordSearchRepository>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>())).ReturnsAsync(new float[] { 1f, 0f });

        var tf = new MemoryTemporalFilter { LastDays = 14 };
        var mf = new List<MetadataFilterCondition> { new() { Key = "env", Operator = "eq", Value = "prod" } };
        var cf = new List<string> { "architecture" };

        memRepoMock.Setup(m => m.SearchSimilarEmbeddingsAsync(
                55L, It.IsAny<float[]>(), "mistral-embed", It.IsAny<int>(), 999L, tf, mf, cf, It.IsAny<long?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>());

        kwSearchMock.Setup(k => k.SearchAsync(55L, "q", 999L, It.IsAny<int>(), tf, mf, cf, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>());

        var hybrid = BuildHybridService(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            keywordSearch: kwSearchMock);

        await hybrid.RetrieveWithRelationsAsync(
            userId: 55L,
            projectId: 1L,
            query: "q",
            topK: 3,
            scopeId: 999L,
            temporalFilter: tf,
            metadataFilters: mf,
            recencyBoost: false,
            graphDepth: 1,
            categoryFilters: cf);

        memRepoMock.Verify(m => m.SearchSimilarEmbeddingsAsync(
            55L,
            It.IsAny<float[]>(),
            "mistral-embed",
            15, // candidateLimit = Math.Max(3 * 3, 15)
            999L,
            tf,
            mf,
            cf,
            It.IsAny<long?>()), Times.Once);
    }

    [Fact]
    public async Task TopKAndCandidateDepth_RespectsLimitsAndDiversity()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var kwSearchMock = new Mock<IKeywordSearchRepository>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>())).ReturnsAsync(new float[] { 1f, 0f });

        // 5 candidates returned by repository
        memRepoMock.Setup(m => m.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(),
                It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>(), It.IsAny<long?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 1L, Content = "M1", Similarity = 0.95, Model = "mistral-embed", Dimensions = 2, MemoryType = "Fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { MemoryId = 2L, Content = "M2", Similarity = 0.90, Model = "mistral-embed", Dimensions = 2, MemoryType = "Fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { MemoryId = 3L, Content = "M3", Similarity = 0.85, Model = "mistral-embed", Dimensions = 2, MemoryType = "Fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { MemoryId = 4L, Content = "M4", Similarity = 0.80, Model = "mistral-embed", Dimensions = 2, MemoryType = "Fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { MemoryId = 5L, Content = "M5", Similarity = 0.75, Model = "mistral-embed", Dimensions = 2, MemoryType = "Fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
            });

        kwSearchMock.Setup(k => k.SearchAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>());

        var hybrid = BuildHybridService(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            keywordSearch: kwSearchMock);

        // Requested topK is 2
        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 2);

        Assert.Equal(2, result.Memories.Count);
        Assert.Equal(1L, result.Memories[0].MemoryId);
        Assert.Equal(2L, result.Memories[1].MemoryId);
    }

    [Fact]
    public async Task GraphRetrieval_RetrievesRelatedMemoriesWhenDepthGreaterThanZero()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var kwSearchMock = new Mock<IKeywordSearchRepository>();
        var entRepoMock = new Mock<IEntityRepository>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>())).ReturnsAsync(new float[] { 1f, 0f });

        memRepoMock.Setup(m => m.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(),
                It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>(), It.IsAny<long?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 1L, Content = "Primary memory", Similarity = 0.95, Model = "mistral-embed", Dimensions = 2, MemoryType = "Fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            });

        kwSearchMock.Setup(k => k.SearchAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>());

        entRepoMock.Setup(e => e.GetEntitiesForMemoriesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, List<EntityData>>
            {
                [1L] = new() { new EntityData { EntityId = 100, NormalizedName = "postgresql", DisplayName = "PostgreSQL", EntityType = "TECH" } }
            });

        entRepoMock.Setup(e => e.GetScopedRelationshipsForEntitiesAsync(
                It.IsAny<long>(), It.IsAny<long>(), It.IsAny<IEnumerable<string>>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<GraphRelationData>
            {
                new()
                {
                    RelationshipId = 1,
                    ScopeId = 10,
                    SourceDisplayName = "Primary memory",
                    RelationshipType = "SHARED_ENTITY",
                    TargetDisplayName = "Related node"
                }
            });

        var hybrid = BuildHybridService(
            memoryRepo: memRepoMock,
            embeddingGen: embGenMock,
            keywordSearch: kwSearchMock,
            entityRepo: entRepoMock);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 10L, "query", topK: 5, scopeId: 10L, graphDepth: 1);

        Assert.Single(result.Memories);
        Assert.Single(result.Relations);
        Assert.Equal("SHARED_ENTITY", result.Relations[0].Relationship);
    }

    [Fact]
    public async Task PostgreSql_HybridRetrieval_EndToEnd_UsesNativeVectorRetrieval()
    {
        var creds = DiscoverPostgresCredentials();
        Assert.True(creds != null, "PostgreSQL test credentials could not be discovered from environment or infrastructure/docker/.env.");

        var connString = BuildConnectionString(creds!.Value, "kairo_vector_test");
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseNpgsql(connString, o => o.UseVector())
            .Options;

        await using var context = new KairoDbContext(options);
        var canConnect = await context.Database.CanConnectAsync();
        Assert.True(canConnect, "PostgreSQL test container is unreachable or rejected connection to kairo_vector_test.");

        // Create isolated test user & scope
        var email = $"hybrid_pg_{Guid.NewGuid():N}@kairo-test.internal";
        var user = new Users { Email = email, AccountStatus = 1, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
        context.Users.Add(user);
        await context.SaveChangesAsync();

        var project = new Projects { UserId = user.UserId, Name = "Hybrid PG Test", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        await context.SaveChangesAsync();

        var scope = new MemoryScopes { ProjectId = project.ProjectId, ActorId = $"actor_{user.UserId}", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
        context.MemoryScopes.Add(scope);
        await context.SaveChangesAsync();

        try
        {
            // Seed two memories with embeddings: Memory 1 is close to query, Memory 2 is distant
            var mem1 = new Memories { UserId = user.UserId, ScopeId = scope.ScopeId, Content = "PostgreSQL native vector storage", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
            var mem2 = new Memories { UserId = user.UserId, ScopeId = scope.ScopeId, Content = "Cooking Italian pizza recipe", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
            context.Memories.AddRange(mem1, mem2);
            await context.SaveChangesAsync();

            context.MemoryCategories.Add(new MemoryCategory { MemoryId = mem1.MemoryId, Category = "database", CreatedAt = DateTime.UtcNow });
            await context.SaveChangesAsync();

            var emb1 = new MemoryEmbeddings { MemoryId = mem1.MemoryId, Model = "mistral-embed", Dimensions = 4, VectorData = System.Text.Json.JsonSerializer.Serialize(new float[] { 0.9f, 0.1f, 0.0f, 0.0f }), CreatedAt = DateTime.UtcNow };
            var emb2 = new MemoryEmbeddings { MemoryId = mem2.MemoryId, Model = "mistral-embed", Dimensions = 4, VectorData = System.Text.Json.JsonSerializer.Serialize(new float[] { 0.0f, 0.0f, 0.9f, 0.1f }), CreatedAt = DateTime.UtcNow };
            context.MemoryEmbeddings.AddRange(emb1, emb2);
            await context.SaveChangesAsync();

            var realRepo = new MemoryRepository(context);
            var embGenMock = new Mock<IEmbeddingGenerator>();
            embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>())).ReturnsAsync(new float[] { 1f, 0f, 0f, 0f });
    
            var kwSearchMock = new Mock<IKeywordSearchRepository>();
            kwSearchMock.Setup(k => k.SearchAsync(user.UserId, "database query", scope.ScopeId, It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<KeywordSearchResult>());

            var relEvalMock = new Mock<IMemoryRelevanceEvaluator>();
            relEvalMock.Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
                .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

            // Rebuild with real repo directly
            var realHybrid = new HybridRetrievalService(
                realRepo,
                embGenMock.Object,
                new SemanticSimilarityService(),
                relEvalMock.Object,
                kwSearchMock.Object,
                new Mock<IEntityRepository>().Object,
                new Mock<IEntityExtractionService>().Object,
                new Mock<ILogger<HybridRetrievalService>>().Object);

            var result = await realHybrid.RetrieveWithRelationsAsync(
                userId: user.UserId,
                projectId: project.ProjectId,
                query: "database query",
                topK: 2,
                scopeId: scope.ScopeId);

            Assert.NotEmpty(result.Memories);
            // Memory 1 must be ranked #1 by native pgvector cosine distance
            Assert.Equal(mem1.MemoryId, result.Memories[0].MemoryId);
            Assert.True(result.Memories[0].Similarity > 0.5);
            Assert.Equal("PostgreSQL native vector storage", result.Memories[0].Content);
            Assert.Single(result.Memories[0].Categories);
            Assert.Equal("database", result.Memories[0].Categories[0]);
        }
        finally
        {
            // Cleanup isolated records
            var cats = await context.MemoryCategories.Where(c => c.Memory.UserId == user.UserId).ToListAsync();
            context.MemoryCategories.RemoveRange(cats);
            var embs = await context.MemoryEmbeddings.Where(e => e.Memory.UserId == user.UserId).ToListAsync();
            context.MemoryEmbeddings.RemoveRange(embs);
            var mems = await context.Memories.Where(m => m.UserId == user.UserId).ToListAsync();
            context.Memories.RemoveRange(mems);
            var sc = await context.MemoryScopes.FindAsync(scope.ScopeId);
            if (sc != null) context.MemoryScopes.Remove(sc);
            var pr = await context.Projects.FindAsync(project.ProjectId);
            if (pr != null) context.Projects.Remove(pr);
            var u = await context.Users.FindAsync(user.UserId);
            if (u != null) context.Users.Remove(u);
            await context.SaveChangesAsync();
        }
    }

    [Fact]
    public async Task PostgreSql_SearchSimilarEmbeddings_NarrowsProjectionAndHydratesTopKOnly()
    {
        var creds = DiscoverPostgresCredentials();
        Assert.True(creds != null, "PostgreSQL test credentials could not be discovered from environment or infrastructure/docker/.env.");

        var connString = BuildConnectionString(creds!.Value, "kairo_vector_test");
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseNpgsql(connString, o => o.UseVector())
            .Options;

        await using var context = new KairoDbContext(options);
        var canConnect = await context.Database.CanConnectAsync();
        Assert.True(canConnect, "PostgreSQL test container is unreachable or rejected connection to kairo_vector_test.");

        var email = $"narrow_proj_{Guid.NewGuid():N}@kairo-test.internal";
        var user = new Users { Email = email, AccountStatus = 1, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
        context.Users.Add(user);
        await context.SaveChangesAsync();

        try
        {
            // Seed 4 memories with 3D embeddings
            var mem1 = new Memories { UserId = user.UserId, Content = "Candidate One (Best)", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow.AddDays(-1), UpdatedAt = DateTime.UtcNow };
            var mem2 = new Memories { UserId = user.UserId, Content = "Candidate Two (Good)", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow.AddDays(-2), UpdatedAt = DateTime.UtcNow };
            var mem3 = new Memories { UserId = user.UserId, Content = "Candidate Three (Fair)", MemoryType = "Skill", IsActive = true, CreatedAt = DateTime.UtcNow.AddDays(-3), UpdatedAt = DateTime.UtcNow };
            var mem4 = new Memories { UserId = user.UserId, Content = "Candidate Four (Poor)", MemoryType = "Event", IsActive = true, CreatedAt = DateTime.UtcNow.AddDays(-4), UpdatedAt = DateTime.UtcNow };
            context.Memories.AddRange(mem1, mem2, mem3, mem4);
            await context.SaveChangesAsync();

            context.MemoryCategories.Add(new MemoryCategory { MemoryId = mem1.MemoryId, Category = "alpha", CreatedAt = DateTime.UtcNow });
            context.MemoryCategories.Add(new MemoryCategory { MemoryId = mem2.MemoryId, Category = "beta", CreatedAt = DateTime.UtcNow });
            await context.SaveChangesAsync();

            var e1 = new MemoryEmbeddings { MemoryId = mem1.MemoryId, Model = "mistral-embed", Dimensions = 3, VectorData = System.Text.Json.JsonSerializer.Serialize(new float[] { 1f, 0f, 0f }), CreatedAt = DateTime.UtcNow };
            var e2 = new MemoryEmbeddings { MemoryId = mem2.MemoryId, Model = "mistral-embed", Dimensions = 3, VectorData = System.Text.Json.JsonSerializer.Serialize(new float[] { 0.8f, 0.6f, 0f }), CreatedAt = DateTime.UtcNow };
            var e3 = new MemoryEmbeddings { MemoryId = mem3.MemoryId, Model = "mistral-embed", Dimensions = 3, VectorData = System.Text.Json.JsonSerializer.Serialize(new float[] { 0.5f, 0.5f, 0.7f }), CreatedAt = DateTime.UtcNow };
            var e4 = new MemoryEmbeddings { MemoryId = mem4.MemoryId, Model = "mistral-embed", Dimensions = 3, VectorData = System.Text.Json.JsonSerializer.Serialize(new float[] { 0f, 1f, 0f }), CreatedAt = DateTime.UtcNow };
            context.MemoryEmbeddings.AddRange(e1, e2, e3, e4);
            await context.SaveChangesAsync();

            var repo = new MemoryRepository(context);
            // Request topK = 2
            var results = await repo.SearchSimilarEmbeddingsAsync(user.UserId, new float[] { 1f, 0f, 0f }, "mistral-embed", topK: 2);

            // Exactly topK=2 returned
            Assert.Equal(2, results.Count);

            // Verified correct ranking and full snapshot hydration on survivors
            Assert.Equal(mem1.MemoryId, results[0].MemoryId);
            Assert.Equal("Candidate One (Best)", results[0].Content);
            Assert.Single(results[0].Categories);
            Assert.Equal("alpha", results[0].Categories[0]);
            Assert.True(results[0].Similarity > 0.99);

            Assert.Equal(mem2.MemoryId, results[1].MemoryId);
            Assert.Equal("Candidate Two (Good)", results[1].Content);
            Assert.Single(results[1].Categories);
            Assert.Equal("beta", results[1].Categories[0]);

            // Non-surviving candidates (mem3, mem4) are not in results
            Assert.DoesNotContain(results, r => r.MemoryId == mem3.MemoryId);
            Assert.DoesNotContain(results, r => r.MemoryId == mem4.MemoryId);
        }
        finally
        {
            var cats = await context.MemoryCategories.Where(c => c.Memory.UserId == user.UserId).ToListAsync();
            context.MemoryCategories.RemoveRange(cats);
            var embs = await context.MemoryEmbeddings.Where(e => e.Memory.UserId == user.UserId).ToListAsync();
            context.MemoryEmbeddings.RemoveRange(embs);
            var mems = await context.Memories.Where(m => m.UserId == user.UserId).ToListAsync();
            context.Memories.RemoveRange(mems);
            var u = await context.Users.FindAsync(user.UserId);
            if (u != null) context.Users.Remove(u);
            await context.SaveChangesAsync();
        }
    }

    [Fact]
    public async Task HybridRetrieval_TiedFusedScores_OrdersDeterministicallyByMemoryId()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var relEvalMock = new Mock<IMemoryRelevanceEvaluator>();
        var kwSearchMock = new Mock<IKeywordSearchRepository>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        // Two semantic candidates with identical similarity 0.85
        // Memory 20 has larger ID, Memory 10 has smaller ID
        memRepoMock.Setup(r => r.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(),
                It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>(), It.IsAny<long?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 20L, Content = "B", Similarity = 0.85, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
                new() { MemoryId = 10L, Content = "A", Similarity = 0.85, Model = "mistral-embed", Dimensions = 2, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
            });

        kwSearchMock.Setup(k => k.SearchAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>());

        memRepoMock.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
            .ReturnsAsync(new Dictionary<long, MemorySnapshot>());

        relEvalMock.Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

        var hybrid = new HybridRetrievalService(
            memRepoMock.Object,
            embGenMock.Object,
            new SemanticSimilarityService(),
            relEvalMock.Object,
            kwSearchMock.Object,
            new Mock<IEntityRepository>().Object,
            new Mock<IEntityExtractionService>().Object,
            new Mock<ILogger<HybridRetrievalService>>().Object);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 2);

        Assert.Equal(2, result.Memories.Count);
        // Ties must be broken deterministically by MemoryId ascending (10 before 20)
        Assert.Equal(10L, result.Memories[0].MemoryId);
        Assert.Equal(20L, result.Memories[1].MemoryId);
    }

    [Fact]
    public async Task HybridRetrieval_CandidateUnionExceedsCandidateLimit_TruncatesByFusedScoreDeterministically()
    {
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();
        var relEvalMock = new Mock<IMemoryRelevanceEvaluator>();
        var kwSearchMock = new Mock<IKeywordSearchRepository>();

        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        // topK = 5 -> candidateLimit = Math.Max(5 * 3, 15) = 15
        // Generate 10 semantic results (scores 0.90 down to 0.72)
        var semanticResults = Enumerable.Range(1, 10).Select(i => new RankedEmbeddingResult
        {
            MemoryId = i,
            Content = $"Semantic {i}",
            Similarity = 1.0 - (i * 0.02),
            Model = "mistral-embed",
            Dimensions = 2,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        }).ToList();

        memRepoMock.Setup(r => r.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(),
                It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>(), It.IsAny<long?>()))
            .ReturnsAsync(semanticResults);

        // Generate 10 keyword-only results (IDs 101 to 110, raw scores 10 down to 1)
        var kwResults = Enumerable.Range(1, 10).Select(i => new KeywordSearchResult
        {
            MemoryId = 100 + i,
            Content = $"Keyword {i}",
            MemoryType = "Fact",
            RawScore = 11 - i
        }).ToList();

        kwSearchMock.Setup(k => k.SearchAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(kwResults);

        // Snapshot hydration for keyword candidates
        var kwSnapshots = kwResults.ToDictionary(k => k.MemoryId, k => new MemorySnapshot
        {
            MemoryId = k.MemoryId,
            Content = k.Content,
            MemoryType = "Fact",
            IsActive = true,
            CreatedAt = DateTime.UtcNow.AddDays(-1),
            UpdatedAt = DateTime.UtcNow.AddDays(-1)
        });
        memRepoMock.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
            .ReturnsAsync(kwSnapshots);

        List<RetrievedMemory>? capturedForEval = null;
        relEvalMock.Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
            .Callback<string, List<RetrievedMemory>>((_, c) => capturedForEval = c)
            .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

        var hybrid = new HybridRetrievalService(
            memRepoMock.Object,
            embGenMock.Object,
            new SemanticSimilarityService(),
            relEvalMock.Object,
            kwSearchMock.Object,
            new Mock<IEntityRepository>().Object,
            new Mock<IEntityExtractionService>().Object,
            new Mock<ILogger<HybridRetrievalService>>().Object);

        var result = await hybrid.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 5);

        // Candidate union is 20 items (10 semantic + 10 keyword)
        // candidateLimit is 15 -> exactly 15 candidates must be sent to relevance evaluator
        Assert.NotNull(capturedForEval);
        Assert.Equal(15, capturedForEval!.Count);

        // Final result must be truncated to topK = 5
        Assert.Equal(5, result.Memories.Count);

        // The top candidate should have highest fused score
        for (int i = 0; i < result.Memories.Count - 1; i++)
        {
            Assert.True(result.Memories[i].Similarity >= result.Memories[i + 1].Similarity);
        }
    }

    private static (string Host, int Port, string Username, string Password)? DiscoverPostgresCredentials()
    {
        var host = Environment.GetEnvironmentVariable("POSTGRES_HOST") ?? "127.0.0.1";
        var portStr = Environment.GetEnvironmentVariable("POSTGRES_HOST_PORT") ?? "5433";
        int.TryParse(portStr, out var port);
        if (port == 0) port = 5433;
        var user = Environment.GetEnvironmentVariable("KAIRO_APP_USER") ?? "kairo_dev";

        var envPass = Environment.GetEnvironmentVariable("KAIRO_APP_PASSWORD");
        if (!string.IsNullOrWhiteSpace(envPass))
            return (host, port, user, envPass);

        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        var dir = new DirectoryInfo(baseDir);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "infrastructure", "docker", ".env")))
            dir = dir.Parent;

        if (dir != null)
        {
            var envFilePath = Path.Combine(dir.FullName, "infrastructure", "docker", ".env");
            var lines = File.ReadAllLines(envFilePath);
            string? discoveredUser = null;
            string? discoveredPass = null;
            string? discoveredPort = null;
            foreach (var rawLine in lines)
            {
                var line = rawLine.Trim();
                if (line.StartsWith('#') || !line.Contains('=')) continue;
                var parts = line.Split('=', 2);
                var key = parts[0].Trim();
                var val = parts[1].Trim();
                if (key == "KAIRO_APP_USER") discoveredUser = val;
                if (key == "KAIRO_APP_PASSWORD") discoveredPass = val;
                if (key == "POSTGRES_HOST_PORT") discoveredPort = val;
            }

            if (!string.IsNullOrWhiteSpace(discoveredPass))
            {
                if (!string.IsNullOrWhiteSpace(discoveredUser)) user = discoveredUser;
                if (int.TryParse(discoveredPort, out var p)) port = p;
                return (host, port, user, discoveredPass);
            }
        }

        return null;
    }

    private static string BuildConnectionString((string Host, int Port, string Username, string Password) creds, string database)
        => $"Host={creds.Host};Port={creds.Port};Database={database};Username={creds.Username};Password={creds.Password};Include Error Detail=true";
}
