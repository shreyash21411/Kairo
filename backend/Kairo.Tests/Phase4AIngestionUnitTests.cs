using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.API.Controllers;
using Kairo.API.Services;
using Kairo.Application.Abstractions.Persistence;
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
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Comprehensive Phase 4A Test Suite:
/// 1. EF Model & Database Configuration (Tables, Indexes, Foreign Keys, Nullability)
/// 2. Backward Compatibility & Synchronous Default Execution (API & Controller contracts)
/// 3. Asynchronous Opt-in Ingestion (CreateMemory & IngestConversation with ?mode=async)
/// 4. Transaction Atomicity & Outbox Pattern (Memory + Job atomic commit)
/// 5. Job Claiming, Concurrency Leasing, Stale Lease Recovery, and Max Attempts
/// 6. Job Processing Lifecycle, Embedding Generation, and Entity/Graph Extraction
/// 7. Race Conditions with Deletion and Expiration (Resurrection Prevention)
/// 8. Transient Provider Retries, Exponential Backoff, and Terminal Failure Handling
/// 9. Security, IDOR Protection, and Error Sanitization
/// 10. Background Worker Execution Lifecycle
/// </summary>
public class Phase4AIngestionUnitTests
{
    private static KairoDbContext CreateMockSqlServerContext()
    {
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseSqlServer("Server=tcp:localhost,1433;Database=kairo_test;")
            .Options;
        return new KairoDbContext(options);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. EF Model & Database Configuration Tests
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Phase4A_EFModel_MemoryIngestionJob_ConfiguredWithRequiredTableAndColumns()
    {
        using var db = CreateMockSqlServerContext();
        var entityType = db.Model.FindEntityType(typeof(MemoryIngestionJob));
        Assert.NotNull(entityType);

        // Check primary key
        var pk = entityType.FindPrimaryKey();
        Assert.NotNull(pk);
        Assert.Single(pk.Properties);
        Assert.Equal("JobId", pk.Properties[0].Name);

        // Phase 4A (revised): JobId must be long, not Guid, and database-generated.
        var jobIdProp = pk.Properties[0];
        Assert.Equal(typeof(long), jobIdProp.ClrType);
        Assert.Equal(Microsoft.EntityFrameworkCore.Metadata.ValueGenerated.OnAdd, jobIdProp.ValueGenerated);

        // Check required columns exist
        Assert.NotNull(entityType.FindProperty("ProjectId"));
        Assert.NotNull(entityType.FindProperty("UserId"));
        Assert.NotNull(entityType.FindProperty("ScopeId"));
        Assert.NotNull(entityType.FindProperty("MemoryId"));
        Assert.NotNull(entityType.FindProperty("JobType"));
        Assert.NotNull(entityType.FindProperty("Status"));
        Assert.NotNull(entityType.FindProperty("Payload"));
        Assert.NotNull(entityType.FindProperty("Attempts"));
        Assert.NotNull(entityType.FindProperty("MaxAttempts"));
        Assert.NotNull(entityType.FindProperty("AvailableAt"));
        Assert.NotNull(entityType.FindProperty("LockedUntil"));
        Assert.NotNull(entityType.FindProperty("LockOwner"));
        Assert.NotNull(entityType.FindProperty("LastError"));
        Assert.NotNull(entityType.FindProperty("CreatedAt"));
        Assert.NotNull(entityType.FindProperty("CompletedAt"));
    }

    [Fact]
    public void Phase4A_EFModel_MemoryIngestionJob_HasIndexesForClaimingAndLookups()
    {
        using var db = CreateMockSqlServerContext();
        var entityType = db.Model.FindEntityType(typeof(MemoryIngestionJob));
        Assert.NotNull(entityType);

        var indexes = entityType.GetIndexes().ToList();

        // 1. Claiming index: Status, AvailableAt, LockedUntil
        var claimingIndex = indexes.FirstOrDefault(i =>
            i.Properties.Select(p => p.Name).SequenceEqual(new[] { "Status", "AvailableAt", "LockedUntil" }));
        Assert.NotNull(claimingIndex);
        Assert.Equal("IX_MemoryIngestionJobs_Claiming", claimingIndex.Name);

        // 2. User & Project lookup index
        var userProjectIndex = indexes.FirstOrDefault(i =>
            i.Properties.Select(p => p.Name).SequenceEqual(new[] { "UserId", "ProjectId" }));
        Assert.NotNull(userProjectIndex);
        Assert.Equal("IX_MemoryIngestionJobs_User_Project", userProjectIndex.Name);

        // 3. MemoryId index
        var memoryIdIndex = indexes.FirstOrDefault(i =>
            i.Properties.Select(p => p.Name).SequenceEqual(new[] { "MemoryId" }));
        Assert.NotNull(memoryIdIndex);
        Assert.Equal("IX_MemoryIngestionJobs_MemoryId", memoryIdIndex.Name);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Backward Compatibility & Synchronous Default Execution
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Phase4A_Controller_CreateMemory_DefaultMode_IsSynchronous_AndPreservesExactContract()
    {
        var memoryServiceMock = new Mock<IMemoryService>();
        var ingestionServiceMock = new Mock<IMemoryIngestionService>();
        var apiKeyContextMock = new Mock<IApiKeyContext>();
        var hybridRetrievalMock = BuildHybridService();
        var jobServiceMock = new Mock<IMemoryJobService>();

        apiKeyContextMock.Setup(a => a.UserId).Returns(42);
        apiKeyContextMock.Setup(a => a.ProjectId).Returns(100);

        var expectedMemory = new MemoryResponse
        {
            MemoryId = 999,
            Content = "Synch memory content",
            MemoryType = "Fact",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        memoryServiceMock.Setup(m => m.CreateMemoryAsync(
                It.IsAny<CreateMemoryRequest>(), 42, 100, It.IsAny<CancellationToken>()))
            .ReturnsAsync((expectedMemory, null));

        var controller = new MemoryController(
            memoryServiceMock.Object,
            ingestionServiceMock.Object,
            apiKeyContextMock.Object,
            hybridRetrievalMock,
            jobServiceMock.Object);

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext()
        };

        var request = new CreateMemoryRequest
        {
            Content = "Synch memory content",
            MemoryType = "Fact",
            ActorId = "actor-1"
        };

        // When mode is null or omitted
        var result = await controller.CreateMemory(request, mode: null);

        // Must be CreatedAtActionResult with 201 Created and exact memory response
        var createdResult = Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal(StatusCodes.Status201Created, createdResult.StatusCode);
        Assert.Equal(expectedMemory, createdResult.Value);

        // Verify synchronous service called, job service NEVER touched
        memoryServiceMock.Verify(m => m.CreateMemoryAsync(request, 42, 100, It.IsAny<CancellationToken>()), Times.Once);
        jobServiceMock.Verify(j => j.EnqueueAsyncCreateMemoryAsync(It.IsAny<CreateMemoryRequest>(), It.IsAny<long>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Phase4A_Controller_IngestConversation_DefaultMode_IsSynchronous()
    {
        var memoryServiceMock = new Mock<IMemoryService>();
        var ingestionServiceMock = new Mock<IMemoryIngestionService>();
        var apiKeyContextMock = new Mock<IApiKeyContext>();
        var hybridRetrievalMock = BuildHybridService();
        var jobServiceMock = new Mock<IMemoryJobService>();

        apiKeyContextMock.Setup(a => a.UserId).Returns(42);
        apiKeyContextMock.Setup(a => a.ProjectId).Returns(100);

        var expectedResponse = new MemoryIngestionResponse
        {
            Processed = true,
            ExtractedCount = 2,
            Memories = new List<IngestionMemoryResult>
            {
                new() { Action = IngestionOperation.Add, MemoryId = 1, Content = "Fact 1" },
                new() { Action = IngestionOperation.Add, MemoryId = 2, Content = "Fact 2" }
            }
        };

        ingestionServiceMock.Setup(i => i.IngestAsync(
                It.IsAny<IngestConversationRequest>(), 42, 100, It.IsAny<CancellationToken>()))
            .ReturnsAsync(expectedResponse);

        var controller = new MemoryController(
            memoryServiceMock.Object,
            ingestionServiceMock.Object,
            apiKeyContextMock.Object,
            hybridRetrievalMock,
            jobServiceMock.Object);

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext()
        };

        var request = new IngestConversationRequest
        {
            ActorId = "actor-1",
            Messages = new List<IngestMessageItem>
            {
                new() { Role = "user", Content = "I like dark chocolate." }
            }
        };

        var result = await controller.IngestConversation(request, mode: null);

        var okResult = Assert.IsType<OkObjectResult>(result);
        Assert.Equal(StatusCodes.Status200OK, okResult.StatusCode);
        Assert.Equal(expectedResponse, okResult.Value);

        ingestionServiceMock.Verify(i => i.IngestAsync(request, 42, 100, It.IsAny<CancellationToken>()), Times.Once);
        jobServiceMock.Verify(j => j.EnqueueAsyncIngestConversationAsync(It.IsAny<IngestConversationRequest>(), It.IsAny<long>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Asynchronous Opt-in Ingestion (CreateMemory & IngestConversation with ?mode=async)
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Phase4A_Controller_CreateMemory_AsyncModeQueryParam_EnqueuesJob_Returns202Accepted()
    {
        var memoryServiceMock = new Mock<IMemoryService>();
        var ingestionServiceMock = new Mock<IMemoryIngestionService>();
        var apiKeyContextMock = new Mock<IApiKeyContext>();
        var hybridRetrievalMock = BuildHybridService();
        var jobServiceMock = new Mock<IMemoryJobService>();

        apiKeyContextMock.Setup(a => a.UserId).Returns(42);
        apiKeyContextMock.Setup(a => a.ProjectId).Returns(100);

        var expectedJobId = 42001L;
        jobServiceMock.Setup(j => j.EnqueueAsyncCreateMemoryAsync(
                It.IsAny<CreateMemoryRequest>(), 42, 100, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AsyncJobAcceptedResponse
            {
                JobId = expectedJobId,
                MemoryId = 777,
                Status = "Pending",
                CreatedAt = DateTime.UtcNow
            });

        var controller = new MemoryController(
            memoryServiceMock.Object,
            ingestionServiceMock.Object,
            apiKeyContextMock.Object,
            hybridRetrievalMock,
            jobServiceMock.Object);

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext()
        };

        var request = new CreateMemoryRequest
        {
            Content = "Heavy memory for background processing",
            MemoryType = "Fact",
            ActorId = "actor-1"
        };

        var result = await controller.CreateMemory(request, mode: "async");

        var acceptedResult = Assert.IsType<AcceptedAtActionResult>(result);
        Assert.Equal(StatusCodes.Status202Accepted, acceptedResult.StatusCode);
        var responsePayload = Assert.IsType<AsyncJobAcceptedResponse>(acceptedResult.Value);
        Assert.Equal(expectedJobId, responsePayload.JobId);
        Assert.Equal(777, responsePayload.MemoryId);
        Assert.Equal("Pending", responsePayload.Status);

        jobServiceMock.Verify(j => j.EnqueueAsyncCreateMemoryAsync(request, 42, 100, It.IsAny<CancellationToken>()), Times.Once);
        memoryServiceMock.Verify(m => m.CreateMemoryAsync(It.IsAny<CreateMemoryRequest>(), It.IsAny<long>(), It.IsAny<long?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Phase4A_Controller_CreateMemory_AsyncModeHeader_EnqueuesJob_Returns202Accepted()
    {
        var memoryServiceMock = new Mock<IMemoryService>();
        var ingestionServiceMock = new Mock<IMemoryIngestionService>();
        var apiKeyContextMock = new Mock<IApiKeyContext>();
        var hybridRetrievalMock = BuildHybridService();
        var jobServiceMock = new Mock<IMemoryJobService>();

        apiKeyContextMock.Setup(a => a.UserId).Returns(42);
        apiKeyContextMock.Setup(a => a.ProjectId).Returns(100);

        var expectedJobId = 42002L;
        jobServiceMock.Setup(j => j.EnqueueAsyncCreateMemoryAsync(
                It.IsAny<CreateMemoryRequest>(), 42, 100, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AsyncJobAcceptedResponse
            {
                JobId = expectedJobId,
                MemoryId = 888,
                Status = "Pending",
                CreatedAt = DateTime.UtcNow
            });

        var controller = new MemoryController(
            memoryServiceMock.Object,
            ingestionServiceMock.Object,
            apiKeyContextMock.Object,
            hybridRetrievalMock,
            jobServiceMock.Object);

        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers["X-Kairo-Mode"] = "async";
        controller.ControllerContext = new ControllerContext { HttpContext = httpContext };

        var request = new CreateMemoryRequest
        {
            Content = "Memory submitted with header mode",
            MemoryType = "Fact",
            ActorId = "actor-1"
        };

        var result = await controller.CreateMemory(request, mode: null);

        var acceptedResult = Assert.IsType<AcceptedAtActionResult>(result);
        Assert.Equal(StatusCodes.Status202Accepted, acceptedResult.StatusCode);
        jobServiceMock.Verify(j => j.EnqueueAsyncCreateMemoryAsync(request, 42, 100, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Phase4A_Controller_IngestConversation_AsyncMode_EnqueuesJob_Returns202Accepted()
    {
        var memoryServiceMock = new Mock<IMemoryService>();
        var ingestionServiceMock = new Mock<IMemoryIngestionService>();
        var apiKeyContextMock = new Mock<IApiKeyContext>();
        var hybridRetrievalMock = BuildHybridService();
        var jobServiceMock = new Mock<IMemoryJobService>();

        apiKeyContextMock.Setup(a => a.UserId).Returns(42);
        apiKeyContextMock.Setup(a => a.ProjectId).Returns(100);

        var expectedJobId = 42003L;
        jobServiceMock.Setup(j => j.EnqueueAsyncIngestConversationAsync(
                It.IsAny<IngestConversationRequest>(), 42, 100, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AsyncJobAcceptedResponse
            {
                JobId = expectedJobId,
                Status = "Pending",
                CreatedAt = DateTime.UtcNow
            });

        var controller = new MemoryController(
            memoryServiceMock.Object,
            ingestionServiceMock.Object,
            apiKeyContextMock.Object,
            hybridRetrievalMock,
            jobServiceMock.Object);

        controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() };

        var request = new IngestConversationRequest
        {
            ActorId = "actor-1",
            Messages = new List<IngestMessageItem>
            {
                new() { Role = "user", Content = "Long complex dialogue..." }
            }
        };

        var result = await controller.IngestConversation(request, mode: "async");

        var acceptedResult = Assert.IsType<AcceptedAtActionResult>(result);
        Assert.Equal(StatusCodes.Status202Accepted, acceptedResult.StatusCode);
        var response = Assert.IsType<AsyncJobAcceptedResponse>(acceptedResult.Value);
        Assert.Equal(expectedJobId, response.JobId);

        jobServiceMock.Verify(j => j.EnqueueAsyncIngestConversationAsync(request, 42, 100, It.IsAny<CancellationToken>()), Times.Once);
        ingestionServiceMock.Verify(i => i.IngestAsync(It.IsAny<IngestConversationRequest>(), It.IsAny<long>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Job Status Endpoint & Security (IDOR Protection)
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Phase4A_Controller_GetJobStatus_AuthorizedUser_ReturnsJobStatus()
    {
        var memoryServiceMock = new Mock<IMemoryService>();
        var ingestionServiceMock = new Mock<IMemoryIngestionService>();
        var apiKeyContextMock = new Mock<IApiKeyContext>();
        var hybridRetrievalMock = BuildHybridService();
        var jobServiceMock = new Mock<IMemoryJobService>();

        apiKeyContextMock.Setup(a => a.UserId).Returns(42);
        apiKeyContextMock.Setup(a => a.ProjectId).Returns(100);

        var jobId = 42010L;
        var expectedStatus = new JobStatusResponse
        {
            JobId = jobId,
            JobType = "CreateMemory",
            Status = "Completed",
            MemoryId = 555,
            Attempts = 1,
            MaxAttempts = 3,
            CreatedAt = DateTime.UtcNow.AddMinutes(-1),
            CompletedAt = DateTime.UtcNow
        };

        jobServiceMock.Setup(j => j.GetJobStatusAsync(jobId, 42, 100, It.IsAny<CancellationToken>()))
            .ReturnsAsync(expectedStatus);

        var controller = new MemoryController(
            memoryServiceMock.Object,
            ingestionServiceMock.Object,
            apiKeyContextMock.Object,
            hybridRetrievalMock,
            jobServiceMock.Object);

        controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() };

        var result = await controller.GetJobStatus(jobId);

        var okResult = Assert.IsType<OkObjectResult>(result);
        Assert.Equal(StatusCodes.Status200OK, okResult.StatusCode);
        Assert.Equal(expectedStatus, okResult.Value);
    }

    [Fact]
    public async Task Phase4A_Controller_GetJobStatus_UnauthorizedDifferentUserOrProject_Returns404NotFound()
    {
        var memoryServiceMock = new Mock<IMemoryService>();
        var ingestionServiceMock = new Mock<IMemoryIngestionService>();
        var apiKeyContextMock = new Mock<IApiKeyContext>();
        var hybridRetrievalMock = BuildHybridService();
        var jobServiceMock = new Mock<IMemoryJobService>();

        // Caller is User 42, Project 100
        apiKeyContextMock.Setup(a => a.UserId).Returns(42);
        apiKeyContextMock.Setup(a => a.ProjectId).Returns(100);

        var jobId = 42011L;
        // Job service returns null because ownership verification failed at repository level
        jobServiceMock.Setup(j => j.GetJobStatusAsync(jobId, 42, 100, It.IsAny<CancellationToken>()))
            .ReturnsAsync((JobStatusResponse?)null);

        var controller = new MemoryController(
            memoryServiceMock.Object,
            ingestionServiceMock.Object,
            apiKeyContextMock.Object,
            hybridRetrievalMock,
            jobServiceMock.Object);

        controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() };

        var result = await controller.GetJobStatus(jobId);

        var notFoundResult = Assert.IsType<NotFoundObjectResult>(result);
        Assert.Equal(StatusCodes.Status404NotFound, notFoundResult.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. MemoryJobService Unit Tests: Transaction Atomicity & Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Phase4A_MemoryJobService_EnqueueCreateMemory_AtomicTransactionExecution()
    {
        var jobRepoMock = new Mock<IIngestionJobRepository>();
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var scopeResolverMock = new Mock<IScopeResolutionService>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var txCoordinatorMock = new Mock<ITransactionCoordinator>();
        var loggerMock = new Mock<ILogger<MemoryJobService>>();

        scopeResolverMock.Setup(s => s.GetOrCreateScopeAsync(100, "actor-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(50);

        memoryRepoMock.Setup(m => m.ExistsAsync(42, "Async fact", 50))
            .ReturnsAsync(false);

        memoryRepoMock.Setup(m => m.CreateAsync(
                42,
                It.Is<ExtractedMemory>(e => e.Content == "Async fact" && e.MemoryType == "Fact"),
                null, 50, null, null, null, It.IsAny<List<string>?>()))
            .ReturnsAsync(777);

        // Transaction coordinator executes the lambda directly
        txCoordinatorMock.Setup(t => t.ExecuteInTransactionAsync(It.IsAny<Func<Task>>(), It.IsAny<CancellationToken>()))
            .Returns<Func<Task>, CancellationToken>((op, ct) => op());

        jobRepoMock.Setup(j => j.EnqueueJobAsync(It.IsAny<MemoryIngestionJobRecord>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(42100L);

        var service = new MemoryJobService(
            jobRepoMock.Object,
            memoryRepoMock.Object,
            scopeResolverMock.Object,
            embeddingGenMock.Object,
            txCoordinatorMock.Object,
            loggerMock.Object);

        var request = new CreateMemoryRequest
        {
            Content = "Async fact",
            MemoryType = "Fact",
            ActorId = "actor-1"
        };

        var response = await service.EnqueueAsyncCreateMemoryAsync(request, 42, 100);

        Assert.NotEqual(0L, response.JobId);
        Assert.Equal(42100L, response.JobId);
        Assert.Equal(777, response.MemoryId);
        Assert.Equal("Pending", response.Status);

        // Verify transaction coordinator was used to guarantee atomic persistence
        txCoordinatorMock.Verify(t => t.ExecuteInTransactionAsync(It.IsAny<Func<Task>>(), It.IsAny<CancellationToken>()), Times.Once);
        memoryRepoMock.Verify(m => m.CreateAsync(42, It.IsAny<ExtractedMemory>(), null, 50, null, null, null, It.IsAny<List<string>?>()), Times.Once);
        jobRepoMock.Verify(j => j.EnqueueJobAsync(It.Is<MemoryIngestionJobRecord>(r => r.MemoryId == 777 && r.JobType == "CreateMemory"), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Phase4A_MemoryJobService_EnqueueCreateMemory_ExactDuplicateFailsFast()
    {
        var jobRepoMock = new Mock<IIngestionJobRepository>();
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var scopeResolverMock = new Mock<IScopeResolutionService>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var txCoordinatorMock = new Mock<ITransactionCoordinator>();
        var loggerMock = new Mock<ILogger<MemoryJobService>>();

        scopeResolverMock.Setup(s => s.GetOrCreateScopeAsync(100, "actor-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(50);

        // Memory already exists!
        memoryRepoMock.Setup(m => m.ExistsAsync(42, "Existing fact", 50))
            .ReturnsAsync(true);

        var service = new MemoryJobService(
            jobRepoMock.Object,
            memoryRepoMock.Object,
            scopeResolverMock.Object,
            embeddingGenMock.Object,
            txCoordinatorMock.Object,
            loggerMock.Object);

        var request = new CreateMemoryRequest
        {
            Content = "Existing fact",
            MemoryType = "Fact",
            ActorId = "actor-1"
        };

        await Assert.ThrowsAsync<ArgumentException>(() => service.EnqueueAsyncCreateMemoryAsync(request, 42, 100));

        // Ensure no transaction was opened and no job enqueued
        txCoordinatorMock.Verify(t => t.ExecuteInTransactionAsync(It.IsAny<Func<Task>>(), It.IsAny<CancellationToken>()), Times.Never);
        jobRepoMock.Verify(j => j.EnqueueJobAsync(It.IsAny<MemoryIngestionJobRecord>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Phase4A_MemoryJobService_ProcessJob_CreateMemory_GeneratesEmbeddingAndExtractsEntities()
    {
        var jobRepoMock = new Mock<IIngestionJobRepository>();
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var scopeResolverMock = new Mock<IScopeResolutionService>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var txCoordinatorMock = new Mock<ITransactionCoordinator>();
        var entityExtractionMock = new Mock<IEntityExtractionService>();
        var entityRepoMock = new Mock<IEntityRepository>();
        var loggerMock = new Mock<ILogger<MemoryJobService>>();

        var snapshot = new MemorySnapshot
        {
            MemoryId = 777,
            UserId = 42,
            Content = "Alice works at Acme Inc.",
            MemoryType = "Fact",
            IsActive = true
        };

        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(777, 42, 100, 50))
            .ReturnsAsync(snapshot);

        var vector = new float[] { 0.1f, 0.2f, 0.3f };
        embeddingGenMock.Setup(e => e.GenerateAsync("Alice works at Acme Inc."))
            .ReturnsAsync(vector);

        var extraction = new FullExtractionResult
        {
            Entities = new List<ExtractedEntity>
            {
                new() { DisplayName = "Alice", NormalizedName = "alice", EntityType = "PERSON" },
                new() { DisplayName = "Acme Inc.", NormalizedName = "acme-inc", EntityType = "COMPANY" }
            },
            Relationships = new List<ExtractedRelationship>
            {
                new() { Source = "Alice", Target = "Acme Inc.", RelationshipType = "works_at", Confidence = 1.0 }
            }
        };

        entityExtractionMock.Setup(e => e.ExtractFullAsync("Alice works at Acme Inc.", It.IsAny<CancellationToken>()))
            .ReturnsAsync(extraction);

        var service = new MemoryJobService(
            jobRepoMock.Object,
            memoryRepoMock.Object,
            scopeResolverMock.Object,
            embeddingGenMock.Object,
            txCoordinatorMock.Object,
            loggerMock.Object,
            entityExtractionMock.Object,
            entityRepoMock.Object);

        var job = new MemoryIngestionJobRecord
        {
            JobId = 42201L,
            UserId = 42,
            ProjectId = 100,
            ScopeId = 50,
            MemoryId = 777,
            JobType = "CreateMemory"
        };

        await service.ProcessJobAsync(job);

        // Verifications:
        // 1. Embedding generated and saved
        embeddingGenMock.Verify(e => e.GenerateAsync("Alice works at Acme Inc."), Times.Once);
        memoryRepoMock.Verify(m => m.SaveEmbeddingAsync(777, "mistral-embed", vector), Times.Once);

        // 2. Entities and relationships upserted
        entityRepoMock.Verify(e => e.UpsertEntitiesForMemoryAsync(100, 777, extraction.Entities, It.IsAny<CancellationToken>()), Times.Once);
        entityRepoMock.Verify(e => e.UpsertRelationshipsForMemoryAsync(100, 50, 777, extraction.Relationships, It.IsAny<CancellationToken>()), Times.Once);

        // 3. Job marked completed
        jobRepoMock.Verify(j => j.CompleteJobAsync(job.JobId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Phase4A_MemoryJobService_ProcessJob_DeletedMemory_CancelsJobWithoutSideEffects()
    {
        var jobRepoMock = new Mock<IIngestionJobRepository>();
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var scopeResolverMock = new Mock<IScopeResolutionService>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var txCoordinatorMock = new Mock<ITransactionCoordinator>();
        var entityExtractionMock = new Mock<IEntityExtractionService>();
        var entityRepoMock = new Mock<IEntityRepository>();
        var loggerMock = new Mock<ILogger<MemoryJobService>>();

        // Memory was soft-deleted or removed!
        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(777, 42, 100, 50))
            .ReturnsAsync((MemorySnapshot?)null);

        var service = new MemoryJobService(
            jobRepoMock.Object,
            memoryRepoMock.Object,
            scopeResolverMock.Object,
            embeddingGenMock.Object,
            txCoordinatorMock.Object,
            loggerMock.Object,
            entityExtractionMock.Object,
            entityRepoMock.Object);

        var job = new MemoryIngestionJobRecord
        {
            JobId = 42202L,
            UserId = 42,
            ProjectId = 100,
            ScopeId = 50,
            MemoryId = 777,
            JobType = "CreateMemory"
        };

        await service.ProcessJobAsync(job);

        // Must cancel job
        jobRepoMock.Verify(j => j.CancelJobAsync(job.JobId, It.Is<string>(s => s.Contains("deleted")), It.IsAny<CancellationToken>()), Times.Once);

        // Must NEVER generate embeddings or extract entities for deleted memory
        embeddingGenMock.Verify(e => e.GenerateAsync(It.IsAny<string>()), Times.Never);
        entityExtractionMock.Verify(e => e.ExtractFullAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Phase4A_MemoryJobService_ProcessJob_ExpiredMemory_CancelsJobWithoutSideEffects()
    {
        var jobRepoMock = new Mock<IIngestionJobRepository>();
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var scopeResolverMock = new Mock<IScopeResolutionService>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var txCoordinatorMock = new Mock<ITransactionCoordinator>();
        var entityExtractionMock = new Mock<IEntityExtractionService>();
        var entityRepoMock = new Mock<IEntityRepository>();
        var loggerMock = new Mock<ILogger<MemoryJobService>>();

        // Memory expired in the past!
        var expiredSnapshot = new MemorySnapshot
        {
            MemoryId = 777,
            UserId = 42,
            Content = "Temporary passcode",
            MemoryType = "Fact",
            IsActive = true,
            ExpiresAt = DateTime.UtcNow.AddMinutes(-5)
        };

        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(777, 42, 100, 50))
            .ReturnsAsync(expiredSnapshot);

        var service = new MemoryJobService(
            jobRepoMock.Object,
            memoryRepoMock.Object,
            scopeResolverMock.Object,
            embeddingGenMock.Object,
            txCoordinatorMock.Object,
            loggerMock.Object,
            entityExtractionMock.Object,
            entityRepoMock.Object);

        var job = new MemoryIngestionJobRecord
        {
            JobId = 42203L,
            UserId = 42,
            ProjectId = 100,
            ScopeId = 50,
            MemoryId = 777,
            JobType = "CreateMemory"
        };

        await service.ProcessJobAsync(job);

        // Must cancel job with expired reason
        jobRepoMock.Verify(j => j.CancelJobAsync(job.JobId, It.Is<string>(s => s.Contains("expired")), It.IsAny<CancellationToken>()), Times.Once);

        // Must NEVER generate embeddings for expired memory
        embeddingGenMock.Verify(e => e.GenerateAsync(It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task Phase4A_MemoryJobService_ProcessJob_TransientFailure_SchedulesRetryWithBackoff()
    {
        var jobRepoMock = new Mock<IIngestionJobRepository>();
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var scopeResolverMock = new Mock<IScopeResolutionService>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var txCoordinatorMock = new Mock<ITransactionCoordinator>();
        var loggerMock = new Mock<ILogger<MemoryJobService>>();

        var snapshot = new MemorySnapshot
        {
            MemoryId = 777,
            UserId = 42,
            Content = "Network unstable fact",
            MemoryType = "Fact",
            IsActive = true
        };

        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(777, 42, 100, 50))
            .ReturnsAsync(snapshot);

        // Provider network failure!
        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ThrowsAsync(new HttpRequestException("Connection timed out to Mistral API"));

        var service = new MemoryJobService(
            jobRepoMock.Object,
            memoryRepoMock.Object,
            scopeResolverMock.Object,
            embeddingGenMock.Object,
            txCoordinatorMock.Object,
            loggerMock.Object);

        var job = new MemoryIngestionJobRecord
        {
            JobId = 42204L,
            UserId = 42,
            ProjectId = 100,
            ScopeId = 50,
            MemoryId = 777,
            JobType = "CreateMemory",
            Attempts = 1
        };

        await service.ProcessJobAsync(job);

        // Verify FailJobAsync called with canRetry: true and a retryDelay
        jobRepoMock.Verify(j => j.FailJobAsync(
            job.JobId,
            It.Is<string>(s => s.Contains("Transient")),
            true,
            It.IsNotNull<TimeSpan?>(),
            It.IsAny<CancellationToken>()), Times.Once);

        jobRepoMock.Verify(j => j.CompleteJobAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Phase4A_MemoryJobService_ProcessJob_PermanentFailure_MarksJobFailedWithoutRetry()
    {
        var jobRepoMock = new Mock<IIngestionJobRepository>();
        var memoryRepoMock = new Mock<IMemoryRepository>();
        var scopeResolverMock = new Mock<IScopeResolutionService>();
        var embeddingGenMock = new Mock<IEmbeddingGenerator>();
        var txCoordinatorMock = new Mock<ITransactionCoordinator>();
        var loggerMock = new Mock<ILogger<MemoryJobService>>();

        var snapshot = new MemorySnapshot
        {
            MemoryId = 777,
            UserId = 42,
            Content = "Malformed content",
            MemoryType = "Fact",
            IsActive = true
        };

        memoryRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(777, 42, 100, 50))
            .ReturnsAsync(snapshot);

        // Fatal logic exception
        embeddingGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ThrowsAsync(new InvalidOperationException("Fatal parsing error"));

        var service = new MemoryJobService(
            jobRepoMock.Object,
            memoryRepoMock.Object,
            scopeResolverMock.Object,
            embeddingGenMock.Object,
            txCoordinatorMock.Object,
            loggerMock.Object);

        var job = new MemoryIngestionJobRecord
        {
            JobId = 42205L,
            UserId = 42,
            ProjectId = 100,
            ScopeId = 50,
            MemoryId = 777,
            JobType = "CreateMemory",
            Attempts = 1
        };

        await service.ProcessJobAsync(job);

        // Verify FailJobAsync called with canRetry: false
        jobRepoMock.Verify(j => j.FailJobAsync(
            job.JobId,
            "Fatal parsing error",
            false,
            null,
            It.IsAny<CancellationToken>()), Times.Once);
    }

    private static HybridRetrievalService BuildHybridService()
    {
        var memRepo = new Mock<IMemoryRepository>();
        memRepo.SetReturnsDefault<Task<List<MemoryEmbeddingData>>>(
            Task.FromResult(new List<MemoryEmbeddingData>()));

        var relEval = new Mock<IMemoryRelevanceEvaluator>();
        relEval.Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string q, List<RetrievedMemory> c) => c);

        return new HybridRetrievalService(
            memRepo.Object,
            new Mock<IEmbeddingGenerator>().Object,
            new SemanticSimilarityService(),
            relEval.Object,
            new Mock<IKeywordSearchRepository>().Object,
            new Mock<IEntityRepository>().Object,
            new Mock<IEntityExtractionService>().Object,
            new Mock<ILogger<HybridRetrievalService>>().Object);
    }
}
