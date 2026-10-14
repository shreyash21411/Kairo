using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Kairo.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Phase 5.8 Unit Tests covering:
///   5.8.1 — Schema: UsageLedgerEntry and ProjectQuota entity mapping
///   5.8.2 — UsageMeterService: records, swallows failures
///   5.8.3 — QuotaEnforcementService: per-minute, per-day limits, fail-open
///   5.8.4 — UsageReportingService: aggregates by operation and outcome
/// </summary>
public class Phase58UsageMeteringUnitTests : IDisposable
{
    private readonly KairoDbContext _db;

    public Phase58UsageMeteringUnitTests()
    {
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        _db = new KairoDbContext(options);

        // Seed minimal Users and Projects required for FK constraints.
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
            Name      = "Test Project",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            IsDeleted = false
        });
        _db.SaveChanges();
    }

    public void Dispose() => _db.Dispose();

    // ── 5.8.1: Schema Validation ──────────────────────────────────────────────

    [Fact]
    public void UsageLedgerEntry_CanBeAddedAndRetrieved()
    {
        var entry = new UsageLedgerEntry
        {
            UserId        = 1,
            ProjectId     = 10,
            OperationType = UsageOperationType.MemoryCreate,
            Outcome       = UsageOutcome.Success,
            OccurredAt    = DateTime.UtcNow,
            UnitCount     = 1
        };

        _db.UsageLedger.Add(entry);
        _db.SaveChanges();

        var retrieved = _db.UsageLedger.Single();
        Assert.Equal(UsageOperationType.MemoryCreate, retrieved.OperationType);
        Assert.Equal(UsageOutcome.Success, retrieved.Outcome);
        Assert.Equal(1, retrieved.UnitCount);
        Assert.Equal(1, retrieved.UserId);
        Assert.Equal(10, retrieved.ProjectId);
    }

    [Fact]
    public void ProjectQuota_CanBeAddedAndRetrieved()
    {
        var quota = new ProjectQuota
        {
            ProjectId              = 10,
            MaxOperationsPerMinute = 60,
            MaxOperationsPerDay    = 5000,
            MaxTotalMemories       = null,
            MaxBatchSize           = 100,
            UpdatedAt              = DateTime.UtcNow
        };

        _db.ProjectQuotas.Add(quota);
        _db.SaveChanges();

        var retrieved = _db.ProjectQuotas.Single(q => q.ProjectId == 10);
        Assert.Equal(60, retrieved.MaxOperationsPerMinute);
        Assert.Equal(5000, retrieved.MaxOperationsPerDay);
        Assert.Null(retrieved.MaxTotalMemories);
    }

    // ── 5.8.2: UsageMeterService ──────────────────────────────────────────────

    [Fact]
    public async Task UsageMeterService_RecordAsync_PersistsLedgerEntry()
    {
        var service = new UsageMeterService(_db, NullLogger<UsageMeterService>.Instance);

        await service.RecordAsync(
            userId: 1,
            projectId: 10,
            operationType: UsageOperationType.MemoryRecall,
            outcome: UsageOutcome.Success,
            unitCount: 1);

        var entry = _db.UsageLedger.Single();
        Assert.Equal(UsageOperationType.MemoryRecall, entry.OperationType);
        Assert.Equal(UsageOutcome.Success, entry.Outcome);
        Assert.Equal(1, entry.UnitCount);
        Assert.Null(entry.TokensUsed);
    }

    [Fact]
    public async Task UsageMeterService_RecordAsync_PersistsTokensWhenProvided()
    {
        var service = new UsageMeterService(_db, NullLogger<UsageMeterService>.Instance);

        await service.RecordAsync(
            userId: 1,
            projectId: 10,
            operationType: UsageOperationType.LlmRerank,
            tokensUsed: 512);

        var entry = _db.UsageLedger.Single();
        Assert.Equal(512, entry.TokensUsed);
    }

    [Fact]
    public async Task UsageMeterService_RecordAsync_PersistsBatchUnits()
    {
        var service = new UsageMeterService(_db, NullLogger<UsageMeterService>.Instance);

        await service.RecordAsync(
            userId: 1,
            projectId: 10,
            operationType: UsageOperationType.BatchCreate,
            unitCount: 50);

        var entry = _db.UsageLedger.Single();
        Assert.Equal(50, entry.UnitCount);
    }

    [Fact]
    public async Task UsageMeterService_RecordAsync_DoesNotThrowOnDbFailure()
    {
        // A disposed context simulates a DB failure.
        _db.Dispose();
        var brokenDb = new KairoDbContext(
            new DbContextOptionsBuilder<KairoDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        brokenDb.Dispose();

        var service = new UsageMeterService(brokenDb, NullLogger<UsageMeterService>.Instance);

        // Must not throw — failures are swallowed and logged.
        var exception = await Record.ExceptionAsync(() =>
            service.RecordAsync(1, 10, UsageOperationType.MemoryCreate));

        Assert.Null(exception);
    }

    // ── 5.8.3: QuotaEnforcementService ───────────────────────────────────────

    [Fact]
    public async Task QuotaEnforcementService_NoQuota_AlwaysAllows()
    {
        var service = new QuotaEnforcementService(_db, NullLogger<QuotaEnforcementService>.Instance);

        // No ProjectQuota row exists for project 10.
        var result = await service.CheckAsync(10, UsageOperationType.MemoryCreate);

        Assert.True(result.IsAllowed);
    }

    [Fact]
    public async Task QuotaEnforcementService_WithinPerMinuteLimit_Allows()
    {
        _db.ProjectQuotas.Add(new ProjectQuota
        {
            ProjectId = 10, MaxOperationsPerMinute = 100, UpdatedAt = DateTime.UtcNow
        });
        // Seed 10 recent operations.
        for (int i = 0; i < 10; i++)
        {
            _db.UsageLedger.Add(new UsageLedgerEntry
            {
                UserId = 1, ProjectId = 10, OperationType = UsageOperationType.MemoryCreate,
                Outcome = UsageOutcome.Success, OccurredAt = DateTime.UtcNow, UnitCount = 1
            });
        }
        _db.SaveChanges();

        var service = new QuotaEnforcementService(_db, NullLogger<QuotaEnforcementService>.Instance);
        var result = await service.CheckAsync(10, UsageOperationType.MemoryCreate, unitCount: 1);

        Assert.True(result.IsAllowed);
    }

    [Fact]
    public async Task QuotaEnforcementService_ExceedingPerMinuteLimit_Returns429()
    {
        _db.ProjectQuotas.Add(new ProjectQuota
        {
            ProjectId = 10, MaxOperationsPerMinute = 5, UpdatedAt = DateTime.UtcNow
        });
        // Seed 5 operations in the last minute.
        for (int i = 0; i < 5; i++)
        {
            _db.UsageLedger.Add(new UsageLedgerEntry
            {
                UserId = 1, ProjectId = 10, OperationType = UsageOperationType.MemoryCreate,
                Outcome = UsageOutcome.Success, OccurredAt = DateTime.UtcNow, UnitCount = 1
            });
        }
        _db.SaveChanges();

        var service = new QuotaEnforcementService(_db, NullLogger<QuotaEnforcementService>.Instance);
        var result = await service.CheckAsync(10, UsageOperationType.MemoryCreate, unitCount: 1);

        Assert.False(result.IsAllowed);
        Assert.NotNull(result.Reason);
        Assert.Contains("per minute", result.Reason!);
        Assert.Equal(60, result.RetryAfterSeconds);
    }

    [Fact]
    public async Task QuotaEnforcementService_ExceedingPerDayLimit_Returns429()
    {
        _db.ProjectQuotas.Add(new ProjectQuota
        {
            ProjectId = 10, MaxOperationsPerDay = 3, UpdatedAt = DateTime.UtcNow
        });
        // Seed 3 operations today.
        for (int i = 0; i < 3; i++)
        {
            _db.UsageLedger.Add(new UsageLedgerEntry
            {
                UserId = 1, ProjectId = 10, OperationType = UsageOperationType.MemoryCreate,
                Outcome = UsageOutcome.Success, OccurredAt = DateTime.UtcNow, UnitCount = 1
            });
        }
        _db.SaveChanges();

        var service = new QuotaEnforcementService(_db, NullLogger<QuotaEnforcementService>.Instance);
        var result = await service.CheckAsync(10, UsageOperationType.MemoryCreate, unitCount: 1);

        Assert.False(result.IsAllowed);
        Assert.NotNull(result.Reason);
        Assert.Contains("per day", result.Reason!);
        Assert.True(result.RetryAfterSeconds > 0);
    }

    [Fact]
    public async Task QuotaEnforcementService_ThrottledOperations_ExcludedFromCount()
    {
        _db.ProjectQuotas.Add(new ProjectQuota
        {
            ProjectId = 10, MaxOperationsPerMinute = 2, UpdatedAt = DateTime.UtcNow
        });
        // Seed 2 throttled operations (should not count against limit).
        for (int i = 0; i < 2; i++)
        {
            _db.UsageLedger.Add(new UsageLedgerEntry
            {
                UserId = 1, ProjectId = 10, OperationType = UsageOperationType.MemoryCreate,
                Outcome = UsageOutcome.Throttled, OccurredAt = DateTime.UtcNow, UnitCount = 1
            });
        }
        _db.SaveChanges();

        var service = new QuotaEnforcementService(_db, NullLogger<QuotaEnforcementService>.Instance);
        // Only 0 successful ops against limit of 2 — should be allowed.
        var result = await service.CheckAsync(10, UsageOperationType.MemoryCreate, unitCount: 1);

        Assert.True(result.IsAllowed);
    }

    // ── 5.8.4: UsageReportingService ─────────────────────────────────────────

    [Fact]
    public async Task UsageReportingService_ReturnsAggregatedReport()
    {
        // Seed ledger entries across multiple operation types.
        var now = DateTime.UtcNow;
        var entries = new[]
        {
            new UsageLedgerEntry { UserId=1, ProjectId=10, OperationType=UsageOperationType.MemoryCreate, Outcome=UsageOutcome.Success, OccurredAt=now, UnitCount=1 },
            new UsageLedgerEntry { UserId=1, ProjectId=10, OperationType=UsageOperationType.MemoryCreate, Outcome=UsageOutcome.Success, OccurredAt=now, UnitCount=1 },
            new UsageLedgerEntry { UserId=1, ProjectId=10, OperationType=UsageOperationType.MemoryRecall, Outcome=UsageOutcome.Success, OccurredAt=now, UnitCount=1 },
            new UsageLedgerEntry { UserId=1, ProjectId=10, OperationType=UsageOperationType.BatchCreate, Outcome=UsageOutcome.Success, OccurredAt=now, UnitCount=10 },
            new UsageLedgerEntry { UserId=1, ProjectId=10, OperationType=UsageOperationType.MemoryCreate, Outcome=UsageOutcome.Failure, OccurredAt=now, UnitCount=1 }
        };
        _db.UsageLedger.AddRange(entries);
        _db.SaveChanges();

        var service = new UsageReportingService(_db);
        var report = await service.GetProjectUsageAsync(
            projectId: 10,
            requestingUserId: 1,
            fromUtc: now.AddHours(-1),
            toUtc: now.AddHours(1));

        Assert.Equal(10, report.ProjectId);
        Assert.Equal(5, report.TotalOperations);
        Assert.Equal(14, report.TotalUnits);

        var createEntry = report.ByOperation.First(x => x.Label == UsageOperationType.MemoryCreate);
        Assert.Equal(3, createEntry.OperationCount);

        var batchEntry = report.ByOperation.First(x => x.Label == UsageOperationType.BatchCreate);
        Assert.Equal(10, batchEntry.UnitCount);

        var successEntry = report.ByOutcome.First(x => x.Label == UsageOutcome.Success);
        Assert.Equal(4, successEntry.OperationCount);

        var failureEntry = report.ByOutcome.First(x => x.Label == UsageOutcome.Failure);
        Assert.Equal(1, failureEntry.OperationCount);
    }

    [Fact]
    public async Task UsageReportingService_WrongUser_ThrowsUnauthorized()
    {
        var service = new UsageReportingService(_db);

        // Project 10 belongs to userId=1, but we're requesting as userId=999.
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.GetProjectUsageAsync(
                projectId: 10,
                requestingUserId: 999));
    }

    [Fact]
    public async Task UsageReportingService_NullTokens_NotIncludedInReport()
    {
        var now = DateTime.UtcNow;
        _db.UsageLedger.Add(new UsageLedgerEntry
        {
            UserId=1, ProjectId=10, OperationType=UsageOperationType.MemoryCreate,
            Outcome=UsageOutcome.Success, OccurredAt=now, UnitCount=1, TokensUsed=null
        });
        _db.SaveChanges();

        var service = new UsageReportingService(_db);
        var report = await service.GetProjectUsageAsync(10, 1);

        // All entries have null tokens — report should not claim tokens were used.
        Assert.Null(report.TotalTokensUsed);
    }

    [Fact]
    public async Task UsageReportingService_TokensPresent_SumsCorrectly()
    {
        var now = DateTime.UtcNow;
        _db.UsageLedger.AddRange(
            new UsageLedgerEntry { UserId=1, ProjectId=10, OperationType=UsageOperationType.LlmRerank, Outcome=UsageOutcome.Success, OccurredAt=now, UnitCount=1, TokensUsed=200 },
            new UsageLedgerEntry { UserId=1, ProjectId=10, OperationType=UsageOperationType.LlmRerank, Outcome=UsageOutcome.Success, OccurredAt=now, UnitCount=1, TokensUsed=350 }
        );
        _db.SaveChanges();

        var service = new UsageReportingService(_db);
        var report = await service.GetProjectUsageAsync(10, 1);

        Assert.Equal(550, report.TotalTokensUsed);
    }
}
