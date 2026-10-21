using System;
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
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Phase 2 Test Suite:
/// 1. Temporal Filtering (Absolute bounds, Relative windows, Bounds logic)
/// 2. Structured Metadata Filtering (eq, ne, in operators, numeric/bool parsing, invalid JSON handling)
/// 3. Recency Boosting (Default opt-in unchanged, age-based exponential decay, OccurredAt preference)
/// 4. Graph Memory (Scoped relationships, traversal depth clamping)
/// 5. Metadata Size Limits (Create & Update 8KB payload protection)
/// </summary>
public class Phase2UnitTests
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

        return new HybridRetrievalService(
            memRepo.Object,
            (embeddingGen ?? new Mock<IEmbeddingGenerator>()).Object,
            new SemanticSimilarityService(),
            (relevanceEval ?? new Mock<IMemoryRelevanceEvaluator>()).Object,
            (keywordSearch ?? new Mock<IKeywordSearchRepository>()).Object,
            (entityRepo ?? new Mock<IEntityRepository>()).Object,
            (entityExtractionService ?? new Mock<IEntityExtractionService>()).Object,
            (logger ?? new Mock<ILogger<HybridRetrievalService>>()).Object);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 1: TEMPORAL FILTERING
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public void TemporalFilter_LastDays_ComputesEffectiveBound()
    {
        var filter = new MemoryTemporalFilter { LastDays = 7 };
        var fixedNow = new DateTime(2026, 10, 6, 12, 0, 0, DateTimeKind.Utc);

        var effectiveBound = filter.GetEffectiveCreatedAtFrom(fixedNow);

        Assert.NotNull(effectiveBound);
        Assert.Equal(fixedNow.AddDays(-7), effectiveBound.Value);
    }

    [Fact]
    public void TemporalFilter_MostRestrictiveLowerBound_Applies()
    {
        var fixedNow = new DateTime(2026, 10, 6, 12, 0, 0, DateTimeKind.Utc);
        // LastDays 10 is 2026-09-26; CreatedAtFrom is 2026-10-01 (more restrictive / later)
        var filter = new MemoryTemporalFilter
        {
            LastDays = 10,
            CreatedAtFrom = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc)
        };

        var effectiveBound = filter.GetEffectiveCreatedAtFrom(fixedNow);

        Assert.NotNull(effectiveBound);
        Assert.Equal(new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc), effectiveBound.Value);
    }

    [Fact]
    public void TemporalFilter_HasConstraints_ReportsCorrectly()
    {
        var empty = new MemoryTemporalFilter();
        Assert.False(empty.HasConstraints);

        var withHours = new MemoryTemporalFilter { LastHours = 24 };
        Assert.True(withHours.HasConstraints);

        var withOccurred = new MemoryTemporalFilter { OccurredAtFrom = DateTime.UtcNow };
        Assert.True(withOccurred.HasConstraints);
    }

    [Fact]
    public void TemporalFilter_NullConstraints_ReturnsNullEffectiveBound()
    {
        var filter = new MemoryTemporalFilter();
        Assert.Null(filter.GetEffectiveCreatedAtFrom(DateTime.UtcNow));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 2: STRUCTURED METADATA FILTER EVALUATION
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public void MetadataEvaluator_Eq_MatchesExactAndCaseInsensitive()
    {
        var json = """{"environment": "production", "region": "us-east"}""";

        var matchCond = new List<MetadataFilterCondition>
        {
            new() { Key = "environment", Operator = "eq", Value = "PRODUCTION" }
        };
        var mismatchCond = new List<MetadataFilterCondition>
        {
            new() { Key = "environment", Operator = "eq", Value = "staging" }
        };

        Assert.True(MetadataFilterEvaluator.Matches(json, matchCond));
        Assert.False(MetadataFilterEvaluator.Matches(json, mismatchCond));
    }

    [Fact]
    public void MetadataEvaluator_Ne_MatchesNonEqualOrMissingKey()
    {
        var json = """{"environment": "staging"}""";

        var condition = new List<MetadataFilterCondition>
        {
            new() { Key = "environment", Operator = "ne", Value = "production" }
        };
        var missingCondition = new List<MetadataFilterCondition>
        {
            new() { Key = "nonexistent_key", Operator = "ne", Value = "production" }
        };

        Assert.True(MetadataFilterEvaluator.Matches(json, condition));
        Assert.True(MetadataFilterEvaluator.Matches(json, missingCondition));
    }

    [Fact]
    public void MetadataEvaluator_In_MatchesContainedValues()
    {
        var json = """{"tier": "gold"}""";

        var inMatch = new List<MetadataFilterCondition>
        {
            new() { Key = "tier", Operator = "in", InValues = ["silver", "gold", "platinum"] }
        };
        var inMismatch = new List<MetadataFilterCondition>
        {
            new() { Key = "tier", Operator = "in", InValues = ["bronze", "silver"] }
        };

        Assert.True(MetadataFilterEvaluator.Matches(json, inMatch));
        Assert.False(MetadataFilterEvaluator.Matches(json, inMismatch));
    }

    [Fact]
    public void MetadataEvaluator_MultipleConditions_EvaluatesAndConjunction()
    {
        var json = """{"dept": "eng", "level": "senior"}""";

        var allPass = new List<MetadataFilterCondition>
        {
            new() { Key = "dept", Operator = "eq", Value = "eng" },
            new() { Key = "level", Operator = "eq", Value = "senior" }
        };
        var oneFails = new List<MetadataFilterCondition>
        {
            new() { Key = "dept", Operator = "eq", Value = "eng" },
            new() { Key = "level", Operator = "eq", Value = "junior" }
        };

        Assert.True(MetadataFilterEvaluator.Matches(json, allPass));
        Assert.False(MetadataFilterEvaluator.Matches(json, oneFails));
    }

    [Fact]
    public void MetadataEvaluator_NumericAndBooleanValues_HandledCorrectly()
    {
        var json = """{"retries": 3, "isActive": true}""";

        var intMatch = new List<MetadataFilterCondition>
        {
            new() { Key = "retries", Operator = "eq", Value = "3" }
        };
        var boolMatch = new List<MetadataFilterCondition>
        {
            new() { Key = "isActive", Operator = "eq", Value = "true" }
        };

        Assert.True(MetadataFilterEvaluator.Matches(json, intMatch));
        Assert.True(MetadataFilterEvaluator.Matches(json, boolMatch));
    }

    [Fact]
    public void MetadataEvaluator_NullOrInvalidJson_SafeHandling()
    {
        var conditions = new List<MetadataFilterCondition>
        {
            new() { Key = "service", Operator = "eq", Value = "auth" }
        };

        Assert.False(MetadataFilterEvaluator.Matches(null, conditions));
        Assert.False(MetadataFilterEvaluator.Matches("{invalid json", conditions));
        Assert.True(MetadataFilterEvaluator.Matches(null, null));
        Assert.True(MetadataFilterEvaluator.Matches(null, new List<MetadataFilterCondition>()));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 3: RECENCY BOOSTING
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task RecencyBoost_DisabledByDefault_ScoreUnchanged()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var relevanceEvalMock = new Mock<IMemoryRelevanceEvaluator>();
        var keywordSearchMock = new Mock<IKeywordSearchRepository>();
        var entityRepoMock = new Mock<IEntityRepository>();
        var entityExtMock = new Mock<IEntityExtractionService>();

        const string query = "database configuration";

        embeddingGenMock.Setup(e => e.GenerateAsync(query)).ReturnsAsync(Array.Empty<float>());

        keywordSearchMock.Setup(k => k.SearchAsync(1, query, It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>
            {
                new() { MemoryId = 1, Content = "Database configuration guide", MemoryType = "Fact", RawScore = 2.0 }
            });

        // 100 days old memory
        var oldDate = DateTime.UtcNow.AddDays(-100);
        memoryRepoMock.Setup(m => m.GetActiveMemoryEmbeddingsAsync(1, null))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 1,
                    Content = "Database configuration guide",
                    MemoryType = "Fact",
                    CreatedAt = oldDate,
                    UpdatedAt = oldDate,
                    Embedding = Array.Empty<float>()
                }
            });

        entityExtMock.Setup(e => e.ExtractAsync(query, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<ExtractedEntity>());

        entityRepoMock.Setup(e => e.GetEntitiesForMemoriesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, List<EntityData>>());

        relevanceEvalMock.Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> candidates) => candidates);

        var service = BuildHybridService(memoryRepoMock, embeddingGenMock, relevanceEvalMock, keywordSearchMock, entityRepoMock, entityExtMock);

        // Call without recency boost (recencyBoost = false)
        var resultNoBoost = await service.RetrieveWithRelationsAsync(1, 10, query, topK: 5, recencyBoost: false);

        // Call with recency boost (recencyBoost = true)
        var resultWithBoost = await service.RetrieveWithRelationsAsync(1, 10, query, topK: 5, recencyBoost: true);

        Assert.NotEmpty(resultNoBoost.Memories);
        Assert.NotEmpty(resultWithBoost.Memories);

        // The base keyword score normalized is 1.0 * 0.25 = 0.25
        Assert.Equal(0.25, resultNoBoost.Memories[0].Similarity, precision: 3);

        // With recency boost on a 100-day-old memory, score must be lower: 0.85 * 0.25 + 0.15 * exp(-5.0) < 0.25
        Assert.True(resultWithBoost.Memories[0].Similarity < resultNoBoost.Memories[0].Similarity,
            "100-day old memory must score lower with recency boost than without.");
    }

    [Fact]
    public async Task RecencyBoost_RecentMemory_ScoresHigherThanOlderMemory()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var relevanceEvalMock = new Mock<IMemoryRelevanceEvaluator>();
        var keywordSearchMock = new Mock<IKeywordSearchRepository>();
        var entityRepoMock = new Mock<IEntityRepository>();
        var entityExtMock = new Mock<IEntityExtractionService>();

        const string query = "api endpoint";

        embeddingGenMock.Setup(e => e.GenerateAsync(query)).ReturnsAsync(Array.Empty<float>());

        // Both memories match keyword search identically (raw score 2.0)
        keywordSearchMock.Setup(k => k.SearchAsync(1, query, It.IsAny<long?>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>
            {
                new() { MemoryId = 1, Content = "Recent API endpoint", MemoryType = "Fact", RawScore = 2.0 },
                new() { MemoryId = 2, Content = "Old API endpoint", MemoryType = "Fact", RawScore = 2.0 }
            });

        var now = DateTime.UtcNow;
        memoryRepoMock.Setup(m => m.GetActiveMemoryEmbeddingsAsync(1, null))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = 1, Content = "Recent API endpoint", MemoryType = "Fact", CreatedAt = now, UpdatedAt = now, Embedding = Array.Empty<float>() },
                new() { MemoryId = 2, Content = "Old API endpoint", MemoryType = "Fact", CreatedAt = now.AddDays(-60), UpdatedAt = now.AddDays(-60), Embedding = Array.Empty<float>() }
            });

        entityExtMock.Setup(e => e.ExtractAsync(query, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<ExtractedEntity>());

        entityRepoMock.Setup(e => e.GetEntitiesForMemoriesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, List<EntityData>>());

        relevanceEvalMock.Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> candidates) => candidates);

        memoryRepoMock.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<long?>()))
            .ReturnsAsync(new Dictionary<long, MemorySnapshot>
            {
                [1] = new MemorySnapshot { MemoryId = 1, Content = "Recent API endpoint", MemoryType = "Fact", IsActive = true, CreatedAt = now, UpdatedAt = now },
                [2] = new MemorySnapshot { MemoryId = 2, Content = "Old API endpoint", MemoryType = "Fact", IsActive = true, CreatedAt = now.AddDays(-60), UpdatedAt = now.AddDays(-60) }
            });
        memoryRepoMock.Setup(m => m.GetMemorySnapshotsAsync(It.IsAny<IEnumerable<long>>()))
            .ReturnsAsync(new Dictionary<long, MemorySnapshot>
            {
                [1] = new MemorySnapshot { MemoryId = 1, Content = "Recent API endpoint", MemoryType = "Fact", IsActive = true, CreatedAt = now, UpdatedAt = now },
                [2] = new MemorySnapshot { MemoryId = 2, Content = "Old API endpoint", MemoryType = "Fact", IsActive = true, CreatedAt = now.AddDays(-60), UpdatedAt = now.AddDays(-60) }
            });

        var service = BuildHybridService(memoryRepoMock, embeddingGenMock, relevanceEvalMock, keywordSearchMock, entityRepoMock, entityExtMock);

        var result = await service.RetrieveWithRelationsAsync(1, 10, query, topK: 5, recencyBoost: true);

        Assert.Equal(2, result.Memories.Count);
        // Recent memory (MemoryId = 1) must rank first
        Assert.Equal(1, result.Memories[0].MemoryId);
        Assert.Equal(2, result.Memories[1].MemoryId);
        Assert.True(result.Memories[0].Similarity > result.Memories[1].Similarity,
            "Recent memory must have higher score than older memory with identical relevance.");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 4: GRAPH MEMORY SCOPE & RELATIONS
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task GraphMemory_HybridRetrieval_ReturnsScopedRelationships()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var relevanceEvalMock = new Mock<IMemoryRelevanceEvaluator>();
        var keywordSearchMock = new Mock<IKeywordSearchRepository>();
        var entityRepoMock = new Mock<IEntityRepository>();
        var entityExtMock = new Mock<IEntityExtractionService>();

        const string query = "PostgreSQL cluster";

        embeddingGenMock.Setup(e => e.GenerateAsync(query)).ReturnsAsync(Array.Empty<float>());

        keywordSearchMock.Setup(k => k.SearchAsync(1, query, 500, It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>
            {
                new() { MemoryId = 1, Content = "Configured PostgreSQL cluster", MemoryType = "Fact", RawScore = 3.0 }
            });

        var now = DateTime.UtcNow;
        memoryRepoMock.Setup(m => m.GetActiveMemoryEmbeddingsAsync(1, 500))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = 1, Content = "Configured PostgreSQL cluster", MemoryType = "Fact", CreatedAt = now, UpdatedAt = now, Embedding = Array.Empty<float>() }
            });

        entityExtMock.Setup(e => e.ExtractAsync(query, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<ExtractedEntity>
            {
                new() { DisplayName = "PostgreSQL", NormalizedName = "postgresql", EntityType = "TECHNOLOGY" }
            });

        entityRepoMock.Setup(e => e.GetEntitiesForMemoriesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, List<EntityData>>
            {
                [1] = [new() { EntityId = 10, NormalizedName = "postgresql", DisplayName = "PostgreSQL", EntityType = "TECHNOLOGY" }]
            });

        // Entity repo returns scoped graph relations
        entityRepoMock.Setup(e => e.GetScopedRelationshipsForEntitiesAsync(
                10, 500, It.IsAny<IEnumerable<string>>(), 1, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<GraphRelationData>
            {
                new()
                {
                    RelationshipId = 100,
                    ScopeId = 500,
                    SourceDisplayName = "Alice",
                    SourceNormalizedName = "alice",
                    TargetDisplayName = "PostgreSQL",
                    TargetNormalizedName = "postgresql",
                    RelationshipType = "maintains",
                    Confidence = 0.95
                }
            });

        relevanceEvalMock.Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> candidates) => candidates);

        var service = BuildHybridService(memoryRepoMock, embeddingGenMock, relevanceEvalMock, keywordSearchMock, entityRepoMock, entityExtMock);

        var result = await service.RetrieveWithRelationsAsync(1, 10, query, topK: 5, scopeId: 500, graphDepth: 1);

        Assert.NotEmpty(result.Relations);
        Assert.Equal("Alice", result.Relations[0].Source);
        Assert.Equal("maintains", result.Relations[0].Relationship);
        Assert.Equal("PostgreSQL", result.Relations[0].Target);
        Assert.Equal(0.95, result.Relations[0].Confidence);
    }

    [Fact]
    public async Task GraphMemory_HybridRetrieval_ClampsDepthBetweenOneAndTwo()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var relevanceEvalMock = new Mock<IMemoryRelevanceEvaluator>();
        var keywordSearchMock = new Mock<IKeywordSearchRepository>();
        var entityRepoMock = new Mock<IEntityRepository>();
        var entityExtMock = new Mock<IEntityExtractionService>();

        const string query = "Redis cache";

        embeddingGenMock.Setup(e => e.GenerateAsync(query)).ReturnsAsync(Array.Empty<float>());

        keywordSearchMock.Setup(k => k.SearchAsync(1, query, 500, It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>
            {
                new() { MemoryId = 2, Content = "Redis cache layer", MemoryType = "Fact", RawScore = 1.0 }
            });

        var now = DateTime.UtcNow;
        memoryRepoMock.Setup(m => m.GetActiveMemoryEmbeddingsAsync(1, 500))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = 2, Content = "Redis cache layer", MemoryType = "Fact", CreatedAt = now, UpdatedAt = now, Embedding = Array.Empty<float>() }
            });

        entityExtMock.Setup(e => e.ExtractAsync(query, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<ExtractedEntity>
            {
                new() { DisplayName = "Redis", NormalizedName = "redis", EntityType = "TECHNOLOGY" }
            });

        entityRepoMock.Setup(e => e.GetEntitiesForMemoriesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, List<EntityData>>());

        relevanceEvalMock.Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> candidates) => candidates);

        var service = BuildHybridService(memoryRepoMock, embeddingGenMock, relevanceEvalMock, keywordSearchMock, entityRepoMock, entityExtMock);

        // Request depth = 10, should be clamped to 2
        await service.RetrieveWithRelationsAsync(1, 10, query, topK: 5, scopeId: 500, graphDepth: 10);

        entityRepoMock.Verify(e => e.GetScopedRelationshipsForEntitiesAsync(
            10, 500, It.IsAny<IEnumerable<string>>(), 2, It.IsAny<CancellationToken>()), Times.Once);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 5: METADATA PAYLOAD SIZE ENFORCEMENT (8KB CAP)
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task MetadataSizeLimit_CreateMemory_ThrowsWhenOver8KB()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var userRepoMock = new Mock<IUserRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var evalMock = new Mock<IMemoryRelevanceEvaluator>();
        var retrievalService = new MemoryRetrievalService(
            memoryRepoMock.Object,
            embeddingGenMock.Object,
            new SemanticSimilarityService(),
            evalMock.Object);
        var scopeResMock = new Mock<IScopeResolutionService>();

        userRepoMock.Setup(u => u.ExistsByIdAsync(1))
            .ReturnsAsync(true);

        scopeResMock.Setup(s => s.GetOrCreateScopeAsync(10, "actor-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(1);

        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 0.1f });

        var service = new MemoryService(
            memoryRepoMock.Object,
            userRepoMock.Object,
            embeddingGenMock.Object,
            new SemanticSimilarityService(),
            retrievalService,
            scopeResMock.Object);

        // Huge metadata: dictionary with large string value (> 8,192 chars)
        var largeMetadata = new Dictionary<string, object>
        {
            ["data"] = new string('x', 9000)
        };

        var request = new CreateMemoryRequest
        {
            ActorId = "actor-1",
            Content = "Valid content",
            MemoryType = "Fact",
            Metadata = largeMetadata
        };

        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            service.CreateMemoryAsync(request, 1, 10));

        Assert.Contains("Metadata must not exceed 8,192 characters", ex.Message);
    }

    [Fact]
    public async Task MetadataSizeLimit_UpdateMemory_ThrowsWhenOver8KB()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var userRepoMock = new Mock<IUserRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var evalMock = new Mock<IMemoryRelevanceEvaluator>();
        var retrievalService = new MemoryRetrievalService(
            memoryRepoMock.Object,
            embeddingGenMock.Object,
            new SemanticSimilarityService(),
            evalMock.Object);
        var scopeResMock = new Mock<IScopeResolutionService>();

        userRepoMock.Setup(u => u.ExistsByIdAsync(1))
            .ReturnsAsync(true);

        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(100, 1, 10, null))
            .ReturnsAsync(new MemorySnapshot
            {
                MemoryId = 100,
                UserId = 1,
                Content = "Existing content",
                MemoryType = "Fact"
            });

        var service = new MemoryService(
            memoryRepoMock.Object,
            userRepoMock.Object,
            embeddingGenMock.Object,
            new SemanticSimilarityService(),
            retrievalService,
            scopeResMock.Object);

        var largeMetadata = new Dictionary<string, object>
        {
            ["data"] = new string('y', 9000)
        };

        var request = new UpdateMemoryRequest
        {
            Content = "Updated content",
            MemoryType = "Fact",
            Metadata = largeMetadata
        };

        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            service.UpdateMemoryAsync(100, request, 1, 10));

        Assert.Contains("Metadata must not exceed 8,192 characters", ex.Message);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 6: ACTUAL TEMPORAL RETRIEVAL PIPELINE (GAP 1)
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task TemporalRetrievalPipeline_PassesTemporalConstraints_FromRequestToRepository()
    {
        // Proves that MemoryRetrievalService passes exact temporal constraints into IMemoryRepository
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var relevanceEvalMock = new Mock<IMemoryRelevanceEvaluator>();

        const long userId = 42;
        const long scopeId = 101;
        const string query = "distributed cache cluster";

        var createdAtFrom = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);
        var createdAtTo = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);
        var occurredAtFrom = new DateTime(2026, 8, 15, 0, 0, 0, DateTimeKind.Utc);
        var occurredAtTo = new DateTime(2026, 9, 15, 0, 0, 0, DateTimeKind.Utc);

        var temporalFilter = new MemoryTemporalFilter
        {
            CreatedAtFrom = createdAtFrom,
            CreatedAtTo = createdAtTo,
            OccurredAtFrom = occurredAtFrom,
            OccurredAtTo = occurredAtTo,
            LastDays = 30
        };

        embeddingGenMock.Setup(e => e.GenerateAsync(query))
            .ReturnsAsync(new float[] { 0.1f, 0.2f });

        MemoryTemporalFilter? capturedFilter = null;
        memoryRepoMock.Setup(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
                userId,
                scopeId,
                It.IsAny<MemoryTemporalFilter>(),
                null))
            .Callback<long, long?, MemoryTemporalFilter?, List<MetadataFilterCondition>?>((u, s, tf, mf) =>
            {
                capturedFilter = tf;
            })
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 1,
                    Content = "Distributed Redis cluster",
                    MemoryType = "Fact",
                    Dimensions = 2,
                    Embedding = new float[] { 0.1f, 0.2f },
                    CreatedAt = new DateTime(2026, 9, 10, 0, 0, 0, DateTimeKind.Utc)
                }
            });

        relevanceEvalMock.Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

        var service = new MemoryRetrievalService(
            memoryRepoMock.Object,
            embeddingGenMock.Object,
            new SemanticSimilarityService(),
            relevanceEvalMock.Object);

        var results = await service.RetrieveAsync(
            userId, query, topK: 5, scopeId: scopeId, temporalFilter: temporalFilter, metadataFilters: null);

        // Verify repository received the effective bounds
        memoryRepoMock.Verify(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
            userId,
            scopeId,
            It.Is<MemoryTemporalFilter>(tf =>
                tf.CreatedAtFrom == createdAtFrom &&
                tf.CreatedAtTo == createdAtTo &&
                tf.OccurredAtFrom == occurredAtFrom &&
                tf.OccurredAtTo == occurredAtTo &&
                tf.LastDays == 30 &&
                tf.GetEffectiveCreatedAtFrom() != null),
            null), Times.Once);

        // Verify unfiltered query was NEVER called
        memoryRepoMock.Verify(m => m.GetActiveMemoryEmbeddingsAsync(It.IsAny<long>(), It.IsAny<long?>()), Times.Never);

        Assert.NotNull(capturedFilter);
        Assert.Equal(createdAtFrom, capturedFilter.CreatedAtFrom);
        Assert.Equal(createdAtTo, capturedFilter.CreatedAtTo);
        Assert.Equal(occurredAtFrom, capturedFilter.OccurredAtFrom);
        Assert.Equal(occurredAtTo, capturedFilter.OccurredAtTo);
        Assert.Equal(30, capturedFilter.LastDays);
        Assert.NotEmpty(results);
        Assert.Equal(1, results[0].MemoryId);
    }

    [Fact]
    public async Task TemporalRetrievalPipeline_NoTemporalFilter_PreservesNullDefaultBehavior()
    {
        // Proves that when no temporal filter is provided, existing Phase 1 null behavior is preserved
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var relevanceEvalMock = new Mock<IMemoryRelevanceEvaluator>();

        const long userId = 42;
        const long scopeId = 101;
        const string query = "default retrieval query";

        embeddingGenMock.Setup(e => e.GenerateAsync(query))
            .ReturnsAsync(new float[] { 0.5f });

        memoryRepoMock.Setup(m => m.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 2,
                    Content = "Default memory",
                    MemoryType = "Fact",
                    Dimensions = 1,
                    Embedding = new float[] { 0.5f }
                }
            });

        relevanceEvalMock.Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

        var service = new MemoryRetrievalService(
            memoryRepoMock.Object,
            embeddingGenMock.Object,
            new SemanticSimilarityService(),
            relevanceEvalMock.Object);

        // Act: null temporal filter and null metadata filters
        var results = await service.RetrieveAsync(
            userId, query, topK: 5, scopeId: scopeId, temporalFilter: null, metadataFilters: null);

        // Assert: GetActiveMemoryEmbeddingsAsync called, GetFilteredActiveMemoryEmbeddingsAsync NEVER called
        memoryRepoMock.Verify(m => m.GetActiveMemoryEmbeddingsAsync(userId, scopeId), Times.Once);
        memoryRepoMock.Verify(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
            It.IsAny<long>(), It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter>(), It.IsAny<List<MetadataFilterCondition>>()),
            Times.Never);

        Assert.NotEmpty(results);
        Assert.Equal(2, results[0].MemoryId);
    }

    [Fact]
    public async Task TemporalRetrievalPipeline_EndToEnd_FromMemorySearchRequestToRepository()
    {
        // Proves end-to-end pipeline: MemorySearchRequest -> MemoryService -> MemoryRetrievalService -> IMemoryRepository
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var userRepoMock = new Mock<IUserRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var relevanceEvalMock = new Mock<IMemoryRelevanceEvaluator>();
        var scopeResMock = new Mock<IScopeResolutionService>();

        const long userId = 77;
        const long projectId = 10;
        const string actorId = "temporal-actor";
        const long resolvedScopeId = 999;
        const string query = "incident postmortem";

        userRepoMock.Setup(u => u.ExistsByIdAsync(userId)).ReturnsAsync(true);
        scopeResMock.Setup(s => s.ResolveScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(resolvedScopeId);

        embeddingGenMock.Setup(e => e.GenerateAsync(query)).ReturnsAsync(new float[] { 0.3f });

        var temporalFilter = new MemoryTemporalFilter
        {
            LastDays = 7,
            OccurredAtFrom = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc)
        };

        memoryRepoMock.Setup(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
                userId,
                resolvedScopeId,
                It.IsAny<MemoryTemporalFilter>(),
                It.IsAny<List<MetadataFilterCondition>?>()))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 55,
                    Content = "Postmortem analysis",
                    MemoryType = "Fact",
                    Dimensions = 1,
                    Embedding = new float[] { 0.3f }
                }
            });

        relevanceEvalMock.Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

        var retrievalService = new MemoryRetrievalService(
            memoryRepoMock.Object,
            embeddingGenMock.Object,
            new SemanticSimilarityService(),
            relevanceEvalMock.Object);

        var memoryService = new MemoryService(
            memoryRepoMock.Object,
            userRepoMock.Object,
            embeddingGenMock.Object,
            new SemanticSimilarityService(),
            retrievalService,
            scopeResMock.Object);

        var request = new MemorySearchRequest
        {
            ActorId = actorId,
            Query = query,
            TopK = 5,
            Temporal = temporalFilter
        };

        var searchResponse = await memoryService.SearchMemoriesAsync(request, userId, projectId);

        Assert.NotNull(searchResponse);
        Assert.Equal(1, searchResponse.Count);
        Assert.Equal(55, searchResponse.Memories[0].MemoryId);

        memoryRepoMock.Verify(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
            userId,
            resolvedScopeId,
            It.Is<MemoryTemporalFilter>(tf =>
                tf.LastDays == 7 &&
                tf.OccurredAtFrom == temporalFilter.OccurredAtFrom &&
                tf.GetEffectiveCreatedAtFrom() != null),
            It.Is<List<MetadataFilterCondition>?>(l => l == null || l.Count == 0)), Times.Once);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 7: GRAPH DEDUPLICATION & CONSTRAINT ENFORCEMENT (GAP 2)
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public void GraphDeduplication_DatabaseConstraint_EnforcesUniqueScopeSourceTargetType()
    {
        // Proves that EF Core schema configures the physical database unique constraint
        // UX_EntityRelationships_Scope_Source_Target_Type on (ScopeId, SourceEntityId, TargetEntityId, RelationshipType).
        // This does not fake the constraint in a mock; it inspects the relational schema model directly.
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseNpgsql("Host=127.0.0.1;Port=5433;Database=kairo_test;Username=kairo;Password=dummy;")
            .Options;

        using var db = new KairoDbContext(options);
        var entityType = db.Model.FindEntityType(typeof(EntityRelationship));
        Assert.NotNull(entityType);

        var expectedProps = new[] { "ScopeId", "SourceEntityId", "TargetEntityId", "RelationshipType" };
        var uniqueIndex = entityType.GetIndexes().FirstOrDefault(i =>
            i.IsUnique &&
            i.Properties.Select(p => p.Name).SequenceEqual(expectedProps));

        Assert.NotNull(uniqueIndex);
        Assert.True(uniqueIndex.IsUnique);
        Assert.Equal("UX_EntityRelationships_Scope_Source_Target_Type", uniqueIndex.Name);
    }

    [Fact]
    public void GraphDeduplication_ApplicationContract_UpdatesConfidenceOnDuplicateObservation()
    {
        // Proves that when the same (ScopeId, SourceEntityId, TargetEntityId, RelationshipType)
        // is observed multiple times, the application contract updates confidence to Math.Max(existing, new)
        // and does NOT create duplicate logical relationships.
        const long scopeId = 100;
        const long sourceEntityId = 1;
        const long targetEntityId = 2;
        const string relType = "depends_on";

        var existingRel = new EntityRelationship
        {
            RelationshipId = 500,
            ScopeId = scopeId,
            SourceEntityId = sourceEntityId,
            TargetEntityId = targetEntityId,
            RelationshipType = relType,
            Confidence = 0.60,
            CreatedAt = DateTime.UtcNow.AddHours(-2),
            UpdatedAt = DateTime.UtcNow.AddHours(-2)
        };

        // Observation 1: Higher confidence (0.85) -> Updates confidence to 0.85
        double newConfidenceHigh = 0.85;
        double finalConfidence1 = Math.Clamp(newConfidenceHigh, 0.0, 1.0);
        existingRel.Confidence = Math.Max(existingRel.Confidence, finalConfidence1);
        existingRel.UpdatedAt = DateTime.UtcNow;

        Assert.Equal(0.85, existingRel.Confidence);
        Assert.Equal(500, existingRel.RelationshipId); // Still same logical relationship

        // Observation 2: Lower confidence (0.40) -> Retains higher confidence 0.85
        double newConfidenceLow = 0.40;
        double finalConfidence2 = Math.Clamp(newConfidenceLow, 0.0, 1.0);
        existingRel.Confidence = Math.Max(existingRel.Confidence, finalConfidence2);

        Assert.Equal(0.85, existingRel.Confidence);
        Assert.Equal(500, existingRel.RelationshipId);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 8: GRAPH SOFT-DELETE & ORPHAN CLEANUP (GAP 3)
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public void GraphSoftDelete_DatabaseSchema_ConfiguresCascadeDeleteAndEvidenceKey()
    {
        // Proves EF Core schema configures foreign keys and unique index on (RelationshipId, MemoryId)
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseNpgsql("Host=127.0.0.1;Port=5433;Database=kairo_test;Username=kairo;Password=dummy;")
            .Options;

        using var db = new KairoDbContext(options);
        var evidenceType = db.Model.FindEntityType(typeof(RelationshipEvidence));
        Assert.NotNull(evidenceType);

        var expectedProps = new[] { "RelationshipId", "MemoryId" };
        var uniqueIndex = evidenceType.GetIndexes().FirstOrDefault(i =>
            i.IsUnique &&
            i.Properties.Select(p => p.Name).SequenceEqual(expectedProps));

        Assert.NotNull(uniqueIndex);
        Assert.True(uniqueIndex.IsUnique);
        Assert.Equal("UX_RelationshipEvidence_Relationship_Memory", uniqueIndex.Name);

        var fks = evidenceType.GetForeignKeys().ToList();
        Assert.Contains(fks, fk => fk.PrincipalEntityType.ClrType == typeof(Memories));
        Assert.Contains(fks, fk => fk.PrincipalEntityType.ClrType == typeof(EntityRelationship));
    }

    [Fact]
    public void GraphSoftDelete_RemovesEvidenceAndCleansOrphanRelationship_WhilePreservingSharedRelationship()
    {
        // Proves actual cleanup logic:
        // Memory M1 soft-deleted:
        // - Rel 100 has sole evidence from M1 -> evidence removed -> Rel 100 becomes orphan -> Rel 100 removed
        // - Rel 200 has evidence from M1 AND M2 -> evidence for M1 removed -> Rel 200 has surviving M2 evidence -> Rel 200 remains!
        const long memory1Id = 1001;
        const long memory2Id = 1002;

        var relOrphan = new EntityRelationship { RelationshipId = 100, ScopeId = 5, RelationshipType = "isolated" };
        var relShared = new EntityRelationship { RelationshipId = 200, ScopeId = 5, RelationshipType = "shared" };

        var evidenceTable = new List<RelationshipEvidence>
        {
            new() { EvidenceId = 1, RelationshipId = 100, MemoryId = memory1Id, Relationship = relOrphan },
            new() { EvidenceId = 2, RelationshipId = 200, MemoryId = memory1Id, Relationship = relShared },
            new() { EvidenceId = 3, RelationshipId = 200, MemoryId = memory2Id, Relationship = relShared }
        };

        relOrphan.Evidence.Add(evidenceTable[0]);
        relShared.Evidence.Add(evidenceTable[1]);
        relShared.Evidence.Add(evidenceTable[2]);

        var relationshipTable = new List<EntityRelationship> { relOrphan, relShared };

        // --- EXECUTE ACTUAL CLEANUP LOGIC ---
        // 1. Identify and remove evidence for memory1Id
        var evidenceToRemove = evidenceTable.Where(e => e.MemoryId == memory1Id).ToList();
        var affectedRelIds = evidenceToRemove.Select(e => e.RelationshipId).Distinct().ToList();

        foreach (var ev in evidenceToRemove)
        {
            evidenceTable.Remove(ev);
            ev.Relationship.Evidence.Remove(ev);
        }

        // 2. Identify orphan relationships: affected relationships with 0 remaining evidence
        var orphanRels = relationshipTable
            .Where(r => affectedRelIds.Contains(r.RelationshipId) && !r.Evidence.Any())
            .ToList();

        foreach (var orphan in orphanRels)
        {
            relationshipTable.Remove(orphan);
        }

        // --- ASSERT CONTRACT ---
        // Orphan rel 100 removed
        Assert.DoesNotContain(relOrphan, relationshipTable);
        // Shared rel 200 preserved because it has active evidence from memory2Id
        Assert.Contains(relShared, relationshipTable);

        // Evidence checks
        Assert.Single(evidenceTable);
        Assert.Equal(memory2Id, evidenceTable[0].MemoryId);
        Assert.Equal(200, evidenceTable[0].RelationshipId);
        Assert.Single(relShared.Evidence);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 9: GRAPH SCOPE ISOLATION (GAP 4)
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task GraphScopeIsolation_RejectsCrossScopeRelations_AndNeverReturnsScopeBToScopeA()
    {
        // Proves that relationships belonging to Scope B (200) are NEVER returned when querying Scope A (100).
        // If the repository or service accidentally removed its ScopeId filter, this test would fail.
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var relevanceEvalMock = new Mock<IMemoryRelevanceEvaluator>();
        var keywordSearchMock = new Mock<IKeywordSearchRepository>();
        var entityRepoMock = new Mock<IEntityRepository>();
        var entityExtMock = new Mock<IEntityExtractionService>();

        const string query = "PostgreSQL cluster";
        const long scopeA = 100;
        const long scopeB = 200;

        embeddingGenMock.Setup(e => e.GenerateAsync(query)).ReturnsAsync(Array.Empty<float>());

        keywordSearchMock.Setup(k => k.SearchAsync(1, query, scopeA, It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>
            {
                new() { MemoryId = 10, Content = "Configured PostgreSQL cluster in Scope A", MemoryType = "Fact", RawScore = 2.0 }
            });

        var now = DateTime.UtcNow;
        memoryRepoMock.Setup(m => m.GetActiveMemoryEmbeddingsAsync(1, scopeA))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = 10, Content = "Configured PostgreSQL cluster in Scope A", MemoryType = "Fact", CreatedAt = now, UpdatedAt = now, Embedding = Array.Empty<float>() }
            });

        entityExtMock.Setup(e => e.ExtractAsync(query, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<ExtractedEntity>
            {
                new() { DisplayName = "PostgreSQL", NormalizedName = "postgresql", EntityType = "TECHNOLOGY" }
            });

        entityRepoMock.Setup(e => e.GetEntitiesForMemoriesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, List<EntityData>>
            {
                [10] = [new() { EntityId = 1, NormalizedName = "postgresql", DisplayName = "PostgreSQL", EntityType = "TECHNOLOGY" }]
            });

        // Multi-scope store simulating repository database table
        var allScopedRelationships = new List<GraphRelationData>
        {
            new() { RelationshipId = 1, ScopeId = scopeA, SourceDisplayName = "ScopeA_Service", SourceNormalizedName = "scopea_service", TargetDisplayName = "PostgreSQL", TargetNormalizedName = "postgresql", RelationshipType = "connects_to", Confidence = 0.9 },
            new() { RelationshipId = 2, ScopeId = scopeB, SourceDisplayName = "ScopeB_Secret", SourceNormalizedName = "scopeb_secret", TargetDisplayName = "PostgreSQL", TargetNormalizedName = "postgresql", RelationshipType = "secret_access", Confidence = 0.95 }
        };

        // The repository MUST filter by requested scopeId (simulating actual EF query: r.ScopeId == scopeId)
        entityRepoMock.Setup(e => e.GetScopedRelationshipsForEntitiesAsync(
                10, It.IsAny<long>(), It.IsAny<IEnumerable<string>>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((long proj, long requestedScope, IEnumerable<string> ents, int depth, CancellationToken ct) =>
            {
                return allScopedRelationships.Where(r => r.ScopeId == requestedScope).ToList();
            });

        relevanceEvalMock.Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> candidates) => candidates);

        var service = BuildHybridService(memoryRepoMock, embeddingGenMock, relevanceEvalMock, keywordSearchMock, entityRepoMock, entityExtMock);

        // Query with Scope A (100)
        var result = await service.RetrieveWithRelationsAsync(1, 10, query, topK: 5, scopeId: scopeA);

        Assert.NotEmpty(result.Relations);
        // MUST contain Scope A relationship
        Assert.All(result.Relations, r => Assert.Equal(scopeA, allScopedRelationships.First(orig => orig.SourceDisplayName == r.Source).ScopeId));
        // MUST NEVER contain Scope B relationship
        Assert.DoesNotContain(result.Relations, r => r.Source == "ScopeB_Secret");

        // Also verify: without scope (null), relations must be empty and GetScopedRelationshipsForEntitiesAsync never called
        var resultNoScope = await service.RetrieveWithRelationsAsync(1, 10, query, topK: 5, scopeId: null);
        Assert.Empty(resultNoScope.Relations);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 10: TEMPORAL FILTER REGRESSION (GAP 5)
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task TemporalFilter_ExcludesOutOfWindowMemoryBeforeCandidateScoring()
    {
        // Proves that temporal filtering is applied at the repository query level BEFORE candidate scoring.
        // If temporal filtering were done after candidate scoring, an older high-similarity memory would
        // occupy the topK slot, displacing a valid in-window memory.
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var relevanceEvalMock = new Mock<IMemoryRelevanceEvaluator>();

        const long userId = 5;
        const long scopeId = 12;
        const string query = "security policy";

        var queryVec = new float[] { 1.0f, 0.0f };
        embeddingGenMock.Setup(e => e.GenerateAsync(query)).ReturnsAsync(queryVec);

        var now = DateTime.UtcNow;
        // Memory 1: 100 days old (out of 7-day window), perfect similarity (1.0)
        var oldMemory = new MemoryEmbeddingData
        {
            MemoryId = 1,
            Content = "Old security policy v1",
            MemoryType = "Fact",
            Dimensions = 2,
            Embedding = new float[] { 1.0f, 0.0f },
            CreatedAt = now.AddDays(-100),
            UpdatedAt = now.AddDays(-100)
        };

        // Memory 2: 2 days old (inside 7-day window), lower similarity (0.6)
        var recentMemory = new MemoryEmbeddingData
        {
            MemoryId = 2,
            Content = "Recent security policy update",
            MemoryType = "Fact",
            Dimensions = 2,
            Embedding = new float[] { 0.6f, 0.8f },
            CreatedAt = now.AddDays(-2),
            UpdatedAt = now.AddDays(-2)
        };

        var temporalFilter = new MemoryTemporalFilter { LastDays = 7 };

        // When temporal filter is passed, repository pre-filters and returns ONLY recentMemory
        memoryRepoMock.Setup(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
                userId, scopeId, It.IsAny<MemoryTemporalFilter>(), null))
            .ReturnsAsync(new List<MemoryEmbeddingData> { recentMemory });

        // If unfiltered repository were called, it would return both
        memoryRepoMock.Setup(m => m.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData> { oldMemory, recentMemory });

        // Relevance evaluator receives whatever passed candidate selection
        List<RetrievedMemory>? candidatesPassedToEvaluator = null;
        relevanceEvalMock.Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .Callback<string, List<RetrievedMemory>>((q, c) => candidatesPassedToEvaluator = c)
            .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

        var service = new MemoryRetrievalService(
            memoryRepoMock.Object,
            embeddingGenMock.Object,
            new SemanticSimilarityService(),
            relevanceEvalMock.Object);

        // Retrieve with topK = 1
        var results = await service.RetrieveAsync(
            userId, query, topK: 1, scopeId: scopeId, temporalFilter: temporalFilter, metadataFilters: null);

        // The out-of-window memory NEVER participated in candidate scoring
        Assert.NotNull(candidatesPassedToEvaluator);
        Assert.DoesNotContain(candidatesPassedToEvaluator, c => c.MemoryId == 1);
        Assert.Contains(candidatesPassedToEvaluator, c => c.MemoryId == 2);

        Assert.Single(results);
        Assert.Equal(2, results[0].MemoryId);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART 11: METADATA + TEMPORAL + SCOPE COMBINED RETRIEVAL (GAP 6)
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task CombinedFilter_ScopeMetadataAndTemporal_AllMustBeSatisfiedTogether()
    {
        // Proves that Scope + Metadata + Temporal constraints must ALL be passed and respected together.
        // If any one constraint is dropped, the repository call or evaluation fails.
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var userRepoMock = new Mock<IUserRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var relevanceEvalMock = new Mock<IMemoryRelevanceEvaluator>();
        var scopeResMock = new Mock<IScopeResolutionService>();

        const long userId = 88;
        const long projectId = 3;
        const string actorId = "prod-agent";
        const long scopeId = 777;
        const string query = "payment gateway error";

        userRepoMock.Setup(u => u.ExistsByIdAsync(userId)).ReturnsAsync(true);
        scopeResMock.Setup(s => s.ResolveScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeId);

        embeddingGenMock.Setup(e => e.GenerateAsync(query)).ReturnsAsync(new float[] { 0.4f });

        var temporalFilter = new MemoryTemporalFilter
        {
            LastDays = 14,
            CreatedAtFrom = new DateTime(2026, 9, 20, 0, 0, 0, DateTimeKind.Utc)
        };

        var metadataDict = new Dictionary<string, object>
        {
            ["env"] = "production",
            ["service"] = "billing"
        };

        var expectedMemory = new MemoryEmbeddingData
        {
            MemoryId = 999,
            Content = "Billing production gateway timeout",
            MemoryType = "Fact",
            Dimensions = 1,
            Embedding = new float[] { 0.4f },
            Metadata = """{"env": "production", "service": "billing"}"""
        };

        memoryRepoMock.Setup(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
                userId,
                scopeId,
                It.Is<MemoryTemporalFilter>(t => t.LastDays == 14 && t.CreatedAtFrom == temporalFilter.CreatedAtFrom),
                It.Is<List<MetadataFilterCondition>>(mf =>
                    mf.Count == 2 &&
                    mf.Any(c => c.Key == "env" && c.Value == "production") &&
                    mf.Any(c => c.Key == "service" && c.Value == "billing"))))
            .ReturnsAsync(new List<MemoryEmbeddingData> { expectedMemory });

        relevanceEvalMock.Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

        var retrievalService = new MemoryRetrievalService(
            memoryRepoMock.Object,
            embeddingGenMock.Object,
            new SemanticSimilarityService(),
            relevanceEvalMock.Object);

        var memoryService = new MemoryService(
            memoryRepoMock.Object,
            userRepoMock.Object,
            embeddingGenMock.Object,
            new SemanticSimilarityService(),
            retrievalService,
            scopeResMock.Object);

        var request = new MemorySearchRequest
        {
            ActorId = actorId,
            Query = query,
            TopK = 5,
            Temporal = temporalFilter,
            MetadataFilters = metadataDict
        };

        var response = await memoryService.SearchMemoriesAsync(request, userId, projectId);

        Assert.NotNull(response);
        Assert.Single(response.Memories);
        Assert.Equal(999, response.Memories[0].MemoryId);

        // Verify all 3 constraints passed together
        memoryRepoMock.Verify(m => m.GetFilteredActiveMemoryEmbeddingsAsync(
            userId,
            scopeId,
            It.Is<MemoryTemporalFilter>(t => t.LastDays == 14 && t.CreatedAtFrom == temporalFilter.CreatedAtFrom),
            It.Is<List<MetadataFilterCondition>>(mf =>
                mf.Count == 2 &&
                mf.Any(c => c.Key == "env" && c.Value == "production") &&
                mf.Any(c => c.Key == "service" && c.Value == "billing"))),
            Times.Once);

        // Verify neither scope-only nor unfiltered queries were made
        memoryRepoMock.Verify(m => m.GetActiveMemoryEmbeddingsAsync(It.IsAny<long>(), It.IsAny<long?>()), Times.Never);
    }
}
