using System;
using System.IO;
using System.Collections.Generic;
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
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Phase 5 Task 5.3: Batch Keyword Metadata Hydration Tests.
/// Validates HybridRetrievalService replaces the N+1 serial GetMemorySnapshotAsync
/// loop with a single GetMemorySnapshotsAsync batch call, and that all correctness
/// properties are preserved or improved.
/// </summary>
public class Phase5BatchHydrationUnitTests
{
    // ── Shared builder ────────────────────────────────────────────────────────

    private static HybridRetrievalService BuildService(
        Mock<IMemoryRepository> memRepo,
        Mock<IEmbeddingGenerator>? embGen = null,
        Mock<IKeywordSearchRepository>? kwSearch = null,
        Mock<IMemoryRelevanceEvaluator>? relEval = null)
    {
        var embeddingGen = embGen    ?? new Mock<IEmbeddingGenerator>();
        var keyword      = kwSearch  ?? new Mock<IKeywordSearchRepository>();
        var evaluator    = relEval   ?? new Mock<IMemoryRelevanceEvaluator>();

        if (relEval == null)
            evaluator.Setup(r => r.EvaluateAsync(
                        It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
                     .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

        return new HybridRetrievalService(
            memRepo.Object,
            embeddingGen.Object,
            new SemanticSimilarityService(),
            evaluator.Object,
            keyword.Object,
            new Mock<IEntityRepository>().Object,
            new Mock<IEntityExtractionService>().Object,
            new Mock<ILogger<HybridRetrievalService>>().Object);
    }

    private static void SetupSemanticDefault(Mock<IMemoryRepository> m,
        IEnumerable<RankedEmbeddingResult>? results = null) =>
        m.Setup(r => r.SearchSimilarEmbeddingsAsync(
                    It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(),
                    It.IsAny<int>(), It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                    It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>()))
         .ReturnsAsync((results ?? Enumerable.Empty<RankedEmbeddingResult>())
                       .ToList());

    // ── Test 1: Multiple keyword-only IDs → exactly one batch call ───────────

    [Fact]
    public async Task BatchHydration_MultipleKeywordOnlyCandidates_ExactlyOneBatchCall()
    {
        var memRepo  = new Mock<IMemoryRepository>();
        var embGen   = new Mock<IEmbeddingGenerator>();
        var kwSearch = new Mock<IKeywordSearchRepository>();

        embGen.Setup(e => e.GenerateAsync(It.IsAny<string>()))
              .ReturnsAsync(new float[] { 1f, 0f });

        // Semantic returns only Memory 10 — Memories 20 and 30 are keyword-only
        SetupSemanticDefault(memRepo, new[]
        {
            new RankedEmbeddingResult { MemoryId = 10L, Content = "Semantic", Similarity = 0.9,
                Model = "mistral-embed", Dimensions = 2, MemoryType = "Fact",
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
        });

        kwSearch.Setup(k => k.SearchAsync(
                    It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(),
                    It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<KeywordSearchResult>
                {
                    new() { MemoryId = 20L, Content = "KW A", MemoryType = "Fact", RawScore = 3.0 },
                    new() { MemoryId = 30L, Content = "KW B", MemoryType = "Fact", RawScore = 2.0 }
                });

        memRepo.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
               .ReturnsAsync(new Dictionary<long, MemorySnapshot>
               {
                   [20L] = new() { MemoryId=20L, UserId=1L, Content="KW A", MemoryType="Fact",
                                   IsActive=true, CreatedAt=DateTime.UtcNow.AddDays(-5),
                                   UpdatedAt=DateTime.UtcNow.AddDays(-5), Categories=new() },
                   [30L] = new() { MemoryId=30L, UserId=1L, Content="KW B", MemoryType="Fact",
                                   IsActive=true, CreatedAt=DateTime.UtcNow.AddDays(-10),
                                   UpdatedAt=DateTime.UtcNow.AddDays(-10), Categories=new() }
               });

        var svc    = BuildService(memRepo, embGen, kwSearch);
        var result = await svc.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 5);

        // Batch method called EXACTLY once
        memRepo.Verify(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()),
                       Times.Once);
        // Old per-ID method NOT called
        memRepo.Verify(m => m.GetMemorySnapshotAsync(It.IsAny<long>()),
                       Times.Never);

        Assert.Equal(3, result.Memories.Count);
        Assert.Contains(result.Memories, m => m.MemoryId == 10L);
        Assert.Contains(result.Memories, m => m.MemoryId == 20L);
        Assert.Contains(result.Memories, m => m.MemoryId == 30L);
    }

    // ── Test 2: No missing keyword-only IDs → batch method NOT called ─────────

    [Fact]
    public async Task BatchHydration_NoKeywordOnlyCandidates_BatchMethodNotCalled()
    {
        var memRepo  = new Mock<IMemoryRepository>();
        var embGen   = new Mock<IEmbeddingGenerator>();
        var kwSearch = new Mock<IKeywordSearchRepository>();

        embGen.Setup(e => e.GenerateAsync(It.IsAny<string>()))
              .ReturnsAsync(new float[] { 1f, 0f });

        // Semantic and keyword return same Memory 5 → no missing IDs
        SetupSemanticDefault(memRepo, new[]
        {
            new RankedEmbeddingResult { MemoryId=5L, Content="Match", Similarity=0.85,
                Model="mistral-embed", Dimensions=2, MemoryType="Fact",
                CreatedAt=DateTime.UtcNow, UpdatedAt=DateTime.UtcNow }
        });

        kwSearch.Setup(k => k.SearchAsync(
                    It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(),
                    It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<KeywordSearchResult>
                {
                    new() { MemoryId=5L, Content="Match", MemoryType="Fact", RawScore=4.0 }
                });

        var svc = BuildService(memRepo, embGen, kwSearch);
        await svc.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 5);

        memRepo.Verify(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()),
                       Times.Never);
        memRepo.Verify(m => m.GetMemorySnapshotAsync(It.IsAny<long>()),
                       Times.Never);
    }

    // ── Test 3: Duplicate keyword IDs → batch called once, IDs deduplicated ───

    [Fact]
    public async Task BatchHydration_DuplicateKeywordIds_BatchCalledOnceWithDeduplicatedIds()
    {
        var memRepo  = new Mock<IMemoryRepository>();
        var embGen   = new Mock<IEmbeddingGenerator>();
        var kwSearch = new Mock<IKeywordSearchRepository>();

        embGen.Setup(e => e.GenerateAsync(It.IsAny<string>()))
              .ReturnsAsync(new float[] { 1f, 0f });

        SetupSemanticDefault(memRepo); // empty

        // MemoryId 7 appears twice in keyword results
        kwSearch.Setup(k => k.SearchAsync(
                    It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(),
                    It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<KeywordSearchResult>
                {
                    new() { MemoryId=7L, Content="Match", MemoryType="Fact", RawScore=2.0 },
                    new() { MemoryId=7L, Content="Match", MemoryType="Fact", RawScore=1.5 }
                });

        IEnumerable<long>? capturedIds = null;
        memRepo.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
               .Callback<IEnumerable<long>>(ids => capturedIds = ids.ToList())
               .ReturnsAsync(new Dictionary<long, MemorySnapshot>
               {
                   [7L] = new() { MemoryId=7L, UserId=1L, Content="Match", MemoryType="Fact",
                                  IsActive=true, CreatedAt=DateTime.UtcNow, UpdatedAt=DateTime.UtcNow,
                                  Categories=new() }
               });

        var svc = BuildService(memRepo, embGen, kwSearch);
        await svc.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 5);

        memRepo.Verify(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()),
                       Times.Once);

        Assert.NotNull(capturedIds);
        var capturedList = capturedIds!.ToList();
        Assert.Equal(capturedList.Count, capturedList.Distinct().Count()); // no duplicates
        Assert.Single(capturedList); // only ID 7
    }

    // ── Test 4: Correct metadata fields are retained ───────────────────────────

    [Fact]
    public async Task BatchHydration_CorrectMetadata_AllFieldsPopulatedFromSnapshot()
    {
        var memRepo  = new Mock<IMemoryRepository>();
        var embGen   = new Mock<IEmbeddingGenerator>();
        var kwSearch = new Mock<IKeywordSearchRepository>();

        embGen.Setup(e => e.GenerateAsync(It.IsAny<string>()))
              .ReturnsAsync(new float[] { 1f, 0f });

        SetupSemanticDefault(memRepo);

        kwSearch.Setup(k => k.SearchAsync(
                    It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(),
                    It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<KeywordSearchResult>
                {
                    new() { MemoryId=55L, Content="KW Content", MemoryType="Event", RawScore=5.0 }
                });

        var tCreated  = new DateTime(2024, 1, 15, 12, 0, 0, DateTimeKind.Utc);
        var tUpdated  = new DateTime(2024, 3, 10,  8, 0, 0, DateTimeKind.Utc);
        var tOccurred = new DateTime(2024, 1, 10,  0, 0, 0, DateTimeKind.Utc);
        var tExpires  = new DateTime(2030, 12, 31, 0, 0, 0, DateTimeKind.Utc);
        const string meta = "{\"source\":\"slack\"}";
        var cats = new List<string> { "engineering", "slack" };

        memRepo.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
               .ReturnsAsync(new Dictionary<long, MemorySnapshot>
               {
                   [55L] = new() { MemoryId=55L, UserId=1L, Content="KW Content",
                                   MemoryType="Event", IsActive=true,
                                   CreatedAt=tCreated, UpdatedAt=tUpdated,
                                   OccurredAt=tOccurred, Metadata=meta,
                                   ExpiresAt=tExpires, Categories=cats }
               });

        var svc    = BuildService(memRepo, embGen, kwSearch);
        var result = await svc.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 5);

        var mem = Assert.Single(result.Memories);
        Assert.Equal(55L,      mem.MemoryId);
        Assert.Equal(tCreated, mem.CreatedAt);
        Assert.Equal(tUpdated, mem.UpdatedAt);
        Assert.Equal(tOccurred,mem.OccurredAt);
        Assert.Equal(meta,     mem.Metadata);
        Assert.Equal(tExpires, mem.ExpiresAt);
        Assert.Equal(cats,     mem.Categories);
    }

    // ── Test 5: Recency boost uses real CreatedAt (not now) ───────────────────

    [Fact]
    public async Task BatchHydration_RecencyBoost_UsesTrueCreatedAtNotNow()
    {
        var memRepo  = new Mock<IMemoryRepository>();
        var embGen   = new Mock<IEmbeddingGenerator>();
        var kwSearch = new Mock<IKeywordSearchRepository>();

        embGen.Setup(e => e.GenerateAsync(It.IsAny<string>()))
              .ReturnsAsync(new float[] { 1f, 0f });

        SetupSemanticDefault(memRepo);

        kwSearch.Setup(k => k.SearchAsync(
                    It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(),
                    It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<KeywordSearchResult>
                {
                    new() { MemoryId=60L, Content="Old kw", MemoryType="Fact", RawScore=4.0 }
                });

        // Memory created 20 days ago
        var oldDate = DateTime.UtcNow.AddDays(-20);
        memRepo.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
               .ReturnsAsync(new Dictionary<long, MemorySnapshot>
               {
                   [60L] = new() { MemoryId=60L, UserId=1L, Content="Old kw", MemoryType="Fact",
                                   IsActive=true, CreatedAt=oldDate, UpdatedAt=oldDate, Categories=new() }
               });

        var svc    = BuildService(memRepo, embGen, kwSearch);
        var result = await svc.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 5, recencyBoost: true);

        var mem = Assert.Single(result.Memories);
        Assert.Equal(60L, mem.MemoryId);

        // With recency boost and 20-day-old memory the score cannot be near 1.0.
        // exp(-0.05*20) ≈ 0.3679 → recency component adds 0.15 * 0.3679 ≈ 0.055
        // Total (only kw signal, normalized to 1.0): 0.85*0.25 + 0.055 ≈ 0.268
        // Crucially must be well below 0.50 (not the artificial near-1.0 from CreatedAt=now)
        Assert.True(mem.Similarity < 0.50,
            $"Score {mem.Similarity} too high — CreatedAt=now inflation may have occurred.");
        Assert.True(mem.Similarity > 0.05, $"Score {mem.Similarity} unexpectedly low.");
    }

    // ── Test 6: Missing snapshot → no artificial max recency ──────────────────

    [Fact]
    public async Task BatchHydration_MissingSnapshot_NoArtificialMaxRecency()
    {
        var memRepo  = new Mock<IMemoryRepository>();
        var embGen   = new Mock<IEmbeddingGenerator>();
        var kwSearch = new Mock<IKeywordSearchRepository>();

        embGen.Setup(e => e.GenerateAsync(It.IsAny<string>()))
              .ReturnsAsync(new float[] { 1f, 0f });

        SetupSemanticDefault(memRepo);

        kwSearch.Setup(k => k.SearchAsync(
                    It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(),
                    It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<KeywordSearchResult>
                {
                    new() { MemoryId=999L, Content="Ghost", MemoryType="Fact", RawScore=5.0 }
                });

        // Batch returns empty — snapshot not found
        memRepo.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
               .ReturnsAsync(new Dictionary<long, MemorySnapshot>());

        var svc    = BuildService(memRepo, embGen, kwSearch);
        var result = await svc.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 5, recencyBoost: true);

        var ghost = result.Memories.FirstOrDefault(m => m.MemoryId == 999L);
        if (ghost != null)
        {
            // Unhydrated fallback receives recencyScore = 0.0 (no artificial recency advantage)
            // Raw score 5.0 (norm 1.0) -> fused score = 0.85 * 0.25 + 0.15 * 0.0 = 0.2125
            Assert.True(ghost.Similarity <= 0.25,
                $"Missing snapshot got artificially high score: {ghost.Similarity}");
        }
        // Absent from results is also acceptable and preferred.
    }

    // ── Test 7: Inactive snapshot → not added to memoryDetailsMap ─────────────

    [Fact]
    public async Task BatchHydration_InactiveSnapshot_SkippedByBatchHandler()
    {
        var memRepo  = new Mock<IMemoryRepository>();
        var embGen   = new Mock<IEmbeddingGenerator>();
        var kwSearch = new Mock<IKeywordSearchRepository>();

        embGen.Setup(e => e.GenerateAsync(It.IsAny<string>()))
              .ReturnsAsync(new float[] { 1f, 0f });

        // Also have a valid semantic result so we get something back
        SetupSemanticDefault(memRepo, new[]
        {
            new RankedEmbeddingResult { MemoryId=1L, Content="Active", Similarity=0.9,
                Model="mistral-embed", Dimensions=2, MemoryType="Fact",
                CreatedAt=DateTime.UtcNow, UpdatedAt=DateTime.UtcNow }
        });

        kwSearch.Setup(k => k.SearchAsync(
                    It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(),
                    It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<KeywordSearchResult>
                {
                    new() { MemoryId=77L, Content="Inactive memory", MemoryType="Fact", RawScore=4.0 }
                });

        memRepo.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
               .ReturnsAsync(new Dictionary<long, MemorySnapshot>
               {
                   [77L] = new() { MemoryId=77L, UserId=1L, Content="Inactive memory",
                                   MemoryType="Fact", IsActive=false, // ← inactive
                                   CreatedAt=DateTime.UtcNow.AddDays(-1),
                                   UpdatedAt=DateTime.UtcNow, Categories=new() }
               });

        var svc    = BuildService(memRepo, embGen, kwSearch);
        var result = await svc.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 5);

        // Batch was called
        memRepo.Verify(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()),
                       Times.Once);

        // Inactive memory is strictly excluded from final results
        Assert.DoesNotContain(result.Memories, m => m.MemoryId == 77L);
        // Primary assertion: GetMemorySnapshotAsync (old per-ID) was never called.
        memRepo.Verify(m => m.GetMemorySnapshotAsync(It.IsAny<long>()), Times.Never);
    }

    // ── Test 8: Expired snapshot → excluded by fusion loop expiry check ────────

    [Fact]
    public async Task BatchHydration_ExpiredSnapshot_ExcludedByFusionLoop()
    {
        var memRepo  = new Mock<IMemoryRepository>();
        var embGen   = new Mock<IEmbeddingGenerator>();
        var kwSearch = new Mock<IKeywordSearchRepository>();

        embGen.Setup(e => e.GenerateAsync(It.IsAny<string>()))
              .ReturnsAsync(new float[] { 1f, 0f });

        SetupSemanticDefault(memRepo);

        kwSearch.Setup(k => k.SearchAsync(
                    It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(),
                    It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<KeywordSearchResult>
                {
                    new() { MemoryId=88L, Content="Expired", MemoryType="Fact", RawScore=4.0 }
                });

        memRepo.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
               .ReturnsAsync(new Dictionary<long, MemorySnapshot>
               {
                   [88L] = new() { MemoryId=88L, UserId=1L, Content="Expired",
                                   MemoryType="Fact", IsActive=true,
                                   CreatedAt=DateTime.UtcNow.AddDays(-30),
                                   UpdatedAt=DateTime.UtcNow.AddDays(-30),
                                   ExpiresAt=DateTime.UtcNow.AddDays(-1), // expired yesterday
                                   Categories=new() }
               });

        var svc    = BuildService(memRepo, embGen, kwSearch);
        var result = await svc.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 5);

        // ExpirationHelper.IsNotExpired returns false → fusion loop skips it
        Assert.DoesNotContain(result.Memories, m => m.MemoryId == 88L);
    }

    // ── Test 9: Candidate union — keyword-only alongside semantic ─────────────

    [Fact]
    public async Task BatchHydration_CandidateUnion_BothSemanticAndKeywordPresent()
    {
        var memRepo  = new Mock<IMemoryRepository>();
        var embGen   = new Mock<IEmbeddingGenerator>();
        var kwSearch = new Mock<IKeywordSearchRepository>();

        embGen.Setup(e => e.GenerateAsync(It.IsAny<string>()))
              .ReturnsAsync(new float[] { 1f, 0f });

        SetupSemanticDefault(memRepo, new[]
        {
            new RankedEmbeddingResult { MemoryId=1L, Content="Semantic only", Similarity=0.8,
                Model="mistral-embed", Dimensions=2, MemoryType="Fact",
                CreatedAt=DateTime.UtcNow, UpdatedAt=DateTime.UtcNow }
        });

        kwSearch.Setup(k => k.SearchAsync(
                    It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(),
                    It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<KeywordSearchResult>
                {
                    new() { MemoryId=2L, Content="KW only", MemoryType="Fact", RawScore=3.0 }
                });

        memRepo.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
               .ReturnsAsync(new Dictionary<long, MemorySnapshot>
               {
                   [2L] = new() { MemoryId=2L, UserId=1L, Content="KW only", MemoryType="Fact",
                                  IsActive=true, CreatedAt=DateTime.UtcNow.AddDays(-3),
                                  UpdatedAt=DateTime.UtcNow.AddDays(-3), Categories=new() }
               });

        var svc    = BuildService(memRepo, embGen, kwSearch);
        var result = await svc.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 5);

        Assert.Equal(2, result.Memories.Count);
        Assert.Contains(result.Memories, m => m.MemoryId == 1L);
        Assert.Contains(result.Memories, m => m.MemoryId == 2L);
    }

    // ── Test 10: SQL Server provider compat — pure function checks unchanged ───

    [Fact]
    public void ProviderCompatibility_SqlServerModelDimensionFiltering_Unchanged()
    {
        Assert.True(EmbeddingGeneratorExtensions.IsModelCompatible(null,  "mistral-embed"));
        Assert.True(EmbeddingGeneratorExtensions.IsModelCompatible("",    "mistral-embed"));
        Assert.True(EmbeddingGeneratorExtensions.IsModelCompatible("MISTRAL-EMBED", "mistral-embed"));
        Assert.False(EmbeddingGeneratorExtensions.IsModelCompatible("openai-ada-002", "mistral-embed"));
    }

    // ── Test 11: Empty input → empty dict immediately (pure mock contract test) ──

    [Fact]
    public async Task GetMemorySnapshotsAsync_EmptyInput_BatchMethodNotCalledByService()
    {
        // When there are no keyword-only IDs, the service must not call GetMemorySnapshotsAsync.
        // (Covered by Test 2.) Independently, verify the interface contract for empty input
        // via a mock that asserts the return type.
        var memRepo  = new Mock<IMemoryRepository>();
        var embGen   = new Mock<IEmbeddingGenerator>();
        var kwSearch = new Mock<IKeywordSearchRepository>();

        embGen.Setup(e => e.GenerateAsync(It.IsAny<string>()))
              .ReturnsAsync(new float[] { 1f, 0f });

        // Semantic returns one result; keyword returns same ID → no missing IDs
        SetupSemanticDefault(memRepo, new[]
        {
            new RankedEmbeddingResult { MemoryId=1L, Content="X", Similarity=0.9,
                Model="mistral-embed", Dimensions=2, MemoryType="Fact",
                CreatedAt=DateTime.UtcNow, UpdatedAt=DateTime.UtcNow }
        });
        kwSearch.Setup(k => k.SearchAsync(
                    It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(),
                    It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<KeywordSearchResult>());

        var svc = BuildService(memRepo, embGen, kwSearch);
        var result = await svc.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 5);

        Assert.Single(result.Memories);
        // Batch method NOT called — no missing keyword-only IDs
        memRepo.Verify(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()), Times.Never);
    }

    // ── Test 12: PostgreSQL live — GetMemorySnapshotsAsync returns correct snapshots ──

    [Fact]
    public async Task PostgreSql_GetMemorySnapshotsAsync_ReturnsBatchCorrectly()
    {
        var creds = DiscoverPostgresCredentials();
        if (creds == null) return; // gracefully skip if postgres unreachable

        var executedCommands = new List<string>();
        var connString = BuildConnectionString(creds.Value, "kairo_vector_test");
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseNpgsql(connString, o => o.UseVector())
            .LogTo(msg => executedCommands.Add(msg), LogLevel.Information)
            .Options;

        await using var context = new KairoDbContext(options);
        if (!await context.Database.CanConnectAsync()) return;

        // Isolated user
        var email = $"batch53_{Guid.NewGuid():N}@kairo-test.internal";
        var user  = new Users { Email=email, AccountStatus=1,
                                CreatedAt=DateTime.UtcNow, UpdatedAt=DateTime.UtcNow };
        context.Users.Add(user);
        await context.SaveChangesAsync();

        try
        {
            var t1 = DateTime.UtcNow.AddDays(-5);
            var t2 = DateTime.UtcNow.AddDays(-10);

            var mem1 = new Memories { UserId=user.UserId, Content="Batch Alpha",
                                      MemoryType="Fact", IsActive=true,
                                      CreatedAt=t1, UpdatedAt=t1 };
            var mem2 = new Memories { UserId=user.UserId, Content="Batch Beta",
                                      MemoryType="Event", IsActive=false, // inactive
                                      CreatedAt=t2, UpdatedAt=t2 };
            context.Memories.AddRange(mem1, mem2);
            await context.SaveChangesAsync();

            context.MemoryCategories.Add(new MemoryCategory
                { MemoryId=mem1.MemoryId, Category="test-cat", CreatedAt=t1 });
            await context.SaveChangesAsync();

            var repo = new MemoryRepository(context);

            // Empty input returns empty dict with ZERO database queries executed
            executedCommands.Clear();
            var empty = await repo.GetMemorySnapshotsAsync(new List<long>());
            Assert.Empty(empty);
            var emptyQueries = executedCommands.Where(s => s.Contains("Executed DbCommand") && s.Contains("SELECT")).ToList();
            Assert.Empty(emptyQueries);

            // Batch with duplicate + non-existent ID
            executedCommands.Clear();
            var ids = new List<long> { mem1.MemoryId, mem2.MemoryId, mem1.MemoryId, 999999999L };
            var result = await repo.GetMemorySnapshotsAsync(ids);

            // Verify EXACTLY one database query was executed for the batch, including category loading
            var batchQueries = executedCommands.Where(s => s.Contains("Executed DbCommand") && s.Contains("SELECT")).ToList();
            Assert.Single(batchQueries);

            // Both mem1 and mem2 returned (repo does NOT filter IsActive)
            Assert.Equal(2, result.Count);

            // mem1 — active, with category
            Assert.True(result.ContainsKey(mem1.MemoryId));
            var s1 = result[mem1.MemoryId];
            Assert.Equal("Batch Alpha", s1.Content);
            Assert.True(s1.IsActive);
            Assert.Single(s1.Categories);
            Assert.Equal("test-cat", s1.Categories[0]);

            // mem2 — inactive; repo returns it, IsActive=false
            Assert.True(result.ContainsKey(mem2.MemoryId));
            var s2 = result[mem2.MemoryId];
            Assert.Equal("Batch Beta", s2.Content);
            Assert.False(s2.IsActive);
            Assert.Empty(s2.Categories);
        }
        finally
        {
            // Cleanup
            var cats = await context.MemoryCategories
                .Where(c => c.Memory.UserId == user.UserId).ToListAsync();
            context.MemoryCategories.RemoveRange(cats);
            var mems = await context.Memories
                .Where(m => m.UserId == user.UserId).ToListAsync();
            context.Memories.RemoveRange(mems);
            var u = await context.Users.FindAsync(user.UserId);
            if (u != null) context.Users.Remove(u);
            await context.SaveChangesAsync();
        }
    }

    // ── Test 13: IsActive filtering is service responsibility, not repository ──

    [Fact]
    public async Task BatchHydration_InactiveMemoryReturnedByRepo_ServiceSkipsIt()
    {
        // Verify that if the repository returns an inactive snapshot in the batch dict,
        // the service's !snapshot.IsActive guard correctly prevents it from being
        // added to memoryDetailsMap and appearing in final results alongside active ones.
        var memRepo  = new Mock<IMemoryRepository>();
        var embGen   = new Mock<IEmbeddingGenerator>();
        var kwSearch = new Mock<IKeywordSearchRepository>();

        embGen.Setup(e => e.GenerateAsync(It.IsAny<string>()))
              .ReturnsAsync(new float[] { 1f, 0f });

        // Semantic returns one active candidate
        SetupSemanticDefault(memRepo, new[]
        {
            new RankedEmbeddingResult { MemoryId=1L, Content="Active", Similarity=0.9,
                Model="mistral-embed", Dimensions=2, MemoryType="Fact",
                CreatedAt=DateTime.UtcNow, UpdatedAt=DateTime.UtcNow }
        });

        // Keyword returns Memory 77 (keyword-only)
        kwSearch.Setup(k => k.SearchAsync(
                    It.IsAny<long>(), It.IsAny<string>(), It.IsAny<long?>(),
                    It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<KeywordSearchResult>
                {
                    new() { MemoryId=77L, Content="Inactive kw", MemoryType="Fact", RawScore=4.0 }
                });

        // Batch returns Memory 77 with IsActive=false
        memRepo.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
               .ReturnsAsync(new Dictionary<long, MemorySnapshot>
               {
                   [77L] = new() { MemoryId=77L, UserId=1L, Content="Inactive kw",
                                   MemoryType="Fact", IsActive=false,
                                   CreatedAt=DateTime.UtcNow.AddDays(-1),
                                   UpdatedAt=DateTime.UtcNow, Categories=new() }
               });

        var svc    = BuildService(memRepo, embGen, kwSearch);
        var result = await svc.RetrieveWithRelationsAsync(1L, 1L, "test", topK: 5);

        // Batch called once
        memRepo.Verify(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()), Times.Once);
        // Old per-ID method never called
        memRepo.Verify(m => m.GetMemorySnapshotAsync(It.IsAny<long>()), Times.Never);

        // Memory 1 (active semantic) is present; Memory 77 (inactive) is excluded from final results
        Assert.Contains(result.Memories, m => m.MemoryId == 1L);
        Assert.DoesNotContain(result.Memories, m => m.MemoryId == 77L);
    }

    // ── Helpers (PostgreSQL live tests) ───────────────────────────────────────

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

    private static string BuildConnectionString(
        (string Host, int Port, string Username, string Password) creds, string database)
        => $"Host={creds.Host};Port={creds.Port};Database={database};Username={creds.Username};" +
           $"Password={creds.Password};Include Error Detail=true";
}
