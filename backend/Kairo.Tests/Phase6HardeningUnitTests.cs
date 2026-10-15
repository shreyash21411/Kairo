using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kairo.API.Controllers;
using Kairo.Application;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Kairo.Infrastructure.Repositories;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Phase 6.3 & 6.4 Hardening and End-to-End Unit & Integration Tests.
/// Covers:
/// - GAP-01: Memory History API (GET /api/v1/memories/{id}/history)
/// - GAP-02: Actor-Level Purge API (DELETE /api/v1/memories?actorId={actorId})
/// - Security isolation, IDOR defense, and usage recording
/// - Repository EF Core integration against in-memory provider
/// </summary>
public class Phase6HardeningUnitTests : IDisposable
{
    private readonly KairoDbContext _db;

    public Phase6HardeningUnitTests()
    {
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        _db = new KairoDbContext(options);
    }

    public void Dispose()
    {
        _db.Database.EnsureDeleted();
        _db.Dispose();
    }

    private static MemoryService CreateMemoryService(
        IMemoryRepository? memoryRepo = null,
        IScopeResolutionService? scopeResolver = null)
    {
        var memRepo = memoryRepo ?? Mock.Of<IMemoryRepository>();
        var userRepo = new Mock<IUserRepository>();
        userRepo.SetReturnsDefault(Task.FromResult(true));
        var embGen = Mock.Of<IEmbeddingGenerator>();
        var simService = new SemanticSimilarityService();
        var relevanceEval = Mock.Of<IMemoryRelevanceEvaluator>();
        var retService = new MemoryRetrievalService(memRepo, embGen, simService, relevanceEval);
        var scopeRes = scopeResolver ?? Mock.Of<IScopeResolutionService>();

        return new MemoryService(
            memRepo,
            userRepo.Object,
            embGen,
            simService,
            retService,
            scopeRes);
    }

    // ── GAP-01: Repository-Level History Tests ─────────────────────────────────

    [Fact]
    public async Task Repository_GetMemoryHistoryAsync_ReturnsDeterministicDescendingOrder()
    {
        var repo = new MemoryRepository(_db);
        long memId = 101;

        var t0 = new DateTime(2026, 10, 15, 10, 0, 0, DateTimeKind.Utc);
        var t1 = new DateTime(2026, 10, 15, 11, 0, 0, DateTimeKind.Utc);
        var t2 = new DateTime(2026, 10, 15, 12, 0, 0, DateTimeKind.Utc);

        _db.MemoryVersions.AddRange(
            new MemoryVersions { MemoryVersionId = 1, MemoryId = memId, Content = "V1", Operation = "ApiCreate", CreatedAt = t0 },
            new MemoryVersions { MemoryVersionId = 2, MemoryId = memId, Content = "V2", Operation = "ApiUpdate", CreatedAt = t1 },
            new MemoryVersions { MemoryVersionId = 3, MemoryId = memId, Content = "V3", Operation = "ApiUpdate", CreatedAt = t2 },
            new MemoryVersions { MemoryVersionId = 4, MemoryId = 999, Content = "Other Mem", Operation = "ApiCreate", CreatedAt = t2 }
        );
        await _db.SaveChangesAsync();

        var history = await repo.GetMemoryHistoryAsync(memId);

        Assert.Equal(3, history.Count);
        Assert.Equal(3, history[0].MemoryVersionId);
        Assert.Equal("V3", history[0].Content);
        Assert.Equal(2, history[1].MemoryVersionId);
        Assert.Equal("V2", history[1].Content);
        Assert.Equal(1, history[2].MemoryVersionId);
        Assert.Equal("V1", history[2].Content);
    }

    [Fact]
    public async Task Repository_GetMemoryHistoryAsync_ReturnsEmptyWhenNoVersions()
    {
        var repo = new MemoryRepository(_db);
        var history = await repo.GetMemoryHistoryAsync(404);
        Assert.NotNull(history);
        Assert.Empty(history);
    }

    // ── GAP-01: Service-Level History Tests ────────────────────────────────────

    [Fact]
    public async Task Service_GetMemoryHistoryAsync_Authorized_ReturnsHistoryResponse()
    {
        var mockRepo = new Mock<IMemoryRepository>();
        long memId = 101;
        long userId = 1;
        long projectId = 10;

        mockRepo.Setup(r => r.GetMemorySnapshotForUserAsync(memId, userId, projectId, null))
            .ReturnsAsync(new MemorySnapshot
            {
                MemoryId = memId,
                UserId = userId,
                Content = "Current content",
                IsActive = true
            });

        var expectedVersions = new List<MemoryVersionResponse>
        {
            new() { MemoryVersionId = 2, MemoryId = memId, Content = "Old content 2", Operation = "ApiUpdate", CreatedAt = DateTime.UtcNow },
            new() { MemoryVersionId = 1, MemoryId = memId, Content = "Old content 1", Operation = "ApiCreate", CreatedAt = DateTime.UtcNow.AddMinutes(-5) }
        };

        mockRepo.Setup(r => r.GetMemoryHistoryAsync(memId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(expectedVersions);

        var service = CreateMemoryService(mockRepo.Object);

        var result = await service.GetMemoryHistoryAsync(memId, userId, projectId);

        Assert.NotNull(result);
        Assert.Equal(memId, result.MemoryId);
        Assert.Equal(2, result.Count);
        Assert.Equal(2, result.Versions.Count);
        Assert.Equal("Old content 2", result.Versions[0].Content);
    }

    [Fact]
    public async Task Service_GetMemoryHistoryAsync_MemoryNotFound_ThrowsKeyNotFoundException()
    {
        var mockRepo = new Mock<IMemoryRepository>();
        mockRepo.Setup(r => r.GetMemorySnapshotForUserAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<long?>(), It.IsAny<long?>()))
            .ReturnsAsync((MemorySnapshot?)null);

        var service = CreateMemoryService(mockRepo.Object);

        await Assert.ThrowsAsync<KeyNotFoundException>(
            () => service.GetMemoryHistoryAsync(999, 1, 10));
    }

    [Fact]
    public async Task Service_GetMemoryHistoryAsync_CrossProjectAccess_DeniedAsNotFound()
    {
        var mockRepo = new Mock<IMemoryRepository>();
        long memId = 101;
        long userId = 1;
        long callerProjectId = 20;

        // Repository returns null because memory belongs to Project 10, not Project 20
        mockRepo.Setup(r => r.GetMemorySnapshotForUserAsync(memId, userId, callerProjectId, null))
            .ReturnsAsync((MemorySnapshot?)null);

        var service = CreateMemoryService(mockRepo.Object);

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(
            () => service.GetMemoryHistoryAsync(memId, userId, callerProjectId));

        Assert.Contains("was not found or does not belong to the current project", ex.Message);
        mockRepo.Verify(r => r.GetMemoryHistoryAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Service_GetMemoryHistoryAsync_InvalidId_ThrowsArgumentException()
    {
        var service = CreateMemoryService();

        await Assert.ThrowsAsync<ArgumentException>(
            () => service.GetMemoryHistoryAsync(0, 1, 10));
        await Assert.ThrowsAsync<ArgumentException>(
            () => service.GetMemoryHistoryAsync(-1, 1, 10));
    }

    // ── GAP-01: Controller-Level History Tests ─────────────────────────────────

    [Fact]
    public async Task Controller_GetMemoryHistory_ReturnsOkAndRecordsUsage()
    {
        var mockService = new Mock<IMemoryService>();
        var mockApiKeyContext = new Mock<IApiKeyContext>();
        mockApiKeyContext.Setup(c => c.UserId).Returns(1);
        mockApiKeyContext.Setup(c => c.ProjectId).Returns(10);

        var mockUsage = new Mock<IUsageMeterService>();

        mockService.Setup(s => s.GetMemoryHistoryAsync(101, 1, 10, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryHistoryResponse
            {
                MemoryId = 101,
                Count = 1,
                Versions = [new() { MemoryVersionId = 1, MemoryId = 101, Content = "V1", Operation = "ApiCreate", CreatedAt = DateTime.UtcNow }]
            });

        var controller = new MemoryController(
            mockService.Object,
            Mock.Of<IMemoryIngestionService>(),
            mockApiKeyContext.Object,
            null!,
            null,
            mockUsage.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };

        var actionResult = await controller.GetMemoryHistory(101);

        var okResult = Assert.IsType<OkObjectResult>(actionResult);
        var response = Assert.IsType<MemoryHistoryResponse>(okResult.Value);
        Assert.Equal(101, response.MemoryId);
        Assert.Equal(1, response.Count);

        mockUsage.Verify(u => u.RecordAsync(1, 10, UsageOperationType.MemoryGet, UsageOutcome.Success, 1), Times.Once);
    }

    [Fact]
    public async Task Controller_GetMemoryHistory_NotFound_Returns404()
    {
        var mockService = new Mock<IMemoryService>();
        var mockApiKeyContext = new Mock<IApiKeyContext>();
        mockApiKeyContext.Setup(c => c.UserId).Returns(1);
        mockApiKeyContext.Setup(c => c.ProjectId).Returns(10);

        mockService.Setup(s => s.GetMemoryHistoryAsync(999, 1, 10, null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new KeyNotFoundException("Memory 999 not found."));

        var controller = new MemoryController(
            mockService.Object,
            Mock.Of<IMemoryIngestionService>(),
            mockApiKeyContext.Object,
            null!)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };

        var actionResult = await controller.GetMemoryHistory(999);

        var notFoundResult = Assert.IsType<NotFoundObjectResult>(actionResult);
        Assert.NotNull(notFoundResult.Value);
    }

    // ── GAP-02: Repository-Level Active Memories For Scope Tests ──────────────

    [Fact]
    public async Task Repository_GetActiveMemoriesForScopeAsync_ReturnsOnlyActiveMatchingScope()
    {
        var repo = new MemoryRepository(_db);
        long userId = 1;
        long targetScopeId = 100;
        long otherScopeId = 200;

        _db.Memories.AddRange(
            new Memories { MemoryId = 1, UserId = userId, ScopeId = targetScopeId, Content = "Mem 1", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
            new Memories { MemoryId = 2, UserId = userId, ScopeId = targetScopeId, Content = "Mem 2", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
            new Memories { MemoryId = 3, UserId = userId, ScopeId = targetScopeId, Content = "Mem 3 (inactive)", IsActive = false, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
            new Memories { MemoryId = 4, UserId = userId, ScopeId = otherScopeId,  Content = "Mem 4 (other scope)", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
            new Memories { MemoryId = 5, UserId = 999,    ScopeId = targetScopeId, Content = "Mem 5 (other user)", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow }
        );
        await _db.SaveChangesAsync();

        var activeMemories = await repo.GetActiveMemoriesForScopeAsync(userId, targetScopeId);

        Assert.Equal(2, activeMemories.Count);
        Assert.Contains(activeMemories, m => m.MemoryId == 1);
        Assert.Contains(activeMemories, m => m.MemoryId == 2);
    }

    // ── GAP-02: Service-Level Actor Purge Tests ───────────────────────────────

    [Fact]
    public async Task Service_PurgeActorMemoriesAsync_PurgesOnlyTargetActorAndArchivesVersions()
    {
        var mockRepo = new Mock<IMemoryRepository>();
        var mockScopeRes = new Mock<IScopeResolutionService>();

        long userId = 1;
        long projectId = 10;
        string actorId = "alice";
        long scopeId = 50;

        mockScopeRes.Setup(s => s.ResolveScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeId);

        var activeMemories = new List<MemorySnapshot>
        {
            new() { MemoryId = 101, UserId = userId, Content = "Alice note 1", IsActive = true },
            new() { MemoryId = 102, UserId = userId, Content = "Alice note 2", IsActive = true },
        };

        mockRepo.Setup(r => r.GetActiveMemoriesForScopeAsync(userId, scopeId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(activeMemories);

        mockRepo.Setup(r => r.CreateMemoryVersionAsync(It.IsAny<long>(), It.IsAny<string>(), "ApiActorPurge"))
            .Returns(Task.CompletedTask);

        mockRepo.Setup(r => r.DeactivateMemoryAsync(It.IsAny<long>()))
            .Returns(Task.CompletedTask);

        var service = CreateMemoryService(mockRepo.Object, mockScopeRes.Object);

        var result = await service.PurgeActorMemoriesAsync(actorId, userId, projectId);

        Assert.Equal("alice", result.ActorId);
        Assert.Equal(2, result.DeletedCount);
        Assert.Equal([101, 102], result.DeletedMemoryIds);

        // Verify version archival with "ApiActorPurge"
        mockRepo.Verify(r => r.CreateMemoryVersionAsync(101, "Alice note 1", "ApiActorPurge"), Times.Once);
        mockRepo.Verify(r => r.CreateMemoryVersionAsync(102, "Alice note 2", "ApiActorPurge"), Times.Once);

        // Verify deactivation
        mockRepo.Verify(r => r.DeactivateMemoryAsync(101), Times.Once);
        mockRepo.Verify(r => r.DeactivateMemoryAsync(102), Times.Once);
    }

    [Fact]
    public async Task Service_PurgeActorMemoriesAsync_MissingScope_ReturnsZeroDeletedCountSafely()
    {
        var mockRepo = new Mock<IMemoryRepository>();
        var mockScopeRes = new Mock<IScopeResolutionService>();

        long userId = 1;
        long projectId = 10;
        string actorId = "nonexistent_actor";

        mockScopeRes.Setup(s => s.ResolveScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new MemoryScopeNotFoundException());

        var service = CreateMemoryService(mockRepo.Object, mockScopeRes.Object);

        var result = await service.PurgeActorMemoriesAsync(actorId, userId, projectId);

        Assert.Equal(actorId, result.ActorId);
        Assert.Equal(0, result.DeletedCount);
        Assert.Empty(result.DeletedMemoryIds);
        mockRepo.Verify(r => r.DeactivateMemoryAsync(It.IsAny<long>()), Times.Never);
    }

    [Fact]
    public async Task Service_PurgeActorMemoriesAsync_RepeatedPurge_IsIdempotent()
    {
        var mockRepo = new Mock<IMemoryRepository>();
        var mockScopeRes = new Mock<IScopeResolutionService>();

        long userId = 1;
        long projectId = 10;
        string actorId = "bob";
        long scopeId = 60;

        mockScopeRes.Setup(s => s.ResolveScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeId);

        // First call has 1 memory; second call has 0 memories remaining
        mockRepo.SetupSequence(r => r.GetActiveMemoriesForScopeAsync(userId, scopeId, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new() { MemoryId = 201, UserId = userId, Content = "Bob 1", IsActive = true }])
            .ReturnsAsync([]);

        var service = CreateMemoryService(mockRepo.Object, mockScopeRes.Object);

        var result1 = await service.PurgeActorMemoriesAsync(actorId, userId, projectId);
        Assert.Equal(1, result1.DeletedCount);

        var result2 = await service.PurgeActorMemoriesAsync(actorId, userId, projectId);
        Assert.Equal(0, result2.DeletedCount);
        Assert.Empty(result2.DeletedMemoryIds);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Service_PurgeActorMemoriesAsync_InvalidActorId_ThrowsArgumentException(string? invalidActorId)
    {
        var service = CreateMemoryService();

        await Assert.ThrowsAsync<ArgumentException>(
            () => service.PurgeActorMemoriesAsync(invalidActorId!, 1, 10));
    }

    // ── GAP-02: Controller-Level Actor Purge Tests ─────────────────────────────

    [Fact]
    public async Task Controller_PurgeActorMemories_ReturnsOkAndRecordsUsage()
    {
        var mockService = new Mock<IMemoryService>();
        var mockApiKeyContext = new Mock<IApiKeyContext>();
        mockApiKeyContext.Setup(c => c.UserId).Returns(1);
        mockApiKeyContext.Setup(c => c.ProjectId).Returns(10);

        var mockUsage = new Mock<IUsageMeterService>();

        mockService.Setup(s => s.PurgeActorMemoriesAsync("charlie", 1, 10, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ActorPurgeResponse
            {
                ActorId = "charlie",
                DeletedCount = 5,
                DeletedMemoryIds = [1, 2, 3, 4, 5],
                Message = "Purged 5 memories."
            });

        var controller = new MemoryController(
            mockService.Object,
            Mock.Of<IMemoryIngestionService>(),
            mockApiKeyContext.Object,
            null!,
            null,
            mockUsage.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };

        var actionResult = await controller.PurgeActorMemories("charlie");

        var okResult = Assert.IsType<OkObjectResult>(actionResult);
        var response = Assert.IsType<ActorPurgeResponse>(okResult.Value);
        Assert.Equal("charlie", response.ActorId);
        Assert.Equal(5, response.DeletedCount);

        mockUsage.Verify(u => u.RecordAsync(1, 10, UsageOperationType.MemoryDelete, UsageOutcome.Success, 5), Times.Once);
    }

    [Fact]
    public async Task Controller_PurgeActorMemories_MissingActorIdQuery_Returns400BadRequest()
    {
        var controller = new MemoryController(
            Mock.Of<IMemoryService>(),
            Mock.Of<IMemoryIngestionService>(),
            Mock.Of<IApiKeyContext>(),
            null!)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };

        var actionResult = await controller.PurgeActorMemories(null);
        var badRequestResult = Assert.IsType<BadRequestObjectResult>(actionResult);
        Assert.NotNull(badRequestResult.Value);

        var actionResultEmpty = await controller.PurgeActorMemories("   ");
        Assert.IsType<BadRequestObjectResult>(actionResultEmpty);
    }
}
