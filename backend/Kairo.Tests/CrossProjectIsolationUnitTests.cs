using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.DTOs;
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
/// enforce project-level scoping so that:
/// 1. Memories belonging to Project A are never returned when querying for Project B.
/// 2. The IApiKeyContext-injected project ID is used as an automatic filter when no
///    explicit projectId argument is provided.
/// 3. An explicit projectId argument takes precedence over the context projectId.
/// 4. When neither a context projectId nor an explicit projectId is supplied, all projects
///    for the given user are returned (backwards-compatible behaviour).
///
/// All tests are 100% offline using the EF Core in-memory provider.
/// </summary>
public class CrossProjectIsolationUnitTests
{
    // -------------------------------------------------------------------------
    // Shared test data — two projects, one user, one memory per project
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
    // MemoryRepository — GetFilteredActiveMemoryEmbeddingsAsync
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
    public async Task GetFilteredEmbeddings_ExplicitProjectIdOverridesContext()
    {
        using var db = CreateSeededDb();
        // Context says ProjectA, explicit arg says ProjectB — explicit wins.
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        var results = await repo.GetFilteredActiveMemoryEmbeddingsAsync(
            userId: UserId,
            scopeId: null,
            temporalFilter: null,
            metadataFilters: null,
            categoryFilters: null,
            projectId: ProjectB);

        Assert.Single(results);
        Assert.Equal(MemoryIdB, results[0].MemoryId);
    }

    [Fact]
    public async Task GetFilteredEmbeddings_ZeroProjectInContext_ReturnsBothProjects()
    {
        using var db = CreateSeededDb();
        var noContextMock = new Mock<IApiKeyContext>();
        noContextMock.Setup(c => c.UserId).Returns(UserId);
        noContextMock.Setup(c => c.ProjectId).Returns(0L);
        noContextMock.Setup(c => c.ApiKeyId).Returns(1L);

        var repo = new MemoryRepository(db, noContextMock.Object);

        var results = await repo.GetFilteredActiveMemoryEmbeddingsAsync(UserId, null, null, null);

        Assert.Equal(2, results.Count);
    }

    [Fact]
    public async Task GetFilteredEmbeddings_NullContext_ReturnsBothProjects()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, apiKeyContext: null);

        var results = await repo.GetFilteredActiveMemoryEmbeddingsAsync(UserId, null, null, null);

        Assert.Equal(2, results.Count);
    }

    // -------------------------------------------------------------------------
    // MemoryRepository — GetActiveMemoryEmbeddingsAsync overloads
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

        // 2-arg overload has no explicit projectId — must still honour context
        var results = await repo.GetActiveMemoryEmbeddingsAsync(UserId, null);

        Assert.Single(results);
        Assert.Equal(MemoryIdA, results[0].MemoryId);
    }

    // -------------------------------------------------------------------------
    // MemoryRepository — GetMemorySnapshotsAsync
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
    public async Task GetMemorySnapshots_NoProjectFilter_ReturnsBothProjects()
    {
        using var db = CreateSeededDb();
        var repo = new MemoryRepository(db, apiKeyContext: null);

        var result = await repo.GetMemorySnapshotsAsync(new[] { MemoryIdA, MemoryIdB });

        Assert.Equal(2, result.Count);
        Assert.True(result.ContainsKey(MemoryIdA));
        Assert.True(result.ContainsKey(MemoryIdB));
    }

    // -------------------------------------------------------------------------
    // GetEffectiveProjectId priority rules (observed via behaviour)
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Priority_ExplicitProjectIdBeatsContext()
    {
        using var db = CreateSeededDb();
        // Context = ProjectA, explicit = ProjectB ? ProjectB wins
        var repo = new MemoryRepository(db, ContextForProject(ProjectA).Object);

        var result = await repo.GetMemorySnapshotsAsync(
            new[] { MemoryIdA, MemoryIdB }, projectId: ProjectB);

        Assert.Single(result);
        Assert.True(result.ContainsKey(MemoryIdB));
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
    // KeywordSearchRepository — SearchAsync project isolation
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
    public async Task KeywordSearch_ExplicitProjectId_OverridesContextProject()
    {
        // Context = ProjectA but explicit projectId = ProjectB ? only B returned
        using var db = CreateSeededDb();
        var repo = new KeywordSearchRepository(db, ContextForProject(ProjectA).Object);

        var results = await repo.SearchAsync(
            UserId, "Rust ownership",
            scopeId: null, limit: 10,
            projectId: ProjectB,
            cancellationToken: CancellationToken.None);

        Assert.All(results, r => Assert.Equal(MemoryIdB, r.MemoryId));
    }

    [Fact]
    public async Task KeywordSearch_NullContext_NoProjectFilter_ReturnsBothProjects()
    {
        using var db = CreateSeededDb();
        var repo = new KeywordSearchRepository(db, apiKeyContext: null);

        // "belongs" appears in both content strings
        var results = await repo.SearchAsync(UserId, "belongs project", scopeId: null);

        var ids = results.Select(r => r.MemoryId).ToHashSet();
        Assert.Contains(MemoryIdA, ids);
        Assert.Contains(MemoryIdB, ids);
    }

    // -------------------------------------------------------------------------
    // Cross-contamination scenario — same query matches both projects
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
}
