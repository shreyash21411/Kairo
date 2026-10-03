using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Moq;
using Xunit;

namespace Kairo.Tests;

public class SemanticSearchUnitTests
{
    private readonly Mock<IMemoryRepository> _memoryRepoMock = new();
    private readonly Mock<IUserRepository> _userRepoMock = new();
    private readonly Mock<IEmbeddingGenerator> _embeddingGenMock = new();
    private readonly SemanticSimilarityService _similarityService = new();
    private readonly Mock<IMemoryRelevanceEvaluator> _relevanceEvalMock = new();
    private readonly Mock<IScopeResolutionService> _scopeResMock = new();

    private MemoryService CreateMemoryService()
    {
        var retrievalService = new MemoryRetrievalService(
            _memoryRepoMock.Object,
            _embeddingGenMock.Object,
            _similarityService,
            _relevanceEvalMock.Object);

        return new MemoryService(
            _memoryRepoMock.Object,
            _userRepoMock.Object,
            _embeddingGenMock.Object,
            _similarityService,
            retrievalService,
            _scopeResMock.Object);
    }

    [Fact]
    public async Task Test1_SearchExactSemanticMatch_ReturnsMemory()
    {
        // Arrange
        var service = CreateMemoryService();
        const long userId = 10;
        const long projectId = 100;
        const string actorId = "actor_search_test";
        const long scopeId = 555;
        const string query = "Which database does the user prefer?";
        const string memoryText = "I prefer PostgreSQL for my backend applications.";

        _scopeResMock
            .Setup(s => s.ResolveScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeId);

        var queryVec = new float[] { 1.0f, 0.0f, 0.0f };
        var memVec = new float[] { 1.0f, 0.0f, 0.0f };

        _embeddingGenMock
            .Setup(e => e.GenerateAsync(query))
            .ReturnsAsync(queryVec);

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 1,
                    Content = memoryText,
                    MemoryType = "Preference",
                    Model = "mistral-embed",
                    Dimensions = 3,
                    Embedding = memVec
                }
            });

        _relevanceEvalMock
            .Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string q, List<RetrievedMemory> c) => c);

        // Act
        var result = await service.SearchMemoriesAsync(
            new MemorySearchRequest { Query = query, ActorId = actorId, TopK = 5 },
            userId,
            projectId);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(1, result.Count);
        Assert.Equal(memoryText, result.Memories[0].Content);
    }

    [Fact]
    public async Task Test2_SearchParaphrase_ReturnsMemory()
    {
        // Arrange
        var service = CreateMemoryService();
        const long userId = 10;
        const long projectId = 100;
        const string actorId = "actor_search_test";
        const long scopeId = 555;
        const string query = "What database does the user like using?";
        const string memoryText = "I prefer PostgreSQL for my backend applications.";

        _scopeResMock
            .Setup(s => s.ResolveScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeId);

        _embeddingGenMock
            .Setup(e => e.GenerateAsync(query))
            .ReturnsAsync(new float[] { 0.95f, 0.05f, 0.0f });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 1,
                    Content = memoryText,
                    MemoryType = "Preference",
                    Model = "mistral-embed",
                    Dimensions = 3,
                    Embedding = new float[] { 1.0f, 0.0f, 0.0f }
                }
            });

        _relevanceEvalMock
            .Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string q, List<RetrievedMemory> c) => c);

        // Act
        var result = await service.SearchMemoriesAsync(
            new MemorySearchRequest { Query = query, ActorId = actorId, TopK = 5 },
            userId,
            projectId);

        // Assert
        Assert.Single(result.Memories);
        Assert.Equal(memoryText, result.Memories[0].Content);
    }

    [Fact]
    public async Task Test3_SearchContextualParaphrase_ReturnsMemory()
    {
        // Arrange
        var service = CreateMemoryService();
        const long userId = 10;
        const long projectId = 100;
        const string actorId = "actor_search_test";
        const long scopeId = 555;
        const string query = "Tell me about the user's database preference.";
        const string memoryText = "I prefer PostgreSQL for my backend applications.";

        _scopeResMock
            .Setup(s => s.ResolveScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeId);

        _embeddingGenMock
            .Setup(e => e.GenerateAsync(query))
            .ReturnsAsync(new float[] { 0.88f, 0.12f, 0.0f });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 1,
                    Content = memoryText,
                    MemoryType = "Preference",
                    Model = "mistral-embed",
                    Dimensions = 3,
                    Embedding = new float[] { 1.0f, 0.0f, 0.0f }
                }
            });

        _relevanceEvalMock
            .Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string q, List<RetrievedMemory> c) => c);

        // Act
        var result = await service.SearchMemoriesAsync(
            new MemorySearchRequest { Query = query, ActorId = actorId, TopK = 5 },
            userId,
            projectId);

        // Assert
        Assert.Single(result.Memories);
        Assert.Equal(memoryText, result.Memories[0].Content);
    }

    [Fact]
    public async Task Test4_UnrelatedQueryRejection_ReturnsEmpty()
    {
        // Arrange
        var service = CreateMemoryService();
        const long userId = 10;
        const long projectId = 100;
        const string actorId = "actor_search_test";
        const long scopeId = 555;
        const string query = "What is the user's favorite football team?";
        const string memoryText = "I prefer PostgreSQL for my backend applications.";

        _scopeResMock
            .Setup(s => s.ResolveScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeId);

        _embeddingGenMock
            .Setup(e => e.GenerateAsync(query))
            .ReturnsAsync(new float[] { 0.0f, 1.0f, 0.0f });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 1,
                    Content = memoryText,
                    MemoryType = "Preference",
                    Model = "mistral-embed",
                    Dimensions = 3,
                    Embedding = new float[] { 1.0f, 0.0f, 0.0f }
                }
            });

        // Relevance evaluator rejects unrelated memory
        _relevanceEvalMock
            .Setup(r => r.EvaluateAsync(query, It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync(new List<RetrievedMemory>());

        // Act
        var result = await service.SearchMemoriesAsync(
            new MemorySearchRequest { Query = query, ActorId = actorId, TopK = 5 },
            userId,
            projectId);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(0, result.Count);
        Assert.Empty(result.Memories);
    }

    [Fact]
    public async Task Test5_NonexistentActorScope_Returns200WithEmptyResult()
    {
        // Arrange
        var service = CreateMemoryService();
        const long userId = 10;
        const long projectId = 100;
        const string nonexistentActorId = "never_created_actor";

        _scopeResMock
            .Setup(s => s.ResolveScopeAsync(projectId, nonexistentActorId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new Kairo.Application.MemoryScopeNotFoundException());

        // Act
        var result = await service.SearchMemoriesAsync(
            new MemorySearchRequest { Query = "Any query", ActorId = nonexistentActorId, TopK = 5 },
            userId,
            projectId);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("Any query", result.Query);
        Assert.Equal(0, result.Count);
        Assert.Empty(result.Memories);
    }

    [Fact]
    public async Task Test6_ActorIsolation_SearchesOnlySpecifiedActorScope()
    {
        // Arrange
        var service = CreateMemoryService();
        const long userId = 10;
        const long projectId = 100;
        const string actorX = "actor_x";
        const long scopeX = 1001;

        _scopeResMock
            .Setup(s => s.ResolveScopeAsync(projectId, actorX, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeX);

        _embeddingGenMock
            .Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1.0f, 0.0f, 0.0f });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeX))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId = 42,
                    Content = "Actor X specific preference",
                    MemoryType = "Fact",
                    Model = "mistral-embed",
                    Dimensions = 3,
                    Embedding = new float[] { 1.0f, 0.0f, 0.0f }
                }
            });

        _relevanceEvalMock
            .Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string q, List<RetrievedMemory> c) => c);

        // Act
        var result = await service.SearchMemoriesAsync(
            new MemorySearchRequest { Query = "What is the preference?", ActorId = actorX, TopK = 5 },
            userId,
            projectId);

        // Assert: Scope passed to repo MUST be scopeX, never scopeY
        _memoryRepoMock.Verify(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeX), Times.Once);
        Assert.Single(result.Memories);
        Assert.Equal(42, result.Memories[0].MemoryId);
    }

    [Fact]
    public async Task Test7_ProjectIsolation_ResolvesScopeUnderAuthenticatedProject()
    {
        // Arrange
        var service = CreateMemoryService();
        const long userId = 10;
        const long projectA = 100;
        const string actorId = "common_actor";

        _scopeResMock
            .Setup(s => s.ResolveScopeAsync(projectA, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(5001);

        _embeddingGenMock
            .Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1.0f, 0.0f, 0.0f });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, 5001))
            .ReturnsAsync(new List<MemoryEmbeddingData>());

        // Act
        var result = await service.SearchMemoriesAsync(
            new MemorySearchRequest { Query = "Search", ActorId = actorId, TopK = 5 },
            userId,
            projectA);

        // Assert: ResolveScopeAsync MUST be called with projectA
        _scopeResMock.Verify(s => s.ResolveScopeAsync(projectA, actorId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Test8_InactiveMemoryExclusion_InactiveMemoriesNotReturned()
    {
        // Arrange
        var service = CreateMemoryService();
        const long userId = 10;
        const long projectId = 100;
        const string actorId = "actor_test";
        const long scopeId = 555;

        _scopeResMock
            .Setup(s => s.ResolveScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeId);

        _embeddingGenMock
            .Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1.0f, 0.0f, 0.0f });

        // GetActiveMemoryEmbeddingsAsync only returns active memories from repo
        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>()); // Inactive memories already filtered at repo

        // Act
        var result = await service.SearchMemoriesAsync(
            new MemorySearchRequest { Query = "Search", ActorId = actorId, TopK = 5 },
            userId,
            projectId);

        // Assert
        Assert.Empty(result.Memories);
    }

    [Fact]
    public async Task Test9_ResultLimit_RespectsTopK()
    {
        // Arrange
        var service = CreateMemoryService();
        const long userId = 10;
        const long projectId = 100;
        const string actorId = "actor_test";
        const long scopeId = 555;

        _scopeResMock
            .Setup(s => s.ResolveScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeId);

        _embeddingGenMock
            .Setup(e => e.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new float[] { 1.0f, 0.0f, 0.0f });

        var list = new List<MemoryEmbeddingData>();
        for (int i = 1; i <= 10; i++)
        {
            list.Add(new MemoryEmbeddingData
            {
                MemoryId = i,
                Content = $"Memory #{i}",
                MemoryType = "Fact",
                Model = "mistral-embed",
                Dimensions = 3,
                Embedding = new float[] { 1.0f, 0.0f, 0.0f }
            });
        }

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(list);

        _relevanceEvalMock
            .Setup(r => r.EvaluateAsync(It.IsAny<string>(), It.IsAny<List<RetrievedMemory>>()))
            .ReturnsAsync((string q, List<RetrievedMemory> c) => c);

        // Act: Request topK = 3
        var result = await service.SearchMemoriesAsync(
            new MemorySearchRequest { Query = "List", ActorId = actorId, TopK = 3 },
            userId,
            projectId);

        // Assert
        Assert.Equal(3, result.Memories.Count);
    }

    [Fact]
    public async Task Test10_InvalidActorOrQuery_ThrowsArgumentException()
    {
        // Arrange
        var service = CreateMemoryService();

        // Empty query
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.SearchMemoriesAsync(
                new MemorySearchRequest { Query = "", ActorId = "actor", TopK = 5 },
                userId: 1,
                projectId: 100));

        // Empty actorId with project
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.SearchMemoriesAsync(
                new MemorySearchRequest { Query = "Valid", ActorId = "   ", TopK = 5 },
                userId: 1,
                projectId: 100));

        // TopK <= 0
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.SearchMemoriesAsync(
                new MemorySearchRequest { Query = "Valid", ActorId = "actor", TopK = 0 },
                userId: 1,
                projectId: 100));

        // TopK > 100
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.SearchMemoriesAsync(
                new MemorySearchRequest { Query = "Valid", ActorId = "actor", TopK = 101 },
                userId: 1,
                projectId: 100));
    }
}
