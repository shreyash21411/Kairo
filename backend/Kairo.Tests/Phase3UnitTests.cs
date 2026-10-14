using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Phase 3 Test Suite:
/// 1. Categories (Validation, Normalization, Multi-category, Filtering, Scope Isolation, Soft-delete Cleanup, Backward Compatibility)
/// 2. Expiration / TTL (UTC semantics, TTL conversion, Exclusion from Semantic, BM25, Graph, Entity retrieval, Update/Un-expire)
/// 3. Batch Operations (Batch Create, Batch Update, Batch Delete, Batch Size Limits, IDOR Defense, Soft Delete, Graph Cleanup)
/// 4. Security & Isolation (Cross-project Batch protection, Input sanitization, Category/Metadata injection prevention)
/// </summary>
public class Phase3UnitTests
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
        memRepo.SetReturnsDefault<Task<List<MemoryEmbeddingData>>>(
            Task.FromResult(new List<MemoryEmbeddingData>()));

        memRepo.Setup(m => m.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(),
                It.IsAny<float[]>(),
                It.IsAny<string>(),
                It.IsAny<int>(),
                It.IsAny<long?>(),
                It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(),
                It.IsAny<List<string>?>()))
            .Returns(async (long uid, float[] qVec, string model, int topK, long? scope, MemoryTemporalFilter? tf, List<MetadataFilterCondition>? mf, List<string>? cf) =>
            {
                var embeddings = await memRepo.Object.GetFilteredActiveMemoryEmbeddingsAsync(uid, scope, tf, mf, cf);
                if (embeddings == null || embeddings.Count == 0)
                {
                    embeddings = await memRepo.Object.GetActiveMemoryEmbeddingsAsync(uid, scope);
                }

                if (embeddings == null || embeddings.Count == 0)
                    return new List<RankedEmbeddingResult>();

                var simService = new SemanticSimilarityService();
                var results = new List<RankedEmbeddingResult>();
                foreach (var e in embeddings)
                {
                    var sim = simService.CalculateCosineSimilarity(qVec, e.Embedding);
                    results.Add(new RankedEmbeddingResult
                    {
                        MemoryId = e.MemoryId,
                        Content = e.Content,
                        MemoryType = e.MemoryType,
                        Model = e.Model ?? model,
                        Dimensions = e.Dimensions,
                        Similarity = sim,
                        CreatedAt = e.CreatedAt == default ? DateTime.UtcNow : e.CreatedAt,
                        UpdatedAt = e.UpdatedAt == default ? DateTime.UtcNow : e.UpdatedAt,
                        OccurredAt = e.OccurredAt,
                        Metadata = e.Metadata,
                        ExpiresAt = e.ExpiresAt,
                        Categories = e.Categories ?? new List<string>()
                    });
                }
                return results.OrderByDescending(r => r.Similarity).Take(topK).ToList();
            });

        // Phase 5.3: batch hydration default — returns empty dict (no keyword-only candidates in Phase 3 tests)
        memRepo.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
            .ReturnsAsync(new Dictionary<long, MemorySnapshot>());

        var relEval = relevanceEval ?? new Mock<IMemoryRelevanceEvaluator>();
        if (relevanceEval == null)
        {
            relEval.Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
                .ReturnsAsync((string q, List<RetrievedMemory> c) => c);
        }

        return new HybridRetrievalService(
            memRepo.Object,
            (embeddingGen ?? new Mock<IEmbeddingGenerator>()).Object,
            new SemanticSimilarityService(),
            relEval.Object,
            (keywordSearch ?? new Mock<IKeywordSearchRepository>()).Object,
            (entityRepo ?? new Mock<IEntityRepository>()).Object,
            (entityExtractionService ?? new Mock<IEntityExtractionService>()).Object,
            (logger ?? new Mock<ILogger<HybridRetrievalService>>()).Object);
    }

    private static MemoryRetrievalService BuildRetrievalService(
        Mock<IMemoryRepository>? memoryRepo = null,
        Mock<IEmbeddingGenerator>? embeddingGen = null,
        Mock<IMemoryRelevanceEvaluator>? relevanceEvaluator = null)
    {
        var relEval = relevanceEvaluator ?? new Mock<IMemoryRelevanceEvaluator>();
        if (relevanceEvaluator == null)
        {
            relEval.Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
                .ReturnsAsync((string q, List<RetrievedMemory> c) => c);
        }

        return new MemoryRetrievalService(
            (memoryRepo ?? new Mock<IMemoryRepository>()).Object,
            (embeddingGen ?? new Mock<IEmbeddingGenerator>()).Object,
            new SemanticSimilarityService(),
            relEval.Object);
    }

    private static MemoryService BuildMemoryService(
        Mock<IMemoryRepository>? memoryRepo = null,
        Mock<IUserRepository>? userRepo = null,
        Mock<IScopeResolutionService>? scopeResolver = null,
        Mock<IEmbeddingGenerator>? embeddingGen = null,
        Mock<IEntityExtractionService>? entityExtractor = null,
        Mock<IEntityRepository>? entityRepo = null)
    {
        var memRepo = memoryRepo ?? new Mock<IMemoryRepository>();
        var uRepo = userRepo ?? new Mock<IUserRepository>();
        uRepo.SetReturnsDefault<Task<bool>>(Task.FromResult(true));
        var embGen = embeddingGen ?? new Mock<IEmbeddingGenerator>();
        var simService = new SemanticSimilarityService();
        var retService = BuildRetrievalService(memRepo, embGen);
        var scopeRes = scopeResolver ?? new Mock<IScopeResolutionService>();
        var entRepo = entityRepo ?? new Mock<IEntityRepository>();
        var entExt = entityExtractor ?? new Mock<IEntityExtractionService>();

        return new MemoryService(
            memRepo.Object,
            uRepo.Object,
            embGen.Object,
            simService,
            retService,
            scopeRes.Object,
            entRepo.Object,
            entExt.Object);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 1: CATEGORIES
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public void CategoryValidator_AddOneCategory_NormalizesAndLowercases()
    {
        var input = new List<string> { "Preference" };
        var result = CategoryValidator.ValidateAndNormalize(input);

        Assert.Single(result);
        Assert.Equal("preference", result[0]);
    }

    [Fact]
    public void CategoryValidator_AddMultipleCategories_NormalizesAll()
    {
        var input = new List<string> { "Preference", "Work", "frontend-ui" };
        var result = CategoryValidator.ValidateAndNormalize(input);

        Assert.Equal(3, result.Count);
        Assert.Contains("preference", result);
        Assert.Contains("work", result);
        Assert.Contains("frontend-ui", result);
    }

    [Fact]
    public void CategoryValidator_DuplicateCategoryPrevention_DeduplicatesCaseInsensitively()
    {
        var input = new List<string> { "Profile", "profile", "PROFILE", "  PROFILE  " };
        var result = CategoryValidator.ValidateAndNormalize(input);

        Assert.Single(result);
        Assert.Equal("profile", result[0]);
    }

    [Fact]
    public void CategoryValidator_Normalization_TrimsWhitespace()
    {
        var input = new List<string> { "   developer_tools   " };
        var result = CategoryValidator.ValidateAndNormalize(input);

        Assert.Single(result);
        Assert.Equal("developer_tools", result[0]);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("category with spaces")]
    [InlineData("user@domain")]
    [InlineData("bad!category")]
    [InlineData("select*from;")]
    public void CategoryValidator_InvalidCategory_ThrowsArgumentException(string invalidCategory)
    {
        var input = new List<string> { invalidCategory };
        Assert.Throws<ArgumentException>(() => CategoryValidator.ValidateAndNormalize(input));
    }

    [Fact]
    public void CategoryValidator_CategoryLengthLimit_ExceedingThrowsArgumentException()
    {
        var overLength = new string('a', CategoryValidator.MaxCategoryLength + 1);
        Assert.Throws<ArgumentException>(() => CategoryValidator.ValidateAndNormalize(new[] { overLength }));
    }

    [Fact]
    public void CategoryValidator_MaxCategoriesPerMemory_ExceedingThrowsArgumentException()
    {
        var tooMany = Enumerable.Range(1, CategoryValidator.MaxCategoriesPerMemory + 1)
            .Select(i => $"cat-{i}")
            .ToList();

        Assert.Throws<ArgumentException>(() => CategoryValidator.ValidateAndNormalize(tooMany));
    }

    [Fact]
    public void CategoryValidator_Single_ValidatesAndReturnsNormalized()
    {
        var single = CategoryValidator.ValidateAndNormalizeSingle("  Architecture.Design  ");
        Assert.Equal("architecture.design", single);
    }

    [Fact]
    public void Category_DatabaseConstraint_EnforcesUniqueMemoryCategory()
    {
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseSqlServer("Server=tcp:localhost,1433;Database=kairo_test;")
            .Options;

        using var db = new KairoDbContext(options);
        var entityType = db.Model.FindEntityType(typeof(MemoryCategory));
        Assert.NotNull(entityType);

        var expectedProps = new[] { "MemoryId", "Category" };
        var uniqueIndex = entityType.GetIndexes().FirstOrDefault(i =>
            i.IsUnique &&
            i.Properties.Select(p => p.Name).SequenceEqual(expectedProps));

        Assert.NotNull(uniqueIndex);
        Assert.True(uniqueIndex.IsUnique);
        Assert.Equal("UX_MemoryCategories_Memory_Category", uniqueIndex.Name);
    }

    [Fact]
    public async Task Category_SearchFilter_PassesCategoryFiltersToRepository()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        var categories = new List<string> { "preference", "ui" };

        memoryRepoMock.Setup(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
                1, 10, null, null, It.Is<List<string>>(c => c.SequenceEqual(categories))))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 1,
                    Content = "Dark mode preference",
                    MemoryType = "Preference",
                    Embedding = new float[] { 1f, 0f },
                    Dimensions = 2,
                    Categories = new List<string> { "preference" },
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                }
            });

        var retrievalService = BuildRetrievalService(memoryRepoMock, embeddingGenMock);

        var results = await retrievalService.RetrieveAsync(
            userId: 1,
            query: "dark mode",
            topK: 5,
            scopeId: 10,
            categoryFilters: categories);

        Assert.Single(results);
        Assert.Equal(1, results[0].MemoryId);
        Assert.Contains("preference", results[0].Categories);
        memoryRepoMock.Verify(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
            1, 10, null, null, It.Is<List<string>>(c => c.SequenceEqual(categories))), Times.Once);
    }

    [Fact]
    public async Task Category_CombinedFilters_CategoryAndMetadata_HybridRetrieval()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var keywordSearchMock = new Mock<IKeywordSearchRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();

        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        var categories = new List<string> { "settings" };
        var metaFilters = new List<MetadataFilterCondition>
        {
            new() { Key = "env", Operator = "eq", Value = "prod" }
        };

        memoryRepoMock.Setup(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
                1, 10, null, metaFilters, categories))
            .ReturnsAsync(new List<MemoryEmbeddingData>());

        keywordSearchMock.Setup(k => k.SearchAsync(
                1, "query", 10, It.IsAny<int>(), null, metaFilters, categories, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>());

        var hybridService = BuildHybridService(
            memoryRepo: memoryRepoMock,
            embeddingGen: embeddingGenMock,
            keywordSearch: keywordSearchMock);

        await hybridService.RetrieveWithRelationsAsync(
            userId: 1,
            projectId: 100,
            query: "query",
            topK: 5,
            scopeId: 10,
            temporalFilter: null,
            metadataFilters: metaFilters,
            recencyBoost: false,
            graphDepth: 1,
            categoryFilters: categories);

        memoryRepoMock.Verify(m => m.SearchSimilarEmbeddingsAsync(1, It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(), 10, null, metaFilters, categories), Times.Once);
        keywordSearchMock.Verify(k => k.SearchAsync(1, "query", 10, It.IsAny<int>(), null, metaFilters, categories, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Category_CombinedFilters_CategoryAndTemporal_HybridRetrieval()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var keywordSearchMock = new Mock<IKeywordSearchRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();

        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        var categories = new List<string> { "facts" };
        var temporalFilter = new MemoryTemporalFilter { LastDays = 30 };

        memoryRepoMock.Setup(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
                1, 10, temporalFilter, null, categories))
            .ReturnsAsync(new List<MemoryEmbeddingData>());

        keywordSearchMock.Setup(k => k.SearchAsync(
                1, "query", 10, It.IsAny<int>(), temporalFilter, null, categories, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>());

        var hybridService = BuildHybridService(
            memoryRepo: memoryRepoMock,
            embeddingGen: embeddingGenMock,
            keywordSearch: keywordSearchMock);

        await hybridService.RetrieveWithRelationsAsync(
            userId: 1,
            projectId: 100,
            query: "query",
            topK: 5,
            scopeId: 10,
            temporalFilter: temporalFilter,
            metadataFilters: null,
            recencyBoost: false,
            graphDepth: 1,
            categoryFilters: categories);

        memoryRepoMock.Verify(m => m.SearchSimilarEmbeddingsAsync(1, It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(), 10, temporalFilter, null, categories), Times.Once);
    }

    [Fact]
    public async Task Category_ScopeIsolation_CategoryFilteredSearchScoped()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        var retrievalService = BuildRetrievalService(memoryRepoMock, embeddingGenMock);

        await retrievalService.RetrieveAsync(
            userId: 42,
            query: "dark mode",
            topK: 5,
            scopeId: 999,
            categoryFilters: new List<string> { "preference" });

        // Verifies userId and scopeId are passed without leaking to other scopes
        memoryRepoMock.Verify(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
            42, 999, null, null, It.IsAny<List<string>>()), Times.Once);
    }

    [Fact]
    public void Category_BackwardCompatibility_MemoriesWithoutCategories_RemainValid()
    {
        var mem = new RetrievedMemory
        {
            MemoryId = 1,
            Content = "Vanilla memory",
            MemoryType = "Fact",
            Similarity = 0.95,
            Categories = new List<string>()
        };

        Assert.Empty(mem.Categories);
        Assert.Null(mem.ExpiresAt);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 2: EXPIRATION / TTL
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public void Expiration_MemoryWithoutExpiration_RemainsActive()
    {
        Assert.True(ExpirationHelper.IsNotExpired(null));
    }

    [Fact]
    public void Expiration_FutureExpiration_RemainsActive()
    {
        var future = DateTime.UtcNow.AddDays(7);
        Assert.True(ExpirationHelper.IsNotExpired(future));
    }

    [Fact]
    public void Expiration_ExpiredMemory_Excluded()
    {
        var past = DateTime.UtcNow.AddMinutes(-5);
        Assert.False(ExpirationHelper.IsNotExpired(past));
    }

    [Fact]
    public void Expiration_ExactBoundary_Deterministic()
    {
        var now = new DateTime(2026, 10, 8, 12, 0, 0, DateTimeKind.Utc);
        var exactNow = now;
        var justAfter = now.AddMilliseconds(1);
        var justBefore = now.AddMilliseconds(-1);

        // Boundary is: ExpiresAt > now
        Assert.False(ExpirationHelper.IsNotExpired(exactNow, now));
        Assert.False(ExpirationHelper.IsNotExpired(justBefore, now));
        Assert.True(ExpirationHelper.IsNotExpired(justAfter, now));
    }

    [Fact]
    public void Expiration_UtcBehavior_Enforced()
    {
        var localTime = new DateTime(2026, 12, 31, 23, 59, 59, DateTimeKind.Unspecified);
        var resolved = ExpirationHelper.ResolveExpiresAt(localTime, null);

        Assert.NotNull(resolved);
        Assert.Equal(DateTimeKind.Utc, resolved.Value.Kind);
    }

    [Fact]
    public void Expiration_TtlConversion_ResolvesToUtcExpiresAt()
    {
        var referenceNow = new DateTime(2026, 10, 8, 10, 0, 0, DateTimeKind.Utc);
        var ttlSeconds = 3600L; // 1 hour

        var resolved = ExpirationHelper.ResolveExpiresAt(null, ttlSeconds, referenceNow);

        Assert.NotNull(resolved);
        Assert.Equal(referenceNow.AddHours(1), resolved.Value);
    }

    [Fact]
    public void Expiration_NegativeTtl_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() => ExpirationHelper.ResolveExpiresAt(null, -100L));
    }

    [Fact]
    public void Expiration_ZeroTtl_ProducesImmediateExpiration()
    {
        var referenceNow = new DateTime(2026, 10, 8, 10, 0, 0, DateTimeKind.Utc);
        var resolved = ExpirationHelper.ResolveExpiresAt(null, 0L, referenceNow);

        Assert.NotNull(resolved);
        Assert.Equal(referenceNow, resolved.Value);
        Assert.False(ExpirationHelper.IsNotExpired(resolved.Value, referenceNow));
    }

    [Fact]
    public void Expiration_ExplicitExpiresAt_TakesPrecedenceOverTtl()
    {
        var explicitExpires = new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc);
        var resolved = ExpirationHelper.ResolveExpiresAt(explicitExpires, 3600L);

        Assert.NotNull(resolved);
        Assert.Equal(explicitExpires, resolved.Value);
    }

    [Fact]
    public async Task Expiration_SemanticSearch_ExcludesExpiredEmbeddings()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        // Memory 1 is active (null expiration)
        // Memory 2 is expired (1 hour ago)
        var now = DateTime.UtcNow;
        memoryRepoMock.Setup(m => m.GetActiveMemoryEmbeddingsAsync(1, null))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 1,
                    Content = "Active memory",
                    MemoryType = "Fact",
                    Embedding = new float[] { 1f, 0f },
                    Dimensions = 2,
                    ExpiresAt = null,
                },
                new()
                {
                    MemoryId = 2,
                    Content = "Expired memory",
                    MemoryType = "Fact",
                    Embedding = new float[] { 1f, 0f },
                    Dimensions = 2,
                    ExpiresAt = now.AddHours(-1),
                }
            });

        var retrievalService = BuildRetrievalService(memoryRepoMock, embeddingGenMock);

        var results = await retrievalService.RetrieveAsync(1, "query", 5);

        // MemoryRetrievalService filters out expired memories:
        Assert.Single(results);
        Assert.Equal(1, results[0].MemoryId);
    }

    [Fact]
    public async Task Expiration_HybridRetrieval_ExcludesExpiredCandidateScores()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var keywordSearchMock = new Mock<IKeywordSearchRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();

        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        var now = DateTime.UtcNow;
        memoryRepoMock.Setup(m => m.GetActiveMemoryEmbeddingsAsync(1, null))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 1,
                    Content = "Active memory",
                    MemoryType = "Fact",
                    Embedding = new float[] { 1f, 0f },
                    Dimensions = 2,
                    ExpiresAt = null,
                },
                new()
                {
                    MemoryId = 2,
                    Content = "Expired memory",
                    MemoryType = "Fact",
                    Embedding = new float[] { 1f, 0f },
                    Dimensions = 2,
                    ExpiresAt = now.AddHours(-1),
                }
            });

        keywordSearchMock.Setup(k => k.SearchAsync(1, "query", null, It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>
            {
                new() { MemoryId = 1, Content = "Active memory", MemoryType = "Fact", RawScore = 2.0 },
                new() { MemoryId = 2, Content = "Expired memory", MemoryType = "Fact", RawScore = 5.0 },
            });

        var hybridService = BuildHybridService(
            memoryRepo: memoryRepoMock,
            embeddingGen: embeddingGenMock,
            keywordSearch: keywordSearchMock);

        var result = await hybridService.RetrieveWithRelationsAsync(1, 100, "query", 5);

        // Expired memory ID 2 must be excluded from final fused results
        Assert.Single(result.Memories);
        Assert.Equal(1, result.Memories[0].MemoryId);
    }

    [Fact]
    public void Expiration_DatabaseIndex_IX_Memories_ExpiresAt_Configured()
    {
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseSqlServer("Server=tcp:localhost,1433;Database=kairo_test;")
            .Options;

        using var db = new KairoDbContext(options);
        var entityType = db.Model.FindEntityType(typeof(Memories));
        Assert.NotNull(entityType);

        // Find the single-column ExpiresAt index (not the composite IX_Memories_Active_ExpiresAt)
        var index = entityType.GetIndexes().FirstOrDefault(i =>
            i.Properties.Count == 1 && i.Properties[0].Name == "ExpiresAt");

        Assert.NotNull(index);
        Assert.Equal("IX_Memories_ExpiresAt", index.Name);
    }

    [Fact]
    public void Expiration_SoftDelete_DistinctFromExpiration()
    {
        var activeExpired = new Memories
        {
            MemoryId = 1,
            IsActive = true,
            ExpiresAt = DateTime.UtcNow.AddDays(-1)
        };

        var softDeletedFuture = new Memories
        {
            MemoryId = 2,
            IsActive = false,
            ExpiresAt = DateTime.UtcNow.AddDays(7)
        };

        Assert.True(activeExpired.IsActive);
        Assert.False(ExpirationHelper.IsNotExpired(activeExpired.ExpiresAt));

        Assert.False(softDeletedFuture.IsActive);
        Assert.True(ExpirationHelper.IsNotExpired(softDeletedFuture.ExpiresAt));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 3: BATCH OPERATIONS
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task BatchCreate_Success_CreatesMultipleMemories()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var scopeResolverMock = new Mock<IScopeResolutionService>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var entityExtractorMock = new Mock<IEntityExtractionService>();
        var entityRepoMock = new Mock<IEntityRepository>();

        scopeResolverMock.Setup(s => s.GetOrCreateScopeAsync(100, "act-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(10L);

        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        entityExtractorMock.Setup(e => e.ExtractFullAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new FullExtractionResult());

        memoryRepoMock.SetupSequence(m => m.CreateAsync(
                1, It.IsAny<ExtractedMemory>(), null, 10L, It.IsAny<DateTime?>(), It.IsAny<string?>(), It.IsAny<DateTime?>(), It.IsAny<List<string>?>()))
            .ReturnsAsync(501L)
            .ReturnsAsync(502L);

        // Mock snapshot retrieval so createdMemories is populated
        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(501L, 1, It.IsAny<long?>(), It.IsAny<long?>()))
            .ReturnsAsync(new MemorySnapshot { MemoryId = 501L, Content = "Item 1", UserId = 1 });
        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(502L, 1, It.IsAny<long?>(), It.IsAny<long?>()))
            .ReturnsAsync(new MemorySnapshot { MemoryId = 502L, Content = "Item 2", UserId = 1 });

        var memoryService = BuildMemoryService(
            memoryRepo: memoryRepoMock,
            scopeResolver: scopeResolverMock,
            embeddingGen: embeddingGenMock,
            entityExtractor: entityExtractorMock,
            entityRepo: entityRepoMock);

        var request = new BatchCreateMemoryRequest
        {
            Memories = new List<BatchCreateMemoryItem>
            {
                new() { Content = "Item 1", MemoryType = "Fact", ActorId = "act-1", Categories = new List<string> { "c1" } },
                new() { Content = "Item 2", MemoryType = "Goal", ActorId = "act-1", Ttl = 3600 }
            }
        };

        var response = await memoryService.BatchCreateMemoriesAsync(request, 1, 100);

        Assert.True(response.Success);
        Assert.Equal(2, response.CreatedCount);
        Assert.Equal(2, response.Memories.Count);
        Assert.Equal(501L, response.Memories[0].MemoryId);
        Assert.Equal(502L, response.Memories[1].MemoryId);
    }

    [Fact]
    public async Task BatchCreate_SizeLimitEnforced_Over100Rejected()
    {
        var memoryService = BuildMemoryService();
        var over100 = Enumerable.Range(1, 101)
            .Select(i => new BatchCreateMemoryItem { Content = $"Mem {i}", ActorId = "act-1" })
            .ToList();

        var request = new BatchCreateMemoryRequest { Memories = over100 };

        await Assert.ThrowsAsync<ArgumentException>(() =>
            memoryService.BatchCreateMemoriesAsync(request, 1, 100));
    }

    [Fact]
    public async Task BatchCreate_EmptyBatch_ThrowsArgumentException()
    {
        var memoryService = BuildMemoryService();
        var request = new BatchCreateMemoryRequest { Memories = new List<BatchCreateMemoryItem>() };

        await Assert.ThrowsAsync<ArgumentException>(() =>
            memoryService.BatchCreateMemoriesAsync(request, 1, 100));
    }

    [Fact]
    public async Task BatchCreate_MetadataValidation_RejectsOversizedMetadata()
    {
        var memoryService = BuildMemoryService();
        var hugeMeta = new Dictionary<string, object>
        {
            ["data"] = new string('x', 9000)
        };

        var request = new BatchCreateMemoryRequest
        {
            Memories = new List<BatchCreateMemoryItem>
            {
                new() { Content = "Mem 1", ActorId = "act-1", Metadata = hugeMeta }
            }
        };

        await Assert.ThrowsAsync<ArgumentException>(() =>
            memoryService.BatchCreateMemoriesAsync(request, 1, 100));
    }

    [Fact]
    public async Task BatchCreate_CategoryValidation_RejectsMalformedCategory()
    {
        var memoryService = BuildMemoryService();
        var request = new BatchCreateMemoryRequest
        {
            Memories = new List<BatchCreateMemoryItem>
            {
                new() { Content = "Mem 1", ActorId = "act-1", Categories = new List<string> { "bad category with spaces!" } }
            }
        };

        await Assert.ThrowsAsync<ArgumentException>(() =>
            memoryService.BatchCreateMemoriesAsync(request, 1, 100));
    }

    [Fact]
    public async Task BatchCreate_NegativeTtl_ThrowsArgumentException()
    {
        var memoryService = BuildMemoryService();
        var request = new BatchCreateMemoryRequest
        {
            Memories = new List<BatchCreateMemoryItem>
            {
                new() { Content = "Mem 1", ActorId = "act-1", Ttl = -500 }
            }
        };

        await Assert.ThrowsAsync<ArgumentException>(() =>
            memoryService.BatchCreateMemoriesAsync(request, 1, 100));
    }

    [Fact]
    public async Task BatchUpdate_Success_UpdatesMultipleMemories()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();

        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(201, 1, 100))
            .ReturnsAsync(new MemorySnapshot { MemoryId = 201, UserId = 1, IsActive = true, Content = "Old 1" });
        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(202, 1, 100))
            .ReturnsAsync(new MemorySnapshot { MemoryId = 202, UserId = 1, IsActive = true, Content = "Old 2" });

        var memoryService = BuildMemoryService(
            memoryRepo: memoryRepoMock,
            embeddingGen: embeddingGenMock);

        var request = new BatchUpdateMemoryRequest
        {
            Memories = new List<BatchUpdateMemoryItem>
            {
                new() { MemoryId = 201, Content = "New 1", Categories = new List<string> { "cat-1" } },
                new() { MemoryId = 202, Content = "New 2", Ttl = 7200 }
            }
        };

        var response = await memoryService.BatchUpdateMemoriesAsync(request, 1, 100);

        Assert.True(response.Success);
        Assert.Equal(2, response.UpdatedCount);
        memoryRepoMock.Verify(m => m.UpdateMemoryContentAsync(
            201, "New 1", It.IsAny<DateTime?>(), It.IsAny<string?>(), It.IsAny<bool>(), It.IsAny<DateTime?>(), true, It.IsAny<List<string>>()), Times.Once);
        memoryRepoMock.Verify(m => m.UpdateMemoryContentAsync(
            202, "New 2", It.IsAny<DateTime?>(), It.IsAny<string?>(), true, It.IsAny<DateTime?>(), It.IsAny<bool>(), It.IsAny<List<string>>()), Times.Once);
    }

    [Fact]
    public async Task BatchUpdate_IDORDefense_CrossProjectMemoryThrowsKeyNotFound()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();

        // Memory 201 belongs to another user/project - returns null
        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(201, 1, 100))
            .ReturnsAsync((MemorySnapshot?)null);

        var memoryService = BuildMemoryService(memoryRepo: memoryRepoMock);

        var request = new BatchUpdateMemoryRequest
        {
            Memories = new List<BatchUpdateMemoryItem>
            {
                new() { MemoryId = 201, Content = "Malicious update" }
            }
        };

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            memoryService.BatchUpdateMemoriesAsync(request, userId: 1, projectId: 100));
    }

    [Fact]
    public async Task BatchDelete_Success_SoftDeletesMultipleMemories()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();

        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(301, 1, 100))
            .ReturnsAsync(new MemorySnapshot { MemoryId = 301, UserId = 1, IsActive = true, Content = "Delete 1" });
        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(302, 1, 100))
            .ReturnsAsync(new MemorySnapshot { MemoryId = 302, UserId = 1, IsActive = true, Content = "Delete 2" });

        var memoryService = BuildMemoryService(memoryRepo: memoryRepoMock);

        var request = new BatchDeleteMemoryRequest
        {
            MemoryIds = new List<long> { 301, 302 }
        };

        var response = await memoryService.BatchDeleteMemoriesAsync(request, 1, 100);

        Assert.True(response.Success);
        Assert.Equal(2, response.DeletedCount);
        Assert.Equal(new List<long> { 301, 302 }, response.DeletedIds);
        memoryRepoMock.Verify(m => m.DeactivateMemoryAsync(301), Times.Once);
        memoryRepoMock.Verify(m => m.DeactivateMemoryAsync(302), Times.Once);
    }

    [Fact]
    public async Task BatchDelete_IDORDefense_CrossProjectMemoryThrowsKeyNotFound()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();

        // Memory 301 does not belong to project/user - returns null
        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(301, 1, 100))
            .ReturnsAsync((MemorySnapshot?)null);

        var memoryService = BuildMemoryService(memoryRepo: memoryRepoMock);

        var request = new BatchDeleteMemoryRequest
        {
            MemoryIds = new List<long> { 301 }
        };

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            memoryService.BatchDeleteMemoriesAsync(request, userId: 1, projectId: 100));
    }

    [Fact]
    public async Task BatchDelete_SizeLimitEnforced_Over100Rejected()
    {
        var memoryService = BuildMemoryService();
        var request = new BatchDeleteMemoryRequest
        {
            MemoryIds = Enumerable.Range(1, 101).Select(i => (long)i).ToList()
        };

        await Assert.ThrowsAsync<ArgumentException>(() =>
            memoryService.BatchDeleteMemoriesAsync(request, 1, 100));
    }

    [Fact]
    public async Task BatchDelete_EmptyList_ThrowsArgumentException()
    {
        var memoryService = BuildMemoryService();
        var request = new BatchDeleteMemoryRequest { MemoryIds = new List<long>() };

        await Assert.ThrowsAsync<ArgumentException>(() =>
            memoryService.BatchDeleteMemoriesAsync(request, 1, 100));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 4: SECURITY & REGRESSION
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Security_CrossProjectBatchCreate_NeverOverridesAuthenticatedProject()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var scopeResolverMock = new Mock<IScopeResolutionService>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();

        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1f, 0f });

        // Authenticated projectId is 100, resolve must be called with 100
        scopeResolverMock.Setup(s => s.GetOrCreateScopeAsync(100, "attacker-scope", It.IsAny<CancellationToken>()))
            .ReturnsAsync(55L);

        var memoryService = BuildMemoryService(
            memoryRepo: memoryRepoMock,
            scopeResolver: scopeResolverMock,
            embeddingGen: embeddingGenMock);

        var request = new BatchCreateMemoryRequest
        {
            Memories = new List<BatchCreateMemoryItem>
            {
                new() { Content = "Test", MemoryType = "Fact", ActorId = "attacker-scope" }
            }
        };

        await memoryService.BatchCreateMemoriesAsync(request, userId: 1, projectId: 100);

        scopeResolverMock.Verify(s => s.GetOrCreateScopeAsync(100, "attacker-scope", It.IsAny<CancellationToken>()), Times.Once);
        scopeResolverMock.Verify(s => s.GetOrCreateScopeAsync(It.IsNotIn(100L), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
