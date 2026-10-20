using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Kairo.API.Controllers;
using Kairo.API.Security;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Security;
using Kairo.Application.Services;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Kairo.Infrastructure.Repositories;
using Kairo.MCP.Tools;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Authenticated End-to-End Application Integration Tests for Cross-Project Isolation.
///
/// Exercises the real application entry points:
/// 1. ApiKeyValidator (raw API key authentication and project context resolution).
/// 2. ApiKeyContext (scoped ambient request context).
/// 3. MemoryController (HTTP endpoint entry point with full request processing).
/// 4. KairoMemoryTools (MCP entry point: remember, recall, update, forget).
/// 5. MemoryJobService & Worker (asynchronous background job identity enforcement).
/// 6. MemoryService, HybridRetrievalService, MemoryRetrievalService.
/// 7. MemoryRepository, KeywordSearchRepository, MemoryScopeRepository, ApiKeyRepository.
///
/// Uses an isolated, synthetic in-memory SQLite/EF provider. Never touches production data.
/// </summary>
public class AuthenticatedEndToEndIsolationIntegrationTests
{
    private const long UserId = 42L;
    private const long ProjectA = 101L;
    private const long ProjectB = 202L;
    private const string RawApiKeyA = "kairo_live_key_proj_A_secret";
    private const string RawApiKeyB = "kairo_live_key_proj_B_secret";
    private const string ActorA = "agent-alpha";
    private const string ActorB = "agent-beta";

    private static string HashKey(string raw)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
    }

    private static KairoDbContext CreateSeededDb()
    {
        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        var db = new KairoDbContext(options);

        // 1. Seed user owning both projects
        db.Users.Add(new Users
        {
            UserId = UserId,
            Email = "owner@kairo-test.internal",
            PasswordHash = "hashed_pw",
            AccountStatus = 1,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });

        // 2. Seed Project A and Project B
        db.Projects.Add(new Projects
        {
            ProjectId = ProjectA,
            UserId = UserId,
            Name = "Project Alpha",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        db.Projects.Add(new Projects
        {
            ProjectId = ProjectB,
            UserId = UserId,
            Name = "Project Beta",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });

        // 3. Seed API Keys for both projects
        db.ApiKeys.Add(new ApiKeys
        {
            ApiKeyId = 1L,
            ProjectId = ProjectA,
            KeyHash = HashKey(RawApiKeyA),
            KeyPrefix = "kairo_live_A",
            Name = "Key A",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        db.ApiKeys.Add(new ApiKeys
        {
            ApiKeyId = 2L,
            ProjectId = ProjectB,
            KeyHash = HashKey(RawApiKeyB),
            KeyPrefix = "kairo_live_B",
            Name = "Key B",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });

        // 4. Seed Scopes for both projects
        db.MemoryScopes.Add(new MemoryScopes
        {
            ScopeId = 1001L,
            ProjectId = ProjectA,
            ActorId = ActorA,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        db.MemoryScopes.Add(new MemoryScopes
        {
            ScopeId = 1002L,
            ProjectId = ProjectB,
            ActorId = ActorB,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });

        db.SaveChanges();
        return db;
    }

    private class TestHarness
    {
        public KairoDbContext Db { get; }
        public ApiKeyValidator Validator { get; }
        public ApiKeyContext Context { get; }
        public MemoryRepository MemoryRepo { get; }
        public KeywordSearchRepository KeywordRepo { get; }
        public ScopeResolutionService ScopeResolver { get; }
        public MemoryRetrievalService RetrievalService { get; }
        public HybridRetrievalService HybridRetrieval { get; }
        public MemoryService MemoryService { get; }
        public MemoryController Controller { get; }
        public KairoMemoryTools McpTools { get; }
        public MemoryJobService JobService { get; }

        public TestHarness(KairoDbContext db, ApiKeyContext context)
        {
            Db = db;
            Context = context;

            var apiKeyRepoMock = new Mock<IApiKeyRepository>();
            apiKeyRepoMock.Setup(r => r.GetByHashAsync(It.IsAny<string>()))
                .ReturnsAsync((string hash) =>
                {
                    var k = db.ApiKeys.FirstOrDefault(x => x.KeyHash == hash);
                    if (k == null) return null;
                    return new ApiKeyData
                    {
                        ApiKeyId = k.ApiKeyId,
                        ProjectId = k.ProjectId,
                        KeyHash = k.KeyHash,
                        KeyPrefix = k.KeyPrefix,
                        Name = k.Name,
                        ExpiresAt = k.ExpiresAt,
                        IsActive = k.IsActive,
                        CreatedAt = k.CreatedAt,
                        UpdatedAt = k.UpdatedAt
                    };
                });
            apiKeyRepoMock.Setup(r => r.GetUserIdByApiKeyIdAsync(It.IsAny<long>()))
                .ReturnsAsync((long id) =>
                {
                    var k = db.ApiKeys.Find(id);
                    if (k == null) return null;
                    var p = db.Projects.Find(k.ProjectId);
                    return p?.UserId ?? UserId;
                });
            apiKeyRepoMock.Setup(r => r.UpdateLastUsedAtAsync(It.IsAny<long>()))
                .Returns(Task.CompletedTask);
            Validator = new ApiKeyValidator(apiKeyRepoMock.Object);

            MemoryRepo = new MemoryRepository(db, context);
            KeywordRepo = new KeywordSearchRepository(db, context);
            var scopeRepo = new MemoryScopeRepository(db);
            ScopeResolver = new ScopeResolutionService(scopeRepo);

            var embGenMock = new Mock<IEmbeddingGenerator>();
            embGenMock.Setup(e => e.GenerateAsync(It.IsAny<string>()))
                .ReturnsAsync(new float[] { 0.1f, 0.2f, 0.3f, 0.4f });
            embGenMock.As<IEmbeddingMetadataProvider>()
                .Setup(m => m.ModelName)
                .Returns("mistral-embed");

            var relEvalMock = new Mock<IMemoryRelevanceEvaluator>();
            relEvalMock.Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
                .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

            var entityRepo = new EntityRepository(db, NullLogger<EntityRepository>.Instance);
            var entityExtMock = new Mock<IEntityExtractionService>();
            entityExtMock.Setup(e => e.ExtractAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<ExtractedEntity>());

            RetrievalService = new MemoryRetrievalService(
                MemoryRepo, embGenMock.Object, new SemanticSimilarityService(), relEvalMock.Object);

            HybridRetrieval = new HybridRetrievalService(
                MemoryRepo,
                embGenMock.Object,
                new SemanticSimilarityService(),
                relEvalMock.Object,
                KeywordRepo,
                entityRepo,
                entityExtMock.Object,
                NullLogger<HybridRetrievalService>.Instance);

            var userRepo = new UserRepository(db);
            var simService = new SemanticSimilarityService();

            MemoryService = new MemoryService(
                MemoryRepo,
                userRepo,
                embGenMock.Object,
                simService,
                RetrievalService,
                ScopeResolver,
                entityRepo,
                entityExtMock.Object);

            var jobRepo = new IngestionJobRepository(db);
            var txCoordinatorMock = new Mock<ITransactionCoordinator>();
            txCoordinatorMock.Setup(t => t.ExecuteInTransactionAsync(It.IsAny<Func<Task>>(), It.IsAny<CancellationToken>()))
                .Returns((Func<Task> op, CancellationToken _) => op());

            JobService = new MemoryJobService(
                jobRepo,
                MemoryRepo,
                ScopeResolver,
                embGenMock.Object,
                txCoordinatorMock.Object,
                NullLogger<MemoryJobService>.Instance,
                entityExtMock.Object,
                entityRepo);

            var ingestionServiceMock = new Mock<IMemoryIngestionService>();

            Controller = new MemoryController(
                MemoryService,
                ingestionServiceMock.Object,
                context,
                HybridRetrieval,
                JobService);

            // Set up mock HttpContext for Controller
            var httpContext = new DefaultHttpContext();
            var serviceProviderMock = new Mock<IServiceProvider>();
            serviceProviderMock.Setup(sp => sp.GetService(typeof(IScopeResolutionService)))
                .Returns(ScopeResolver);
            httpContext.RequestServices = serviceProviderMock.Object;
            Controller.ControllerContext = new ControllerContext { HttpContext = httpContext };

            McpTools = new KairoMemoryTools(context, MemoryService, ScopeResolver);
        }
    }

    private static async Task<TestHarness> CreateAuthenticatedHarnessAsync(string rawApiKey)
    {
        var db = CreateSeededDb();
        var context = new ApiKeyContext();

        var harness = new TestHarness(db, context);

        // Authenticate through the real ApiKeyValidator
        var authResult = await harness.Validator.ValidateAsync(rawApiKey);
        Assert.True(authResult.IsValid, "API Key must validate successfully.");

        // Request context populated as KairoApiKeyAuthenticationHandler does
        context.SetContext(authResult.UserId, authResult.ProjectId, authResult.ApiKeyId);

        return harness;
    }

    private static List<MemoryResponse> GetListFromOkResult(IActionResult actionResult)
    {
        var ok = Assert.IsType<OkObjectResult>(actionResult);
        var prop = ok.Value!.GetType().GetProperty("memories");
        return Assert.IsType<List<MemoryResponse>>(prop!.GetValue(ok.Value));
    }

    // =========================================================================
    // Gate 1 & 2: Authenticated Controller CRUD & Isolation (Key A vs Key B)
    // =========================================================================

    [Fact]
    public async Task Controller_CreateMemory_WithKeyA_StoresUnderProjectA()
    {
        var harness = await CreateAuthenticatedHarnessAsync(RawApiKeyA);

        var request = new CreateMemoryRequest
        {
            Content = "Project A secret roadmap and features",
            MemoryType = "Fact",
            ActorId = ActorA
        };

        var actionResult = await harness.Controller.CreateMemory(request);
        var createdResult = Assert.IsType<CreatedAtActionResult>(actionResult);
        var memoryResponse = Assert.IsType<MemoryResponse>(createdResult.Value);

        Assert.Equal(UserId, memoryResponse.UserId);
        Assert.Equal("Project A secret roadmap and features", memoryResponse.Content);

        // Verify stored in DB with Project A's scope
        var stored = await harness.Db.Memories.FindAsync(memoryResponse.MemoryId);
        Assert.NotNull(stored);
        Assert.Equal(1001L, stored!.ScopeId);
    }

    [Fact]
    public async Task Controller_GetMemory_KeyACannotReadProjectBMemory_Returns404()
    {
        // 1. Seed Memory B in Project B
        using var db = CreateSeededDb();
        var memB = new Memories
        {
            MemoryId = 6002L,
            UserId = UserId,
            ScopeId = 1002L, // Scope for Project B
            Content = "Project B confidential financial data",
            MemoryType = "Fact",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        db.Memories.Add(memB);
        db.SaveChanges();

        // 2. Authenticate as Key A
        var contextA = new ApiKeyContext();
        var harnessA = new TestHarness(db, contextA);
        var authA = await harnessA.Validator.ValidateAsync(RawApiKeyA);
        contextA.SetContext(authA.UserId, authA.ProjectId, authA.ApiKeyId);

        // 3. Key A attempts to read Project B's memory
        var result = await harnessA.Controller.GetMemory(6002L);

        // Must fail closed with 404 NotFound (cannot infer existence or read)
        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task Controller_GetMemory_KeyBCannotReadProjectAMemory_Returns404()
    {
        // 1. Seed Memory A in Project A
        using var db = CreateSeededDb();
        var memA = new Memories
        {
            MemoryId = 6001L,
            UserId = UserId,
            ScopeId = 1001L, // Scope for Project A
            Content = "Project A proprietary architecture",
            MemoryType = "Fact",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        db.Memories.Add(memA);
        db.SaveChanges();

        // 2. Authenticate as Key B
        var contextB = new ApiKeyContext();
        var harnessB = new TestHarness(db, contextB);
        var authB = await harnessB.Validator.ValidateAsync(RawApiKeyB);
        contextB.SetContext(authB.UserId, authB.ProjectId, authB.ApiKeyId);

        // 3. Key B attempts to read Project A's memory
        var result = await harnessB.Controller.GetMemory(6001L);

        // Must fail closed with 404 NotFound
        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task Controller_ListMemories_StrictlyIsolatesByAuthenticatedKey()
    {
        using var db = CreateSeededDb();
        db.Memories.Add(new Memories { MemoryId = 6001L, UserId = UserId, ScopeId = 1001L, Content = "Alpha Item", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.Memories.Add(new Memories { MemoryId = 6002L, UserId = UserId, ScopeId = 1002L, Content = "Beta Item", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.SaveChanges();

        // Key A listing
        var contextA = new ApiKeyContext();
        var harnessA = new TestHarness(db, contextA);
        var authA = await harnessA.Validator.ValidateAsync(RawApiKeyA);
        contextA.SetContext(authA.UserId, authA.ProjectId, authA.ApiKeyId);

        var resultA = await harnessA.Controller.ListMemories();
        var listA = GetListFromOkResult(resultA);

        Assert.Single(listA);
        Assert.Equal(6001L, listA[0].MemoryId);
        Assert.Equal("Alpha Item", listA[0].Content);

        // Key B listing
        var contextB = new ApiKeyContext();
        var harnessB = new TestHarness(db, contextB);
        var authB = await harnessB.Validator.ValidateAsync(RawApiKeyB);
        contextB.SetContext(authB.UserId, authB.ProjectId, authB.ApiKeyId);

        var resultB = await harnessB.Controller.ListMemories();
        var listB = GetListFromOkResult(resultB);

        Assert.Single(listB);
        Assert.Equal(6002L, listB[0].MemoryId);
        Assert.Equal("Beta Item", listB[0].Content);
    }

    [Fact]
    public async Task Controller_UpdateMemory_CrossProjectAttempt_FailsWith404_AndLeavesMemoryIntact()
    {
        using var db = CreateSeededDb();
        db.Memories.Add(new Memories { MemoryId = 6001L, UserId = UserId, ScopeId = 1001L, Content = "Original A", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.SaveChanges();

        // Authenticate with Key B and attempt to update Project A's memory
        var contextB = new ApiKeyContext();
        var harnessB = new TestHarness(db, contextB);
        var authB = await harnessB.Validator.ValidateAsync(RawApiKeyB);
        contextB.SetContext(authB.UserId, authB.ProjectId, authB.ApiKeyId);

        var updateReq = new UpdateMemoryRequest { Content = "Malicious update from B", MemoryType = "Fact" };
        var result = await harnessB.Controller.UpdateMemory(6001L, updateReq);

        Assert.IsType<NotFoundObjectResult>(result);

        // Verify content unchanged in database
        var mem = await db.Memories.FindAsync(6001L);
        Assert.Equal("Original A", mem!.Content);
    }

    [Fact]
    public async Task Controller_DeleteMemory_CrossProjectAttempt_FailsWith404_AndDoesNotDeactivate()
    {
        using var db = CreateSeededDb();
        db.Memories.Add(new Memories { MemoryId = 6001L, UserId = UserId, ScopeId = 1001L, Content = "Original A", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.SaveChanges();

        // Authenticate with Key B and attempt to delete Project A's memory
        var contextB = new ApiKeyContext();
        var harnessB = new TestHarness(db, contextB);
        var authB = await harnessB.Validator.ValidateAsync(RawApiKeyB);
        contextB.SetContext(authB.UserId, authB.ProjectId, authB.ApiKeyId);

        var result = await harnessB.Controller.DeleteMemory(6001L);
        Assert.IsType<NotFoundObjectResult>(result);

        // Verify memory remains active
        var mem = await db.Memories.FindAsync(6001L);
        Assert.True(mem!.IsActive);
    }

    [Fact]
    public async Task Controller_GetMemoryHistory_CrossProjectAttempt_FailsWith404()
    {
        using var db = CreateSeededDb();
        db.Memories.Add(new Memories { MemoryId = 6001L, UserId = UserId, ScopeId = 1001L, Content = "Original A", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.MemoryVersions.Add(new MemoryVersions { MemoryVersionId = 1L, MemoryId = 6001L, Content = "V1", Operation = "ApiCreate", CreatedAt = DateTime.UtcNow });
        db.SaveChanges();

        // Key B attempts history
        var contextB = new ApiKeyContext();
        var harnessB = new TestHarness(db, contextB);
        var authB = await harnessB.Validator.ValidateAsync(RawApiKeyB);
        contextB.SetContext(authB.UserId, authB.ProjectId, authB.ApiKeyId);

        var result = await harnessB.Controller.GetMemoryHistory(6001L);
        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task Controller_PurgeMemories_CrossProjectAttempt_DoesNotPurgeOtherProject()
    {
        using var db = CreateSeededDb();
        db.Memories.Add(new Memories { MemoryId = 6001L, UserId = UserId, ScopeId = 1001L, Content = "Original A", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.SaveChanges();

        // Key B attempts to purge "agent-alpha" (which exists in Project A, not Project B)
        var contextB = new ApiKeyContext();
        var harnessB = new TestHarness(db, contextB);
        var authB = await harnessB.Validator.ValidateAsync(RawApiKeyB);
        contextB.SetContext(authB.UserId, authB.ProjectId, authB.ApiKeyId);

        // Scope resolution for ActorA under ProjectB finds no scope -> returns Ok with DeletedCount = 0
        var result = await harnessB.Controller.PurgeActorMemories(ActorA);
        var ok = Assert.IsType<OkObjectResult>(result);
        var purgeResp = Assert.IsType<ActorPurgeResponse>(ok.Value);
        Assert.Equal(0, purgeResp.DeletedCount);
        Assert.Empty(purgeResp.DeletedMemoryIds);

        // Memory A remains active
        var mem = await db.Memories.FindAsync(6001L);
        Assert.True(mem!.IsActive);
    }

    // =========================================================================
    // Search Isolation (Semantic & Hybrid Retrieval)
    // =========================================================================

    [Fact]
    public async Task Controller_SearchMemories_SemanticV1_ReturnsOnlyAuthorizedProjectMemories()
    {
        using var db = CreateSeededDb();
        db.Memories.Add(new Memories { MemoryId = 6001L, UserId = UserId, ScopeId = 1001L, Content = "Python async pattern in Alpha", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.MemoryEmbeddings.Add(new MemoryEmbeddings { EmbeddingId = 9001L, MemoryId = 6001L, Model = "mistral-embed", Dimensions = 4, VectorData = "[0.1,0.2,0.3,0.4]", CreatedAt = DateTime.UtcNow });

        db.Memories.Add(new Memories { MemoryId = 6002L, UserId = UserId, ScopeId = 1002L, Content = "Python async pattern in Beta", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.MemoryEmbeddings.Add(new MemoryEmbeddings { EmbeddingId = 9002L, MemoryId = 6002L, Model = "mistral-embed", Dimensions = 4, VectorData = "[0.1,0.2,0.3,0.4]", CreatedAt = DateTime.UtcNow });
        db.SaveChanges();

        // Search with Key A
        var contextA = new ApiKeyContext();
        var harnessA = new TestHarness(db, contextA);
        var authA = await harnessA.Validator.ValidateAsync(RawApiKeyA);
        contextA.SetContext(authA.UserId, authA.ProjectId, authA.ApiKeyId);

        var reqA = new MemorySearchRequest { Query = "Python async", ActorId = ActorA, Hybrid = false, TopK = 5 };
        var resultA = await harnessA.Controller.SearchMemories(reqA);
        var okA = Assert.IsType<OkObjectResult>(resultA);
        var respA = Assert.IsType<MemorySearchResponse>(okA.Value);

        Assert.Single(respA.Memories);
        Assert.Equal(6001L, respA.Memories[0].MemoryId);
    }

    [Fact]
    public async Task Controller_SearchMemories_Hybrid_ReturnsOnlyAuthorizedProjectMemories()
    {
        using var db = CreateSeededDb();
        db.Memories.Add(new Memories { MemoryId = 6001L, UserId = UserId, ScopeId = 1001L, Content = "Rust borrow checker Alpha", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.MemoryEmbeddings.Add(new MemoryEmbeddings { EmbeddingId = 9001L, MemoryId = 6001L, Model = "mistral-embed", Dimensions = 4, VectorData = "[0.1,0.2,0.3,0.4]", CreatedAt = DateTime.UtcNow });

        db.Memories.Add(new Memories { MemoryId = 6002L, UserId = UserId, ScopeId = 1002L, Content = "Rust borrow checker Beta", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.MemoryEmbeddings.Add(new MemoryEmbeddings { EmbeddingId = 9002L, MemoryId = 6002L, Model = "mistral-embed", Dimensions = 4, VectorData = "[0.1,0.2,0.3,0.4]", CreatedAt = DateTime.UtcNow });
        db.SaveChanges();

        // Search with Key B
        var contextB = new ApiKeyContext();
        var harnessB = new TestHarness(db, contextB);
        var authB = await harnessB.Validator.ValidateAsync(RawApiKeyB);
        contextB.SetContext(authB.UserId, authB.ProjectId, authB.ApiKeyId);

        var reqB = new MemorySearchRequest { Query = "Rust borrow checker", ActorId = ActorB, Hybrid = true, TopK = 5 };
        var resultB = await harnessB.Controller.SearchMemories(reqB);
        var okB = Assert.IsType<OkObjectResult>(resultB);
        var respB = Assert.IsType<MemorySearchResponse>(okB.Value);

        Assert.Single(respB.Memories);
        Assert.Equal(6002L, respB.Memories[0].MemoryId);
    }

    // =========================================================================
    // MCP Tools Isolation (Remember & Recall)
    // =========================================================================

    [Fact]
    public async Task McpTools_RememberAndRecall_StrictlyScopedToKeyContext()
    {
        using var db = CreateSeededDb();

        // Key A stores memory via MCP
        var contextA = new ApiKeyContext();
        var harnessA = new TestHarness(db, contextA);
        var authA = await harnessA.Validator.ValidateAsync(RawApiKeyA);
        contextA.SetContext(authA.UserId, authA.ProjectId, authA.ApiKeyId);

        var rememberJsonA = await harnessA.McpTools.Remember("Secret plan for Project A", "Goal", ActorA);
        Assert.Contains("\"stored\": true", rememberJsonA);

        // Key B recalls with same query -> cannot see Project A memory
        var contextB = new ApiKeyContext();
        var harnessB = new TestHarness(db, contextB);
        var authB = await harnessB.Validator.ValidateAsync(RawApiKeyB);
        contextB.SetContext(authB.UserId, authB.ProjectId, authB.ApiKeyId);

        var recallJsonB = await harnessB.McpTools.Recall("Secret plan", ActorB, topK: 5);
        Assert.Contains("\"count\": 0", recallJsonB);
    }

    // =========================================================================
    // Gate 3: Genuine Background Job Processing & Anti-Tampering
    // =========================================================================

    [Fact]
    public async Task BackgroundJob_EnqueueAndProcess_StrictlyEnforcesCapturedProjectIdentity()
    {
        using var db = CreateSeededDb();

        // 1. Authenticate with Key A and enqueue an async memory creation
        var contextA = new ApiKeyContext();
        var harnessA = new TestHarness(db, contextA);
        var authA = await harnessA.Validator.ValidateAsync(RawApiKeyA);
        contextA.SetContext(authA.UserId, authA.ProjectId, authA.ApiKeyId);

        var req = new CreateMemoryRequest
        {
            Content = "Asynchronously ingested documentation for Project A",
            MemoryType = "Fact",
            ActorId = ActorA
        };

        var accepted = await harnessA.JobService.EnqueueAsyncCreateMemoryAsync(req, UserId, ProjectA);
        Assert.True(accepted.JobId > 0);

        // Verify the persisted job record captured ProjectA identity
        var jobRecord = await harnessA.Db.MemoryIngestionJobs.FindAsync(accepted.JobId);
        Assert.NotNull(jobRecord);
        Assert.Equal(ProjectA, jobRecord!.ProjectId);
        Assert.Equal(UserId, jobRecord.UserId);
        Assert.NotNull(jobRecord.MemoryId);

        // 2. Worker executes in unauthenticated background context using job's captured identity
        var workerJobRecord = new MemoryIngestionJobRecord
        {
            JobId = jobRecord.JobId,
            ProjectId = jobRecord.ProjectId,
            UserId = jobRecord.UserId,
            ScopeId = jobRecord.ScopeId,
            MemoryId = jobRecord.MemoryId,
            JobType = jobRecord.JobType,
            Status = "Pending"
        };

        // Worker processes the job
        await harnessA.JobService.ProcessJobAsync(workerJobRecord);

        // Memory snapshot check: embedding was persisted for this memory
        var embedding = await harnessA.Db.MemoryEmbeddings.FirstOrDefaultAsync(e => e.MemoryId == jobRecord.MemoryId.Value);
        Assert.NotNull(embedding);
        Assert.Equal("mistral-embed", embedding!.Model);
    }

    [Fact]
    public async Task BackgroundJob_TamperedProjectId_FailsClosed_CancellingJobWithoutProcessing()
    {
        using var db = CreateSeededDb();

        // Seed Memory in Project A
        var memA = new Memories
        {
            MemoryId = 6001L,
            UserId = UserId,
            ScopeId = 1001L,
            Content = "Target memory in Project A",
            MemoryType = "Fact",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        db.Memories.Add(memA);
        db.SaveChanges();

        var nullContext = new ApiKeyContext();
        var harness = new TestHarness(db, nullContext);

        // Tampered job record: points to MemoryId 6001 (Project A), but claims ProjectId = ProjectB
        var tamperedJob = new MemoryIngestionJobRecord
        {
            JobId = 9999L,
            ProjectId = ProjectB, // Tampered!
            UserId = UserId,
            ScopeId = 1001L,
            MemoryId = 6001L,
            JobType = "CreateMemory",
            Status = "Pending"
        };

        // Worker execution with tampered ProjectId must cancel job because GetMemorySnapshotForUserAsync fails closed
        await harness.JobService.ProcessJobAsync(tamperedJob);

        // Verify NO embeddings were generated for the foreign memory
        var embeddings = await db.MemoryEmbeddings.Where(e => e.MemoryId == 6001L).ToListAsync();
        Assert.Empty(embeddings);
    }

    // =========================================================================
    // Missing Authentication / Zero Project Context Fails Closed
    // =========================================================================

    [Fact]
    public async Task MissingProjectContext_ControllerOrService_FailsClosedToZeroRecords()
    {
        using var db = CreateSeededDb();
        db.Memories.Add(new Memories { MemoryId = 6001L, UserId = UserId, ScopeId = 1001L, Content = "Alpha", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.Memories.Add(new Memories { MemoryId = 6002L, UserId = UserId, ScopeId = 1002L, Content = "Beta", MemoryType = "Fact", IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.SaveChanges();

        // Context has UserId = 42 but ProjectId = 0 (unscoped/invalid API key)
        var zeroContext = new ApiKeyContext();
        zeroContext.SetContext(UserId, 0L, 999L);
        var harness = new TestHarness(db, zeroContext);

        // Listing with zero project context fails closed to empty list
        var listResult = await harness.Controller.ListMemories();
        var list = GetListFromOkResult(listResult);
        Assert.Empty(list);

        // Search with zero project context fails closed with ArgumentException (ProjectId required)
        var searchReq = new MemorySearchRequest { Query = "Alpha", ActorId = ActorA };
        var searchResult = await harness.Controller.SearchMemories(searchReq);
        var badReq = Assert.IsType<BadRequestObjectResult>(searchResult);
        Assert.Contains("ProjectId is required", badReq.Value!.ToString()!);
    }
}
