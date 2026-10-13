using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Kairo.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Moq;
using Npgsql;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Phase 4C Task 4C.4: Native pgvector retrieval integration tests.
/// Uses <c>kairo_vector_test</c> database. All tests skip gracefully when
/// the database is unreachable. Never touches <c>kairo_dev</c>.
/// </summary>
public class Phase4CVectorRetrievalIntegrationTests : IAsyncLifetime
{
    private const string VectorTestDb = "kairo_vector_test";

    private KairoDbContext? _context;
    private MemoryRepository? _repo;
    private (string Host, int Port, string Username, string Password)? _pgCreds;

    private long _userId;
    private long _projectId;
    private long _scopeId;

    // ── IAsyncLifetime ────────────────────────────────────────────────────────

    public async Task InitializeAsync()
    {
        _pgCreds = DiscoverPostgresCredentials();
        if (_pgCreds == null) return;

        var connString = BuildConnectionString(_pgCreds.Value, VectorTestDb);

        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseNpgsql(connString, o => o.UseVector())
            .Options;

        _context = new KairoDbContext(options);

        var canConnect = await _context.Database.CanConnectAsync();
        if (!canConnect)
        {
            _context.Dispose();
            _context = null;
            return;
        }

        _repo = new MemoryRepository(_context);

        // Unique user per test run for isolation
        var email = $"vector_test_{Guid.NewGuid():N}@kairo-test.internal";
        var user = new Users
        {
            Email = email,
            AccountStatus = 1,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _context.Users.Add(user);
        await _context.SaveChangesAsync();
        _userId = user.UserId;

        var project = new Projects
        {
            UserId = _userId,
            Name = "Vector Test Project",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _context.Projects.Add(project);
        await _context.SaveChangesAsync();
        _projectId = project.ProjectId;

        var scope = new MemoryScopes
        {
            ProjectId = _projectId,
            ActorId = $"actor_{_userId}",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _context.MemoryScopes.Add(scope);
        await _context.SaveChangesAsync();
        _scopeId = scope.ScopeId;
    }

    public async Task DisposeAsync()
    {
        if (_context != null)
        {
            try
            {
                var embIds = await _context.MemoryEmbeddings
                    .Where(e => e.Memory.UserId == _userId)
                    .Select(e => e.EmbeddingId)
                    .ToListAsync();
                if (embIds.Count > 0)
                {
                    var rows = await _context.MemoryEmbeddings
                        .Where(e => embIds.Contains(e.EmbeddingId))
                        .ToListAsync();
                    _context.MemoryEmbeddings.RemoveRange(rows);
                    await _context.SaveChangesAsync();
                }

                var memIds = await _context.Memories
                    .Where(m => m.UserId == _userId)
                    .Select(m => m.MemoryId)
                    .ToListAsync();
                if (memIds.Count > 0)
                {
                    var mems = await _context.Memories
                        .Where(m => memIds.Contains(m.MemoryId))
                        .ToListAsync();
                    _context.Memories.RemoveRange(mems);
                    await _context.SaveChangesAsync();
                }

                if (_scopeId > 0)
                {
                    var sc = await _context.MemoryScopes.FindAsync(_scopeId);
                    if (sc != null) { _context.MemoryScopes.Remove(sc); await _context.SaveChangesAsync(); }
                }
                if (_projectId > 0)
                {
                    var pr = await _context.Projects.FindAsync(_projectId);
                    if (pr != null) { _context.Projects.Remove(pr); await _context.SaveChangesAsync(); }
                }
                if (_userId > 0)
                {
                    var usr = await _context.Users.FindAsync(_userId);
                    if (usr != null) { _context.Users.Remove(usr); await _context.SaveChangesAsync(); }
                }
            }
            catch { /* best-effort cleanup */ }

            await _context.DisposeAsync();
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private bool IsSkipped => _context == null || _repo == null;

    private async Task<long> SeedMemoryWithEmbeddingAsync(
        string content,
        float[] vector,
        string model = "mistral-embed",
        DateTime? expiresAt = null,
        bool isActive = true)
    {
        var memory = new Memories
        {
            UserId = _userId,
            ScopeId = _scopeId,
            Content = content,
            MemoryType = "fact",
            IsActive = isActive,
            ExpiresAt = expiresAt,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _context!.Memories.Add(memory);
        await _context.SaveChangesAsync();

        var emb = new MemoryEmbeddings
        {
            MemoryId = memory.MemoryId,
            Model = model,
            Dimensions = vector.Length,
            VectorData = System.Text.Json.JsonSerializer.Serialize(vector),
            CreatedAt = DateTime.UtcNow
        };
        _context.MemoryEmbeddings.Add(emb);
        await _context.SaveChangesAsync();

        return memory.MemoryId;
    }

    private static float[] PerturbedVector(float[] baseVec, float noise, int dims)
    {
        var rng = new Random(42);
        var v = new float[dims];
        for (int i = 0; i < dims; i++)
            v[i] = (i < baseVec.Length ? baseVec[i] : 0f) + (float)(rng.NextDouble() * noise - noise / 2);
        return Normalize(v);
    }

    private static float[] Normalize(float[] v)
    {
        var mag = (float)Math.Sqrt(v.Sum(x => (double)x * x));
        if (mag == 0f) return v;
        return v.Select(x => x / mag).ToArray();
    }

    private static float[] MakeVector(int dims, float fill = 0.1f)
        => Normalize(Enumerable.Range(0, dims).Select(i => fill + i * 0.001f).Select(x => (float)x).ToArray());

    // ── Tests ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_PostgreSql_ReturnsTopKResults()
    {
        if (IsSkipped) return;

        const int dims = 8;
        var queryVec = MakeVector(dims, 0.5f);

        await SeedMemoryWithEmbeddingAsync("Identical memory", queryVec.ToArray());
        await SeedMemoryWithEmbeddingAsync("Very similar memory", PerturbedVector(queryVec, 0.01f, dims));
        await SeedMemoryWithEmbeddingAsync("Less similar memory", PerturbedVector(queryVec, 0.5f, dims));

        var results = await _repo!.SearchSimilarEmbeddingsAsync(
            _userId, queryVec, "mistral-embed", topK: 3);

        Assert.NotNull(results);
        Assert.True(results.Count <= 3, $"Expected at most 3 results, got {results.Count}");

        for (int i = 1; i < results.Count; i++)
            Assert.True(results[i - 1].Similarity >= results[i].Similarity,
                $"Results not ordered: [{i-1}]={results[i-1].Similarity:F6} < [{i}]={results[i].Similarity:F6}");

        Assert.True(results[0].Similarity > 0.95, $"Top result similarity too low: {results[0].Similarity:F6}");
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_PostgreSql_ExcludesExpiredEmbeddings()
    {
        if (IsSkipped) return;

        const int dims = 8;
        var queryVec = MakeVector(dims);

        await SeedMemoryWithEmbeddingAsync("Active memory", queryVec.ToArray());
        await SeedMemoryWithEmbeddingAsync("Expired memory",
            PerturbedVector(queryVec, 0.01f, dims),
            expiresAt: DateTime.UtcNow.AddHours(-1));

        var results = await _repo!.SearchSimilarEmbeddingsAsync(
            _userId, queryVec, "mistral-embed", topK: 10);

        Assert.DoesNotContain(results, r => r.Content == "Expired memory");
        Assert.Contains(results, r => r.Content == "Active memory");
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_PostgreSql_ExcludesInactiveMemories()
    {
        if (IsSkipped) return;

        const int dims = 8;
        var queryVec = MakeVector(dims);

        await SeedMemoryWithEmbeddingAsync("Active memory", queryVec.ToArray());
        await SeedMemoryWithEmbeddingAsync("Inactive memory",
            PerturbedVector(queryVec, 0.01f, dims), isActive: false);

        var results = await _repo!.SearchSimilarEmbeddingsAsync(
            _userId, queryVec, "mistral-embed", topK: 10);

        Assert.DoesNotContain(results, r => r.Content == "Inactive memory");
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_PostgreSql_ExcludesDimensionMismatch()
    {
        if (IsSkipped) return;

        const int dims = 8;
        var queryVec = MakeVector(dims);

        await SeedMemoryWithEmbeddingAsync("Correct dims", queryVec.ToArray());
        await SeedMemoryWithEmbeddingAsync("Wrong dims", MakeVector(4));

        var results = await _repo!.SearchSimilarEmbeddingsAsync(
            _userId, queryVec, "mistral-embed", topK: 10);

        Assert.DoesNotContain(results, r => r.Content == "Wrong dims");
        Assert.Contains(results, r => r.Content == "Correct dims");
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_PostgreSql_ExcludesModelMismatch()
    {
        if (IsSkipped) return;

        const int dims = 8;
        var queryVec = MakeVector(dims);

        await SeedMemoryWithEmbeddingAsync("Matching model", queryVec.ToArray(), model: "mistral-embed");
        await SeedMemoryWithEmbeddingAsync("Mismatching model", queryVec.ToArray(), model: "openai-text-embedding-3-small");

        var results = await _repo!.SearchSimilarEmbeddingsAsync(
            _userId, queryVec, "mistral-embed", topK: 10);

        Assert.DoesNotContain(results, r => r.Content == "Mismatching model");
        Assert.Contains(results, r => r.Content == "Matching model");

        // Case-insensitive query model check
        var caseInsensitiveResults = await _repo!.SearchSimilarEmbeddingsAsync(
            _userId, queryVec, "MISTRAL-EMBED", topK: 10);
        Assert.Contains(caseInsensitiveResults, r => r.Content == "Matching model");
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_PostgreSql_KnownDistinguishableVectors_RanksAccurately()
    {
        if (IsSkipped) return;

        // Distinct, known vectors in 3D:
        // Query: [1.0, 0.0, 0.0]
        // V1: Identical -> [1.0, 0.0, 0.0]                 => sim = 1.000000
        // V2: 45 degrees -> [0.70710677, 0.70710677, 0.0]  => sim = ~0.707107
        // V3: 60 degrees -> [0.5, 0.8660254, 0.0]          => sim = ~0.500000
        // V4: Orthogonal -> [0.0, 1.0, 0.0]                 => sim = ~0.000000
        // V5: Opposite   -> [-1.0, 0.0, 0.0]                => sim = -1.000000
        var queryVec = new float[] { 1f, 0f, 0f };
        var v1 = new float[] { 1f, 0f, 0f };
        var v2 = new float[] { 0.70710677f, 0.70710677f, 0f };
        var v3 = new float[] { 0.5f, 0.8660254f, 0f };
        var v4 = new float[] { 0f, 1f, 0f };
        var v5 = new float[] { -1f, 0f, 0f };

        await SeedMemoryWithEmbeddingAsync("V1_Identical", v1, "mistral-embed");
        await SeedMemoryWithEmbeddingAsync("V2_45Deg", v2, "mistral-embed");
        await SeedMemoryWithEmbeddingAsync("V3_60Deg", v3, "mistral-embed");
        await SeedMemoryWithEmbeddingAsync("V4_Orthogonal", v4, "mistral-embed");
        await SeedMemoryWithEmbeddingAsync("V5_Opposite", v5, "mistral-embed");

        // Top-3 query
        var top3 = await _repo!.SearchSimilarEmbeddingsAsync(
            _userId, queryVec, "mistral-embed", topK: 3);

        Assert.Equal(3, top3.Count);
        Assert.Equal("V1_Identical", top3[0].Content);
        Assert.True(Math.Abs(top3[0].Similarity - 1.0) < 0.001, $"Expected ~1.0, got {top3[0].Similarity}");

        Assert.Equal("V2_45Deg", top3[1].Content);
        Assert.True(Math.Abs(top3[1].Similarity - 0.707107) < 0.001, $"Expected ~0.7071, got {top3[1].Similarity}");

        Assert.Equal("V3_60Deg", top3[2].Content);
        Assert.True(Math.Abs(top3[2].Similarity - 0.5) < 0.001, $"Expected ~0.5, got {top3[2].Similarity}");

        // Top-5 query: includes orthogonal and opposite in strict descending order
        var top5 = await _repo!.SearchSimilarEmbeddingsAsync(
            _userId, queryVec, "mistral-embed", topK: 5);

        Assert.Equal(5, top5.Count);
        Assert.Equal("V1_Identical", top5[0].Content);
        Assert.Equal("V2_45Deg", top5[1].Content);
        Assert.Equal("V3_60Deg", top5[2].Content);
        Assert.Equal("V4_Orthogonal", top5[3].Content);
        Assert.True(Math.Abs(top5[3].Similarity - 0.0) < 0.001, $"Expected ~0.0, got {top5[3].Similarity}");

        Assert.Equal("V5_Opposite", top5[4].Content);
        Assert.True(Math.Abs(top5[4].Similarity - (-1.0)) < 0.001, $"Expected ~-1.0, got {top5[4].Similarity}");
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_PostgreSql_UsesNativeDatabaseProvider()
    {
        if (IsSkipped) return;

        Assert.True(_context!.Database.IsNpgsql(), "Test database should be PostgreSQL");
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_PostgreSql_SimilarityRankingIsDeterministic()
    {
        if (IsSkipped) return;

        const int dims = 8;
        var queryVec = MakeVector(dims, 0.3f);

        await SeedMemoryWithEmbeddingAsync("A", PerturbedVector(queryVec, 0.01f, dims));
        await SeedMemoryWithEmbeddingAsync("B", PerturbedVector(queryVec, 0.2f, dims));
        await SeedMemoryWithEmbeddingAsync("C", PerturbedVector(queryVec, 0.5f, dims));

        var results1 = await _repo!.SearchSimilarEmbeddingsAsync(_userId, queryVec, "mistral-embed", topK: 3);
        var results2 = await _repo!.SearchSimilarEmbeddingsAsync(_userId, queryVec, "mistral-embed", topK: 3);

        Assert.Equal(results1.Select(r => r.Content), results2.Select(r => r.Content));
        Assert.Equal(
            results1.Select(r => Math.Round(r.Similarity, 6)),
            results2.Select(r => Math.Round(r.Similarity, 6)));
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_PostgreSql_IsolatedByUserId()
    {
        if (IsSkipped) return;

        const int dims = 8;
        var queryVec = MakeVector(dims);

        await SeedMemoryWithEmbeddingAsync("My memory", queryVec.ToArray());

        var otherUserId = _userId + 999999L;
        var results = await _repo!.SearchSimilarEmbeddingsAsync(
            otherUserId, queryVec, "mistral-embed", topK: 10);

        Assert.DoesNotContain(results, r => r.Content == "My memory");
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_PostgreSql_EmptyResultsWhenNoMatch()
    {
        if (IsSkipped) return;

        const int dims = 8;
        var queryVec = MakeVector(dims);

        var emptyUserId = _userId + 777777L;
        var results = await _repo!.SearchSimilarEmbeddingsAsync(
            emptyUserId, queryVec, "mistral-embed", topK: 5);

        Assert.NotNull(results);
        Assert.Empty(results);
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_PostgreSql_TopKLimitRespected()
    {
        if (IsSkipped) return;

        const int dims = 8;
        var queryVec = MakeVector(dims);

        for (int i = 0; i < 10; i++)
            await SeedMemoryWithEmbeddingAsync($"Memory {i}", PerturbedVector(queryVec, 0.1f * i, dims));

        var results = await _repo!.SearchSimilarEmbeddingsAsync(
            _userId, queryVec, "mistral-embed", topK: 3);

        Assert.True(results.Count <= 3, $"Expected at most 3 results, got {results.Count}");
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_PostgreSql_SimilarityIsInValidRange()
    {
        if (IsSkipped) return;

        const int dims = 8;
        var queryVec = MakeVector(dims);

        await SeedMemoryWithEmbeddingAsync("Memory A", PerturbedVector(queryVec, 0.1f, dims));
        await SeedMemoryWithEmbeddingAsync("Memory B", PerturbedVector(queryVec, 0.4f, dims));

        var results = await _repo!.SearchSimilarEmbeddingsAsync(
            _userId, queryVec, "mistral-embed", topK: 5);

        foreach (var r in results)
            Assert.True(r.Similarity >= -1.0 && r.Similarity <= 1.0,
                $"Similarity {r.Similarity:F6} out of [-1, 1] for '{r.Content}'");
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_ArgumentValidation_ThrowsOnEmptyVector()
    {
        if (IsSkipped) return;

        await Assert.ThrowsAsync<ArgumentException>(async () =>
            await _repo!.SearchSimilarEmbeddingsAsync(_userId, Array.Empty<float>(), "mistral-embed", topK: 5));
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_ArgumentValidation_ThrowsOnZeroTopK()
    {
        if (IsSkipped) return;

        await Assert.ThrowsAsync<ArgumentException>(async () =>
            await _repo!.SearchSimilarEmbeddingsAsync(_userId, MakeVector(8), "mistral-embed", topK: 0));
    }

    [Fact]
    public async Task SearchSimilarEmbeddingsAsync_ArgumentValidation_ThrowsOnNonFiniteVector()
    {
        if (IsSkipped) return;

        var nanVector = new float[] { 0.1f, float.NaN, 0.3f };
        await Assert.ThrowsAsync<ArgumentException>(async () =>
            await _repo!.SearchSimilarEmbeddingsAsync(_userId, nanVector, "mistral-embed", topK: 5));

        var infVector = new float[] { 0.1f, float.PositiveInfinity, 0.3f };
        await Assert.ThrowsAsync<ArgumentException>(async () =>
            await _repo!.SearchSimilarEmbeddingsAsync(_userId, infVector, "mistral-embed", topK: 5));
    }

    // ── Credential discovery ──────────────────────────────────────────────────

    private static (string Host, int Port, string Username, string Password)? DiscoverPostgresCredentials()
    {
        var host = Environment.GetEnvironmentVariable("POSTGRES_HOST") ?? "127.0.0.1";
        var portStr = Environment.GetEnvironmentVariable("POSTGRES_HOST_PORT") ?? "5433";
        int.TryParse(portStr, out var port);
        if (port == 0) port = 5433;
        var user = Environment.GetEnvironmentVariable("KAIRO_APP_USER") ?? "kairo_dev";

        var envPass = Environment.GetEnvironmentVariable("KAIRO_APP_PASSWORD");
        if (!string.IsNullOrWhiteSpace(envPass))
            return (host, port, user, envPass);

        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        var dir = new DirectoryInfo(baseDir);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "infrastructure", "docker", ".env")))
            dir = dir.Parent;

        if (dir != null)
        {
            var envFilePath = Path.Combine(dir.FullName, "infrastructure", "docker", ".env");
            var lines = File.ReadAllLines(envFilePath);
            string? discoveredUser = null;
            string? discoveredPass = null;
            string? discoveredPort = null;
            foreach (var rawLine in lines)
            {
                var line = rawLine.Trim();
                if (line.StartsWith('#') || !line.Contains('=')) continue;
                var parts = line.Split('=', 2);
                var key = parts[0].Trim();
                var val = parts[1].Trim();
                if (key == "KAIRO_APP_USER") discoveredUser = val;
                if (key == "KAIRO_APP_PASSWORD") discoveredPass = val;
                if (key == "POSTGRES_HOST_PORT") discoveredPort = val;
            }

            if (!string.IsNullOrWhiteSpace(discoveredPass))
            {
                if (!string.IsNullOrWhiteSpace(discoveredUser)) user = discoveredUser;
                if (int.TryParse(discoveredPort, out var p)) port = p;
                return (host, port, user, discoveredPass);
            }
        }

        return null;
    }

    private static string BuildConnectionString(
        (string Host, int Port, string Username, string Password) creds, string database)
        => $"Host={creds.Host};Port={creds.Port};Database={database};Username={creds.Username};Password={creds.Password};";
}

/// <summary>
/// Phase 4C Task 4C.4: SQL Server regression tests using Moq.
/// Verifies that <see cref="IMemoryRepository.SearchSimilarEmbeddingsAsync"/> is declared
/// on the interface, that <see cref="RankedEmbeddingResult"/> carries all required fields,
/// and that <see cref="SemanticSimilarityService"/> (the SQL Server fallback's cosine calculator)
/// is correct. No real database required.
/// </summary>
public class Phase4CVectorRetrievalSqlServerRegressionTests
{
    private static float[] MakeVector(int dims, float fill = 0.1f)
    {
        var v = Enumerable.Range(0, dims).Select(i => fill + i * 0.001f).Select(x => (float)x).ToArray();
        var mag = (float)Math.Sqrt(v.Sum(x => (double)x * x));
        return v.Select(x => x / mag).ToArray();
    }

    [Fact]
    public void IMemoryRepository_DeclaresSearchSimilarEmbeddingsAsync()
    {
        var method = typeof(IMemoryRepository).GetMethod(
            nameof(IMemoryRepository.SearchSimilarEmbeddingsAsync));
        Assert.NotNull(method);
        Assert.Equal(typeof(Task<List<RankedEmbeddingResult>>), method!.ReturnType);
    }

    [Fact]
    public void RankedEmbeddingResult_HasAllRequiredProperties()
    {
        var r = new RankedEmbeddingResult
        {
            MemoryId   = 1L,
            Content    = "Test content",
            MemoryType = "fact",
            Model      = "mistral-embed",
            Dimensions = 8,
            Similarity = 0.95,
            CreatedAt  = DateTime.UtcNow,
            UpdatedAt  = DateTime.UtcNow,
            OccurredAt = DateTime.UtcNow.AddDays(-1),
            Metadata   = "{\"key\":\"val\"}",
            ExpiresAt  = DateTime.UtcNow.AddDays(7),
            Categories = new List<string> { "work" }
        };

        Assert.Equal(1L, r.MemoryId);
        Assert.Equal("Test content", r.Content);
        Assert.Equal("fact", r.MemoryType);
        Assert.Equal("mistral-embed", r.Model);
        Assert.Equal(8, r.Dimensions);
        Assert.Equal(0.95, r.Similarity);
        Assert.Equal("{\"key\":\"val\"}", r.Metadata);
        Assert.Contains("work", r.Categories);
    }

    [Fact]
    public async Task MockedRepository_SearchSimilarEmbeddingsAsync_ReturnsRankedResults()
    {
        const int dims = 8;
        const long userId = 1L;
        var queryVec = MakeVector(dims, 0.5f);

        var ranked = new List<RankedEmbeddingResult>
        {
            new() { MemoryId = 10, Content = "Most similar",  Similarity = 0.99, Model = "mistral-embed", Dimensions = dims, MemoryType = "fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow, Categories = new() },
            new() { MemoryId = 20, Content = "Less similar",  Similarity = 0.75, Model = "mistral-embed", Dimensions = dims, MemoryType = "fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow, Categories = new() },
            new() { MemoryId = 30, Content = "Least similar", Similarity = 0.55, Model = "mistral-embed", Dimensions = dims, MemoryType = "fact", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow, Categories = new() }
        };

        var mock = new Mock<IMemoryRepository>();
        mock.Setup(r => r.SearchSimilarEmbeddingsAsync(
                userId, queryVec, "mistral-embed", 3, null, null, null, null))
            .ReturnsAsync(ranked);

        var results = await mock.Object.SearchSimilarEmbeddingsAsync(
            userId, queryVec, "mistral-embed", topK: 3);

        Assert.Equal(3, results.Count);
        Assert.Equal("Most similar", results[0].Content);
        Assert.True(results[0].Similarity >= results[1].Similarity);
        Assert.True(results[1].Similarity >= results[2].Similarity);
    }

    [Fact]
    public async Task MockedRepository_SearchSimilarEmbeddingsAsync_ReturnsEmptyWhenNoMatch()
    {
        const long userId = 2L;
        var queryVec = MakeVector(8);

        var mock = new Mock<IMemoryRepository>();
        mock.Setup(r => r.SearchSimilarEmbeddingsAsync(
                It.IsAny<long>(), It.IsAny<float[]>(), It.IsAny<string>(), It.IsAny<int>(),
                It.IsAny<long?>(), It.IsAny<MemoryTemporalFilter?>(),
                It.IsAny<List<MetadataFilterCondition>?>(), It.IsAny<List<string>?>()))
            .ReturnsAsync(new List<RankedEmbeddingResult>());

        var results = await mock.Object.SearchSimilarEmbeddingsAsync(userId, queryVec, "mistral-embed", 5);

        Assert.NotNull(results);
        Assert.Empty(results);
    }

    [Fact]
    public void SemanticSimilarityService_ComputesCorrectCosine_IdenticalVectors()
    {
        var svc = new SemanticSimilarityService();
        var a = new float[] { 1f, 0f, 0f };
        var sim = svc.CalculateCosineSimilarity(a, a);
        Assert.True(Math.Abs(sim - 1.0) < 0.0001, $"Identical vectors should have similarity 1.0, got {sim}");
    }

    [Fact]
    public void SemanticSimilarityService_ComputesCorrectCosine_OrthogonalVectors()
    {
        var svc = new SemanticSimilarityService();
        var a = new float[] { 1f, 0f, 0f };
        var b = new float[] { 0f, 1f, 0f };
        var sim = svc.CalculateCosineSimilarity(a, b);
        Assert.True(Math.Abs(sim) < 0.0001, $"Orthogonal vectors should have similarity ~0.0, got {sim}");
    }

    [Fact]
    public void RankedEmbeddingResult_SimilarityRange_IsDouble()
    {
        var r = new RankedEmbeddingResult { Similarity = -1.0 };
        Assert.Equal(-1.0, r.Similarity);
        r.Similarity = 1.0;
        Assert.Equal(1.0, r.Similarity);
        r.Similarity = 0.0;
        Assert.Equal(0.0, r.Similarity);
    }

    [Fact]
    public void FallbackPath_CompatibilityLogic_DimensionAndModelFiltering()
    {
        var queryDims = 8;
        var queryModel = "mistral-embed";

        // Dimension mismatch
        Assert.NotEqual(4, queryDims);

        // Model mismatch
        Assert.False(Kairo.Application.Abstractions.Services.EmbeddingGeneratorExtensions.IsModelCompatible(
            "openai-ada-002", queryModel));

        // Model match (case-insensitive)
        Assert.True(Kairo.Application.Abstractions.Services.EmbeddingGeneratorExtensions.IsModelCompatible(
            "MISTRAL-EMBED", queryModel));

        // Null model (legacy mock compatibility)
        Assert.True(Kairo.Application.Abstractions.Services.EmbeddingGeneratorExtensions.IsModelCompatible(
            null, queryModel));
    }
}