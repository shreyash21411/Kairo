using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.API.Controllers;
using Kairo.API.Middleware;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Kairo.Infrastructure.Services;
using Kairo.MCP.Tools;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Comprehensive Phase 5.8 remediation regression test suite.
/// Verifies:
/// 1. Quota middleware pipeline ordering, auth context gating, and non-billable job route pass-through.
/// 2. Real application service/controller usage recording for all operations without double counting.
/// 3. UsageMeterService DI lifetime resilience (IServiceScopeFactory) and non-throwing guarantee.
/// 4. QuotaEnforcementService concurrency protection, in-flight tracking, configurable fail-open/closed, and boundary limits.
/// 5. Batch and MCP usage attribution with accurate operation types and unit counts.
/// </summary>
public class Phase58RemediationRegressionTests : IDisposable
{
    private readonly KairoDbContext _db;
    private readonly Mock<IApiKeyContext> _mockApiKeyContext;

    public Phase58RemediationRegressionTests()
    {
        QuotaEnforcementService.ResetConcurrencyState();

        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        _db = new KairoDbContext(options);

        _db.Users.Add(new Users
        {
            UserId    = 1,
            Email     = "test@kairo.ai",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        _db.Projects.Add(new Projects
        {
            ProjectId = 10,
            UserId    = 1,
            Name      = "Project 10",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            IsDeleted = false
        });
        _db.Projects.Add(new Projects
        {
            ProjectId = 20,
            UserId    = 1,
            Name      = "Project 20",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            IsDeleted = false
        });
        _db.SaveChanges();

        _mockApiKeyContext = new Mock<IApiKeyContext>();
        _mockApiKeyContext.Setup(c => c.UserId).Returns(1);
        _mockApiKeyContext.Setup(c => c.ProjectId).Returns(10);
    }

    public void Dispose()
    {
        QuotaEnforcementService.ResetConcurrencyState();
        _db.Dispose();
    }

    // ── 1. Quota Middleware Pipeline & Route Verification ────────────────────

    [Fact]
    public async Task QuotaMeterMiddleware_WhenProjectOverQuota_Returns429AndMetersThrottled()
    {
        // Seed quota of 2 ops/min and 2 used ops in the last minute
        _db.ProjectQuotas.Add(new ProjectQuota
        {
            ProjectId = 10,
            MaxOperationsPerMinute = 2,
            UpdatedAt = DateTime.UtcNow
        });
        _db.UsageLedger.Add(new UsageLedgerEntry { UserId = 1, ProjectId = 10, OperationType = UsageOperationType.MemoryCreate, Outcome = UsageOutcome.Success, OccurredAt = DateTime.UtcNow, UnitCount = 1 });
        _db.UsageLedger.Add(new UsageLedgerEntry { UserId = 1, ProjectId = 10, OperationType = UsageOperationType.MemoryCreate, Outcome = UsageOutcome.Success, OccurredAt = DateTime.UtcNow, UnitCount = 1 });
        _db.SaveChanges();

        var quotaService = new QuotaEnforcementService(_db, NullLogger<QuotaEnforcementService>.Instance);
        var meterService = new UsageMeterService(_db, NullLogger<UsageMeterService>.Instance, quotaService);

        var context = new DefaultHttpContext();
        context.Request.Path = "/api/v1/memories";
        context.Request.Method = "POST";

        var services = new ServiceCollection();
        services.AddSingleton(_mockApiKeyContext.Object);
        services.AddSingleton<IQuotaEnforcementService>(quotaService);
        services.AddSingleton<IUsageMeterService>(meterService);
        context.RequestServices = services.BuildServiceProvider();

        var responseStream = new MemoryStream();
        context.Response.Body = responseStream;

        bool nextCalled = false;
        RequestDelegate next = ctx => { nextCalled = true; return Task.CompletedTask; };

        var middleware = new QuotaMeterMiddleware(next);
        await middleware.InvokeAsync(context);

        Assert.False(nextCalled);
        Assert.Equal(StatusCodes.Status429TooManyRequests, context.Response.StatusCode);
        Assert.True(context.Response.Headers.ContainsKey("Retry-After"));

        // Confirm throttled event was recorded in UsageLedger
        var throttledEntry = _db.UsageLedger.FirstOrDefault(e => e.Outcome == UsageOutcome.Throttled && e.ProjectId == 10);
        Assert.NotNull(throttledEntry);
        Assert.Equal(UsageOperationType.MemoryCreate, throttledEntry.OperationType);
    }

    [Fact]
    public async Task QuotaMeterMiddleware_WhenProjectWithinQuota_PassesThrough()
    {
        _db.ProjectQuotas.Add(new ProjectQuota
        {
            ProjectId = 10,
            MaxOperationsPerMinute = 100,
            UpdatedAt = DateTime.UtcNow
        });
        _db.SaveChanges();

        var quotaService = new QuotaEnforcementService(_db, NullLogger<QuotaEnforcementService>.Instance);
        var meterService = new UsageMeterService(_db, NullLogger<UsageMeterService>.Instance, quotaService);

        var context = new DefaultHttpContext();
        context.Request.Path = "/api/v1/memories";
        context.Request.Method = "POST";

        var services = new ServiceCollection();
        services.AddSingleton(_mockApiKeyContext.Object);
        services.AddSingleton<IQuotaEnforcementService>(quotaService);
        services.AddSingleton<IUsageMeterService>(meterService);
        context.RequestServices = services.BuildServiceProvider();

        bool nextCalled = false;
        RequestDelegate next = ctx => { nextCalled = true; return Task.CompletedTask; };

        var middleware = new QuotaMeterMiddleware(next);
        await middleware.InvokeAsync(context);

        Assert.True(nextCalled);
    }

    [Fact]
    public async Task QuotaMeterMiddleware_UnauthenticatedRequest_PassesThroughToAuthorization()
    {
        // Unauthenticated request (ProjectId == 0)
        var unauthContext = new Mock<IApiKeyContext>();
        unauthContext.Setup(c => c.UserId).Returns(0);
        unauthContext.Setup(c => c.ProjectId).Returns(0);

        var quotaService = new Mock<IQuotaEnforcementService>();
        var meterService = new Mock<IUsageMeterService>();

        var context = new DefaultHttpContext();
        context.Request.Path = "/api/v1/memories";
        context.Request.Method = "GET";

        var services = new ServiceCollection();
        services.AddSingleton(unauthContext.Object);
        services.AddSingleton(quotaService.Object);
        services.AddSingleton(meterService.Object);
        context.RequestServices = services.BuildServiceProvider();

        bool nextCalled = false;
        RequestDelegate next = ctx => { nextCalled = true; return Task.CompletedTask; };

        var middleware = new QuotaMeterMiddleware(next);
        await middleware.InvokeAsync(context);

        Assert.True(nextCalled);
        // Quota check must NOT be invoked when unauthenticated
        quotaService.Verify(q => q.CheckAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task QuotaMeterMiddleware_JobStatusRoute_BypassesQuotaEnforcement()
    {
        var quotaService = new Mock<IQuotaEnforcementService>();
        var meterService = new Mock<IUsageMeterService>();

        var context = new DefaultHttpContext();
        context.Request.Path = "/api/v1/memories/jobs/99";
        context.Request.Method = "GET";

        var services = new ServiceCollection();
        services.AddSingleton(_mockApiKeyContext.Object);
        services.AddSingleton(quotaService.Object);
        services.AddSingleton(meterService.Object);
        context.RequestServices = services.BuildServiceProvider();

        bool nextCalled = false;
        RequestDelegate next = ctx => { nextCalled = true; return Task.CompletedTask; };

        var middleware = new QuotaMeterMiddleware(next);
        await middleware.InvokeAsync(context);

        Assert.True(nextCalled);
        quotaService.Verify(q => q.CheckAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task QuotaMeterMiddleware_DifferentProjects_HaveIsolatedCounters()
    {
        // Project 10 is at its limit (1 op/min)
        _db.ProjectQuotas.Add(new ProjectQuota { ProjectId = 10, MaxOperationsPerMinute = 1, UpdatedAt = DateTime.UtcNow });
        _db.UsageLedger.Add(new UsageLedgerEntry { UserId = 1, ProjectId = 10, OperationType = UsageOperationType.MemoryCreate, Outcome = UsageOutcome.Success, OccurredAt = DateTime.UtcNow, UnitCount = 1 });

        // Project 20 has limit of 100
        _db.ProjectQuotas.Add(new ProjectQuota { ProjectId = 20, MaxOperationsPerMinute = 100, UpdatedAt = DateTime.UtcNow });
        _db.SaveChanges();

        var quotaService = new QuotaEnforcementService(_db, NullLogger<QuotaEnforcementService>.Instance);
        var meterService = new UsageMeterService(_db, NullLogger<UsageMeterService>.Instance, quotaService);

        var p20ApiKey = new Mock<IApiKeyContext>();
        p20ApiKey.Setup(c => c.UserId).Returns(1);
        p20ApiKey.Setup(c => c.ProjectId).Returns(20);

        var context = new DefaultHttpContext();
        context.Request.Path = "/api/v1/memories";
        context.Request.Method = "POST";

        var services = new ServiceCollection();
        services.AddSingleton(p20ApiKey.Object);
        services.AddSingleton<IQuotaEnforcementService>(quotaService);
        services.AddSingleton<IUsageMeterService>(meterService);
        context.RequestServices = services.BuildServiceProvider();

        bool nextCalled = false;
        var middleware = new QuotaMeterMiddleware(_ => { nextCalled = true; return Task.CompletedTask; });
        await middleware.InvokeAsync(context);

        // Project 20 should be allowed despite project 10 being throttled
        Assert.True(nextCalled);
    }

    // ── 2. Controller Successful Usage Recording ──────────────────────────────

    [Fact]
    public async Task MemoryController_CreateMemory_MetersMemoryCreateOnSuccess()
    {
        var mockMemService = new Mock<IMemoryService>();
        mockMemService.Setup(s => s.CreateMemoryAsync(It.IsAny<CreateMemoryRequest>(), 1, 10, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new MemoryResponse { MemoryId = 123, UserId = 1, Content = "Hello", MemoryType = "Fact" }, (MemoryDuplicateResult?)null));

        var mockMeter = new Mock<IUsageMeterService>();
        var mockRetrieval = CreateMockHybridRetrieval();

        var controller = new MemoryController(
            mockMemService.Object,
            Mock.Of<IMemoryIngestionService>(),
            _mockApiKeyContext.Object,
            mockRetrieval,
            usageMeterService: mockMeter.Object);

        var actionResult = await controller.CreateMemory(new CreateMemoryRequest { Content = "Hello", MemoryType = "Fact" });
        Assert.IsType<CreatedAtActionResult>(actionResult);

        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.MemoryCreate, UsageOutcome.Success, 1, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task MemoryController_GetMemory_MetersMemoryGetOnSuccess()
    {
        var mockMemService = new Mock<IMemoryService>();
        mockMemService.Setup(s => s.GetMemoryAsync(555, 1, 10, null))
            .ReturnsAsync(new MemoryResponse { MemoryId = 555, UserId = 1, Content = "Fact" });

        var mockMeter = new Mock<IUsageMeterService>();
        var controller = new MemoryController(
            mockMemService.Object,
            Mock.Of<IMemoryIngestionService>(),
            _mockApiKeyContext.Object,
            CreateMockHybridRetrieval(),
            usageMeterService: mockMeter.Object);

        var actionResult = await controller.GetMemory(555);
        Assert.IsType<OkObjectResult>(actionResult);

        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.MemoryGet, UsageOutcome.Success, 1, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task MemoryController_ListMemories_MetersMemoryGetOnSuccess()
    {
        var mockMemService = new Mock<IMemoryService>();
        mockMemService.Setup(s => s.ListMemoriesAsync(1, 10))
            .ReturnsAsync(new List<MemoryResponse> { new() { MemoryId = 1 } });

        var mockMeter = new Mock<IUsageMeterService>();
        var controller = new MemoryController(
            mockMemService.Object,
            Mock.Of<IMemoryIngestionService>(),
            _mockApiKeyContext.Object,
            CreateMockHybridRetrieval(),
            usageMeterService: mockMeter.Object);

        var actionResult = await controller.ListMemories();
        Assert.IsType<OkObjectResult>(actionResult);

        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.MemoryGet, UsageOutcome.Success, 1, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task MemoryController_UpdateMemory_MetersMemoryUpdateOnSuccess()
    {
        var mockMemService = new Mock<IMemoryService>();
        mockMemService.Setup(s => s.UpdateMemoryAsync(100, It.IsAny<UpdateMemoryRequest>(), 1, 10, null))
            .ReturnsAsync(new MemoryResponse { MemoryId = 100 });

        var mockMeter = new Mock<IUsageMeterService>();
        var controller = new MemoryController(
            mockMemService.Object,
            Mock.Of<IMemoryIngestionService>(),
            _mockApiKeyContext.Object,
            CreateMockHybridRetrieval(),
            usageMeterService: mockMeter.Object);

        var actionResult = await controller.UpdateMemory(100, new UpdateMemoryRequest { Content = "New" });
        Assert.IsType<OkObjectResult>(actionResult);

        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.MemoryUpdate, UsageOutcome.Success, 1, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task MemoryController_DeleteMemory_MetersMemoryDeleteOnSuccess()
    {
        var mockMemService = new Mock<IMemoryService>();
        mockMemService.Setup(s => s.DeleteMemoryAsync(100, 1, 10, null))
            .Returns(Task.CompletedTask);

        var mockMeter = new Mock<IUsageMeterService>();
        var controller = new MemoryController(
            mockMemService.Object,
            Mock.Of<IMemoryIngestionService>(),
            _mockApiKeyContext.Object,
            CreateMockHybridRetrieval(),
            usageMeterService: mockMeter.Object);

        var actionResult = await controller.DeleteMemory(100);
        Assert.IsType<OkObjectResult>(actionResult);

        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.MemoryDelete, UsageOutcome.Success, 1, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task MemoryController_SearchMemories_MetersMemoryRecallOnSuccess()
    {
        var mockMemService = new Mock<IMemoryService>();
        mockMemService.Setup(s => s.SearchMemoriesAsync(It.IsAny<MemorySearchRequest>(), 1, 10, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemorySearchResponse { Query = "test", Count = 0, Memories = new() });

        var mockMeter = new Mock<IUsageMeterService>();
        var controller = new MemoryController(
            mockMemService.Object,
            Mock.Of<IMemoryIngestionService>(),
            _mockApiKeyContext.Object,
            CreateMockHybridRetrieval(),
            usageMeterService: mockMeter.Object);

        var actionResult = await controller.SearchMemories(new MemorySearchRequest { Query = "test", TopK = 5 });
        Assert.IsType<OkObjectResult>(actionResult);

        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.MemoryRecall, UsageOutcome.Success, 1, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task MemoryController_BatchCreate_MetersBatchCreateWithAccurateUnitCount()
    {
        var mockMemService = new Mock<IMemoryService>();
        mockMemService.Setup(s => s.BatchCreateMemoriesAsync(It.IsAny<BatchCreateMemoryRequest>(), 1, 10, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BatchCreateResponse { Success = true, CreatedCount = 7 });

        var mockMeter = new Mock<IUsageMeterService>();
        var controller = new MemoryController(
            mockMemService.Object,
            Mock.Of<IMemoryIngestionService>(),
            _mockApiKeyContext.Object,
            CreateMockHybridRetrieval(),
            usageMeterService: mockMeter.Object);

        var actionResult = await controller.BatchCreate(new BatchCreateMemoryRequest
        {
            Memories = Enumerable.Range(1, 7).Select(i => new BatchCreateMemoryItem { Content = $"C_{i}" }).ToList()
        });

        Assert.IsType<ObjectResult>(actionResult);
        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.BatchCreate, UsageOutcome.Success, 7, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task MemoryController_BatchDelete_MetersBatchDeleteWithAccurateUnitCount()
    {
        var mockMemService = new Mock<IMemoryService>();
        mockMemService.Setup(s => s.BatchDeleteMemoriesAsync(It.IsAny<BatchDeleteMemoryRequest>(), 1, 10, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BatchDeleteResponse { Success = true, DeletedCount = 4 });

        var mockMeter = new Mock<IUsageMeterService>();
        var controller = new MemoryController(
            mockMemService.Object,
            Mock.Of<IMemoryIngestionService>(),
            _mockApiKeyContext.Object,
            CreateMockHybridRetrieval(),
            usageMeterService: mockMeter.Object);

        var actionResult = await controller.BatchDelete(new BatchDeleteMemoryRequest { MemoryIds = new List<long> { 1, 2, 3, 4 } });
        Assert.IsType<OkObjectResult>(actionResult);

        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.BatchDelete, UsageOutcome.Success, 4, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task MemoryController_IngestConversation_MetersDialogueIngestOnSuccess()
    {
        var mockIngest = new Mock<IMemoryIngestionService>();
        mockIngest.Setup(i => i.IngestAsync(It.IsAny<IngestConversationRequest>(), 1, 10, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryIngestionResponse { Processed = true, ExtractedCount = 2, Memories = new() });

        var mockMeter = new Mock<IUsageMeterService>();
        var controller = new MemoryController(
            Mock.Of<IMemoryService>(),
            mockIngest.Object,
            _mockApiKeyContext.Object,
            CreateMockHybridRetrieval(),
            usageMeterService: mockMeter.Object);

        var actionResult = await controller.IngestConversation(new IngestConversationRequest
        {
            ActorId = "actor_1",
            Messages = new List<IngestMessageItem> { new() { Role = "user", Content = "I like apples" } }
        });

        Assert.IsType<OkObjectResult>(actionResult);
        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.DialogueIngest, UsageOutcome.Success, 1, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── 3. HybridRetrieval LLM Reranker Usage Metering ─────────────────────────

    [Fact]
    public async Task HybridRetrievalService_RerankSuccess_MetersLlmRerankWithCandidateCount()
    {
        var mockRepo = new Mock<IMemoryRepository>();
        mockRepo.Setup(r => r.SearchSimilarEmbeddingsAsync(It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(), null, null, null, null))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 1, Similarity = 0.9, Content = "C1", MemoryType = "Fact" },
                new() { MemoryId = 2, Similarity = 0.8, Content = "C2", MemoryType = "Fact" }
            });

        var mockEmbed = new Mock<IEmbeddingGenerator>();
        mockEmbed.Setup(e => e.GenerateAsync(It.IsAny<string>())).ReturnsAsync(new float[] { 1f });

        var mockEval = new Mock<IMemoryRelevanceEvaluator>();
        mockEval.Setup(e => e.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> input) => input);

        var mockRerank = new Mock<IRerankerService>();
        mockRerank.Setup(r => r.RerankAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string _, List<RetrievedMemory> input, CancellationToken _) => input);

        var mockMeter = new Mock<IUsageMeterService>();

        var hybridService = new HybridRetrievalService(
            mockRepo.Object,
            mockEmbed.Object,
            new SemanticSimilarityService(),
            mockEval.Object,
            Mock.Of<IKeywordSearchRepository>(),
            Mock.Of<IEntityRepository>(),
            Mock.Of<IEntityExtractionService>(),
            NullLogger<HybridRetrievalService>.Instance,
            rerankerService: mockRerank.Object,
            usageMeterService: mockMeter.Object);

        var result = await hybridService.RetrieveAsync(1, 10, "query", topK: 2);
        Assert.NotNull(result);

        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.LlmRerank, UsageOutcome.Success, 2, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task HybridRetrievalService_RerankFailure_MetersLlmRerankWithFailureOutcome()
    {
        var mockRepo = new Mock<IMemoryRepository>();
        mockRepo.Setup(r => r.SearchSimilarEmbeddingsAsync(It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(), null, null, null, null))
            .ReturnsAsync(new List<RankedEmbeddingResult>
            {
                new() { MemoryId = 1, Similarity = 0.9, Content = "C1", MemoryType = "Fact" }
            });

        var mockEmbed = new Mock<IEmbeddingGenerator>();
        mockEmbed.Setup(e => e.GenerateAsync(It.IsAny<string>())).ReturnsAsync(new float[] { 1f });

        var mockEval = new Mock<IMemoryRelevanceEvaluator>();
        mockEval.Setup(e => e.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> input) => input);

        var mockRerank = new Mock<IRerankerService>();
        mockRerank.Setup(r => r.RerankAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("Rerank provider timeout"));

        var mockMeter = new Mock<IUsageMeterService>();

        var hybridService = new HybridRetrievalService(
            mockRepo.Object,
            mockEmbed.Object,
            new SemanticSimilarityService(),
            mockEval.Object,
            Mock.Of<IKeywordSearchRepository>(),
            Mock.Of<IEntityRepository>(),
            Mock.Of<IEntityExtractionService>(),
            NullLogger<HybridRetrievalService>.Instance,
            rerankerService: mockRerank.Object,
            usageMeterService: mockMeter.Object);

        var result = await hybridService.RetrieveAsync(1, 10, "query", topK: 2);
        Assert.NotNull(result);

        // Fallback occurred, and failure outcome was metered
        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.LlmRerank, UsageOutcome.Failure, 1, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── 4. UsageMeterService DI Scope & Lifetime ──────────────────────────────

    [Fact]
    public async Task UsageMeterService_WithScopeFactory_CreatesIsolatedScopeAndPersists()
    {
        var dbName = Guid.NewGuid().ToString();
        var services = new ServiceCollection();
        services.AddDbContext<KairoDbContext>(opt => opt.UseInMemoryDatabase(dbName));
        var provider = services.BuildServiceProvider();

        // Seed Users and Projects in DB
        using (var initScope = provider.CreateScope())
        {
            var db = initScope.ServiceProvider.GetRequiredService<KairoDbContext>();
            db.Users.Add(new Users { UserId = 1, Email = "test@kairo.ai", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
            db.Projects.Add(new Projects { ProjectId = 10, UserId = 1, Name = "P", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }

        var scopeFactory = provider.GetRequiredService<IServiceScopeFactory>();
        var meter = new UsageMeterService(scopeFactory, NullLogger<UsageMeterService>.Instance);

        await meter.RecordAsync(1, 10, UsageOperationType.MemoryCreate, UsageOutcome.Success, 1);

        // Verify with another independent scope that entry was persisted
        using (var verifyScope = provider.CreateScope())
        {
            var db = verifyScope.ServiceProvider.GetRequiredService<KairoDbContext>();
            var entry = await db.UsageLedger.FirstOrDefaultAsync(e => e.ProjectId == 10);
            Assert.NotNull(entry);
            Assert.Equal(UsageOperationType.MemoryCreate, entry.OperationType);
        }
    }

    // ── 5. QuotaEnforcement Concurrency, Fail-Open/Closed, & Boundaries ───────

    [Fact]
    public async Task QuotaEnforcementService_ConcurrentRequests_PreventStaleSnapshotBreach()
    {
        // Limit is 1 op per minute.
        _db.ProjectQuotas.Add(new ProjectQuota
        {
            ProjectId = 10,
            MaxOperationsPerMinute = 1,
            UpdatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();

        var service = new QuotaEnforcementService(_db, NullLogger<QuotaEnforcementService>.Instance);

        // Fire 10 concurrent checks at the exact same millisecond
        var tasks = Enumerable.Range(0, 10)
            .Select(_ => Task.Run(() => service.CheckAsync(10, UsageOperationType.MemoryCreate, 1)))
            .ToArray();

        var results = await Task.WhenAll(tasks);

        var allowedCount = results.Count(r => r.IsAllowed);
        var exceededCount = results.Count(r => !r.IsAllowed);

        // Exactly 1 allowed, 9 throttled
        Assert.Equal(1, allowedCount);
        Assert.Equal(9, exceededCount);
    }

    [Fact]
    public async Task QuotaEnforcementService_FailOpenTrue_ReturnsAllowedOnStorageError()
    {
        var mockDb = new Mock<KairoDbContext>(new DbContextOptions<KairoDbContext>());
        mockDb.Setup(d => d.ProjectQuotas).Throws(new InvalidOperationException("DB connection broken"));

        var options = Options.Create(new QuotaOptions { FailOpen = true });
        var service = new QuotaEnforcementService(mockDb.Object, NullLogger<QuotaEnforcementService>.Instance, options);

        var result = await service.CheckAsync(10, UsageOperationType.MemoryCreate);
        Assert.True(result.IsAllowed);
    }

    [Fact]
    public async Task QuotaEnforcementService_FailClosedFalse_ReturnsExceededOnStorageError()
    {
        var mockDb = new Mock<KairoDbContext>(new DbContextOptions<KairoDbContext>());
        mockDb.Setup(d => d.ProjectQuotas).Throws(new InvalidOperationException("DB connection broken"));

        var options = Options.Create(new QuotaOptions { FailOpen = false });
        var service = new QuotaEnforcementService(mockDb.Object, NullLogger<QuotaEnforcementService>.Instance, options);

        var result = await service.CheckAsync(10, UsageOperationType.MemoryCreate);
        Assert.False(result.IsAllowed);
        Assert.Contains("unavailable", result.Reason);
        Assert.Equal(30, result.RetryAfterSeconds);
    }

    [Fact]
    public async Task QuotaEnforcementService_BoundaryChecks_ExactLimitBehavior()
    {
        // Quota is 5 ops per minute
        _db.ProjectQuotas.Add(new ProjectQuota
        {
            ProjectId = 10,
            MaxOperationsPerMinute = 5,
            UpdatedAt = DateTime.UtcNow
        });
        // Seed 4 existing operations
        for (int i = 0; i < 4; i++)
        {
            _db.UsageLedger.Add(new UsageLedgerEntry
            {
                UserId = 1, ProjectId = 10, OperationType = UsageOperationType.MemoryCreate,
                Outcome = UsageOutcome.Success, OccurredAt = DateTime.UtcNow, UnitCount = 1
            });
        }
        await _db.SaveChangesAsync();

        var service = new QuotaEnforcementService(_db, NullLogger<QuotaEnforcementService>.Instance);

        // 4 used + 1 requested = 5 <= 5 (EXACTLY AT LIMIT: Allowed)
        var exactBoundaryResult = await service.CheckAsync(10, UsageOperationType.MemoryCreate, 1);
        Assert.True(exactBoundaryResult.IsAllowed);

        // 4 used + 1 in-flight + 1 requested = 6 > 5 (ABOVE LIMIT: Exceeded)
        var aboveLimitResult = await service.CheckAsync(10, UsageOperationType.MemoryCreate, 1);
        Assert.False(aboveLimitResult.IsAllowed);
    }

    [Fact]
    public async Task QuotaEnforcementService_MaxBatchSize_ExceededRejectsImmediately()
    {
        _db.ProjectQuotas.Add(new ProjectQuota
        {
            ProjectId = 10,
            MaxBatchSize = 10,
            UpdatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();

        var service = new QuotaEnforcementService(_db, NullLogger<QuotaEnforcementService>.Instance);

        // Requesting 11 when MaxBatchSize is 10
        var result = await service.CheckAsync(10, UsageOperationType.BatchCreate, unitCount: 11);
        Assert.False(result.IsAllowed);
        Assert.Contains("exceeds maximum allowed batch size of 10", result.Reason);
    }

    // ── 6. Batch & MCP Usage Attribution ──────────────────────────────────────

    [Fact]
    public async Task KairoMemoryTools_RememberBatch_MetersBatchCreateWithBatchCount()
    {
        var mockMemService = new Mock<IMemoryService>();
        mockMemService.Setup(s => s.BatchCreateMemoriesAsync(It.IsAny<BatchCreateMemoryRequest>(), 1, 10, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BatchCreateResponse { Success = true, CreatedCount = 5, Memories = new(), Errors = new() });

        var mockMeter = new Mock<IUsageMeterService>();
        var mockQuota = new Mock<IQuotaEnforcementService>();
        mockQuota.Setup(q => q.CheckAsync(10, UsageOperationType.BatchCreate, 5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(QuotaCheckResult.Allowed);

        var tools = new KairoMemoryTools(
            _mockApiKeyContext.Object,
            mockMemService.Object,
            Mock.Of<IScopeResolutionService>(),
            Mock.Of<IMemoryIngestionService>(),
            quotaService: mockQuota.Object,
            usageMeter: mockMeter.Object);

        var batch = Enumerable.Range(1, 5)
            .Select(i => new BatchCreateMemoryItem { Content = $"Batch item {i}" })
            .ToList();

        var resultJson = await tools.RememberBatch(batch, "actor_1");
        Assert.Contains("\"success\": true", resultJson);

        // Verified: metered as BatchCreate with unit count 5, not MemoryGet with unit count 1
        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.BatchCreate, UsageOutcome.Success, 5, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task KairoMemoryTools_ForgetBatch_MetersBatchDeleteWithIdsCount()
    {
        var mockMemService = new Mock<IMemoryService>();
        mockMemService.Setup(s => s.BatchDeleteMemoriesAsync(It.IsAny<BatchDeleteMemoryRequest>(), 1, 10, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BatchDeleteResponse { Success = true, DeletedCount = 3, DeletedIds = new(), Errors = new() });

        var mockScope = new Mock<IScopeResolutionService>();
        mockScope.Setup(s => s.ResolveScopeAsync(10, "actor_1")).ReturnsAsync(100);

        var mockMeter = new Mock<IUsageMeterService>();
        var mockQuota = new Mock<IQuotaEnforcementService>();
        mockQuota.Setup(q => q.CheckAsync(10, UsageOperationType.BatchDelete, 3, It.IsAny<CancellationToken>()))
            .ReturnsAsync(QuotaCheckResult.Allowed);

        var tools = new KairoMemoryTools(
            _mockApiKeyContext.Object,
            mockMemService.Object,
            mockScope.Object,
            Mock.Of<IMemoryIngestionService>(),
            quotaService: mockQuota.Object,
            usageMeter: mockMeter.Object);

        var ids = new List<long> { 101, 102, 103 };
        var resultJson = await tools.ForgetBatch(ids, "actor_1");
        Assert.Contains("\"success\": true", resultJson);

        // Verified: metered as BatchDelete with unit count 3
        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.BatchDelete, UsageOutcome.Success, 3, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task KairoMemoryTools_Ping_DoesNotRecordUsage()
    {
        var mockMeter = new Mock<IUsageMeterService>();
        var tools = new KairoMemoryTools(
            _mockApiKeyContext.Object,
            Mock.Of<IMemoryService>(),
            Mock.Of<IScopeResolutionService>(),
            usageMeter: mockMeter.Object);

        var result = tools.Ping();
        Assert.Contains("online", result);

        mockMeter.Verify(m => m.RecordAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task KairoMemoryTools_WhenOverQuota_ReturnsQuotaExceededAndMetersThrottled()
    {
        var mockQuota = new Mock<IQuotaEnforcementService>();
        mockQuota.Setup(q => q.CheckAsync(10, UsageOperationType.MemoryCreate, 1, It.IsAny<CancellationToken>()))
            .ReturnsAsync(QuotaCheckResult.Exceeded("Rate limit exceeded per minute.", retryAfterSeconds: 45));

        var mockMeter = new Mock<IUsageMeterService>();
        var tools = new KairoMemoryTools(
            _mockApiKeyContext.Object,
            Mock.Of<IMemoryService>(),
            Mock.Of<IScopeResolutionService>(),
            quotaService: mockQuota.Object,
            usageMeter: mockMeter.Object);

        var resultJson = await tools.Remember("content", "Fact", "actor_1");
        Assert.Contains("quota_exceeded", resultJson);
        Assert.Contains("45", resultJson);

        mockMeter.Verify(m => m.RecordAsync(
            1, 10, UsageOperationType.MemoryCreate, UsageOutcome.Throttled, 1, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    private static HybridRetrievalService CreateMockHybridRetrieval()
    {
        return new HybridRetrievalService(
            Mock.Of<IMemoryRepository>(),
            Mock.Of<IEmbeddingGenerator>(),
            new SemanticSimilarityService(),
            Mock.Of<IMemoryRelevanceEvaluator>(),
            Mock.Of<IKeywordSearchRepository>(),
            Mock.Of<IEntityRepository>(),
            Mock.Of<IEntityExtractionService>(),
            NullLogger<HybridRetrievalService>.Instance);
    }
}
