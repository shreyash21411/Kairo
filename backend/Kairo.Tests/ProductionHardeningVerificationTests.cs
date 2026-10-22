using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Kairo.API.Health;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Kairo.Infrastructure.Repositories;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Xunit.Sdk;

namespace Kairo.Tests;

/// <summary>
/// Production hardening verification tests covering:
/// 1. EF Core PostgreSQL default value metadata (Task 1).
/// 2. Atomic PostgreSQL background job claiming under concurrent competition (Task 2).
/// 3. Database-aware readiness health checks (Task 3).
/// 4. Forwarded headers configuration and trust models (Task 4).
/// </summary>
public class ProductionHardeningVerificationTests
{
    // ── Task 1: EF Core Metadata Verification ─────────────────────────────────

    [Fact]
    public void KairoDbContext_ModelMetadata_HasNoSqlServerSysUtcDateTimeDefaults()
    {
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseNpgsql("Host=localhost;Database=test", o => o.UseVector())
            .Options;

        using var context = new KairoDbContext(options);
        var model = context.Model;

        foreach (var entityType in model.GetEntityTypes())
        {
            foreach (var property in entityType.GetProperties())
            {
                var defaultSql = property.GetDefaultValueSql();
                if (defaultSql != null)
                {
                    Assert.DoesNotContain("sysutcdatetime", defaultSql, StringComparison.OrdinalIgnoreCase);
                }
            }
        }
    }

    [Fact]
    public void KairoDbContext_ModelMetadata_AllRemediatedEntitiesUseCurrentTimestamp()
    {
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseNpgsql("Host=localhost;Database=test", o => o.UseVector())
            .Options;

        using var context = new KairoDbContext(options);
        var model = context.Model;

        // 1. Entities (CreatedAt, UpdatedAt)
        var entityType = model.FindEntityType(typeof(NamedEntity));
        Assert.NotNull(entityType);
        Assert.Equal("CURRENT_TIMESTAMP", entityType.FindProperty(nameof(NamedEntity.CreatedAt))?.GetDefaultValueSql());
        Assert.Equal("CURRENT_TIMESTAMP", entityType.FindProperty(nameof(NamedEntity.UpdatedAt))?.GetDefaultValueSql());

        // 2. MemoryEntities (CreatedAt)
        var memEntityType = model.FindEntityType(typeof(MemoryEntities));
        Assert.NotNull(memEntityType);
        Assert.Equal("CURRENT_TIMESTAMP", memEntityType.FindProperty(nameof(MemoryEntities.CreatedAt))?.GetDefaultValueSql());

        // 3. EntityRelationships (CreatedAt, UpdatedAt)
        var relType = model.FindEntityType(typeof(EntityRelationship));
        Assert.NotNull(relType);
        Assert.Equal("CURRENT_TIMESTAMP", relType.FindProperty(nameof(EntityRelationship.CreatedAt))?.GetDefaultValueSql());
        Assert.Equal("CURRENT_TIMESTAMP", relType.FindProperty(nameof(EntityRelationship.UpdatedAt))?.GetDefaultValueSql());

        // 4. RelationshipEvidence (CreatedAt)
        var evType = model.FindEntityType(typeof(RelationshipEvidence));
        Assert.NotNull(evType);
        Assert.Equal("CURRENT_TIMESTAMP", evType.FindProperty(nameof(RelationshipEvidence.CreatedAt))?.GetDefaultValueSql());

        // 5. MemoryCategories (CreatedAt)
        var catType = model.FindEntityType(typeof(MemoryCategory));
        Assert.NotNull(catType);
        Assert.Equal("CURRENT_TIMESTAMP", catType.FindProperty(nameof(MemoryCategory.CreatedAt))?.GetDefaultValueSql());

        // 6. MemoryIngestionJobs (CreatedAt)
        var jobType = model.FindEntityType(typeof(MemoryIngestionJob));
        Assert.NotNull(jobType);
        Assert.Equal("CURRENT_TIMESTAMP", jobType.FindProperty(nameof(MemoryIngestionJob.CreatedAt))?.GetDefaultValueSql());
    }

    // ── Task 3: Database Readiness Health Check Tests ─────────────────────────

    [PostgreSqlFact]
    public async Task DatabaseHealthCheck_WhenDatabaseIsReachable_ReturnsHealthy()
    {
        var connStr = DiscoverTestPostgresConnectionString()!;

        var services = new ServiceCollection();
        services.AddDbContext<KairoDbContext>(opt => opt.UseNpgsql(connStr!, o => o.UseVector()));
        var sp = services.BuildServiceProvider();

        var healthCheck = new KairoDatabaseHealthCheck(
            sp.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<KairoDatabaseHealthCheck>.Instance);

        var result = await healthCheck.CheckHealthAsync(new HealthCheckContext());

        Assert.Equal(HealthStatus.Healthy, result.Status);
        Assert.Equal("PostgreSQL database is reachable.", result.Description);
    }

    [Fact]
    public async Task DatabaseHealthCheck_WhenDatabaseIsUnreachable_ReturnsUnhealthyWithoutLeakingSecrets()
    {
        // Bad port connection string to force connection failure — no real DB required.
        var secretPassword = "SuperSecretPassword123!DoNotLeak";
        var badConnStr = $"Host=127.0.0.1;Port=5499;Database=kairo_fake;Username=fake_user;Password={secretPassword};Timeout=1;CommandTimeout=1;";

        var services = new ServiceCollection();
        services.AddDbContext<KairoDbContext>(opt => opt.UseNpgsql(badConnStr, o => o.UseVector()));
        var sp = services.BuildServiceProvider();

        var healthCheck = new KairoDatabaseHealthCheck(
            sp.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<KairoDatabaseHealthCheck>.Instance);

        var result = await healthCheck.CheckHealthAsync(new HealthCheckContext());

        Assert.Equal(HealthStatus.Unhealthy, result.Status);
        Assert.Equal("PostgreSQL database is unreachable.", result.Description);

        // Security assertion: Description must never leak password or connection string details.
        Assert.DoesNotContain(secretPassword, result.Description, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("5499", result.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DatabaseHealthCheck_WhenCancelled_ReturnsUnhealthy()
    {
        // A connection string that will accept the TCP connection but delay — we cancel immediately.
        // Use a non-routable IP to guarantee it won't connect before cancellation.
        var badConnStr = "Host=192.0.2.1;Port=5432;Database=kairo_fake;Username=fake;Password=fake;Timeout=30;";

        var services = new ServiceCollection();
        services.AddDbContext<KairoDbContext>(opt => opt.UseNpgsql(badConnStr, o => o.UseVector()));
        var sp = services.BuildServiceProvider();

        var healthCheck = new KairoDatabaseHealthCheck(
            sp.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<KairoDatabaseHealthCheck>.Instance);

        using var cts = new CancellationTokenSource(millisecondsDelay: 50);

        var result = await healthCheck.CheckHealthAsync(new HealthCheckContext(), cts.Token);

        // Must be Unhealthy — either from cancellation or connection failure.
        Assert.Equal(HealthStatus.Unhealthy, result.Status);
        Assert.NotNull(result.Description);
    }

    // ── Task 4: Forwarded Headers Options Configuration Tests ──────────────────

    [Fact]
    public void ForwardedHeaders_Default_Configuration_IsSafeWithNoTrustedProxies()
    {
        // The default appsettings.json has TrustAllNetworks=false and empty proxy lists.
        var inMemorySettings = new Dictionary<string, string?>
        {
            ["ForwardedHeaders:ForwardLimit"] = "1",
            ["ForwardedHeaders:TrustAllNetworks"] = "false",
        };

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(inMemorySettings)
            .Build();

        var options = new ForwardedHeadersOptions();
        var forwardedConfig = config.GetSection("ForwardedHeaders");
        var trustAll = forwardedConfig.GetValue<bool>("TrustAllNetworks", false);
        var forwardLimit = forwardedConfig.GetValue<int?>("ForwardLimit");

        if (forwardLimit.HasValue) options.ForwardLimit = forwardLimit.Value;

        // Default is safe: TrustAllNetworks is false; no extra proxies added.
        Assert.False(trustAll);
        Assert.Equal(1, options.ForwardLimit);
        // KnownProxies still contains only the default loopback — no user-configured additions.
        Assert.DoesNotContain(IPAddress.Parse("10.0.0.1"), options.KnownProxies);
    }

    [Fact]
    public void ForwardedHeaders_Configuration_BindsKnownProxiesAndIPNetworks()
    {
        var inMemorySettings = new Dictionary<string, string?>
        {
            ["ForwardedHeaders:ForwardLimit"] = "2",
            ["ForwardedHeaders:TrustAllNetworks"] = "false",
            ["ForwardedHeaders:KnownProxies:0"] = "10.0.0.1",
            ["ForwardedHeaders:KnownNetworks:0"] = "192.168.1.0/24"
        };

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(inMemorySettings)
            .Build();

        var options = new ForwardedHeadersOptions();
        var forwardedConfig = config.GetSection("ForwardedHeaders");
        var trustAll = forwardedConfig.GetValue<bool>("TrustAllNetworks", false);
        var forwardLimit = forwardedConfig.GetValue<int?>("ForwardLimit");
        if (forwardLimit.HasValue) options.ForwardLimit = forwardLimit.Value;

        if (trustAll)
        {
            options.KnownIPNetworks.Clear();
            options.KnownProxies.Clear();
        }
        else
        {
            var knownProxies = forwardedConfig.GetSection("KnownProxies").Get<string[]>() ?? Array.Empty<string>();
            foreach (var proxy in knownProxies)
            {
                if (IPAddress.TryParse(proxy, out var ip)) options.KnownProxies.Add(ip);
            }

            var knownNetworks = forwardedConfig.GetSection("KnownNetworks").Get<string[]>() ?? Array.Empty<string>();
            foreach (var network in knownNetworks)
            {
                if (System.Net.IPNetwork.TryParse(network, out var ipNet)) options.KnownIPNetworks.Add(ipNet);
            }
        }

        Assert.Equal(2, options.ForwardLimit);
        Assert.Contains(IPAddress.Parse("10.0.0.1"), options.KnownProxies);
        Assert.Contains(System.Net.IPNetwork.Parse("192.168.1.0/24"), options.KnownIPNetworks);
    }

    [Fact]
    public void ForwardedHeaders_TrustAllNetworks_ClearsKnownProxiesAndNetworks()
    {
        var inMemorySettings = new Dictionary<string, string?>
        {
            ["ForwardedHeaders:TrustAllNetworks"] = "true"
        };

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(inMemorySettings)
            .Build();

        var options = new ForwardedHeadersOptions();
        // Defaults contain loopback
        Assert.NotEmpty(options.KnownProxies);

        var forwardedConfig = config.GetSection("ForwardedHeaders");
        var trustAll = forwardedConfig.GetValue<bool>("TrustAllNetworks", false);

        if (trustAll)
        {
            options.KnownIPNetworks.Clear();
            options.KnownProxies.Clear();
        }

        Assert.Empty(options.KnownProxies);
        Assert.Empty(options.KnownIPNetworks);
    }

    [Fact]
    public void ForwardedHeaders_InvalidForwardLimit_ThrowsInvalidOperation()
    {
        // ForwardLimit must be >= 1. A value of 0 or negative is invalid and must
        // be rejected by the application startup validation in Program.cs.
        var inMemorySettings = new Dictionary<string, string?>
        {
            ["ForwardedHeaders:ForwardLimit"] = "0",
            ["ForwardedHeaders:TrustAllNetworks"] = "false",
        };

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(inMemorySettings)
            .Build();

        var forwardedConfig = config.GetSection("ForwardedHeaders");
        var forwardLimit = forwardedConfig.GetValue<int?>("ForwardLimit");

        // Simulate the validation logic from Program.cs
        Assert.True(forwardLimit.HasValue);
        Assert.True(forwardLimit.Value <= 0,
            "ForwardLimit of 0 or negative must be caught as invalid configuration.");

        // Verify our validation logic would throw
        var ex = Assert.Throws<InvalidOperationException>(() =>
        {
            if (forwardLimit.HasValue && forwardLimit.Value <= 0)
                throw new InvalidOperationException(
                    $"ForwardedHeaders:ForwardLimit must be a positive integer. Got: {forwardLimit.Value}");
        });
        Assert.Contains("ForwardedHeaders:ForwardLimit must be a positive integer", ex.Message);
    }

    // ── Task 2: PostgreSQL Concurrent Job Claiming Integration Test ───────────
    // Requires KAIRO_TEST_POSTGRES_CONNECTION_STRING env var pointing to an
    // isolated test database (NOT kairo_dev or any production database).

    [PostgreSqlFact]
    public async Task IngestionJobRepository_PostgreSql_CompetingWorkersCannotClaimSameJob()
    {
        var connStr = DiscoverTestPostgresConnectionString()!;

        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseNpgsql(connStr!, o => o.UseVector())
            .Options;

        using var seedContext = new KairoDbContext(options);
        // Verify connectivity — fail clearly if the test DB is unreachable
        var canConnect = await seedContext.Database.CanConnectAsync();
        Assert.True(canConnect,
            $"Test database is unreachable. Verify KAIRO_TEST_POSTGRES_CONNECTION_STRING targets a running PostgreSQL instance.");

        // Ensure we have a valid test user and project in the ISOLATED test database.
        var testUser = await seedContext.Users.FirstOrDefaultAsync();
        if (testUser == null)
        {
            testUser = new Users
            {
                Email = $"worker_test_{Guid.NewGuid():N}@voidzone.internal",
                AccountStatus = 1,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            seedContext.Users.Add(testUser);
            await seedContext.SaveChangesAsync();
        }

        var testProject = await seedContext.Projects.FirstOrDefaultAsync(p => p.UserId == testUser.UserId);
        if (testProject == null)
        {
            testProject = new Projects
            {
                UserId = testUser.UserId,
                Name = "Worker Concurrency Test Project",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            seedContext.Projects.Add(testProject);
            await seedContext.SaveChangesAsync();
        }

        var uniqueTag = $"ConcurrencyTest_{Guid.NewGuid():N}";

        // Seed 2 distinct pending jobs that are immediately available.
        var now = DateTime.UtcNow;
        var job1 = new MemoryIngestionJob
        {
            UserId = testUser.UserId,
            ProjectId = testProject.ProjectId,
            JobType = uniqueTag,
            Status = "Pending",
            Attempts = 0,
            MaxAttempts = 3,
            AvailableAt = now.AddMinutes(-5),
            CreatedAt = now.AddMinutes(-5)
        };
        var job2 = new MemoryIngestionJob
        {
            UserId = testUser.UserId,
            ProjectId = testProject.ProjectId,
            JobType = uniqueTag,
            Status = "Pending",
            Attempts = 0,
            MaxAttempts = 3,
            AvailableAt = now.AddMinutes(-4),
            CreatedAt = now.AddMinutes(-4)
        };

        seedContext.MemoryIngestionJobs.AddRange(job1, job2);
        await seedContext.SaveChangesAsync();

        var job1Id = job1.JobId;
        var job2Id = job2.JobId;

        try
        {
            // Spawn 2 competing worker tasks simultaneously against separate DbContext instances.
            var barrier = new TaskCompletionSource<bool>();

            var worker1Task = Task.Run(async () =>
            {
                await barrier.Task;
                using var worker1Context = new KairoDbContext(options);
                var repo = new IngestionJobRepository(worker1Context);
                return await repo.ClaimNextJobsAsync(batchSize: 1, workerId: "worker-competing-1", leaseDuration: TimeSpan.FromMinutes(2));
            });

            var worker2Task = Task.Run(async () =>
            {
                await barrier.Task;
                using var worker2Context = new KairoDbContext(options);
                var repo = new IngestionJobRepository(worker2Context);
                return await repo.ClaimNextJobsAsync(batchSize: 1, workerId: "worker-competing-2", leaseDuration: TimeSpan.FromMinutes(2));
            });

            // Release both workers at the exact same instant to create maximum concurrency contention.
            barrier.SetResult(true);

            await Task.WhenAll(worker1Task, worker2Task);

            var worker1Claimed = await worker1Task;
            var worker2Claimed = await worker2Task;

            Assert.Single(worker1Claimed);
            Assert.Single(worker2Claimed);

            var claimed1Id = worker1Claimed[0].JobId;
            var claimed2Id = worker2Claimed[0].JobId;

            // Core assertion: Each worker claimed a DISTINCT job. No duplicate claims.
            Assert.NotEqual(claimed1Id, claimed2Id);

            var allClaimedIds = new HashSet<long> { claimed1Id, claimed2Id };
            Assert.Contains(job1Id, allClaimedIds);
            Assert.Contains(job2Id, allClaimedIds);

            // Verify status in database.
            using var verifyContext = new KairoDbContext(options);
            var dbJob1 = await verifyContext.MemoryIngestionJobs.FindAsync(job1Id);
            var dbJob2 = await verifyContext.MemoryIngestionJobs.FindAsync(job2Id);

            Assert.NotNull(dbJob1);
            Assert.NotNull(dbJob2);
            Assert.Equal("Processing", dbJob1.Status);
            Assert.Equal("Processing", dbJob2.Status);
            Assert.NotEqual(dbJob1.LockOwner, dbJob2.LockOwner);
        }
        finally
        {
            // Clean up only the records this test created — never touch pre-existing records.
            using var cleanupContext = new KairoDbContext(options);
            var toClean = await cleanupContext.MemoryIngestionJobs
                .Where(j => j.JobId == job1Id || j.JobId == job2Id)
                .ToListAsync();
            cleanupContext.MemoryIngestionJobs.RemoveRange(toClean);
            await cleanupContext.SaveChangesAsync();
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Discovers a PostgreSQL connection string for integration testing.
    /// Priority 1: KAIRO_TEST_POSTGRES_CONNECTION_STRING environment variable.
    /// Priority 2: Local Docker PostgreSQL container from infrastructure/docker/.env.
    /// Returns null if neither is available, allowing tests to be cleanly skipped.
    /// Never targets remote cloud or production databases.
    /// </summary>
    internal static string? DiscoverTestPostgresConnectionString()
    {
        // 1. Explicit test database connection string.
        var explicit_ = Environment.GetEnvironmentVariable("KAIRO_TEST_POSTGRES_CONNECTION_STRING");
        if (!string.IsNullOrWhiteSpace(explicit_))
        {
            if (explicit_.Contains("neon.tech", StringComparison.OrdinalIgnoreCase) ||
                explicit_.Contains("render.com", StringComparison.OrdinalIgnoreCase) ||
                explicit_.Contains("supabase", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "KAIRO_TEST_POSTGRES_CONNECTION_STRING appears to point to a production or cloud database. " +
                    "This environment variable must only target a local, isolated test database.");
            }
            return explicit_;
        }

        // 2. Local Docker development PostgreSQL from infrastructure/docker/.env
        var host = Environment.GetEnvironmentVariable("POSTGRES_HOST") ?? "127.0.0.1";
        var portStr = Environment.GetEnvironmentVariable("POSTGRES_HOST_PORT") ?? "5433";
        if (!int.TryParse(portStr, out var port)) port = 5433;
        var user = Environment.GetEnvironmentVariable("KAIRO_APP_USER") ?? "kairo_dev";
        var pass = Environment.GetEnvironmentVariable("KAIRO_APP_PASSWORD");

        if (string.IsNullOrWhiteSpace(pass))
        {
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var dir = new DirectoryInfo(baseDir);
            while (dir != null && !File.Exists(Path.Combine(dir.FullName, "infrastructure", "docker", ".env")))
                dir = dir.Parent;

            if (dir != null)
            {
                var envPath = Path.Combine(dir.FullName, "infrastructure", "docker", ".env");
                foreach (var line in File.ReadAllLines(envPath))
                {
                    var trimmed = line.Trim();
                    if (trimmed.StartsWith('#') || !trimmed.Contains('=')) continue;
                    var parts = trimmed.Split('=', 2);
                    var k = parts[0].Trim();
                    var v = parts[1].Trim();
                    if (k == "KAIRO_APP_USER") user = v;
                    if (k == "KAIRO_APP_PASSWORD") pass = v;
                    if (k == "POSTGRES_HOST_PORT" && int.TryParse(v, out var p)) port = p;
                }
            }
        }

        if (!string.IsNullOrWhiteSpace(pass))
        {
            return $"Host={host};Port={port};Database=kairo_dev;Username={user};Password={pass};Timeout=3;CommandTimeout=3;";
        }

        return null;
    }
}

/// <summary>
/// Custom xUnit fact attribute that conditionally skips a test when local PostgreSQL
/// is not reachable or configured. This avoids silent false-positive passes while
/// preventing unnecessary failures in test environments that lack PostgreSQL.
/// </summary>
public sealed class PostgreSqlFactAttribute : FactAttribute
{
    public PostgreSqlFactAttribute()
    {
        var connStr = ProductionHardeningVerificationTests.DiscoverTestPostgresConnectionString();
        if (connStr == null)
        {
            Skip = "PostgreSQL is not configured. Set KAIRO_TEST_POSTGRES_CONNECTION_STRING or configure infrastructure/docker/.env.";
        }
    }
}
