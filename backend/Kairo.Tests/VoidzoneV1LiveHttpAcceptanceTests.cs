using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.DTOs;
using Npgsql;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// VOIDZONE V1 Master Live HTTP Acceptance Tests.
///
/// Executes real HTTP requests against the running ASP.NET Core pipeline via KairoWebApplicationFactory.
/// Safety guarantees:
/// - Connects exclusively to local PostgreSQL test database: kairo_fresh_init_test.
/// - Never touches kairo_dev, Neon, or cloud databases.
/// - Cleans up all created records upon completion.
/// - Verifies zero credential leaks in responses.
/// </summary>
public sealed class VoidzoneV1LiveHttpAcceptanceTests : IAsyncLifetime
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private KairoWebApplicationFactory _factory = null!;
    private HttpClient _client = null!;
    private string _testConnectionString = null!;

    // Track created test entities for rigorous cleanup
    private readonly HashSet<long> _trackedUserIds = new();
    private readonly HashSet<long> _trackedProjectIds = new();
    private readonly HashSet<long> _trackedApiKeyIds = new();
    private readonly HashSet<long> _trackedMemoryIds = new();
    private readonly HashSet<long> _trackedJobIds = new();

    public Task InitializeAsync()
    {
        _testConnectionString = KairoWebApplicationFactory.ResolveTestConnectionString();
        _factory = new KairoWebApplicationFactory();
        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _client?.Dispose();
        if (_factory != null)
        {
            await _factory.DisposeAsync();
        }

        // Clean up test records from kairo_fresh_init_test
        await CleanupTestRecordsAsync();
    }

    private async Task CleanupTestRecordsAsync()
    {
        if (_trackedUserIds.Count == 0 && _trackedProjectIds.Count == 0 && _trackedMemoryIds.Count == 0)
            return;

        await using var conn = new NpgsqlConnection(_testConnectionString);
        await conn.OpenAsync();

        await using var tx = await conn.BeginTransactionAsync();
        try
        {
            // 1. Delete memory dependents
            if (_trackedUserIds.Count > 0)
            {
                var userList = string.Join(",", _trackedUserIds);

                await ExecuteNonQueryAsync(conn, tx, $"""
                    DELETE FROM "MemoryEmbeddings" WHERE "MemoryId" IN (SELECT "MemoryId" FROM "Memories" WHERE "UserId" IN ({userList}));
                    DELETE FROM "MemoryVersions" WHERE "MemoryId" IN (SELECT "MemoryId" FROM "Memories" WHERE "UserId" IN ({userList}));
                    DELETE FROM "MemoryCategories" WHERE "MemoryId" IN (SELECT "MemoryId" FROM "Memories" WHERE "UserId" IN ({userList}));
                    DELETE FROM "MemoryEntities" WHERE "MemoryId" IN (SELECT "MemoryId" FROM "Memories" WHERE "UserId" IN ({userList}));
                    DELETE FROM "RelationshipEvidence" WHERE "MemoryId" IN (SELECT "MemoryId" FROM "Memories" WHERE "UserId" IN ({userList}));
                    DELETE FROM "Memories" WHERE "UserId" IN ({userList});
                    DELETE FROM "MemoryScopes" WHERE "ProjectId" IN (SELECT "ProjectId" FROM "Projects" WHERE "UserId" IN ({userList}));
                    DELETE FROM "MemoryIngestionJobs" WHERE "UserId" IN ({userList});
                    DELETE FROM "UsageLedger" WHERE "UserId" IN ({userList});
                    DELETE FROM "ProjectQuotas" WHERE "ProjectId" IN (SELECT "ProjectId" FROM "Projects" WHERE "UserId" IN ({userList}));
                    DELETE FROM "ApiKeys" WHERE "ProjectId" IN (SELECT "ProjectId" FROM "Projects" WHERE "UserId" IN ({userList}));
                    DELETE FROM "Projects" WHERE "UserId" IN ({userList});
                    DELETE FROM "RefreshTokens" WHERE "UserId" IN ({userList});
                    DELETE FROM "AuthenticationIdentities" WHERE "UserId" IN ({userList});
                    DELETE FROM "Users" WHERE "UserId" IN ({userList});
                """);
            }

            await tx.CommitAsync();
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }

    private static async Task ExecuteNonQueryAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string sql)
    {
        await using var cmd = new NpgsqlCommand(sql, conn, tx);
        await cmd.ExecuteNonQueryAsync();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: Auth and Project Setup
    // ─────────────────────────────────────────────────────────────────────────

    private async Task<(long UserId, string Email, string Token, string RefreshToken)> RegisterAndLoginAsync(
        string emailPrefix = "e2e_user")
    {
        var email = $"{emailPrefix}_{Guid.NewGuid():N}@kairo-test.internal";
        var password = "SecurePassword123!@#";

        // Register
        var regResponse = await _client.PostAsJsonAsync("/api/auth/register", new RegisterRequest
        {
            Email = email,
            Password = password
        });
        Assert.Equal(HttpStatusCode.Created, regResponse.StatusCode);
        var regResult = await regResponse.Content.ReadFromJsonAsync<RegisterResult>(JsonOptions);
        Assert.NotNull(regResult);
        _trackedUserIds.Add(regResult.UserId);

        // Login
        var loginResponse = await _client.PostAsJsonAsync("/api/auth/login", new LoginRequest
        {
            Email = email,
            Password = password
        });
        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);
        var loginResult = await loginResponse.Content.ReadFromJsonAsync<LoginResult>(JsonOptions);
        Assert.NotNull(loginResult);
        Assert.False(string.IsNullOrWhiteSpace(loginResult.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(loginResult.RefreshToken));

        return (regResult.UserId, email, loginResult.AccessToken, loginResult.RefreshToken);
    }

    private async Task<(long ProjectId, string ProjectName)> CreateProjectAsync(string jwtToken, string projectName)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/v1/projects")
        {
            Content = JsonContent.Create(new CreateProjectRequest { Name = projectName })
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jwtToken);

        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var proj = await res.Content.ReadFromJsonAsync<ProjectResponse>(JsonOptions);
        Assert.NotNull(proj);
        _trackedProjectIds.Add(proj.ProjectId);

        return (proj.ProjectId, proj.Name);
    }

    private async Task<string> CreateApiKeyAsync(string jwtToken, long projectId, string keyName)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/v1/api-keys")
        {
            Content = JsonContent.Create(new CreateApiKeyRequest
            {
                ProjectId = projectId,
                Name = keyName
            })
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jwtToken);

        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var keyResult = await res.Content.ReadFromJsonAsync<CreatedApiKeyResponse>(JsonOptions);
        Assert.NotNull(keyResult);
        Assert.StartsWith("kairo_live_", keyResult.ApiKey);
        _trackedApiKeyIds.Add(keyResult.ApiKeyId);

        return keyResult.ApiKey;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 1: Health and Readiness Probes
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Scenario1_HealthEndpoints_AllReturnHealthy()
    {
        // 1. /health
        var healthRes = await _client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, healthRes.StatusCode);
        var healthBody = await healthRes.Content.ReadAsStringAsync();
        Assert.Contains("Healthy", healthBody);

        // 2. /health/live
        var liveRes = await _client.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, liveRes.StatusCode);
        var liveBody = await liveRes.Content.ReadAsStringAsync();
        Assert.Contains("Healthy", liveBody);

        // 3. /health/ready
        var readyRes = await _client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.OK, readyRes.StatusCode);
        var readyBody = await readyRes.Content.ReadAsStringAsync();
        Assert.Contains("Healthy", readyBody);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 2: Authentication and Authorization Flow
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Scenario2_AuthenticationLifecycle_Register_Login_Me_Refresh_Succeeds()
    {
        var email = $"user_{Guid.NewGuid():N}@kairo-test.internal";
        var password = "SecurePass123!@#";

        // 1. Register
        var regRes = await _client.PostAsJsonAsync("/api/auth/register", new RegisterRequest
        {
            Email = email,
            Password = password
        });
        Assert.Equal(HttpStatusCode.Created, regRes.StatusCode);
        var regResult = await regRes.Content.ReadFromJsonAsync<RegisterResult>(JsonOptions);
        Assert.NotNull(regResult);
        Assert.Equal(email, regResult.Email);
        _trackedUserIds.Add(regResult.UserId);

        // 2. Duplicate registration fails with Conflict (409)
        var dupRes = await _client.PostAsJsonAsync("/api/auth/register", new RegisterRequest
        {
            Email = email,
            Password = password
        });
        Assert.Equal(HttpStatusCode.Conflict, dupRes.StatusCode);

        // 3. Login with wrong password fails with Unauthorized (401)
        var badLoginRes = await _client.PostAsJsonAsync("/api/auth/login", new LoginRequest
        {
            Email = email,
            Password = "WrongPassword!"
        });
        Assert.Equal(HttpStatusCode.Unauthorized, badLoginRes.StatusCode);

        // 4. Login with correct password succeeds
        var loginRes = await _client.PostAsJsonAsync("/api/auth/login", new LoginRequest
        {
            Email = email,
            Password = password
        });
        Assert.Equal(HttpStatusCode.OK, loginRes.StatusCode);
        var loginResult = await loginRes.Content.ReadFromJsonAsync<LoginResult>(JsonOptions);
        Assert.NotNull(loginResult);
        Assert.False(string.IsNullOrWhiteSpace(loginResult.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(loginResult.RefreshToken));

        // 5. GET /api/auth/me without auth fails (401)
        var unauthMe = await _client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthMe.StatusCode);

        // 6. GET /api/auth/me with JWT succeeds
        using var meReq = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        meReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", loginResult.AccessToken);
        var meRes = await _client.SendAsync(meReq);
        Assert.Equal(HttpStatusCode.OK, meRes.StatusCode);
        var meResult = await meRes.Content.ReadFromJsonAsync<AccountMeResult>(JsonOptions);
        Assert.NotNull(meResult);
        Assert.Equal(email, meResult.Email);
        Assert.Equal(regResult.UserId, meResult.UserId);

        // 7. POST /api/auth/refresh rotates token pair
        var refreshRes = await _client.PostAsJsonAsync("/api/auth/refresh", new RefreshTokenRequest
        {
            RefreshToken = loginResult.RefreshToken
        });
        Assert.Equal(HttpStatusCode.OK, refreshRes.StatusCode);
        var refreshedTokens = await refreshRes.Content.ReadFromJsonAsync<TokenPair>(JsonOptions);
        Assert.NotNull(refreshedTokens);
        Assert.False(string.IsNullOrWhiteSpace(refreshedTokens.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(refreshedTokens.RefreshToken));

        // 8. New access token works for GET /api/auth/me
        using var meReq2 = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        meReq2.Headers.Authorization = new AuthenticationHeaderValue("Bearer", refreshedTokens.AccessToken);
        var meRes2 = await _client.SendAsync(meReq2);
        Assert.Equal(HttpStatusCode.OK, meRes2.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 3: Multi-Tenancy & Project Isolation
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Scenario3_MultiTenancy_ProjectAndApiKey_IsolationEnforced()
    {
        // Setup User A and User B
        var userA = await RegisterAndLoginAsync("tenantA");
        var userB = await RegisterAndLoginAsync("tenantB");

        // User A creates Project A
        var projA = await CreateProjectAsync(userA.Token, "Project Alpha");
        // User B creates Project B
        var projB = await CreateProjectAsync(userB.Token, "Project Beta");

        // User A me-profile contains Project A but NOT Project B
        using var meReqA = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        meReqA.Headers.Authorization = new AuthenticationHeaderValue("Bearer", userA.Token);
        var meResA = await _client.SendAsync(meReqA);
        var meA = await meResA.Content.ReadFromJsonAsync<AccountMeResult>(JsonOptions);
        Assert.NotNull(meA);
        Assert.Contains(meA.Projects, p => p.ProjectId == projA.ProjectId);
        Assert.DoesNotContain(meA.Projects, p => p.ProjectId == projB.ProjectId);

        // User B me-profile contains Project B but NOT Project A
        using var meReqB = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        meReqB.Headers.Authorization = new AuthenticationHeaderValue("Bearer", userB.Token);
        var meResB = await _client.SendAsync(meReqB);
        var meB = await meResB.Content.ReadFromJsonAsync<AccountMeResult>(JsonOptions);
        Assert.NotNull(meB);
        Assert.Contains(meB.Projects, p => p.ProjectId == projB.ProjectId);
        Assert.DoesNotContain(meB.Projects, p => p.ProjectId == projA.ProjectId);

        // Cross-project attack: User A attempts to create an API key for Project B
        using var attackKeyReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/api-keys")
        {
            Content = JsonContent.Create(new CreateApiKeyRequest
            {
                ProjectId = projB.ProjectId,
                Name = "Attacker Key"
            })
        };
        attackKeyReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", userA.Token);
        var attackKeyRes = await _client.SendAsync(attackKeyReq);
        Assert.Equal(HttpStatusCode.Unauthorized, attackKeyRes.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 4: Memory Ingestion (Sync) and Idempotency / Deduplication
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Scenario4_MemoryIngestion_Sync_AndDuplicateHandling()
    {
        var user = await RegisterAndLoginAsync("ingest_user");
        var proj = await CreateProjectAsync(user.Token, "Ingest Proj");
        var apiKey = await CreateApiKeyAsync(user.Token, proj.ProjectId, "Ingest Key");

        // 1. Create Memory
        using var createReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories")
        {
            Content = JsonContent.Create(new CreateMemoryRequest
            {
                Content = "User prefers Obsidian Dark theme with high contrast",
                MemoryType = "Preference",
                ActorId = "actor-alice",
                Categories = new List<string> { "preferences", "ui" },
                Metadata = new Dictionary<string, object> { ["source"] = "settings_page" }
            })
        };
        createReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        var createRes = await _client.SendAsync(createReq);
        Assert.Equal(HttpStatusCode.Created, createRes.StatusCode);

        var mem = await createRes.Content.ReadFromJsonAsync<MemoryResponse>(JsonOptions);
        Assert.NotNull(mem);
        Assert.True(mem.MemoryId > 0);
        Assert.Equal("User prefers Obsidian Dark theme with high contrast", mem.Content);
        Assert.Equal("Preference", mem.MemoryType);
        _trackedMemoryIds.Add(mem.MemoryId);

        // 2. Read back via GET /api/v1/memories/{memoryId}
        using var getReq = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/memories/{mem.MemoryId}");
        getReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        var getRes = await _client.SendAsync(getReq);
        Assert.Equal(HttpStatusCode.OK, getRes.StatusCode);
        var fetchedMem = await getRes.Content.ReadFromJsonAsync<MemoryResponse>(JsonOptions);
        Assert.NotNull(fetchedMem);
        Assert.Equal(mem.MemoryId, fetchedMem.MemoryId);
        Assert.Equal(mem.Content, fetchedMem.Content);

        // 3. Duplicate Ingestion: submit exact same content & type
        using var dupReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories")
        {
            Content = JsonContent.Create(new CreateMemoryRequest
            {
                Content = "User prefers Obsidian Dark theme with high contrast",
                MemoryType = "Preference",
                ActorId = "actor-alice"
            })
        };
        dupReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        var dupRes = await _client.SendAsync(dupReq);
        Assert.Equal(HttpStatusCode.OK, dupRes.StatusCode);
        var dupResult = await dupRes.Content.ReadFromJsonAsync<MemoryDuplicateResult>(JsonOptions);
        Assert.NotNull(dupResult);
        Assert.True(dupResult.IsDuplicate);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 5: Cross-Project Memory Isolation across Search, Read, Mutate
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Scenario5_CrossProjectMemoryIsolation_FailsClosed()
    {
        var userA = await RegisterAndLoginAsync("tenant_iso_a");
        var userB = await RegisterAndLoginAsync("tenant_iso_b");

        var projA = await CreateProjectAsync(userA.Token, "Isolation Proj A");
        var projB = await CreateProjectAsync(userB.Token, "Isolation Proj B");

        var keyA = await CreateApiKeyAsync(userA.Token, projA.ProjectId, "Key A");
        var keyB = await CreateApiKeyAsync(userB.Token, projB.ProjectId, "Key B");

        // Ingest memory into Project A
        using var createReqA = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories")
        {
            Content = JsonContent.Create(new CreateMemoryRequest
            {
                Content = "Project Alpha top-secret revenue projections for 2027",
                MemoryType = "Fact",
                ActorId = "actor-projA"
            })
        };
        createReqA.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyA);
        var createResA = await _client.SendAsync(createReqA);
        var memA = await createResA.Content.ReadFromJsonAsync<MemoryResponse>(JsonOptions);
        Assert.NotNull(memA);
        _trackedMemoryIds.Add(memA.MemoryId);

        // Ingest memory into Project B
        using var createReqB = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories")
        {
            Content = JsonContent.Create(new CreateMemoryRequest
            {
                Content = "Project Beta confidential architectural blueprints",
                MemoryType = "Fact",
                ActorId = "actor-projB"
            })
        };
        createReqB.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyB);
        var createResB = await _client.SendAsync(createReqB);
        var memB = await createResB.Content.ReadFromJsonAsync<MemoryResponse>(JsonOptions);
        Assert.NotNull(memB);
        _trackedMemoryIds.Add(memB.MemoryId);

        // 1. Cross-Project Read: Key A attempts to read Memory B -> 404
        using var readReq = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/memories/{memB.MemoryId}");
        readReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyA);
        var readRes = await _client.SendAsync(readReq);
        Assert.Equal(HttpStatusCode.NotFound, readRes.StatusCode);

        // 2. Cross-Project Read: Key B attempts to read Memory A -> 404
        using var readReq2 = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/memories/{memA.MemoryId}");
        readReq2.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyB);
        var readRes2 = await _client.SendAsync(readReq2);
        Assert.Equal(HttpStatusCode.NotFound, readRes2.StatusCode);

        // 3. Cross-Project Search: Key A searches for Project B keywords -> 0 results
        using var searchReqA = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories/search")
        {
            Content = JsonContent.Create(new MemorySearchRequest
            {
                Query = "architectural blueprints",
                TopK = 5,
                ActorId = "actor-projA"
            })
        };
        searchReqA.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyA);
        var searchResA = await _client.SendAsync(searchReqA);
        Assert.Equal(HttpStatusCode.OK, searchResA.StatusCode);
        var searchResultA = await searchResA.Content.ReadFromJsonAsync<MemorySearchResponse>(JsonOptions);
        Assert.NotNull(searchResultA);
        Assert.DoesNotContain(searchResultA.Memories, m => m.MemoryId == memB.MemoryId);

        // 4. Same Project Search: Key B searches for its own memory -> Found!
        using var searchReqB = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories/search")
        {
            Content = JsonContent.Create(new MemorySearchRequest
            {
                Query = "architectural blueprints",
                TopK = 5,
                ActorId = "actor-projB"
            })
        };
        searchReqB.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyB);
        var searchResB = await _client.SendAsync(searchReqB);
        Assert.Equal(HttpStatusCode.OK, searchResB.StatusCode);
        var searchResultB = await searchResB.Content.ReadFromJsonAsync<MemorySearchResponse>(JsonOptions);
        Assert.NotNull(searchResultB);
        Assert.Contains(searchResultB.Memories, m => m.MemoryId == memB.MemoryId);

        // 5. Cross-Project Update: Key A attempts to update Memory B -> 404
        using var updateReq = new HttpRequestMessage(HttpMethod.Put, $"/api/v1/memories/{memB.MemoryId}")
        {
            Content = JsonContent.Create(new UpdateMemoryRequest
            {
                Content = "Hacked content",
                MemoryType = "Fact"
            })
        };
        updateReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyA);
        var updateRes = await _client.SendAsync(updateReq);
        Assert.Equal(HttpStatusCode.NotFound, updateRes.StatusCode);

        // 6. Cross-Project Delete: Key A attempts to delete Memory B -> 404
        using var delReq = new HttpRequestMessage(HttpMethod.Delete, $"/api/v1/memories/{memB.MemoryId}");
        delReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyA);
        var delRes = await _client.SendAsync(delReq);
        Assert.Equal(HttpStatusCode.NotFound, delRes.StatusCode);

        // 7. Cross-Project List: Key A lists memories -> contains memA, does NOT contain memB
        using var listReqA = new HttpRequestMessage(HttpMethod.Get, "/api/v1/memories");
        listReqA.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyA);
        var listResA = await _client.SendAsync(listReqA);
        Assert.Equal(HttpStatusCode.OK, listResA.StatusCode);
        using var listDataA = await listResA.Content.ReadFromJsonAsync<JsonDocument>(JsonOptions);
        Assert.NotNull(listDataA);
        var memIdsA = listDataA.RootElement.GetProperty("memories").EnumerateArray()
            .Select(m => m.GetProperty("memoryId").GetInt64()).ToList();
        Assert.Contains(memA.MemoryId, memIdsA);
        Assert.DoesNotContain(memB.MemoryId, memIdsA);

        // 8. Cross-Project List: Key B lists memories -> contains memB, does NOT contain memA
        using var listReqB = new HttpRequestMessage(HttpMethod.Get, "/api/v1/memories");
        listReqB.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyB);
        var listResB = await _client.SendAsync(listReqB);
        Assert.Equal(HttpStatusCode.OK, listResB.StatusCode);
        using var listDataB = await listResB.Content.ReadFromJsonAsync<JsonDocument>(JsonOptions);
        Assert.NotNull(listDataB);
        var memIdsB = listDataB.RootElement.GetProperty("memories").EnumerateArray()
            .Select(m => m.GetProperty("memoryId").GetInt64()).ToList();
        Assert.Contains(memB.MemoryId, memIdsB);
        Assert.DoesNotContain(memA.MemoryId, memIdsB);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 6: Retrieval & Search Verification
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Scenario6_RetrievalAndSearch_HybridAndSemantic_Succeeds()
    {
        var user = await RegisterAndLoginAsync("search_user");
        var proj = await CreateProjectAsync(user.Token, "Search Proj");
        var key = await CreateApiKeyAsync(user.Token, proj.ProjectId, "Search Key");

        // Ingest two distinct memories
        using var req1 = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories")
        {
            Content = JsonContent.Create(new CreateMemoryRequest
            {
                Content = "Quantum computing uses qubits and superposition principles",
                MemoryType = "Fact",
                ActorId = "actor-researcher"
            })
        };
        req1.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        var res1 = await _client.SendAsync(req1);
        var m1 = await res1.Content.ReadFromJsonAsync<MemoryResponse>(JsonOptions);
        Assert.NotNull(m1);
        _trackedMemoryIds.Add(m1.MemoryId);

        using var req2 = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories")
        {
            Content = JsonContent.Create(new CreateMemoryRequest
            {
                Content = "Baking sourdough bread requires organic flour, water, and wild yeast",
                MemoryType = "Fact",
                ActorId = "actor-researcher"
            })
        };
        req2.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        var res2 = await _client.SendAsync(req2);
        var m2 = await res2.Content.ReadFromJsonAsync<MemoryResponse>(JsonOptions);
        Assert.NotNull(m2);
        _trackedMemoryIds.Add(m2.MemoryId);

        // Hybrid search for quantum
        using var searchReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories/search")
        {
            Content = JsonContent.Create(new MemorySearchRequest
            {
                Query = "quantum qubits superposition",
                TopK = 5,
                ActorId = "actor-researcher",
                Hybrid = true
            })
        };
        searchReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        var searchRes = await _client.SendAsync(searchReq);
        Assert.Equal(HttpStatusCode.OK, searchRes.StatusCode);
        var searchResult = await searchRes.Content.ReadFromJsonAsync<MemorySearchResponse>(JsonOptions);
        Assert.NotNull(searchResult);
        Assert.NotEmpty(searchResult.Memories);
        Assert.Equal(m1.MemoryId, searchResult.Memories[0].MemoryId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 7: Asynchronous Ingestion & Processing
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Scenario7_AsyncIngestion_EnqueuesJobAndProcessesToCompletion()
    {
        var user = await RegisterAndLoginAsync("async_user");
        var proj = await CreateProjectAsync(user.Token, "Async Proj");
        var key = await CreateApiKeyAsync(user.Token, proj.ProjectId, "Async Key");

        // Enqueue async memory ingestion via ?mode=async
        using var asyncCreateReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories?mode=async")
        {
            Content = JsonContent.Create(new CreateMemoryRequest
            {
                Content = "Distributed streaming pipelines require durable log storage and consumer offsets",
                MemoryType = "Fact",
                ActorId = "actor-stream"
            })
        };
        asyncCreateReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        var asyncCreateRes = await _client.SendAsync(asyncCreateReq);

        Assert.Equal(HttpStatusCode.Accepted, asyncCreateRes.StatusCode);
        var jobAccepted = await asyncCreateRes.Content.ReadFromJsonAsync<AsyncJobAcceptedResponse>(JsonOptions);
        Assert.NotNull(jobAccepted);
        Assert.True(jobAccepted.JobId > 0);
        _trackedJobIds.Add(jobAccepted.JobId);

        // Poll job status until terminal state or timeout (15 seconds max)
        JobStatusResponse? finalJobStatus = null;
        JobStatusResponse? lastObservedStatus = null;
        for (int i = 0; i < 30; i++)
        {
            await Task.Delay(500);

            using var jobQueryReq = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/memories/jobs/{jobAccepted.JobId}");
            jobQueryReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
            var jobQueryRes = await _client.SendAsync(jobQueryReq);

            if (jobQueryRes.StatusCode == HttpStatusCode.OK)
            {
                var status = await jobQueryRes.Content.ReadFromJsonAsync<JobStatusResponse>(JsonOptions);
                if (status != null)
                {
                    lastObservedStatus = status;
                    if (status.Status is "Completed" or "Failed" or "Cancelled")
                    {
                        finalJobStatus = status;
                        break;
                    }
                }
            }
        }

        Assert.True(finalJobStatus != null,
            $"Job {jobAccepted.JobId} did not reach terminal state. Last observed status='{lastObservedStatus?.Status}', attempts={lastObservedStatus?.Attempts}, error='{lastObservedStatus?.LastError}'");
        Assert.Equal("Completed", finalJobStatus.Status);
        Assert.NotNull(finalJobStatus.MemoryId);
        _trackedMemoryIds.Add(finalJobStatus.MemoryId.Value);

        // Verify the background-processed memory is searchable
        using var searchReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories/search")
        {
            Content = JsonContent.Create(new MemorySearchRequest
            {
                Query = "distributed streaming consumer offsets",
                TopK = 5,
                ActorId = "actor-stream"
            })
        };
        searchReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        var searchRes = await _client.SendAsync(searchReq);
        Assert.Equal(HttpStatusCode.OK, searchRes.StatusCode);
        var searchResult = await searchRes.Content.ReadFromJsonAsync<MemorySearchResponse>(JsonOptions);
        Assert.NotNull(searchResult);
        Assert.Contains(searchResult.Memories, m => m.MemoryId == finalJobStatus.MemoryId.Value);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 8: Restart and Recovery (PostgreSQL Persistence across boots)
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Scenario8_RestartRecovery_DataPersistsInPostgreSqlAcrossFactoryBoots()
    {
        // 1. Create entities in Factory 1
        var user = await RegisterAndLoginAsync("restart_user");
        var proj = await CreateProjectAsync(user.Token, "Restart Proj");
        var key = await CreateApiKeyAsync(user.Token, proj.ProjectId, "Restart Key");

        using var createReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories")
        {
            Content = JsonContent.Create(new CreateMemoryRequest
            {
                Content = "Persistent knowledge snapshot surviving host restart",
                MemoryType = "Fact",
                ActorId = "actor-persist"
            })
        };
        createReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        var createRes = await _client.SendAsync(createReq);
        var mem = await createRes.Content.ReadFromJsonAsync<MemoryResponse>(JsonOptions);
        Assert.NotNull(mem);
        _trackedMemoryIds.Add(mem.MemoryId);

        // 2. Simulate complete host restart: boot a completely new factory instance
        using var secondFactory = new KairoWebApplicationFactory();
        using var secondClient = secondFactory.CreateClient();

        // 3. Read memory through the restarted host
        using var getReq = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/memories/{mem.MemoryId}");
        getReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        var getRes = await secondClient.SendAsync(getReq);
        Assert.Equal(HttpStatusCode.OK, getRes.StatusCode);
        var fetched = await getRes.Content.ReadFromJsonAsync<MemoryResponse>(JsonOptions);
        Assert.NotNull(fetched);
        Assert.Equal(mem.MemoryId, fetched.MemoryId);
        Assert.Equal(mem.Content, fetched.Content);

        // 4. Search memory through the restarted host
        using var searchReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories/search")
        {
            Content = JsonContent.Create(new MemorySearchRequest
            {
                Query = "persistent knowledge snapshot surviving",
                TopK = 5,
                ActorId = "actor-persist"
            })
        };
        searchReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        var searchRes = await secondClient.SendAsync(searchReq);
        Assert.Equal(HttpStatusCode.OK, searchRes.StatusCode);
        var searchResult = await searchRes.Content.ReadFromJsonAsync<MemorySearchResponse>(JsonOptions);
        Assert.NotNull(searchResult);
        Assert.Contains(searchResult.Memories, m => m.MemoryId == mem.MemoryId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 9: Resilience, Boundary Checks & Safe Error Responses
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Scenario9_ResilienceAndBoundaryChecks_SafeFailureModes()
    {
        // 1. Missing Authorization header -> 401
        var unauthRes = await _client.PostAsJsonAsync("/api/v1/memories", new CreateMemoryRequest
        {
            Content = "Test",
            MemoryType = "Fact",
            ActorId = "act"
        });
        Assert.Equal(HttpStatusCode.Unauthorized, unauthRes.StatusCode);

        // 2. Invalid API Key format -> 401
        using var invalidKeyReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories")
        {
            Content = JsonContent.Create(new CreateMemoryRequest
            {
                Content = "Test",
                MemoryType = "Fact",
                ActorId = "act"
            })
        };
        invalidKeyReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "completely_bogus_key");
        var invalidKeyRes = await _client.SendAsync(invalidKeyReq);
        Assert.Equal(HttpStatusCode.Unauthorized, invalidKeyRes.StatusCode);

        // 3. User with valid key submits malformed / empty content -> 400
        var user = await RegisterAndLoginAsync("boundary_user");
        var proj = await CreateProjectAsync(user.Token, "Boundary Proj");
        var key = await CreateApiKeyAsync(user.Token, proj.ProjectId, "Boundary Key");

        using var emptyContentReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/memories")
        {
            Content = JsonContent.Create(new CreateMemoryRequest
            {
                Content = "",
                MemoryType = "Fact",
                ActorId = "act"
            })
        };
        emptyContentReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        var emptyContentRes = await _client.SendAsync(emptyContentReq);
        Assert.Equal(HttpStatusCode.BadRequest, emptyContentRes.StatusCode);

        // 4. Verify no database credentials or connection strings leaked in error responses
        var errorBody = await emptyContentRes.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Host=", errorBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Password=", errorBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("kairo_fresh_init_test", errorBody, StringComparison.OrdinalIgnoreCase);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 10: Server-Side API Key Validation and Project Ownership Binding
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Scenario10_ApiKeyValidationAndOwnershipVerification_EnforcesProjectBinding()
    {
        var userA = await RegisterAndLoginAsync("key_val_a");
        var userB = await RegisterAndLoginAsync("key_val_b");

        // User A creates Project Alpha and Project Beta
        var projA = await CreateProjectAsync(userA.Token, "Project Alpha Validation");
        var projB = await CreateProjectAsync(userA.Token, "Project Beta Validation");

        // User A generates Key A for Project Alpha and Key B for Project Beta
        var keyA = await CreateApiKeyAsync(userA.Token, projA.ProjectId, "Alpha Key");
        var keyB = await CreateApiKeyAsync(userA.Token, projB.ProjectId, "Beta Key");

        // 1. User A validates Key A via POST /api/v1/api-keys/validate -> returns Project Alpha ID
        using var validateReqA = new HttpRequestMessage(HttpMethod.Post, "/api/v1/api-keys/validate")
        {
            Content = JsonContent.Create(new ValidateApiKeyRequest { ApiKey = keyA })
        };
        validateReqA.Headers.Authorization = new AuthenticationHeaderValue("Bearer", userA.Token);
        var validateResA = await _client.SendAsync(validateReqA);
        Assert.Equal(HttpStatusCode.OK, validateResA.StatusCode);
        var valResultA = await validateResA.Content.ReadFromJsonAsync<ValidateApiKeyResponse>(JsonOptions);
        Assert.NotNull(valResultA);
        Assert.True(valResultA.IsValid);
        Assert.Equal(projA.ProjectId, valResultA.ProjectId);

        // 2. User A validates Key B via POST /api/v1/api-keys/validate -> returns Project Beta ID
        using var validateReqB = new HttpRequestMessage(HttpMethod.Post, "/api/v1/api-keys/validate")
        {
            Content = JsonContent.Create(new ValidateApiKeyRequest { ApiKey = keyB })
        };
        validateReqB.Headers.Authorization = new AuthenticationHeaderValue("Bearer", userA.Token);
        var validateResB = await _client.SendAsync(validateReqB);
        Assert.Equal(HttpStatusCode.OK, validateResB.StatusCode);
        var valResultB = await validateResB.Content.ReadFromJsonAsync<ValidateApiKeyResponse>(JsonOptions);
        Assert.NotNull(valResultB);
        Assert.True(valResultB.IsValid);
        Assert.Equal(projB.ProjectId, valResultB.ProjectId);

        // 3. User B attempts to validate User A's key -> rejected with IsValid = false (key does not belong to User B)
        using var foreignValReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/api-keys/validate")
        {
            Content = JsonContent.Create(new ValidateApiKeyRequest { ApiKey = keyA })
        };
        foreignValReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", userB.Token);
        var foreignValRes = await _client.SendAsync(foreignValReq);
        Assert.Equal(HttpStatusCode.OK, foreignValRes.StatusCode);
        var foreignValResult = await foreignValRes.Content.ReadFromJsonAsync<ValidateApiKeyResponse>(JsonOptions);
        Assert.NotNull(foreignValResult);
        Assert.False(foreignValResult.IsValid);

        // 4. Validate malformed / invalid key -> returns IsValid = false
        using var malformedReq = new HttpRequestMessage(HttpMethod.Post, "/api/v1/api-keys/validate")
        {
            Content = JsonContent.Create(new ValidateApiKeyRequest { ApiKey = "kairo_live_invalid_garbage_key" })
        };
        malformedReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", userA.Token);
        var malformedRes = await _client.SendAsync(malformedReq);
        Assert.Equal(HttpStatusCode.OK, malformedRes.StatusCode);
        var malformedResult = await malformedRes.Content.ReadFromJsonAsync<ValidateApiKeyResponse>(JsonOptions);
        Assert.NotNull(malformedResult);
        Assert.False(malformedResult.IsValid);

        // 5. Verify Key A using GET /api/v1/api-keys/verify (ApiKey authenticated)
        using var verifyReqA = new HttpRequestMessage(HttpMethod.Get, "/api/v1/api-keys/verify");
        verifyReqA.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyA);
        var verifyResA = await _client.SendAsync(verifyReqA);
        Assert.Equal(HttpStatusCode.OK, verifyResA.StatusCode);
        var verifyResultA = await verifyResA.Content.ReadFromJsonAsync<VerifyApiKeyResponse>(JsonOptions);
        Assert.NotNull(verifyResultA);
        Assert.True(verifyResultA.Valid);
        Assert.Equal(projA.ProjectId, verifyResultA.ProjectId);

        // 6. Verify Key B using GET /api/v1/api-keys/verify (ApiKey authenticated)
        using var verifyReqB = new HttpRequestMessage(HttpMethod.Get, "/api/v1/api-keys/verify");
        verifyReqB.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyB);
        var verifyResB = await _client.SendAsync(verifyReqB);
        Assert.Equal(HttpStatusCode.OK, verifyResB.StatusCode);
        var verifyResultB = await verifyResB.Content.ReadFromJsonAsync<VerifyApiKeyResponse>(JsonOptions);
        Assert.NotNull(verifyResultB);
        Assert.True(verifyResultB.Valid);
        Assert.Equal(projB.ProjectId, verifyResultB.ProjectId);

        // 7. Revoke Key A and confirm verify fails closed with 401 Unauthorized
        using var revokeReq = new HttpRequestMessage(HttpMethod.Delete, $"/api/v1/api-keys/{valResultA.ApiKeyId}");
        revokeReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", userA.Token);
        var revokeRes = await _client.SendAsync(revokeReq);
        Assert.Equal(HttpStatusCode.OK, revokeRes.StatusCode);

        using var verifyRevokedReq = new HttpRequestMessage(HttpMethod.Get, "/api/v1/api-keys/verify");
        verifyRevokedReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", keyA);
        var verifyRevokedRes = await _client.SendAsync(verifyRevokedReq);
        Assert.Equal(HttpStatusCode.Unauthorized, verifyRevokedRes.StatusCode);
    }
}
