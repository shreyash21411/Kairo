using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Kairo.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Regression tests for cross-project memory isolation (SEC-001).
///
/// Verifies that <see cref="MemoryRepository"/> and <see cref="KeywordSearchRepository"/>
/// enforce project-level authorization boundaries so that:
/// 1. Memories belonging to Project A are never returned when querying for Project B.
/// 2. Key A cannot access Project B memories, even when the same user owns both projects.
/// 3. Key A cannot access Project B by supplying or manipulating an explicit projectId (mismatches fail closed).
/// 4. Missing or invalid project context (ProjectId = 0L) fails closed and never turns into an unfiltered search.
/// 5. Global retrieval across all projects must be explicitly authorized via ExplicitGlobalRetrieval (-1L).
/// 6. An authenticated project-scoped key cannot use the global retrieval sentinel to bypass isolation.
///
/// All tests are 100% offline using the EF Core in-memory provider.
/// </summary>
public class CrossProjectIsolationUnitTests
{
    // -------------------------------------------------------------------------
    // Shared test data - two projects, one user, one memory per project
    // -------------------------------------------------------------------------

    private const long UserId     = 42L;
    private const long ProjectA   = 101L;
    private const long ProjectB   = 202L;
    private const long ScopeA     = 1001L;
    private const long ScopeB     = 1002L;
    private const long MemoryIdA  = 5001L;
    private const long MemoryIdB  = 5002L;
    private const string ContentA = "This belongs to Project A Python async patterns";
    private const string ContentB = "This belongs to Project B Rust ownership model";

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static KairoDbContext CreateSeededDb()
    {
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        var db = new KairoDbContext(options);

        db.Users.Add(new Users
        {
            UserId        = UserId,
            Email         = "test@example.com",
            PasswordHash  = "x",
            AccountStatus = 1,
            CreatedAt     = DateTime.UtcNow,
            UpdatedAt     = DateTime.UtcNow
        });

        db.MemoryScopes.Add(new MemoryScopes
        {
            ScopeId   = ScopeA,
            ProjectId = ProjectA,
            ActorId   = "agent-a",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        db.MemoryScopes.Add(new MemoryScopes
        {
            ScopeId   = ScopeB,
            ProjectId = ProjectB,
            ActorId   = "agent-b",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });

        db.Memories.Add(new Memories
        {
            MemoryId   = MemoryIdA,
            UserId     = UserId,
            ScopeId    = ScopeA,
            Content    = ContentA,
            MemoryType = "fact",
            IsActive   = true,
            CreatedAt  = DateTime.UtcNow,
            UpdatedAt  = DateTime.UtcNow
        });
        db.MemoryEmbeddings.Add(new MemoryEmbeddings
        {
            EmbeddingId = 9001L,
            MemoryId    = MemoryIdA,
            Model       = "mistral-embed",
            Dimensions  = 3,
            VectorData  = "[0.1,0.2,0.3]",
            CreatedAt   = DateTime.UtcNow
        });

        db.Memories.Add(new Memories
        {
            MemoryId   = MemoryIdB,
            UserId     = UserId,
            ScopeId    = ScopeB,
            Content    = ContentB,
            MemoryType = "fact",
            IsActive   = true,
            CreatedAt  = DateTime.UtcNow,
            UpdatedAt  = DateTime.UtcNow
        });
        db.MemoryEmbeddings.Add(new MemoryEmbeddings
        {
            EmbeddingId = 9002L,
            MemoryId    = MemoryIdB,
            Model       = "mistral-embed",
            Dimensions  = 3,
            VectorData  = "[0.4,0.5,0.6]",
            CreatedAt   = DateTime.UtcNow
        });

        db.SaveChanges();
        return db;
    }

    private static Mock<IApiKeyContext> ContextForProject(long projectId)
    {
        var mock = new Mock<IApiKeyContext>();
        mock.Setup(c => c.UserId).Returns(UserId);
        mock.Setup(c => c.ProjectId).Returns(projectId);
        mock.Setup(c => c.ApiKeyId).Returns(1L);
        return mock;
    }

    // -------------------------------------------------------------------------
    // MemoryRepository - GetFilteredActiveMemoryEmbeddingsAsync
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GetFilteredEmbeddings_ContextProjectA_ReturnsOnlyProjectAEmbeddings()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        var results = await repo.GetFilteredActiveMemoryEmbeddingsAsync(UserId, null, null, null);

        Assert.Single(results);
        Assert.Equal(MemoryIdA, results[0].MemoryId);
    }

    [Fact]
    public async Task GetFilteredEmbeddings_ContextProjectB_ReturnsOnlyProjectBEmbeddings()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, ContextForProject(ProjectB).Object);

        var results = await repo.GetFilteredActiveMemoryEmbeddingsAsync(UserId, null, null, null);

        Assert.Single(results);
        Assert.Equal(MemoryIdB, results[0].MemoryId);
    }

    [Fact]
    public async Task GetFilteredEmbeddings_ContextProjectA_ExplicitProjectB_FailsClosed()
    {
        using var db = CreateSeededDb();
        // Key A is bound to Project A. Supplying explicit Project B must fail closed to protect isolation.
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        var results = await repo.GetFilteredActiveMemoryEmbeddingsAsync(
            userId: UserId,
            scopeId: null,
            temporalFilter: null,
            metadataFilters: null,
            categoryFilters: null,
            projectId: ProjectB);

        Assert.Empty(results);
    }

    [Fact]
    public async Task GetFilteredEmbeddings_ZeroProjectInContext_FailsClosed()
    {
        using var db = CreateSeededDb();
        var noContextMock = new Mock<IApiKeyContext>();
        noContextMock.Setup(c => c.UserId).Returns(UserId);
        noContextMock.Setup(c => c.ProjectId).Returns(0L);
        noContextMock.Setup(c => c.ApiKeyId).Returns(1L);

        var repo = new MemoryRepository(db, noContextMock.Object);

        var results = await repo.GetFilteredActiveMemoryEmbeddingsAsync(UserId, null, null, null);

        Assert.Empty(results);
    }

    [Fact]
    public async Task GetFilteredEmbeddings_ExplicitGlobalRetrieval_ReturnsBothProjects()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, apiKeyContext: null);

        var results = await repo.GetFilteredActiveMemoryEmbeddingsAsync(
            userId: UserId,
            scopeId: null,
            temporalFilter: null,
            metadataFilters: null,
            categoryFilters: null,
            projectId: ProjectAuthorizationContext.ExplicitGlobalRetrieval);

        Assert.Equal(2, results.Count);
    }

    [Fact]
    public async Task GetFilteredEmbeddings_ContextProjectA_GlobalSentinelAttempt_FailsClosed()
    {
        using var db = CreateSeededDb();
        // Project-scoped key attempting to pass global retrieval sentinel must fail closed.
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        var results = await repo.GetFilteredActiveMemoryEmbeddingsAsync(
            userId: UserId,
            scopeId: null,
            temporalFilter: null,
            metadataFilters: null,
            categoryFilters: null,
            projectId: ProjectAuthorizationContext.ExplicitGlobalRetrieval);

        Assert.Empty(results);
    }

    // -------------------------------------------------------------------------
    // MemoryRepository - GetActiveMemoryEmbeddingsAsync overloads
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GetActiveEmbeddings_ExplicitProjectId_IsolatesBothDirections()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, apiKeyContext: null);

        var resultsA = await repo.GetActiveMemoryEmbeddingsAsync(UserId, null, ProjectA);
        var resultsB = await repo.GetActiveMemoryEmbeddingsAsync(UserId, null, ProjectB);

        Assert.Single(resultsA);
        Assert.Equal(MemoryIdA, resultsA[0].MemoryId);
        Assert.Single(resultsB);
        Assert.Equal(MemoryIdB, resultsB[0].MemoryId);
    }

    [Fact]
    public async Task GetActiveEmbeddings_CompatibilityOverload_RespectsContextProjectId()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        // 2-arg overload has no explicit projectId - must still honour context
        var results = await repo.GetActiveMemoryEmbeddingsAsync(UserId, null);

        Assert.Single(results);
        Assert.Equal(MemoryIdA, results[0].MemoryId);
    }

    // -------------------------------------------------------------------------
    // MemoryRepository - GetMemorySnapshotsAsync
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GetMemorySnapshots_WithProjectFilter_ExcludesOtherProject()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        var result = await repo.GetMemorySnapshotsAsync(new[] { MemoryIdA, MemoryIdB }, ProjectA);

        Assert.Single(result);
        Assert.True(result.ContainsKey(MemoryIdA));
        Assert.False(result.ContainsKey(MemoryIdB));
    }

    [Fact]
    public async Task GetMemorySnapshots_ZeroProjectInContext_FailsClosed()
    {
        using var db = CreateSeededDb();
        var zeroContextMock = new Mock<IApiKeyContext>();
        zeroContextMock.Setup(c => c.UserId).Returns(UserId);
        zeroContextMock.Setup(c => c.ProjectId).Returns(0L);

        var repo = new MemoryRepository(db, zeroContextMock.Object);

        var result = await repo.GetMemorySnapshotsAsync(new[] { MemoryIdA, MemoryIdB });

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetMemorySnapshots_ExplicitGlobalRetrieval_ReturnsBothProjects()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, apiKeyContext: null);

        var result = await repo.GetMemorySnapshotsAsync(
            new[] { MemoryIdA, MemoryIdB },
            projectId: ProjectAuthorizationContext.ExplicitGlobalRetrieval);

        Assert.Equal(2, result.Count);
        Assert.True(result.ContainsKey(MemoryIdA));
        Assert.True(result.ContainsKey(MemoryIdB));
    }

    // -------------------------------------------------------------------------
    // GetEffectiveProjectId priority rules (observed via behaviour)
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Priority_ContextEnforced_MismatchingExplicitProjectIdFailsClosed()
    {
        using var db = CreateSeededDb();
        // Context = ProjectA, explicit = ProjectB -> Mismatch fails closed, Key A cannot access Project B
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        var result = await repo.GetMemorySnapshotsAsync(
            new[] { MemoryIdA, MemoryIdB }, projectId: ProjectB);

        Assert.Empty(result);
    }

    [Fact]
    public async Task Priority_ContextUsedWhenNoExplicitProjectId()
    {
        using var db = CreateSeededDb();
        // Context = ProjectB, explicit = null ? ProjectB context wins
        var repo = new MemoryRepository(db, ContextForProject(ProjectB).Object);

        var result = await repo.GetMemorySnapshotsAsync(
            new[] { MemoryIdA, MemoryIdB }, projectId: null);

        Assert.Single(result);
        Assert.True(result.ContainsKey(MemoryIdB));
    }

    // -------------------------------------------------------------------------
    // KeywordSearchRepository - SearchAsync project isolation
    // -------------------------------------------------------------------------

    [Fact]
    public async Task KeywordSearch_ContextProjectA_DoesNotReturnProjectBContent()
    {
        using var db = CreateSeededDb();
        var repo = new KeywordSearchRepository(db, ContextForProject(ProjectA).Object);

        // "Python" is only in ContentA
        var results = await repo.SearchAsync(UserId, "Python async", scopeId: null);

        Assert.All(results, r => Assert.Equal(MemoryIdA, r.MemoryId));
        Assert.DoesNotContain(results, r => r.MemoryId == MemoryIdB);
    }

    [Fact]
    public async Task KeywordSearch_ContextProjectB_DoesNotReturnProjectAContent()
    {
        using var db = CreateSeededDb();
        var repo = new KeywordSearchRepository(db, ContextForProject(ProjectB).Object);

        // "Rust" is only in ContentB
        var results = await repo.SearchAsync(UserId, "Rust ownership", scopeId: null);

        Assert.All(results, r => Assert.Equal(MemoryIdB, r.MemoryId));
        Assert.DoesNotContain(results, r => r.MemoryId == MemoryIdA);
    }

    [Fact]
    public async Task KeywordSearch_ContextProjectA_ExplicitProjectB_FailsClosed()
    {
        // Context = ProjectA but explicit projectId = ProjectB -> must fail closed (empty)
        using var db = CreateSeededDb();
        var repo = new KeywordSearchRepository(db, ContextForProject(ProjectA).Object);

        var results = await repo.SearchAsync(
            UserId, "Rust ownership",
            scopeId: null, limit: 10,
            projectId: ProjectB,
            cancellationToken: CancellationToken.None);

        Assert.Empty(results);
    }

    [Fact]
    public async Task KeywordSearch_ZeroProjectInContext_FailsClosed()
    {
        using var db = CreateSeededDb();
        var zeroContextMock = new Mock<IApiKeyContext>();
        zeroContextMock.Setup(c => c.UserId).Returns(UserId);
        zeroContextMock.Setup(c => c.ProjectId).Returns(0L);

        var repo = new KeywordSearchRepository(db, zeroContextMock.Object);

        var results = await repo.SearchAsync(UserId, "belongs project", scopeId: null);

        Assert.Empty(results);
    }

    [Fact]
    public async Task KeywordSearch_ExplicitGlobalRetrieval_ReturnsBothProjects()
    {
        using var db = CreateSeededDb();
        var repo = new KeywordSearchRepository(db, apiKeyContext: null);

        var results = await repo.SearchAsync(
            UserId, "belongs project",
            scopeId: null, limit: 10,
            projectId: ProjectAuthorizationContext.ExplicitGlobalRetrieval,
            cancellationToken: CancellationToken.None);

        var ids = results.Select(r => r.MemoryId).ToHashSet();
        Assert.Contains(MemoryIdA, ids);
        Assert.Contains(MemoryIdB, ids);
    }

    // -------------------------------------------------------------------------
    // Cross-contamination scenario - same query matches both projects
    // -------------------------------------------------------------------------

    [Fact]
    public async Task KeywordSearch_ProjectScoped_NeverLeaksCrossProject_EvenWhenQueryMatchesBoth()
    {
        using var db = CreateSeededDb();

        // "belongs" matches both ContentA and ContentB.
        // ProjectA-scoped context must only return Memory A.
        var repoA = new KeywordSearchRepository(db, ContextForProject(ProjectA).Object);
        var resultsA = await repoA.SearchAsync(UserId, "belongs", scopeId: null);
        Assert.All(resultsA, r => Assert.Equal(MemoryIdA, r.MemoryId));

        // ProjectB-scoped context must only return Memory B.
        var repoB = new KeywordSearchRepository(db, ContextForProject(ProjectB).Object);
        var resultsB = await repoB.SearchAsync(UserId, "belongs", scopeId: null);
        Assert.All(resultsB, r => Assert.Equal(MemoryIdB, r.MemoryId));
    }

    [Fact]
    public async Task EmbeddingRetrieval_ProjectScoped_NeverLeaksCrossProject()
    {
        using var db = CreateSeededDb();

        var repoA = new MemoryRepository(db, ContextForProject(ProjectA).Object);
        var embeddingsA = await repoA.GetFilteredActiveMemoryEmbeddingsAsync(UserId, null, null, null);

        // Must never contain an embedding whose memory belongs to ProjectB
        Assert.All(embeddingsA, e => Assert.Equal(MemoryIdA, e.MemoryId));
        Assert.DoesNotContain(embeddingsA, e => e.MemoryId == MemoryIdB);
    }

    // -------------------------------------------------------------------------
    // SearchSimilarEmbeddingsAsync - Native / Fallback Vector Isolation
    // -------------------------------------------------------------------------

    [Fact]
    public async Task SearchSimilarEmbeddings_ContextProjectA_ReturnsOnlyProjectAMemory()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        var queryVec = new float[] { 0.1f, 0.2f, 0.3f };
        var results = await repo.SearchSimilarEmbeddingsAsync(
            UserId, queryVec, "mistral-embed", topK: 5);

        Assert.Single(results);
        Assert.Equal(MemoryIdA, results[0].MemoryId);
    }

    [Fact]
    public async Task SearchSimilarEmbeddings_ContextProjectB_ReturnsOnlyProjectBMemory()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, ContextForProject(ProjectB).Object);

        var queryVec = new float[] { 0.4f, 0.5f, 0.6f };
        var results = await repo.SearchSimilarEmbeddingsAsync(
            UserId, queryVec, "mistral-embed", topK: 5);

        Assert.Single(results);
        Assert.Equal(MemoryIdB, results[0].MemoryId);
    }

    [Fact]
    public async Task SearchSimilarEmbeddings_ContextProjectA_ExplicitProjectB_FailsClosed()
    {
        using var db = CreateSeededDb();
        // Context is ProjectA, but explicit call requests ProjectB -> fails closed (empty)
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        var queryVec = new float[] { 0.1f, 0.2f, 0.3f };
        var results = await repo.SearchSimilarEmbeddingsAsync(
            UserId, queryVec, "mistral-embed", topK: 5,
            scopeId: null, temporalFilter: null, metadataFilters: null, categoryFilters: null,
            projectId: ProjectB);

        Assert.Empty(results);
    }

    [Fact]
    public async Task SearchSimilarEmbeddings_ZeroProjectInContext_FailsClosed()
    {
        using var db = CreateSeededDb();
        var zeroContextMock = new Mock<IApiKeyContext>();
        zeroContextMock.Setup(c => c.UserId).Returns(UserId);
        zeroContextMock.Setup(c => c.ProjectId).Returns(0L);

        var repo = new MemoryRepository(db, zeroContextMock.Object);

        var queryVec = new float[] { 0.1f, 0.2f, 0.3f };
        var results = await repo.SearchSimilarEmbeddingsAsync(
            UserId, queryVec, "mistral-embed", topK: 5);

        Assert.Empty(results);
    }

    [Fact]
    public async Task SearchSimilarEmbeddings_ExplicitGlobalRetrieval_ReturnsBothProjects()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, apiKeyContext: null);

        var queryVec = new float[] { 0.1f, 0.2f, 0.3f };
        var results = await repo.SearchSimilarEmbeddingsAsync(
            UserId, queryVec, "mistral-embed", topK: 5,
            scopeId: null, temporalFilter: null, metadataFilters: null, categoryFilters: null,
            projectId: ProjectAuthorizationContext.ExplicitGlobalRetrieval);

        Assert.Equal(2, results.Count);
    }

    // -------------------------------------------------------------------------
    // MemoryRetrievalService - Service-layer Isolation & Explicit ProjectId
    // -------------------------------------------------------------------------

    [Fact]
    public async Task MemoryRetrievalService_ExplicitProjectId_IsolatesRetrievalEvenWithNullContext()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, apiKeyContext: null);

        var embGenMock = new Mock<IEmbeddingGenerator>();
        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 0.1f, 0.2f, 0.3f });
        embGenMock.As<IEmbeddingMetadataProvider>()
            .Setup(m => m.ModelName)
            .Returns("mistral-embed");

        var relevanceMock = new Mock<IMemoryRelevanceEvaluator>();
        relevanceMock.Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

        var service = new MemoryRetrievalService(
            repo, embGenMock.Object, new SemanticSimilarityService(), relevanceMock.Object);

        // Query with explicit ProjectA
        var resultsA = await service.RetrieveAsync(UserId, "patterns", topK: 5, scopeId: null, projectId: ProjectA);
        Assert.Single(resultsA);
        Assert.Equal(MemoryIdA, resultsA[0].MemoryId);

        // Query with explicit ProjectB
        var resultsB = await service.RetrieveAsync(UserId, "patterns", topK: 5, scopeId: null, projectId: ProjectB);
        Assert.Single(resultsB);
        Assert.Equal(MemoryIdB, resultsB[0].MemoryId);
    }

    [Fact]
    public async Task MemoryRetrievalService_ContextProjectA_ExplicitProjectB_FailsClosed()
    {
        using var db = CreateSeededDb();
        // Context says ProjectA
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        var embGenMock = new Mock<IEmbeddingGenerator>();
        embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 0.1f, 0.2f, 0.3f });
        embGenMock.As<IEmbeddingMetadataProvider>()
            .Setup(m => m.ModelName)
            .Returns("mistral-embed");

        var relevanceMock = new Mock<IMemoryRelevanceEvaluator>();
        relevanceMock.Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

        var service = new MemoryRetrievalService(
            repo, embGenMock.Object, new SemanticSimilarityService(), relevanceMock.Object);

        // Explicit call asks for ProjectB when authenticated as ProjectA — must fail closed
        var results = await service.RetrieveAsync(UserId, "query", topK: 5, scopeId: null, projectId: ProjectB);
        Assert.Empty(results);
    }

    // -------------------------------------------------------------------------
    // User Isolation & Cross-Tenant Boundary Tests
    // -------------------------------------------------------------------------

    [Fact]
    public async Task UserIsolation_QueryForDifferentUser_ReturnsEmpty()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        const long ForeignUserId = 99999L;
        var embeddings = await repo.GetFilteredActiveMemoryEmbeddingsAsync(ForeignUserId, null, null, null);
        Assert.Empty(embeddings);

        var similar = await repo.SearchSimilarEmbeddingsAsync(
            ForeignUserId, new float[] { 0.1f, 0.2f, 0.3f }, "mistral-embed", topK: 5);
        Assert.Empty(similar);
    }

    [Fact]
    public async Task GetMemorySnapshotForUser_CrossProject_ReturnsNull()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        // MemoryIdA belongs to ProjectA. Requesting it under ProjectB must return null.
        var snapshot = await repo.GetMemorySnapshotForUserAsync(MemoryIdA, UserId, projectId: ProjectB);
        Assert.Null(snapshot);

        // Requesting it under its own ProjectA returns the snapshot.
        var validSnapshot = await repo.GetMemorySnapshotForUserAsync(MemoryIdA, UserId, projectId: ProjectA);
        Assert.NotNull(validSnapshot);
        Assert.Equal(MemoryIdA, validSnapshot!.MemoryId);
    }

    [Fact]
    public async Task GetMemorySnapshotForUser_ForeignUser_ReturnsNull()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        const long ForeignUserId = 88888L;
        // MemoryIdA belongs to UserId, requesting as ForeignUserId must fail closed.
        var snapshot = await repo.GetMemorySnapshotForUserAsync(MemoryIdA, ForeignUserId, projectId: ProjectA);
        Assert.Null(snapshot);
    }

    // -------------------------------------------------------------------------
    // Background Job Identity & Authorization Boundary Tests
    // -------------------------------------------------------------------------

    [Fact]
    public async Task BackgroundJob_ProcessesWithProjectIdCapturedAtEnqueueTime()
    {
        using var db = CreateSeededDb();
        // Background worker has null ambient context
        var repo = new MemoryRepository(db, apiKeyContext: null);

        // Job was enqueued with ProjectA identity
        var jobRecord = new MemoryIngestionJobRecord
        {
            JobId = 7001L,
            UserId = UserId,
            ProjectId = ProjectA,
            ScopeId = ScopeA,
            MemoryId = MemoryIdA,
            JobType = "CreateMemory",
            Status = "Pending"
        };

        // Worker fetches memory using captured job.ProjectId
        var memory = await repo.GetMemorySnapshotForUserAsync(
            jobRecord.MemoryId.Value,
            jobRecord.UserId,
            jobRecord.ProjectId,
            jobRecord.ScopeId);

        Assert.NotNull(memory);
        Assert.Equal(MemoryIdA, memory!.MemoryId);
        Assert.Equal(ContentA, memory.Content);
    }

    [Fact]
    public async Task BackgroundJob_ManipulatedProjectId_FailsClosedAndCannotAccessForeignProjectMemory()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, apiKeyContext: null);

        // Job targeting MemoryIdA (in ProjectA) has manipulated / cross-project ProjectId = ProjectB
        var tamperedJobRecord = new MemoryIngestionJobRecord
        {
            JobId = 7002L,
            UserId = UserId,
            ProjectId = ProjectB,
            ScopeId = ScopeA,
            MemoryId = MemoryIdA,
            JobType = "CreateMemory",
            Status = "Pending"
        };

        // Worker execution with ProjectB must fail closed (return null)
        var memory = await repo.GetMemorySnapshotForUserAsync(
            tamperedJobRecord.MemoryId.Value,
            tamperedJobRecord.UserId,
            tamperedJobRecord.ProjectId,
            tamperedJobRecord.ScopeId);

        Assert.Null(memory);
    }
}
