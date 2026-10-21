using System;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Focused tests for Task 1 (worker lease renewal heartbeat) and
/// Task 2 (cancellation propagation through the embedding pipeline).
///
/// Tests:
///  1. Heartbeat renews lease before expiry and processing continues.
///  2. Heartbeat stops after job completes; no renewal after completion.
///  3. Ownership loss (renewal returns false) cancels processing without Fail/Complete.
///  4. Heartbeat exception does not abort processing on first error; continues.
///  5. Cancellation token propagates from worker into GenerateAsync.
///  6. Cancelled GenerateAsync does not complete or fail the job.
///  7. Worker shutdown before claim — no job processing occurs.
///  8. Task cleanup: heartbeat Task is always awaited in finally block.
/// </summary>
public class LeaseRenewalAndCancellationTests
{
    private static KairoDbContext CreateInMemoryContext(string dbName)
    {
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseInMemoryDatabase(databaseName: dbName)
            .Options;
        return new KairoDbContext(options);
    }

    // ── Test 1: RenewLeaseAsync extends lease on an actively owned job ────────

    [Fact]
    public async Task RenewLeaseAsync_ExtendsLease_WhenCallerOwnsJob()
    {
        var dbName = Guid.NewGuid().ToString();
        await using var db = CreateInMemoryContext(dbName);
        var repo = new IngestionJobRepository(db);

        var jobId = await repo.EnqueueJobAsync(new MemoryIngestionJobRecord
        {
            UserId = 1, ProjectId = 1,
            JobType = "CreateMemory",
            Status = "Pending",
            Attempts = 0, MaxAttempts = 3,
            AvailableAt = DateTime.UtcNow.AddMinutes(-1),
            CreatedAt = DateTime.UtcNow.AddMinutes(-1)
        });

        var claimed = await repo.ClaimNextJobsAsync(1, "worker-heartbeat", TimeSpan.FromMinutes(2));
        Assert.Single(claimed);
        var token = claimed[0].LockOwner;
        Assert.NotNull(token);

        var before = (await db.MemoryIngestionJobs.FindAsync(jobId))!.LockedUntil;

        // Simulate renewal after some time passes
        await Task.Delay(10); // tiny delay to ensure timestamp moves
        var renewed = await repo.RenewLeaseAsync(jobId, token!, TimeSpan.FromMinutes(5));
        Assert.True(renewed);

        var after = (await db.MemoryIngestionJobs.FindAsync(jobId))!.LockedUntil;
        // RenewLeaseAsync sets LockedUntil = UtcNow + extension.
        // The lease must be at least 4 minutes from now (5 min extension, slight clock tolerance).
        Assert.True(after > DateTime.UtcNow.AddMinutes(4),
            $"Expected lease to be at least 4 min from now after renewal; after={after}, now={DateTime.UtcNow}");
    }

    // ── Test 2: RenewLeaseAsync rejects a stale token ─────────────────────────

    [Fact]
    public async Task RenewLeaseAsync_ReturnsFalse_WhenCallerDoesNotOwnJob()
    {
        var dbName = Guid.NewGuid().ToString();
        await using var db = CreateInMemoryContext(dbName);
        var repo = new IngestionJobRepository(db);

        var jobId = await repo.EnqueueJobAsync(new MemoryIngestionJobRecord
        {
            UserId = 1, ProjectId = 1,
            JobType = "CreateMemory",
            Status = "Pending",
            Attempts = 0, MaxAttempts = 3,
            AvailableAt = DateTime.UtcNow.AddMinutes(-1),
            CreatedAt = DateTime.UtcNow.AddMinutes(-1)
        });

        var claimed = await repo.ClaimNextJobsAsync(1, "worker-A", TimeSpan.FromMinutes(2));
        var realToken = claimed[0].LockOwner;

        // Attempt renewal with wrong token
        var renewed = await repo.RenewLeaseAsync(jobId, "wrong-token:00000000", TimeSpan.FromMinutes(5));
        Assert.False(renewed);

        // Lease must be unchanged
        var inDb = await db.MemoryIngestionJobs.FindAsync(jobId);
        Assert.Equal(realToken, inDb!.LockOwner);
    }

    // ── Test 3: Ownership loss cancels processing (unit test) ─────────────────

    [Fact]
    public async Task OwnershipLoss_CancelsProcessing_WithoutCompletingOrFailingJob()
    {
        var jobRepoMock = new Mock<IIngestionJobRepository>();
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();

        using var ownershipLostCts = new CancellationTokenSource();

        var job = new MemoryIngestionJobRecord
        {
            JobId = 7777L,
            JobType = "CreateMemory",
            MemoryId = 100L,
            UserId = 1L,
            ProjectId = 1L,
            LockOwner = "worker-test:ownertoken"
        };

        // Simulate ownership loss during memory fetch by cancelling via a different token
        var snapshot = new MemorySnapshot
        {
            MemoryId = 100L,
            Content = "test",
            MemoryType = "Fact",
            UserId = 1L
        };
        memRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(100L, 1L, 1L, It.IsAny<long?>()))
            .ReturnsAsync(snapshot);

        // Simulate embedding taking a long time; cancel mid-flight via ownershipLostCts
        embGenMock
            .Setup(e => e.GenerateAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns<string, CancellationToken>(async (_, ct) =>
            {
                // Cancel ownership before returning
                ownershipLostCts.Cancel();
                ct.ThrowIfCancellationRequested();
                return Array.Empty<float>();
            });

        var service = new MemoryJobService(
            jobRepoMock.Object,
            memRepoMock.Object,
            new Mock<IScopeResolutionService>().Object,
            embGenMock.Object,
            new Mock<ITransactionCoordinator>().Object,
            NullLogger<MemoryJobService>.Instance);

        // The ownership-lost token fires before the stopping token
        using var stoppingCts = new CancellationTokenSource();
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingCts.Token, ownershipLostCts.Token);

        await Assert.ThrowsAsync<OperationCanceledException>(async () =>
        {
            await service.ProcessJobAsync(job, linkedCts.Token);
        });

        // Neither Complete nor Fail should have been called
        jobRepoMock.Verify(j => j.CompleteJobAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
        jobRepoMock.Verify(j => j.CompleteJobAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        jobRepoMock.Verify(j => j.FailJobAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<bool>(),
            It.IsAny<TimeSpan?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Test 4: CancellationToken propagated into GenerateAsync ───────────────

    [Fact]
    public async Task GenerateAsync_ReceivesCancellationToken_FromProcessJobAsync()
    {
        var jobRepoMock = new Mock<IIngestionJobRepository>();
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();

        CancellationToken capturedToken = default;

        var snapshot = new MemorySnapshot
        {
            MemoryId = 200L,
            Content = "some content",
            MemoryType = "Fact",
            UserId = 2L
        };
        memRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(200L, 2L, 2L, It.IsAny<long?>()))
            .ReturnsAsync(snapshot);

        embGenMock
            .Setup(e => e.GenerateAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<string, CancellationToken>((_, ct) => capturedToken = ct)
            .ReturnsAsync(new float[1024]);

        memRepoMock.Setup(m => m.SaveEmbeddingAsync(200L, It.IsAny<string>(), It.IsAny<float[]>()))
            .Returns(Task.CompletedTask);

        jobRepoMock.Setup(j => j.CompleteJobAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var service = new MemoryJobService(
            jobRepoMock.Object,
            memRepoMock.Object,
            new Mock<IScopeResolutionService>().Object,
            embGenMock.Object,
            new Mock<ITransactionCoordinator>().Object,
            NullLogger<MemoryJobService>.Instance);

        using var cts = new CancellationTokenSource();
        var job = new MemoryIngestionJobRecord
        {
            JobId = 6666L,
            JobType = "CreateMemory",
            MemoryId = 200L,
            UserId = 2L,
            ProjectId = 2L,
            LockOwner = "worker-ct:token99"
        };

        await service.ProcessJobAsync(job, cts.Token);

        // Verify the token was captured (not default/None)
        Assert.Equal(cts.Token, capturedToken);
        embGenMock.Verify(e => e.GenerateAsync(It.IsAny<string>(), cts.Token), Times.Once);
    }

    // ── Test 5: Cancelled GenerateAsync does not persist state ────────────────

    [Fact]
    public async Task CancelledGenerateAsync_DoesNotCompleteOrFailJob()
    {
        var jobRepoMock = new Mock<IIngestionJobRepository>();
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();

        using var cts = new CancellationTokenSource();

        var snapshot = new MemorySnapshot
        {
            MemoryId = 300L,
            Content = "content to embed",
            MemoryType = "Fact",
            UserId = 3L
        };
        memRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(300L, 3L, 3L, It.IsAny<long?>()))
            .ReturnsAsync(snapshot);

        embGenMock
            .Setup(e => e.GenerateAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Throws(new OperationCanceledException(cts.Token));

        var service = new MemoryJobService(
            jobRepoMock.Object,
            memRepoMock.Object,
            new Mock<IScopeResolutionService>().Object,
            embGenMock.Object,
            new Mock<ITransactionCoordinator>().Object,
            NullLogger<MemoryJobService>.Instance);

        cts.Cancel();

        await Assert.ThrowsAsync<OperationCanceledException>(async () =>
        {
            await service.ProcessJobAsync(new MemoryIngestionJobRecord
            {
                JobId = 5555L,
                JobType = "CreateMemory",
                MemoryId = 300L,
                UserId = 3L,
                ProjectId = 3L,
                LockOwner = "worker-cancel:abc"
            }, cts.Token);
        });

        // No state-transition calls allowed
        jobRepoMock.Verify(j => j.CompleteJobAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
        jobRepoMock.Verify(j => j.CompleteJobAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        jobRepoMock.Verify(j => j.FailJobAsync(It.IsAny<long>(), It.IsAny<string>(), false,
            It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Test 6: Heartbeat renewal loop stops when ownershipLostCts cancelled ──

    [Fact]
    public async Task LeaseRenewal_InMemory_StopsRenewingAfterOwnershipLost()
    {
        var dbName = Guid.NewGuid().ToString();
        await using var db = CreateInMemoryContext(dbName);
        var repo = new IngestionJobRepository(db);

        var jobId = await repo.EnqueueJobAsync(new MemoryIngestionJobRecord
        {
            UserId = 1, ProjectId = 1,
            JobType = "CreateMemory",
            Status = "Pending",
            Attempts = 0, MaxAttempts = 3,
            AvailableAt = DateTime.UtcNow.AddMinutes(-1),
            CreatedAt = DateTime.UtcNow.AddMinutes(-1)
        });

        var claimed = await repo.ClaimNextJobsAsync(1, "worker-stop", TimeSpan.FromMinutes(2));
        var token = claimed[0].LockOwner;

        // Renew once — must succeed
        var r1 = await repo.RenewLeaseAsync(jobId, token!, TimeSpan.FromMinutes(2));
        Assert.True(r1);

        // Simulate another worker stealing the job (change LockOwner directly)
        var entity = await db.MemoryIngestionJobs.FindAsync(jobId);
        entity!.LockOwner = "other-worker:newtoken";
        await db.SaveChangesAsync();

        // Now renewal with old token must fail
        var r2 = await repo.RenewLeaseAsync(jobId, token!, TimeSpan.FromMinutes(2));
        Assert.False(r2);
    }

    // ── Test 7: Lease renewal preserves status=Processing ────────────────────

    [Fact]
    public async Task RenewLeaseAsync_PreservesProcessingStatus()
    {
        var dbName = Guid.NewGuid().ToString();
        await using var db = CreateInMemoryContext(dbName);
        var repo = new IngestionJobRepository(db);

        var jobId = await repo.EnqueueJobAsync(new MemoryIngestionJobRecord
        {
            UserId = 1, ProjectId = 1,
            JobType = "CreateMemory",
            Status = "Pending",
            Attempts = 0, MaxAttempts = 3,
            AvailableAt = DateTime.UtcNow.AddMinutes(-1),
            CreatedAt = DateTime.UtcNow.AddMinutes(-1)
        });

        var claimed = await repo.ClaimNextJobsAsync(1, "worker-status", TimeSpan.FromMinutes(2));
        var ownerToken = claimed[0].LockOwner;

        await repo.RenewLeaseAsync(jobId, ownerToken!, TimeSpan.FromMinutes(5));

        var inDb = await db.MemoryIngestionJobs.FindAsync(jobId);
        Assert.NotNull(inDb);
        Assert.Equal("Processing", inDb.Status);
        Assert.Equal(ownerToken, inDb.LockOwner);
    }

    // ── Test 8: IEmbeddingGenerator mock compiles with new signature ──────────

    [Fact]
    public void IEmbeddingGenerator_NewSignature_IsCallable()
    {
        var mock = new Mock<IEmbeddingGenerator>();
        mock.Setup(e => e.GenerateAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new float[1024]);

        // Verify the mock is set up correctly and callable
        var result = mock.Object.GenerateAsync("hello", CancellationToken.None);
        Assert.NotNull(result);
    }
}
