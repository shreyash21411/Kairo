using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
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
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Ingestion worker reliability and production hardening tests:
/// 1. A stale worker cannot complete a job after another claim takes ownership.
/// 2. A stale worker cannot schedule a retry or mark a newer claim as failed.
/// 3. An expired lease with attempts remaining can be reclaimed.
/// 4. An expired lease at the maximum attempt count transitions to Failed.
/// 5. Multiple workers cannot claim the same active job concurrently in PostgreSQL.
/// 6. A cancellation/completion race produces a valid, deterministic final state.
/// 7. Long-running processing cannot lead to an old worker corrupting a newer claim.
/// 8. Unexpected processing exceptions produce the intended retry or terminal outcome.
/// 9. Memory deletion/expiration cancels job without subsequent completion overwrite.
/// 10. Lease renewal for actively owned job successfully extends lease duration.
/// </summary>
public class IngestionWorkerReliabilityTests
{
    private static KairoDbContext CreateInMemoryContext(string dbName)
    {
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseInMemoryDatabase(databaseName: dbName)
            .Options;
        return new KairoDbContext(options);
    }

    // ── Test 1: Stale Worker Cannot Complete Job After Reclaim ────────────────

    [Fact]
    public async Task StaleWorker_CannotCompleteJob_AfterAnotherClaimTakesOwnership()
    {
        var dbName = Guid.NewGuid().ToString();
        await using var db = CreateInMemoryContext(dbName);
        var repo = new IngestionJobRepository(db);

        var jobId = await repo.EnqueueJobAsync(new MemoryIngestionJobRecord
        {
            UserId = 1,
            ProjectId = 1,
            JobType = "CreateMemory",
            Status = "Pending",
            Attempts = 0,
            MaxAttempts = 3,
            AvailableAt = DateTime.UtcNow.AddMinutes(-5),
            CreatedAt = DateTime.UtcNow.AddMinutes(-5)
        });

        // Worker 1 claims job
        var claimed1 = await repo.ClaimNextJobsAsync(1, "worker-1", TimeSpan.FromMinutes(2));
        Assert.Single(claimed1);
        var worker1Token = claimed1[0].LockOwner;
        Assert.NotNull(worker1Token);

        // Simulate lease expiration
        var jobEntity = await db.MemoryIngestionJobs.FindAsync(jobId);
        Assert.NotNull(jobEntity);
        jobEntity.LockedUntil = DateTime.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();

        // Worker 2 claims the expired job
        var claimed2 = await repo.ClaimNextJobsAsync(1, "worker-2", TimeSpan.FromMinutes(2));
        Assert.Single(claimed2);
        var worker2Token = claimed2[0].LockOwner;
        Assert.NotNull(worker2Token);
        Assert.NotEqual(worker1Token, worker2Token);

        // Worker 1 attempts to complete the job with stale token -> MUST FAIL
        var worker1Completed = await repo.CompleteJobAsync(jobId, lockOwner: worker1Token);
        Assert.False(worker1Completed);

        // Verify in DB that job is NOT completed and still owned by Worker 2
        var currentJob = await db.MemoryIngestionJobs.FindAsync(jobId);
        Assert.NotNull(currentJob);
        Assert.Equal("Processing", currentJob.Status);
        Assert.Equal(worker2Token, currentJob.LockOwner);

        // Worker 2 completes with active token -> MUST SUCCEED
        var worker2Completed = await repo.CompleteJobAsync(jobId, lockOwner: worker2Token);
        Assert.True(worker2Completed);

        var finalJob = await db.MemoryIngestionJobs.FindAsync(jobId);
        Assert.NotNull(finalJob);
        Assert.Equal("Completed", finalJob.Status);
        Assert.Null(finalJob.LockOwner);
    }

    // ── Test 2: Stale Worker Cannot Schedule Retry or Overwrite Failure ───────

    [Fact]
    public async Task StaleWorker_CannotScheduleRetryOrMarkNewerClaimFailed()
    {
        var dbName = Guid.NewGuid().ToString();
        await using var db = CreateInMemoryContext(dbName);
        var repo = new IngestionJobRepository(db);

        var jobId = await repo.EnqueueJobAsync(new MemoryIngestionJobRecord
        {
            UserId = 1,
            ProjectId = 1,
            JobType = "CreateMemory",
            Status = "Pending",
            Attempts = 0,
            MaxAttempts = 3,
            AvailableAt = DateTime.UtcNow.AddMinutes(-5)
        });

        var claimed1 = await repo.ClaimNextJobsAsync(1, "worker-1", TimeSpan.FromMinutes(2));
        var worker1Token = claimed1[0].LockOwner;

        // Simulate lease expiration and reclaim by Worker 2
        var jobEntity = await db.MemoryIngestionJobs.FindAsync(jobId);
        jobEntity!.LockedUntil = DateTime.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();

        var claimed2 = await repo.ClaimNextJobsAsync(1, "worker-2", TimeSpan.FromMinutes(2));
        var worker2Token = claimed2[0].LockOwner;

        // Worker 1 tries to fail & reschedule retry -> MUST FAIL
        var worker1Failed = await repo.FailJobAsync(
            jobId,
            error: "Worker 1 transient error",
            canRetry: true,
            retryDelay: TimeSpan.FromSeconds(10),
            lockOwner: worker1Token);

        Assert.False(worker1Failed);

        // DB state must remain in Processing owned by Worker 2
        var current = await db.MemoryIngestionJobs.FindAsync(jobId);
        Assert.Equal("Processing", current!.Status);
        Assert.Equal(worker2Token, current.LockOwner);
        Assert.NotEqual("Worker 1 transient error", current.LastError);
    }

    // ── Test 3: Expired Lease With Attempts Remaining Can Be Reclaimed ────────

    [Fact]
    public async Task ExpiredLease_WithAttemptsRemaining_CanBeReclaimed()
    {
        var dbName = Guid.NewGuid().ToString();
        await using var db = CreateInMemoryContext(dbName);
        var repo = new IngestionJobRepository(db);

        var now = DateTime.UtcNow;
        var job = new MemoryIngestionJob
        {
            UserId = 1,
            ProjectId = 1,
            JobType = "CreateMemory",
            Status = "Processing",
            Attempts = 1,
            MaxAttempts = 3,
            AvailableAt = now.AddMinutes(-10),
            CreatedAt = now.AddMinutes(-10),
            LockedUntil = now.AddMinutes(-2), // Expired 2 minutes ago
            LockOwner = "old-worker:token123"
        };
        db.MemoryIngestionJobs.Add(job);
        await db.SaveChangesAsync();

        var claimed = await repo.ClaimNextJobsAsync(1, "new-worker", TimeSpan.FromMinutes(2));
        Assert.Single(claimed);
        Assert.Equal(job.JobId, claimed[0].JobId);
        Assert.Equal(2, claimed[0].Attempts); // Incremented
        Assert.StartsWith("new-worker:", claimed[0].LockOwner!);
    }

    // ── Test 4: Expired Lease at Max Attempts Transitions to Failed ───────────

    [Fact]
    public async Task ExpiredLease_AtMaxAttempts_TransitionsToFailed()
    {
        var dbName = Guid.NewGuid().ToString();
        await using var db = CreateInMemoryContext(dbName);
        var repo = new IngestionJobRepository(db);

        var now = DateTime.UtcNow;
        var job = new MemoryIngestionJob
        {
            UserId = 1,
            ProjectId = 1,
            JobType = "CreateMemory",
            Status = "Processing",
            Attempts = 3,
            MaxAttempts = 3, // Already at max attempts!
            AvailableAt = now.AddMinutes(-10),
            CreatedAt = now.AddMinutes(-10),
            LockedUntil = now.AddMinutes(-2), // Expired
            LockOwner = "crashed-worker:tokenXYZ"
        };
        db.MemoryIngestionJobs.Add(job);
        await db.SaveChangesAsync();

        // Recovery query runs proactively on ClaimNextJobsAsync or directly
        var recoveredCount = await repo.RecoverExhaustedJobsAsync();
        Assert.Equal(1, recoveredCount);

        var updated = await db.MemoryIngestionJobs.FindAsync(job.JobId);
        Assert.NotNull(updated);
        Assert.Equal("Failed", updated.Status);
        Assert.Contains("Job lease expired after reaching maximum attempts", updated.LastError!);
        Assert.Null(updated.LockedUntil);
        Assert.Null(updated.LockOwner);
        Assert.NotNull(updated.CompletedAt);
    }

    // ── Test 5: Multiple Workers Cannot Claim Same Active Job in PostgreSQL ───

    [DedicatedTestPostgresFact]
    public async Task MultipleWorkers_CannotClaimSameActiveJob_Concurrently_PostgreSql()
    {
        var connStr = ProductionHardeningVerificationTests.DiscoverDedicatedTestPostgresConnectionString();
        Assert.NotNull(connStr);

        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseNpgsql(connStr, o => o.UseVector())
            .Options;

        await using var seedDb = new KairoDbContext(options);
        var canConnect = await seedDb.Database.CanConnectAsync();
        Assert.True(canConnect, "Configured dedicated test database is unreachable.");

        Users? createdUser = null;
        Projects? createdProject = null;

        var user = await seedDb.Users.FirstOrDefaultAsync();
        if (user == null)
        {
            user = new Users
            {
                Email = $"worker_conc_{Guid.NewGuid():N}@voidzone.internal",
                AccountStatus = 1,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            seedDb.Users.Add(user);
            await seedDb.SaveChangesAsync();
            createdUser = user;
        }

        var project = await seedDb.Projects.FirstOrDefaultAsync(p => p.UserId == user.UserId);
        if (project == null)
        {
            project = new Projects
            {
                UserId = user.UserId,
                Name = "Worker Conc Project",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            seedDb.Projects.Add(project);
            await seedDb.SaveChangesAsync();
            createdProject = project;
        }

        var now = DateTime.UtcNow;
        var tag = $"ConcTest_{Guid.NewGuid():N}";
        var job1 = new MemoryIngestionJob
        {
            UserId = user.UserId,
            ProjectId = project.ProjectId,
            JobType = tag,
            Status = "Pending",
            Attempts = 0,
            MaxAttempts = 3,
            AvailableAt = now.AddMinutes(-5),
            CreatedAt = now.AddMinutes(-5)
        };
        var job2 = new MemoryIngestionJob
        {
            UserId = user.UserId,
            ProjectId = project.ProjectId,
            JobType = tag,
            Status = "Pending",
            Attempts = 0,
            MaxAttempts = 3,
            AvailableAt = now.AddMinutes(-4),
            CreatedAt = now.AddMinutes(-4)
        };

        seedDb.MemoryIngestionJobs.AddRange(job1, job2);
        await seedDb.SaveChangesAsync();

        var job1Id = job1.JobId;
        var job2Id = job2.JobId;

        try
        {
            // Spawn 4 simultaneous competing worker tasks for 2 jobs
            var barrier = new TaskCompletionSource<bool>();
            var tasks = Enumerable.Range(1, 4).Select(i => Task.Run(async () =>
            {
                await barrier.Task;
                await using var workerDb = new KairoDbContext(options);
                var repo = new IngestionJobRepository(workerDb);
                return await repo.ClaimNextJobsAsync(1, $"worker-load-{i}", TimeSpan.FromMinutes(2));
            })).ToList();

            barrier.SetResult(true);
            var results = await Task.WhenAll(tasks);

            var allClaimed = results.SelectMany(r => r).ToList();

            // Exactly 2 total claims must have succeeded across all 4 workers
            Assert.Equal(2, allClaimed.Count);

            // The claimed job IDs must be completely distinct
            var claimedIds = allClaimed.Select(c => c.JobId).Distinct().ToList();
            Assert.Equal(2, claimedIds.Count);

            // All claim tokens must be unique
            var claimTokens = allClaimed.Select(c => c.LockOwner).Distinct().ToList();
            Assert.Equal(2, claimTokens.Count);
        }
        finally
        {
            await using var cleanDb = new KairoDbContext(options);
            var toRemove = await cleanDb.MemoryIngestionJobs
                .Where(j => j.JobId == job1Id || j.JobId == job2Id)
                .ToListAsync();
            cleanDb.MemoryIngestionJobs.RemoveRange(toRemove);

            if (createdProject != null)
            {
                var proj = await cleanDb.Projects.FindAsync(createdProject.ProjectId);
                if (proj != null) cleanDb.Projects.Remove(proj);
            }

            if (createdUser != null)
            {
                var usr = await cleanDb.Users.FindAsync(createdUser.UserId);
                if (usr != null) cleanDb.Users.Remove(usr);
            }

            await cleanDb.SaveChangesAsync();
        }
    }

    // ── Test 6: Cancellation/Completion Race Produces Deterministic State ─────

    [Fact]
    public async Task Cancellation_Completion_Race_ProducesDeterministicFinalState()
    {
        var dbName = Guid.NewGuid().ToString();
        await using var db = CreateInMemoryContext(dbName);
        var repo = new IngestionJobRepository(db);

        var jobId = await repo.EnqueueJobAsync(new MemoryIngestionJobRecord
        {
            UserId = 1,
            ProjectId = 1,
            JobType = "CreateMemory",
            Status = "Pending"
        });

        var claimed = await repo.ClaimNextJobsAsync(1, "worker-race", TimeSpan.FromMinutes(2));
        var workerToken = claimed[0].LockOwner;

        // Administrative cancellation arrives while worker is processing
        var cancelled = await repo.CancelJobAsync(jobId, "Memory deleted by user", lockOwner: null);
        Assert.True(cancelled);

        // Stale worker finishes and tries to complete -> MUST FAIL
        var completed = await repo.CompleteJobAsync(jobId, lockOwner: workerToken);
        Assert.False(completed);

        // Verify status remains Cancelled
        var finalJob = await db.MemoryIngestionJobs.FindAsync(jobId);
        Assert.Equal("Cancelled", finalJob!.Status);
        Assert.Equal("Memory deleted by user", finalJob.LastError);
    }

    // ── Test 7: Lease Renewal Validates Ownership and Extends Lease ───────────

    [Fact]
    public async Task LeaseRenewal_ValidatesOwnership_AndRejectsStaleWorker()
    {
        var dbName = Guid.NewGuid().ToString();
        await using var db = CreateInMemoryContext(dbName);
        var repo = new IngestionJobRepository(db);

        var jobId = await repo.EnqueueJobAsync(new MemoryIngestionJobRecord
        {
            UserId = 1,
            ProjectId = 1,
            JobType = "CreateMemory",
            Status = "Pending"
        });

        var claimed = await repo.ClaimNextJobsAsync(1, "worker-renew", TimeSpan.FromMinutes(2));
        var token = claimed[0].LockOwner;

        // Active worker successfully renews lease
        var renewed = await repo.RenewLeaseAsync(jobId, token!, TimeSpan.FromMinutes(5));
        Assert.True(renewed);

        var inDb = await db.MemoryIngestionJobs.FindAsync(jobId);
        Assert.True(inDb!.LockedUntil > DateTime.UtcNow.AddMinutes(4));

        // Invalid token cannot renew lease
        var badRenew = await repo.RenewLeaseAsync(jobId, "invalid-token", TimeSpan.FromMinutes(5));
        Assert.False(badRenew);
    }

    // ── Test 8: ProcessJobAsync Does Not Overwrite Cancelled Jobs ─────────────

    [Fact]
    public async Task ProcessJobAsync_WhenMemoryDeleted_CancelsAndDoesNotOverwriteWithCompleted()
    {
        var jobRepoMock = new Mock<IIngestionJobRepository>();
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();

        var job = new MemoryIngestionJobRecord
        {
            JobId = 9999L,
            JobType = "CreateMemory",
            MemoryId = 123L,
            UserId = 1L,
            ProjectId = 1L,
            LockOwner = "worker-test:token1"
        };

        // Memory does not exist (was deleted)
        memRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(123L, 1L, 1L, It.IsAny<long?>()))
            .ReturnsAsync((MemorySnapshot?)null);

        jobRepoMock.Setup(j => j.CancelJobAsync(9999L, It.IsAny<string>(), "worker-test:token1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var service = new MemoryJobService(
            jobRepoMock.Object,
            memRepoMock.Object,
            new Mock<IScopeResolutionService>().Object,
            embGenMock.Object,
            new Mock<ITransactionCoordinator>().Object,
            NullLogger<MemoryJobService>.Instance);

        await service.ProcessJobAsync(job);

        // CancelJobAsync must have been called
        jobRepoMock.Verify(j => j.CancelJobAsync(9999L, It.Is<string>(s => s.Contains("deleted")), "worker-test:token1", It.IsAny<CancellationToken>()), Times.Once);

        // CRITICAL BUG VERIFICATION: CompleteJobAsync must NEVER have been called!
        jobRepoMock.Verify(j => j.CompleteJobAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
        jobRepoMock.Verify(j => j.CompleteJobAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Test 9: ProcessJobAsync Rethrows OperationCanceledException ───────────

    [Fact]
    public async Task ProcessJobAsync_WhenCancellationRequested_DoesNotMarkAsPermanentFailure()
    {
        var jobRepoMock = new Mock<IIngestionJobRepository>();
        var memRepoMock = new Mock<IMemoryRepository>();
        var embGenMock = new Mock<IEmbeddingGenerator>();

        using var cts = new CancellationTokenSource();
        cts.Cancel(); // Already cancelled

        var job = new MemoryIngestionJobRecord
        {
            JobId = 8888L,
            JobType = "CreateMemory",
            MemoryId = 123L,
            UserId = 1L,
            ProjectId = 1L
        };

        memRepoMock.Setup(m => m.GetMemorySnapshotForUserAsync(123L, 1L, 1L, It.IsAny<long?>()))
            .Throws(new OperationCanceledException(cts.Token));

        var service = new MemoryJobService(
            jobRepoMock.Object,
            memRepoMock.Object,
            new Mock<IScopeResolutionService>().Object,
            embGenMock.Object,
            new Mock<ITransactionCoordinator>().Object,
            NullLogger<MemoryJobService>.Instance);

        // Must rethrow OperationCanceledException and NOT swallow as permanent failure
        await Assert.ThrowsAsync<OperationCanceledException>(async () =>
        {
            await service.ProcessJobAsync(job, cts.Token);
        });

        // FailJobAsync must NEVER be called with canRetry: false
        jobRepoMock.Verify(j => j.FailJobAsync(It.IsAny<long>(), It.IsAny<string>(), false, It.IsAny<TimeSpan?>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
