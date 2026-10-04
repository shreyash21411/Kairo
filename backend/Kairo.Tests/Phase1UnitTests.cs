using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Phase 1 Test Suite:
/// 1. Multi-Dimensional Memory Scopes & Isolation
/// 2. ADD-Only Ingestion Mode
/// 3. Entity Extraction, Deduplication & Storage
/// 4. Hybrid Retrieval & Score Fusion
/// </summary>
public class Phase1UnitTests
{
    // ══════════════════════════════════════════════════════════════════════════
    // PART A: MULTI-DIMENSIONAL SCOPES & ISOLATION
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Scope_MultiDim_ResolvesDistinctScopesForDifferentUsers()
    {
        var repoMock = new Mock<IMemoryScopeRepository>();
        var service = new ScopeResolutionService(repoMock.Object);

        var keyA = new MemoryScopeKey { UserId = "user-100", AgentId = "assistant-1" };
        var keyB = new MemoryScopeKey { UserId = "user-200", AgentId = "assistant-1" };

        repoMock.Setup(r => r.GetOrCreateMultiDimAsync(1, "user-100", "assistant-1", null, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryScopeData { ScopeId = 101, ProjectId = 1, UserId = "user-100", AgentId = "assistant-1", ActorId = "u1" });

        repoMock.Setup(r => r.GetOrCreateMultiDimAsync(1, "user-200", "assistant-1", null, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryScopeData { ScopeId = 102, ProjectId = 1, UserId = "user-200", AgentId = "assistant-1", ActorId = "u2" });

        var scopeIdA = await service.GetOrCreateFromScopeKeyAsync(1, keyA);
        var scopeIdB = await service.GetOrCreateFromScopeKeyAsync(1, keyB);

        Assert.Equal(101, scopeIdA);
        Assert.Equal(102, scopeIdB);
        Assert.NotEqual(scopeIdA, scopeIdB);
    }

    [Fact]
    public async Task Scope_MultiDim_ResolvesDistinctScopesForDifferentAgents()
    {
        var repoMock = new Mock<IMemoryScopeRepository>();
        var service = new ScopeResolutionService(repoMock.Object);

        var keyA = new MemoryScopeKey { UserId = "user-100", AgentId = "agent-alpha" };
        var keyB = new MemoryScopeKey { UserId = "user-100", AgentId = "agent-beta" };

        repoMock.Setup(r => r.GetOrCreateMultiDimAsync(1, "user-100", "agent-alpha", null, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryScopeData { ScopeId = 201, ProjectId = 1, UserId = "user-100", AgentId = "agent-alpha", ActorId = "a1" });

        repoMock.Setup(r => r.GetOrCreateMultiDimAsync(1, "user-100", "agent-beta", null, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryScopeData { ScopeId = 202, ProjectId = 1, UserId = "user-100", AgentId = "agent-beta", ActorId = "a2" });

        var scopeIdA = await service.GetOrCreateFromScopeKeyAsync(1, keyA);
        var scopeIdB = await service.GetOrCreateFromScopeKeyAsync(1, keyB);

        Assert.Equal(201, scopeIdA);
        Assert.Equal(202, scopeIdB);
        Assert.NotEqual(scopeIdA, scopeIdB);
    }

    [Fact]
    public async Task Scope_MultiDim_ResolvesDistinctScopesForDifferentRunsAndSessions()
    {
        var repoMock = new Mock<IMemoryScopeRepository>();
        var service = new ScopeResolutionService(repoMock.Object);

        var keySession1 = new MemoryScopeKey { UserId = "user-1", SessionId = "sess-01" };
        var keySession2 = new MemoryScopeKey { UserId = "user-1", SessionId = "sess-02" };
        var keyRun1 = new MemoryScopeKey { UserId = "user-1", RunId = "run-01" };

        repoMock.Setup(r => r.GetOrCreateMultiDimAsync(1, "user-1", null, "sess-01", null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryScopeData { ScopeId = 301, ProjectId = 1, ActorId = "s1" });
        repoMock.Setup(r => r.GetOrCreateMultiDimAsync(1, "user-1", null, "sess-02", null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryScopeData { ScopeId = 302, ProjectId = 1, ActorId = "s2" });
        repoMock.Setup(r => r.GetOrCreateMultiDimAsync(1, "user-1", null, null, "run-01", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryScopeData { ScopeId = 303, ProjectId = 1, ActorId = "r1" });

        var s1 = await service.GetOrCreateFromScopeKeyAsync(1, keySession1);
        var s2 = await service.GetOrCreateFromScopeKeyAsync(1, keySession2);
        var r1 = await service.GetOrCreateFromScopeKeyAsync(1, keyRun1);

        Assert.Equal(301, s1);
        Assert.Equal(302, s2);
        Assert.Equal(303, r1);
        Assert.NotEqual(s1, s2);
        Assert.NotEqual(s1, r1);
    }

    [Fact]
    public async Task Scope_EmptyKey_ThrowsArgumentException()
    {
        var repoMock = new Mock<IMemoryScopeRepository>();
        var service = new ScopeResolutionService(repoMock.Object);

        var emptyKey = new MemoryScopeKey();

        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.GetOrCreateFromScopeKeyAsync(1, emptyKey));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.ResolveFromScopeKeyAsync(1, emptyKey));
    }

    [Fact]
    public async Task Scope_LegacyActorIdFallback_WorksAsExpected()
    {
        var repoMock = new Mock<IMemoryScopeRepository>();
        var service = new ScopeResolutionService(repoMock.Object);

        var legacyKey = new MemoryScopeKey { ActorId = "legacy-actor" };

        repoMock.Setup(r => r.GetOrCreateAsync(1, "legacy-actor", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryScopeData { ScopeId = 999, ProjectId = 1, ActorId = "legacy-actor" });

        var scopeId = await service.GetOrCreateFromScopeKeyAsync(1, legacyKey);
        Assert.Equal(999, scopeId);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART B: ADD-ONLY INGESTION
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Ingestion_AddOnlyMode_AlwaysCreatesNewMemoryWithoutConsolidationUpdateOrMerge()
    {
        var extractorMock = new Mock<IMemoryExtractor>();
        var evaluatorMock = new Mock<IMemoryConsolidationEvaluator>();
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var similarityService = new SemanticSimilarityService();
        var scopeResMock = new Mock<IScopeResolutionService>();
        var entityExtractionMock = new Mock<IEntityExtractionService>();
        var entityRepoMock = new Mock<IEntityRepository>();
        var loggerMock = new Mock<ILogger<MemoryIngestionService>>();

        scopeResMock.Setup(s => s.GetOrCreateScopeAsync(10, "actor-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(500);

        extractorMock.Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = "I prefer PostgreSQL.", MemoryType = "Preference" }
            });

        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 0.1f, 0.2f, 0.3f });

        // Existing memory exists with high similarity
        memoryRepoMock.Setup(r => r.ExistsAsync(1, "I prefer PostgreSQL.", 500))
            .ReturnsAsync(false);
        memoryRepoMock.Setup(r => r.GetActiveMemoryEmbeddingsAsync(1, 500))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = 1, Content = "I use PostgreSQL database.", Embedding = new float[] { 0.1f, 0.2f, 0.3f }, Dimensions = 3, MemoryType = "Preference", Model = "mistral-embed" }
            });

        long createdMemoryId = 777;
        memoryRepoMock.Setup(r => r.CreateAsync(1, It.IsAny<ExtractedMemory>(), null, 500))
            .ReturnsAsync(createdMemoryId);

        var service = new MemoryIngestionService(
            extractorMock.Object,
            evaluatorMock.Object,
            memoryRepoMock.Object,
            embeddingGenMock.Object,
            similarityService,
            scopeResMock.Object,
            entityExtractionMock.Object,
            entityRepoMock.Object,
            loggerMock.Object);

        var request = new IngestConversationRequest
        {
            ActorId = "actor-1",
            Messages = [new IngestMessageItem { Role = "user", Content = "I prefer PostgreSQL." }]
        };

        var response = await service.IngestAsync(request, 1, 10);

        // Verification: Action MUST be Add, NOT Update or Merge
        Assert.True(response.Processed);
        Assert.Single(response.Memories);
        Assert.Equal(IngestionOperation.Add, response.Memories[0].Action);
        Assert.Equal(createdMemoryId, response.Memories[0].MemoryId);

        // Crucial: The consolidation evaluator must NOT have been called in ADD-only mode
        evaluatorMock.Verify(e => e.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()), Times.Never);

        // Memory repository CreateAsync was called
        memoryRepoMock.Verify(r => r.CreateAsync(1, It.IsAny<ExtractedMemory>(), null, 500), Times.Once);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART C: ENTITY EXTRACTION & REPOSITORY
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Entity_ExtractAndPersist_LinksEntitiesToMemory()
    {
        var extractorMock = new Mock<IMemoryExtractor>();
        var evaluatorMock = new Mock<IMemoryConsolidationEvaluator>();
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var similarityService = new SemanticSimilarityService();
        var scopeResMock = new Mock<IScopeResolutionService>();
        var entityExtractionMock = new Mock<IEntityExtractionService>();
        var entityRepoMock = new Mock<IEntityRepository>();
        var loggerMock = new Mock<ILogger<MemoryIngestionService>>();

        scopeResMock.Setup(s => s.GetOrCreateScopeAsync(10, "actor-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(500);

        extractorMock.Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = "I work at Microsoft and use Azure.", MemoryType = "Fact" }
            });

        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 0.1f, 0.2f, 0.3f });

        memoryRepoMock.Setup(r => r.CreateAsync(1, It.IsAny<ExtractedMemory>(), null, 500))
            .ReturnsAsync(101);

        // Mock entity extraction returning 2 entities
        entityExtractionMock.Setup(e => e.ExtractAsync("I work at Microsoft and use Azure.", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<ExtractedEntity>
            {
                new() { DisplayName = "Microsoft", NormalizedName = "microsoft", EntityType = "ORGANIZATION" },
                new() { DisplayName = "Azure", NormalizedName = "azure", EntityType = "PRODUCT" }
            });

        entityRepoMock.Setup(r => r.UpsertEntitiesForMemoryAsync(10, 101, It.IsAny<List<ExtractedEntity>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<EntityData>
            {
                new() { EntityId = 1, DisplayName = "Microsoft", NormalizedName = "microsoft", EntityType = "ORGANIZATION" },
                new() { EntityId = 2, DisplayName = "Azure", NormalizedName = "azure", EntityType = "PRODUCT" }
            });

        var service = new MemoryIngestionService(
            extractorMock.Object,
            evaluatorMock.Object,
            memoryRepoMock.Object,
            embeddingGenMock.Object,
            similarityService,
            scopeResMock.Object,
            entityExtractionMock.Object,
            entityRepoMock.Object,
            loggerMock.Object);

        var request = new IngestConversationRequest
        {
            ActorId = "actor-1",
            Messages = [new IngestMessageItem { Role = "user", Content = "I work at Microsoft and use Azure." }]
        };

        var response = await service.IngestAsync(request, 1, 10);

        Assert.True(response.Processed);
        // Verify entity upserts were called for memory 101
        entityRepoMock.Verify(r => r.UpsertEntitiesForMemoryAsync(10, 101, It.IsAny<List<ExtractedEntity>>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PART D: HYBRID RETRIEVAL & SCORE FUSION
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task HybridRetrieval_FusesSemanticKeywordAndEntitySignals()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var similarityService = new SemanticSimilarityService();
        var relevanceEvalMock = new Mock<IMemoryRelevanceEvaluator>();
        var keywordSearchMock = new Mock<IKeywordSearchRepository>();
        var entityRepoMock = new Mock<IEntityRepository>();
        var loggerMock = new Mock<ILogger<HybridRetrievalService>>();

        const long userId = 1;
        const long projectId = 10;
        const long scopeId = 500;
        const string query = "PostgreSQL database configuration";

        // Query embedding
        embeddingGenMock.Setup(e => e.GenerateAsync(query))
            .ReturnsAsync(new float[] { 1.0f, 0.0f });

        // Stored memories in scope
        memoryRepoMock.Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = 1, Content = "PostgreSQL tuning settings", MemoryType = "Fact", Dimensions = 2, Embedding = new float[] { 0.9f, 0.1f } },
                new() { MemoryId = 2, Content = "Python web development", MemoryType = "Skill", Dimensions = 2, Embedding = new float[] { 0.1f, 0.9f } }
            });

        // Keyword search matches memory 1
        keywordSearchMock.Setup(k => k.SearchAsync(userId, query, scopeId, It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>
            {
                new() { MemoryId = 1, Content = "PostgreSQL tuning settings", MemoryType = "Fact", RawScore = 5.0 }
            });

        // Entity repository has entity tokens for memory 1
        entityRepoMock.Setup(e => e.GetEntitiesForMemoriesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, List<EntityData>>
            {
                [1] = [new() { EntityId = 1, NormalizedName = "postgresql", DisplayName = "PostgreSQL", EntityType = "TECHNOLOGY" }]
            });

        // Relevance evaluator passes through
        relevanceEvalMock.Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> candidates) => candidates);

        var hybrid = new HybridRetrievalService(
            memoryRepoMock.Object,
            embeddingGenMock.Object,
            similarityService,
            relevanceEvalMock.Object,
            keywordSearchMock.Object,
            entityRepoMock.Object,
            loggerMock.Object);

        var results = await hybrid.RetrieveAsync(userId, projectId, query, topK: 5, scopeId: scopeId);

        Assert.NotEmpty(results);
        // Memory 1 should be ranked highest because it has high semantic, keyword, and entity signals
        Assert.Equal(1, results[0].MemoryId);
        Assert.True(results[0].Similarity > 0.5);
    }

    [Fact]
    public async Task ScopeIsolation_UserACannotRetrieveUserBMemory()
    {
        var scopeRepoMock = new Mock<IMemoryScopeRepository>();
        var scopeService = new ScopeResolutionService(scopeRepoMock.Object);

        const long projectId = 42;
        var scopeKeyUserA = new MemoryScopeKey { UserId = "alice" };
        var scopeKeyUserB = new MemoryScopeKey { UserId = "bob" };

        scopeRepoMock.Setup(r => r.GetByMultiDimKeyAsync(projectId, "alice", null, null, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryScopeData { ScopeId = 1001, ProjectId = projectId, UserId = "alice" });
        scopeRepoMock.Setup(r => r.GetByMultiDimKeyAsync(projectId, "bob", null, null, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryScopeData { ScopeId = 1002, ProjectId = projectId, UserId = "bob" });

        var resolvedScopeA = await scopeService.ResolveFromScopeKeyAsync(projectId, scopeKeyUserA);
        var resolvedScopeB = await scopeService.ResolveFromScopeKeyAsync(projectId, scopeKeyUserB);

        Assert.Equal(1001, resolvedScopeA);
        Assert.Equal(1002, resolvedScopeB);
        Assert.NotEqual(resolvedScopeA, resolvedScopeB);
    }

    [Fact]
    public async Task ScopeIsolation_AgentACannotRetrieveAgentBMemory()
    {
        var scopeRepoMock = new Mock<IMemoryScopeRepository>();
        var scopeService = new ScopeResolutionService(scopeRepoMock.Object);

        const long projectId = 42;
        var scopeKeyAgentA = new MemoryScopeKey { AgentId = "sales-agent" };
        var scopeKeyAgentB = new MemoryScopeKey { AgentId = "billing-agent" };

        scopeRepoMock.Setup(r => r.GetByMultiDimKeyAsync(projectId, null, "sales-agent", null, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryScopeData { ScopeId = 2001, ProjectId = projectId, AgentId = "sales-agent" });
        scopeRepoMock.Setup(r => r.GetByMultiDimKeyAsync(projectId, null, "billing-agent", null, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryScopeData { ScopeId = 2002, ProjectId = projectId, AgentId = "billing-agent" });

        var resolvedA = await scopeService.ResolveFromScopeKeyAsync(projectId, scopeKeyAgentA);
        var resolvedB = await scopeService.ResolveFromScopeKeyAsync(projectId, scopeKeyAgentB);

        Assert.Equal(2001, resolvedA);
        Assert.Equal(2002, resolvedB);
        Assert.NotEqual(resolvedA, resolvedB);
    }

    [Fact]
    public async Task HybridRetrieval_TopK_StrictlyLimitsResultCount()
    {
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var similarityService = new SemanticSimilarityService();
        var relevanceEvalMock = new Mock<IMemoryRelevanceEvaluator>();
        var keywordSearchMock = new Mock<IKeywordSearchRepository>();
        var entityRepoMock = new Mock<IEntityRepository>();
        var loggerMock = new Mock<ILogger<HybridRetrievalService>>();

        const long userId = 1;
        const long projectId = 10;
        const long scopeId = 500;
        const string query = "database";

        embeddingGenMock.Setup(e => e.GenerateAsync(query))
            .ReturnsAsync(new float[] { 1.0f, 0.0f });

        memoryRepoMock.Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = 1, Content = "Database 1", MemoryType = "Fact", Dimensions = 2, Embedding = new float[] { 1.0f, 0.0f } },
                new() { MemoryId = 2, Content = "Database 2", MemoryType = "Fact", Dimensions = 2, Embedding = new float[] { 0.9f, 0.1f } },
                new() { MemoryId = 3, Content = "Database 3", MemoryType = "Fact", Dimensions = 2, Embedding = new float[] { 0.8f, 0.2f } }
            });

        keywordSearchMock.Setup(k => k.SearchAsync(userId, query, scopeId, It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>());

        entityRepoMock.Setup(e => e.GetEntitiesForMemoriesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, List<EntityData>>());

        relevanceEvalMock.Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> candidates) => candidates);

        var hybrid = new HybridRetrievalService(
            memoryRepoMock.Object,
            embeddingGenMock.Object,
            similarityService,
            relevanceEvalMock.Object,
            keywordSearchMock.Object,
            entityRepoMock.Object,
            loggerMock.Object);

        var results = await hybrid.RetrieveAsync(userId, projectId, query, topK: 1, scopeId: scopeId);

        Assert.Single(results);
        Assert.Equal(1, results[0].MemoryId);
    }
}

