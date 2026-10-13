using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Kairo.Infrastructure.Providers;
using Kairo.Infrastructure.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Moq.Protected;
using Xunit;

namespace Kairo.Tests;

public class Phase4BProviderUnitTests
{
    // ══════════════════════════════════════════════════════════════════════════
    // 1. PROVIDER REGISTRATION & DI CONFIGURATION VALIDATION
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public void DI_DefaultConfiguration_ResolvesMistralLlmAndEmbeddingProviders()
    {
        var services = new ServiceCollection();
        services.AddLogging();

        services.Configure<ProviderOptions>(opts =>
        {
            opts.DefaultLlmProvider = "Mistral";
            opts.DefaultEmbeddingProvider = "Mistral";
        });
        services.Configure<MistralOptions>(opts =>
        {
            opts.ApiKey = "test-key";
            opts.Model = "mistral-small-latest";
        });
        services.Configure<MistralEmbeddingOptions>(opts =>
        {
            opts.ApiKey = "test-key";
            opts.Model = "mistral-embed";
        });

        services.AddHttpClient<MistralLlmProvider>();
        services.AddHttpClient<MistralEmbeddingProvider>();

        services.AddScoped<ILlmProvider>(sp => sp.GetRequiredService<MistralLlmProvider>());
        services.AddScoped<IEmbeddingProvider>(sp => sp.GetRequiredService<MistralEmbeddingProvider>());
        services.AddScoped<IEmbeddingGenerator, MistralEmbeddingGenerator>();
        services.AddScoped<IMemoryExtractor, MistralMemoryExtractor>();

        using var provider = services.BuildServiceProvider();

        var llmProvider = provider.GetRequiredService<ILlmProvider>();
        var embeddingProvider = provider.GetRequiredService<IEmbeddingProvider>();
        var embeddingGen = provider.GetRequiredService<IEmbeddingGenerator>();

        Assert.NotNull(llmProvider);
        Assert.Equal("Mistral", llmProvider.ProviderName);
        Assert.NotNull(embeddingProvider);
        Assert.Equal("Mistral", embeddingProvider.ProviderName);
        Assert.Equal(1024, embeddingProvider.ExpectedDimensions);
        Assert.Equal("mistral-embed", embeddingProvider.ModelName);
        Assert.NotNull(embeddingGen);
    }

    [Fact]
    public void Configuration_InvalidLlmProviderName_ThrowsInvalidOperationException()
    {
        var options = new ProviderOptions { DefaultLlmProvider = "UnsupportedVendor" };

        var action = () =>
        {
            if (!string.Equals(options.DefaultLlmProvider, "Mistral", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException($"Configured LLM provider '{options.DefaultLlmProvider}' is not supported. Supported providers: Mistral.");
            }
        };

        var ex = Assert.Throws<InvalidOperationException>(action);
        Assert.Contains("UnsupportedVendor", ex.Message);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 2. MISTRAL EMBEDDING PROVIDER TESTS (MOCKED HTTP TRANSPORT)
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task MistralEmbeddingProvider_GenerateEmbedding_ParsesVectorAndValidates1024Dimensions()
    {
        var dummyVector = new float[1024];
        dummyVector[0] = 0.42f;
        dummyVector[1023] = 0.99f;

        var mockResponseJson = JsonSerializer.Serialize(new
        {
            data = new[]
            {
                new { embedding = dummyVector }
            }
        });

        var client = CreateMockHttpClient(HttpStatusCode.OK, mockResponseJson);
        var options = Options.Create(new MistralEmbeddingOptions { ApiKey = "secret-key", Model = "mistral-embed" });
        var provider = new MistralEmbeddingProvider(client, options);

        var result = await provider.GenerateEmbeddingAsync("Test input text");

        Assert.Equal(1024, result.Length);
        Assert.Equal(0.42f, result[0]);
        Assert.Equal(0.99f, result[1023]);
    }

    [Fact]
    public async Task MistralEmbeddingProvider_MismatchedDimension_ThrowsIncompatibleEmbeddingDimensionException()
    {
        var invalidVector = new float[512]; // Expected 1024

        var mockResponseJson = JsonSerializer.Serialize(new
        {
            data = new[]
            {
                new { embedding = invalidVector }
            }
        });

        var client = CreateMockHttpClient(HttpStatusCode.OK, mockResponseJson);
        var options = Options.Create(new MistralEmbeddingOptions { ApiKey = "secret-key", Model = "mistral-embed" });
        var provider = new MistralEmbeddingProvider(client, options);

        var ex = await Assert.ThrowsAsync<IncompatibleEmbeddingDimensionException>(
            () => provider.GenerateEmbeddingAsync("Test text"));

        Assert.Equal(1024, ex.ExpectedDimensions);
        Assert.Equal(512, ex.ActualDimensions);
        Assert.DoesNotContain("secret-key", ex.Message);
    }

    [Fact]
    public async Task MistralEmbeddingProvider_Http401_ThrowsProviderAuthenticationException()
    {
        var client = CreateMockHttpClient(HttpStatusCode.Unauthorized, "{\"error\":\"Unauthorized\"}");
        var options = Options.Create(new MistralEmbeddingOptions { ApiKey = "bad-key", Model = "mistral-embed" });
        var provider = new MistralEmbeddingProvider(client, options);

        var ex = await Assert.ThrowsAsync<ProviderAuthenticationException>(
            () => provider.GenerateEmbeddingAsync("Test text"));

        Assert.Equal(401, ex.StatusCode);
        Assert.DoesNotContain("bad-key", ex.Message);
    }

    [Fact]
    public async Task MistralEmbeddingProvider_Http429_ThrowsProviderTransientException()
    {
        var client = CreateMockHttpClient((HttpStatusCode)429, "{\"error\":\"Rate limit exceeded\"}");
        var options = Options.Create(new MistralEmbeddingOptions { ApiKey = "test-key" });
        var provider = new MistralEmbeddingProvider(client, options);

        var ex = await Assert.ThrowsAsync<ProviderTransientException>(
            () => provider.GenerateEmbeddingAsync("Test text"));

        Assert.Equal(429, ex.StatusCodeNumber);
        Assert.IsAssignableFrom<HttpRequestException>(ex);
    }

    [Fact]
    public async Task MistralEmbeddingProvider_Http503_ThrowsProviderTransientException()
    {
        var client = CreateMockHttpClient(HttpStatusCode.ServiceUnavailable, "{\"error\":\"Service Unavailable\"}");
        var options = Options.Create(new MistralEmbeddingOptions { ApiKey = "test-key" });
        var provider = new MistralEmbeddingProvider(client, options);

        var ex = await Assert.ThrowsAsync<ProviderTransientException>(
            () => provider.GenerateEmbeddingAsync("Test text"));

        Assert.Equal(503, ex.StatusCodeNumber);
        Assert.IsAssignableFrom<HttpRequestException>(ex);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 3. MISTRAL LLM PROVIDER TESTS (MOCKED HTTP TRANSPORT)
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task MistralLlmProvider_GenerateChatCompletion_SendsCorrectJsonPayloadAndReturnsContent()
    {
        var responseJson = JsonSerializer.Serialize(new
        {
            choices = new[]
            {
                new
                {
                    message = new
                    {
                        content = "{\"result\":\"success\"}"
                    }
                }
            }
        });

        string? requestBody = null;
        string? authScheme = null;
        string? authParam = null;

        var mockHandler = new Mock<HttpMessageHandler>();
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Returns<HttpRequestMessage, CancellationToken>(async (req, ct) =>
            {
                authScheme = req.Headers.Authorization?.Scheme;
                authParam = req.Headers.Authorization?.Parameter;
                if (req.Content != null)
                {
                    requestBody = await req.Content.ReadAsStringAsync(ct);
                }
                return new HttpResponseMessage
                {
                    StatusCode = HttpStatusCode.OK,
                    Content = new StringContent(responseJson)
                };
            });

        var client = new HttpClient(mockHandler.Object);
        var options = Options.Create(new MistralOptions { ApiKey = "llm-key", Model = "mistral-small-latest" });
        var provider = new MistralLlmProvider(client, options);

        var request = new LlmCompletionRequest
        {
            SystemPrompt = "System instruction",
            UserPrompt = "User turn",
            Temperature = 0.1,
            EnforceJsonOutput = true
        };

        var result = await provider.GenerateChatCompletionAsync(request);

        Assert.Equal("{\"result\":\"success\"}", result);
        Assert.Equal("Bearer", authScheme);
        Assert.Equal("llm-key", authParam);
        Assert.NotNull(requestBody);
        Assert.Contains("json_object", requestBody);
        Assert.Contains("System instruction", requestBody);
        Assert.Contains("User turn", requestBody);
    }

    [Fact]
    public async Task MistralLlmProvider_Http401_ThrowsProviderAuthenticationException()
    {
        var client = CreateMockHttpClient(HttpStatusCode.Unauthorized, "{\"error\":\"Invalid API key\"}");
        var options = Options.Create(new MistralOptions { ApiKey = "invalid-token" });
        var provider = new MistralLlmProvider(client, options);

        var ex = await Assert.ThrowsAsync<ProviderAuthenticationException>(
            () => provider.GenerateChatCompletionAsync(new LlmCompletionRequest { UserPrompt = "Hello" }));

        Assert.Equal(401, ex.StatusCode);
        Assert.DoesNotContain("invalid-token", ex.Message);
    }

    [Fact]
    public async Task MistralLlmProvider_Http500_ThrowsProviderTransientException()
    {
        var client = CreateMockHttpClient(HttpStatusCode.InternalServerError, "Internal Server Error");
        var options = Options.Create(new MistralOptions { ApiKey = "valid-key" });
        var provider = new MistralLlmProvider(client, options);

        var ex = await Assert.ThrowsAsync<ProviderTransientException>(
            () => provider.GenerateChatCompletionAsync(new LlmCompletionRequest { UserPrompt = "Hello" }));

        Assert.Equal(500, ex.StatusCodeNumber);
        Assert.IsAssignableFrom<HttpRequestException>(ex);
    }

    [Fact]
    public async Task MistralLlmProvider_Cancellation_PropagatesOperationCanceledException()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var mockHandler = new Mock<HttpMessageHandler>();
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ThrowsAsync(new OperationCanceledException(cts.Token));

        var client = new HttpClient(mockHandler.Object);
        var options = Options.Create(new MistralOptions { ApiKey = "valid-key" });
        var provider = new MistralLlmProvider(client, options);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => provider.GenerateChatCompletionAsync(new LlmCompletionRequest { UserPrompt = "Hello" }, cts.Token));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 4. SERVICE ADAPTER DELEGATION TESTS
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task MistralEmbeddingGenerator_DelegatesToEmbeddingProvider_ReturnsVector()
    {
        var mockProvider = new Mock<IEmbeddingProvider>();
        mockProvider.Setup(p => p.ModelName).Returns("mistral-embed");
        mockProvider.Setup(p => p.ExpectedDimensions).Returns(1024);
        mockProvider.Setup(p => p.GenerateEmbeddingAsync("text", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new float[] { 0.1f, 0.2f });

        var generator = new MistralEmbeddingGenerator(mockProvider.Object);

        Assert.Equal("mistral-embed", generator.ModelName);
        Assert.Equal(1024, generator.ExpectedDimensions);

        var result = await generator.GenerateAsync("text");
        Assert.Equal(new float[] { 0.1f, 0.2f }, result);
        mockProvider.Verify(p => p.GenerateEmbeddingAsync("text", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task MistralMemoryExtractor_DelegatesToLlmProvider_DeserializesMemories()
    {
        var mockLlm = new Mock<ILlmProvider>();
        var sampleJson = """
        {
          "memories": [
            { "content": "User prefers dark mode", "memoryType": "Preference" },
            { "content": "Project uses SQL Server", "memoryType": "Fact" }
          ]
        }
        """;

        mockLlm.Setup(l => l.GenerateChatCompletionAsync(It.IsAny<LlmCompletionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(sampleJson);

        var extractor = new MistralMemoryExtractor(mockLlm.Object);
        var messages = new List<CreateMessageRequest>
        {
            new() { Role = "user", Content = "I prefer dark mode and we use SQL Server." }
        };

        var results = await extractor.ExtractAsync(messages);

        Assert.Equal(2, results.Count);
        Assert.Equal("User prefers dark mode", results[0].Content);
        Assert.Equal("Preference", results[0].MemoryType);
        Assert.Equal("Project uses SQL Server", results[1].Content);
        Assert.Equal("Fact", results[1].MemoryType);
    }

    [Fact]
    public async Task MistralEntityExtractionService_DelegatesToLlmProvider_DeserializesEntities()
    {
        var mockLlm = new Mock<ILlmProvider>();
        var sampleJson = """
        {
          "entities": [
            { "displayName": "PostgreSQL", "normalizedName": "postgresql", "entityType": "TECHNOLOGY" },
            { "displayName": "Alice", "normalizedName": "alice", "entityType": "PERSON" }
          ],
          "relationships": [
            { "source": "Alice", "target": "PostgreSQL", "relationshipType": "uses", "confidence": 0.9 }
          ]
        }
        """;

        mockLlm.Setup(l => l.GenerateChatCompletionAsync(It.IsAny<LlmCompletionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(sampleJson);

        var logger = new Mock<ILogger<MistralEntityExtractionService>>();
        var service = new MistralEntityExtractionService(mockLlm.Object, logger.Object);

        var result = await service.ExtractFullAsync("Alice uses PostgreSQL.");

        Assert.Equal(2, result.Entities.Count);
        Assert.Equal("PostgreSQL", result.Entities[0].DisplayName);
        Assert.Equal("TECHNOLOGY", result.Entities[0].EntityType);
        Assert.Single(result.Relationships);
        Assert.Equal("Alice", result.Relationships[0].Source);
        Assert.Equal("uses", result.Relationships[0].RelationshipType);
    }

    [Fact]
    public async Task MistralMemoryConsolidationEvaluator_DelegatesToLlmProvider_Deserializes4ActionSchema()
    {
        var mockLlm = new Mock<ILlmProvider>();
        var sampleJson = """
        {
          "action": "Update",
          "canonicalContent": "User moved to London",
          "reason": "New location supersedes old location"
        }
        """;

        mockLlm.Setup(l => l.GenerateChatCompletionAsync(It.IsAny<LlmCompletionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(sampleJson);

        var evaluator = new MistralMemoryConsolidationEvaluator(mockLlm.Object);
        var candidate = new MemoryConsolidationCandidate
        {
            ContentA = "User lives in Paris",
            ContentB = "User moved to London"
        };

        var result = await evaluator.EvaluateAsync(candidate);

        Assert.Equal(ConsolidationAction.Update, result.Action);
        Assert.Equal("User moved to London", result.CanonicalContent);
        Assert.Equal("New location supersedes old location", result.Reason);
    }

    [Fact]
    public async Task MistralMemoryRelevanceEvaluator_DelegatesToLlmProvider_FiltersRelevantMemories()
    {
        var mockLlm = new Mock<ILlmProvider>();
        var sampleJson = """
        {
          "relevantMemoryIds": [101]
        }
        """;

        mockLlm.Setup(l => l.GenerateChatCompletionAsync(It.IsAny<LlmCompletionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(sampleJson);

        var evaluator = new MistralMemoryRelevanceEvaluator(mockLlm.Object);
        var candidates = new List<RetrievedMemory>
        {
            new() { MemoryId = 101, Content = "Relevant memory" },
            new() { MemoryId = 102, Content = "Irrelevant noise" }
        };

        var filtered = await evaluator.EvaluateAsync("What is relevant?", candidates);

        Assert.Single(filtered);
        Assert.Equal(101, filtered[0].MemoryId);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 5. EMBEDDING-SPACE SAFETY & MODEL REJECTION TESTS
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task MemoryService_CreateMemory_RejectsDimensionMismatchBeforePersistence()
    {
        var memoryRepo = new Mock<IMemoryRepository>();
        var userRepo = new Mock<IUserRepository>();
        userRepo.Setup(u => u.ExistsByIdAsync(1)).ReturnsAsync(true);

        var scopeResolver = new Mock<IScopeResolutionService>();
        scopeResolver.Setup(s => s.GetOrCreateScopeAsync(100, "act-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(10L);

        // Generator claims 1024 dimensions, but returns 512!
        var mockGen = new Mock<IEmbeddingGenerator>();
        var metaMock = mockGen.As<IEmbeddingMetadataProvider>();
        metaMock.Setup(m => m.ModelName).Returns("mistral-embed");
        metaMock.Setup(m => m.ExpectedDimensions).Returns(1024);
        mockGen.Setup(g => g.GenerateAsync(It.IsAny<string>())).ReturnsAsync(new float[512]);

        var service = new MemoryService(
            memoryRepo.Object,
            userRepo.Object,
            mockGen.Object,
            new SemanticSimilarityService(),
            new MemoryRetrievalService(memoryRepo.Object, mockGen.Object, new SemanticSimilarityService(), new Mock<IMemoryRelevanceEvaluator>().Object),
            scopeResolver.Object);

        var request = new CreateMemoryRequest
        {
            Content = "Test memory",
            MemoryType = "Fact",
            ActorId = "act-1"
        };

        var ex = await Assert.ThrowsAsync<IncompatibleEmbeddingDimensionException>(
            () => service.CreateMemoryAsync(request, userId: 1, projectId: 100));

        Assert.Equal(1024, ex.ExpectedDimensions);
        Assert.Equal(512, ex.ActualDimensions);

        // Ensure database write was NEVER attempted
        memoryRepo.Verify(r => r.CreateAsync(It.IsAny<long>(), It.IsAny<ExtractedMemory>(), It.IsAny<long?>(), It.IsAny<long?>(), It.IsAny<DateTime?>(), It.IsAny<string?>(), It.IsAny<DateTime?>(), It.IsAny<List<string>?>()), Times.Never);
    }

    [Fact]
    public async Task MemoryService_SemanticCheck_ExcludesMemoriesWithDifferentModelName()
    {
        var memoryRepo = new Mock<IMemoryRepository>();
        var userRepo = new Mock<IUserRepository>();
        userRepo.Setup(u => u.ExistsByIdAsync(1)).ReturnsAsync(true);
        var scopeResolver = new Mock<IScopeResolutionService>();
        scopeResolver.Setup(s => s.GetOrCreateScopeAsync(100, "act-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(10L);

        var mockGen = new Mock<IEmbeddingGenerator>();
        var metaMock = mockGen.As<IEmbeddingMetadataProvider>();
        metaMock.Setup(m => m.ModelName).Returns("mistral-embed");
        metaMock.Setup(m => m.ExpectedDimensions).Returns(2);
        // Returns identical vector [1.0, 0.0]
        mockGen.Setup(g => g.GenerateAsync(It.IsAny<string>())).ReturnsAsync(new float[] { 1.0f, 0.0f });

        // Existing memory in DB has identical vector AND same dimension (2), but belongs to "openai-ada" space!
        memoryRepo.Setup(r => r.GetActiveMemoryEmbeddingsAsync(1, 10L))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 999,
                    Content = "Similar text",
                    Model = "openai-ada", // INCOMPATIBLE MODEL
                    Dimensions = 2,
                    Embedding = new float[] { 1.0f, 0.0f }
                }
            });

        memoryRepo.Setup(r => r.CreateAsync(It.IsAny<long>(), It.IsAny<ExtractedMemory>(), It.IsAny<long?>(), It.IsAny<long?>(), It.IsAny<DateTime?>(), It.IsAny<string?>(), It.IsAny<DateTime?>(), It.IsAny<List<string>?>()))
            .ReturnsAsync(1001L);
        memoryRepo.Setup(r => r.GetMemorySnapshotForUserAsync(
                It.IsAny<long>(), It.IsAny<long>(), It.IsAny<long?>(), It.IsAny<long?>()))
            .ReturnsAsync(new MemorySnapshot { MemoryId = 1001L, Content = "Test memory", MemoryType = "Fact" });

        var service = new MemoryService(
            memoryRepo.Object,
            userRepo.Object,
            mockGen.Object,
            new SemanticSimilarityService(),
            new MemoryRetrievalService(memoryRepo.Object, mockGen.Object, new SemanticSimilarityService(), new Mock<IMemoryRelevanceEvaluator>().Object),
            scopeResolver.Object);

        var request = new CreateMemoryRequest
        {
            Content = "Test memory",
            MemoryType = "Fact",
            ActorId = "act-1"
        };

        var (created, duplicate) = await service.CreateMemoryAsync(request, 1, 100L);

        // Memory must NOT be marked duplicate because the existing vector is in an incompatible model space!
        Assert.Null(duplicate);
        Assert.NotNull(created);
        Assert.Equal(1001L, created.MemoryId);
    }

    [Fact]
    public async Task HybridRetrieval_SemanticChannel_ExcludesDifferentModel_PreservesLexicalBM25()
    {
        var memoryRepo = new Mock<IMemoryRepository>();
        var embeddingGen = new Mock<IEmbeddingGenerator>();
        var metaMock = embeddingGen.As<IEmbeddingMetadataProvider>();
        metaMock.Setup(m => m.ModelName).Returns("mistral-embed");
        metaMock.Setup(m => m.ExpectedDimensions).Returns(2);

        embeddingGen.Setup(e => e.GenerateAsync("PostgreSQL"))
            .ReturnsAsync(new float[] { 1.0f, 0.0f });

        // Stored memory 100 has model = "legacy-model", same dimension (2)
        memoryRepo.Setup(r => r.GetActiveMemoryEmbeddingsAsync(1, 50L))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 100,
                    Content = "PostgreSQL indexing guide",
                    MemoryType = "Fact",
                    Model = "legacy-model", // INCOMPATIBLE MODEL
                    Dimensions = 2,
                    Embedding = new float[] { 1.0f, 0.0f }
                }
            });

        // Keyword BM25 channel DOES return memory 100!
        var keywordMock = new Mock<IKeywordSearchRepository>();
        keywordMock.Setup(k => k.SearchAsync(1, "PostgreSQL", 50L, It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<KeywordSearchResult>
            {
                new() { MemoryId = 100, Content = "PostgreSQL indexing guide", MemoryType = "Fact", RawScore = 15.0 }
            });

        var entityRepo = new Mock<IEntityRepository>();
        entityRepo.Setup(e => e.GetEntitiesForMemoriesAsync(It.IsAny<IEnumerable<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, List<EntityData>>());

        var relEval = new Mock<IMemoryRelevanceEvaluator>();
        relEval.Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string _, List<RetrievedMemory> c) => c);

        var hybrid = new HybridRetrievalService(
            memoryRepo.Object,
            embeddingGen.Object,
            new SemanticSimilarityService(),
            relEval.Object,
            keywordMock.Object,
            entityRepo.Object,
            new Mock<IEntityExtractionService>().Object,
            new Mock<ILogger<HybridRetrievalService>>().Object);

        var results = await hybrid.RetrieveAsync(1, 10, "PostgreSQL", topK: 5, scopeId: 50L);

        // Memory 100 MUST still be returned because BM25 matched, even though semantic vector was excluded!
        Assert.Single(results);
        Assert.Equal(100, results[0].MemoryId);
    }

    [Fact]
    public async Task MemoryConsolidation_Consolidate_ExcludesPairWithMismatchedModels()
    {
        var repo = new Mock<IMemoryRepository>();

        var memories = new List<MemoryEmbeddingData>
        {
            new() { MemoryId = 1, Content = "Fact A", Dimensions = 2, Model = "mistral-embed", Embedding = new float[] { 1f, 0f } },
            new() { MemoryId = 2, Content = "Fact B", Dimensions = 2, Model = "openai-ada",   Embedding = new float[] { 1f, 0f } }
        };

        repo.Setup(r => r.GetActiveMemoryEmbeddingsAsync(1, 10L))
            .ReturnsAsync(memories);

        var service = new MemoryConsolidationService(
            repo.Object,
            new SemanticSimilarityService());

        var result = await service.ConsolidateAsync(
            new MemoryConsolidationRequest { UserId = 1, ScopeId = 10L });

        // Pair was skipped due to mismatched models!
        Assert.Equal(0, result.CandidatePairs);
        Assert.Empty(result.Candidates);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 6. PHASE 4A WORKER RETRY & ERROR BEHAVIOR REGRESSION TESTS
    // ══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Phase4AWorker_ProviderTransientException_IsCaughtAsHttpRequestExceptionAndRetried()
    {
        var jobRepo = new Mock<IIngestionJobRepository>();
        var memoryRepo = new Mock<IMemoryRepository>();
        var embeddingGen = new Mock<IEmbeddingGenerator>();
        var tx = new Mock<ITransactionCoordinator>();
        var logger = new Mock<ILogger<MemoryJobService>>();

        var job = new MemoryIngestionJobRecord
        {
            JobId = 42301L,
            JobType = "CreateMemory",
            MemoryId = 42L,
            UserId = 1,
            ProjectId = 100,
            Attempts = 1
        };

        memoryRepo.Setup(m => m.GetMemorySnapshotForUserAsync(42L, 1, 100, It.IsAny<long?>()))
            .ReturnsAsync(new MemorySnapshot { MemoryId = 42L, Content = "Text" });

        // Provider throws ProviderTransientException (429 Rate Limit)
        embeddingGen.Setup(e => e.GenerateAsync("Text"))
            .ThrowsAsync(new ProviderTransientException("Mistral", "Rate limit exceeded", 429));

        var jobService = new MemoryJobService(
            jobRepo.Object,
            memoryRepo.Object,
            new Mock<IScopeResolutionService>().Object,
            embeddingGen.Object,
            tx.Object,
            logger.Object);

        await jobService.ProcessJobAsync(job);

        // MemoryJobService's catch (HttpRequestException httpEx) block MUST have executed and set canRetry: true!
        jobRepo.Verify(r => r.FailJobAsync(
            job.JobId,
            "Transient network failure contacting provider.",
            true, // canRetry MUST BE TRUE
            It.IsAny<TimeSpan?>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Phase4AWorker_ProviderAuthenticationException_FailsJobPermanently()
    {
        var jobRepo = new Mock<IIngestionJobRepository>();
        var memoryRepo = new Mock<IMemoryRepository>();
        var embeddingGen = new Mock<IEmbeddingGenerator>();
        var tx = new Mock<ITransactionCoordinator>();
        var logger = new Mock<ILogger<MemoryJobService>>();

        var job = new MemoryIngestionJobRecord
        {
            JobId = 42302L,
            JobType = "CreateMemory",
            MemoryId = 42L,
            UserId = 1,
            ProjectId = 100,
            Attempts = 1
        };

        memoryRepo.Setup(m => m.GetMemorySnapshotForUserAsync(42L, 1, 100, It.IsAny<long?>()))
            .ReturnsAsync(new MemorySnapshot { MemoryId = 42L, Content = "Text" });

        // Provider throws ProviderAuthenticationException (401 Bad Key)
        embeddingGen.Setup(e => e.GenerateAsync("Text"))
            .ThrowsAsync(new ProviderAuthenticationException("Mistral", "Unauthorized"));

        var jobService = new MemoryJobService(
            jobRepo.Object,
            memoryRepo.Object,
            new Mock<IScopeResolutionService>().Object,
            embeddingGen.Object,
            tx.Object,
            logger.Object);

        await jobService.ProcessJobAsync(job);

        // Permanent failure: canRetry MUST BE FALSE!
        jobRepo.Verify(r => r.FailJobAsync(
            job.JobId,
            It.Is<string>(msg => msg.Contains("Unauthorized")),
            false, // canRetry MUST BE FALSE
            It.IsAny<TimeSpan?>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Phase4AWorker_IncompatibleEmbeddingDimensionException_FailsJobPermanently()
    {
        var jobRepo = new Mock<IIngestionJobRepository>();
        var memoryRepo = new Mock<IMemoryRepository>();
        var embeddingGen = new Mock<IEmbeddingGenerator>();
        var tx = new Mock<ITransactionCoordinator>();
        var logger = new Mock<ILogger<MemoryJobService>>();

        var job = new MemoryIngestionJobRecord
        {
            JobId = 42303L,
            JobType = "CreateMemory",
            MemoryId = 42L,
            UserId = 1,
            ProjectId = 100,
            Attempts = 1
        };

        memoryRepo.Setup(m => m.GetMemorySnapshotForUserAsync(42L, 1, 100, It.IsAny<long?>()))
            .ReturnsAsync(new MemorySnapshot { MemoryId = 42L, Content = "Text" });

        // Dimension mismatch
        embeddingGen.Setup(e => e.GenerateAsync("Text"))
            .ThrowsAsync(new IncompatibleEmbeddingDimensionException("mistral-embed", 1024, 768));

        var jobService = new MemoryJobService(
            jobRepo.Object,
            memoryRepo.Object,
            new Mock<IScopeResolutionService>().Object,
            embeddingGen.Object,
            tx.Object,
            logger.Object);

        await jobService.ProcessJobAsync(job);

        // Permanent failure: dimension mismatch must never retry
        jobRepo.Verify(r => r.FailJobAsync(
            job.JobId,
            It.Is<string>(msg => msg.Contains("1024")),
            false, // canRetry MUST BE FALSE
            It.IsAny<TimeSpan?>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── Helper ────────────────────────────────────────────────────────────────
    private static HttpClient CreateMockHttpClient(HttpStatusCode statusCode, string content)
    {
        var mockHandler = new Mock<HttpMessageHandler>();
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = statusCode,
                Content = new StringContent(content)
            });

        return new HttpClient(mockHandler.Object);
    }
}
