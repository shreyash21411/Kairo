using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.MCP.Tools;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Phase 5.7 Task 5.7.2: Unit tests for Recall Filters in the MCP Recall Tool.
/// Covers category, temporal, metadata, and graphDepth filters, combined filters,
/// validation, backward compatibility, and tenant isolation.
/// </summary>
public class Phase5McpRecallFiltersUnitTests
{
    private readonly Mock<IApiKeyContext> _mockApiKeyContext;
    private readonly Mock<IMemoryService> _mockMemoryService;
    private readonly Mock<IScopeResolutionService> _mockScopeResolutionService;
    private readonly KairoMemoryTools _tools;

    private const long TestUserId = 42;
    private const long TestProjectId = 101;

    public Phase5McpRecallFiltersUnitTests()
    {
        _mockApiKeyContext = new Mock<IApiKeyContext>();
        _mockApiKeyContext.Setup(c => c.UserId).Returns(TestUserId);
        _mockApiKeyContext.Setup(c => c.ProjectId).Returns(TestProjectId);

        _mockMemoryService = new Mock<IMemoryService>();
        _mockScopeResolutionService = new Mock<IScopeResolutionService>();

        _tools = new KairoMemoryTools(
            _mockApiKeyContext.Object,
            _mockMemoryService.Object,
            _mockScopeResolutionService.Object);
    }

    // ── 1. Recall without filters: backward compatibility ─────────────────────

    [Fact]
    public async Task Recall_WithoutFilters_PreservesBackwardCompatibility()
    {
        const string query = "preferences";
        const string actorId = "user-alice";

        MemorySearchRequest? capturedRequest = null;
        _mockMemoryService
            .Setup(s => s.SearchMemoriesAsync(
                It.IsAny<MemorySearchRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .Callback<MemorySearchRequest, long, long?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .ReturnsAsync(new MemorySearchResponse
            {
                Query = query,
                Count = 1,
                Memories = new List<RetrievedMemory>
                {
                    new()
                    {
                        MemoryId = 77,
                        Content = "User prefers dark mode",
                        MemoryType = "Preference",
                        Similarity = 0.92f
                    }
                }
            });

        // Invoked with only 3 legacy arguments
        var json = await _tools.Recall(query, actorId, topK: 5);

        Assert.NotNull(capturedRequest);
        Assert.Equal(query, capturedRequest!.Query);
        Assert.Equal(actorId, capturedRequest.ActorId);
        Assert.Equal(5, capturedRequest.TopK);
        Assert.Null(capturedRequest.Categories);
        Assert.Null(capturedRequest.MetadataFilters);
        Assert.Null(capturedRequest.Temporal);
        Assert.Null(capturedRequest.GraphDepth);

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        Assert.Equal(1, root.GetProperty("count").GetInt32());
        Assert.Equal(77, root.GetProperty("memories")[0].GetProperty("memoryId").GetInt64());
        Assert.Equal(0.92, root.GetProperty("memories")[0].GetProperty("similarity").GetDouble(), precision: 2);
    }

    // ── 2. Category filtering ─────────────────────────────────────────────────

    [Fact]
    public async Task Recall_WithCategoryFilter_MapsCategoriesToSearchRequest()
    {
        const string query = "database";
        const string actorId = "user-alice";
        var categories = new List<string> { "database", "backend" };

        MemorySearchRequest? capturedRequest = null;
        _mockMemoryService
            .Setup(s => s.SearchMemoriesAsync(
                It.IsAny<MemorySearchRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .Callback<MemorySearchRequest, long, long?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .ReturnsAsync(new MemorySearchResponse
            {
                Query = query,
                Count = 1,
                Memories = new List<RetrievedMemory>
                {
                    new()
                    {
                        MemoryId = 101,
                        Content = "Uses PostgreSQL",
                        MemoryType = "Fact",
                        Similarity = 0.88f,
                        Categories = new List<string> { "database" }
                    }
                }
            });

        var json = await _tools.Recall(query, actorId, topK: 10, categories: categories);

        Assert.NotNull(capturedRequest);
        Assert.Equal(categories, capturedRequest!.Categories);

        using var doc = JsonDocument.Parse(json);
        var mem0 = doc.RootElement.GetProperty("memories")[0];
        Assert.Equal("database", mem0.GetProperty("categories")[0].GetString());
    }

    // ── 3. Temporal filtering ─────────────────────────────────────────────────

    [Fact]
    public async Task Recall_WithTemporalFilter_PopulatesMemoryTemporalFilter()
    {
        const string query = "recent events";
        const string actorId = "user-bob";
        var createdFrom = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);
        var createdTo = new DateTime(2026, 10, 14, 23, 59, 59, DateTimeKind.Utc);
        var occurredFrom = new DateTime(2026, 9, 15, 0, 0, 0, DateTimeKind.Utc);
        var occurredTo = new DateTime(2026, 10, 10, 0, 0, 0, DateTimeKind.Utc);
        const int lastDays = 30;

        MemorySearchRequest? capturedRequest = null;
        _mockMemoryService
            .Setup(s => s.SearchMemoriesAsync(
                It.IsAny<MemorySearchRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .Callback<MemorySearchRequest, long, long?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .ReturnsAsync(new MemorySearchResponse { Query = query, Count = 0, Memories = new() });

        await _tools.Recall(
            query,
            actorId,
            createdFrom: createdFrom,
            createdTo: createdTo,
            occurredFrom: occurredFrom,
            occurredTo: occurredTo,
            lastDays: lastDays);

        Assert.NotNull(capturedRequest);
        Assert.NotNull(capturedRequest!.Temporal);
        Assert.Equal(createdFrom, capturedRequest.Temporal!.CreatedAtFrom);
        Assert.Equal(createdTo, capturedRequest.Temporal.CreatedAtTo);
        Assert.Equal(occurredFrom, capturedRequest.Temporal.OccurredAtFrom);
        Assert.Equal(occurredTo, capturedRequest.Temporal.OccurredAtTo);
        Assert.Equal(lastDays, capturedRequest.Temporal.LastDays);
    }

    // ── 4. Metadata filtering ─────────────────────────────────────────────────

    [Fact]
    public async Task Recall_WithMetadataFilter_MapsDictionaryToSearchRequest()
    {
        const string query = "config";
        const string actorId = "user-carol";
        var metaFilters = new Dictionary<string, object>
        {
            ["env"] = "production",
            ["tier"] = 1
        };

        MemorySearchRequest? capturedRequest = null;
        _mockMemoryService
            .Setup(s => s.SearchMemoriesAsync(
                It.IsAny<MemorySearchRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .Callback<MemorySearchRequest, long, long?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .ReturnsAsync(new MemorySearchResponse { Query = query, Count = 0, Memories = new() });

        await _tools.Recall(query, actorId, metadataFilters: metaFilters);

        Assert.NotNull(capturedRequest);
        Assert.Equal(metaFilters, capturedRequest!.MetadataFilters);
    }

    // ── 5. Graph depth & relation serialization ───────────────────────────────

    [Fact]
    public async Task Recall_WithGraphDepth_PopulatesGraphDepthAndSerializesRelations()
    {
        const string query = "architecture";
        const string actorId = "user-dave";

        MemorySearchRequest? capturedRequest = null;
        _mockMemoryService
            .Setup(s => s.SearchMemoriesAsync(
                It.IsAny<MemorySearchRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .Callback<MemorySearchRequest, long, long?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .ReturnsAsync(new MemorySearchResponse
            {
                Query = query,
                Count = 1,
                Memories = new List<RetrievedMemory>
                {
                    new() { MemoryId = 201, Content = "Uses ASP.NET Core", Similarity = 0.95 }
                },
                Relations = new List<GraphRelationDto>
                {
                    new()
                    {
                        Source = "Kairo",
                        Relationship = "built_with",
                        Target = ".NET",
                        Confidence = 0.99
                    }
                }
            });

        var json = await _tools.Recall(query, actorId, graphDepth: 2, recencyBoost: true);

        Assert.NotNull(capturedRequest);
        Assert.Equal(2, capturedRequest!.GraphDepth);
        Assert.True(capturedRequest.RecencyBoost);

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        Assert.True(root.TryGetProperty("relations", out var rels));
        Assert.Single(rels.EnumerateArray());
        var r0 = rels[0];
        Assert.Equal("Kairo", r0.GetProperty("source").GetString());
        Assert.Equal("built_with", r0.GetProperty("relationship").GetString());
        Assert.Equal(".NET", r0.GetProperty("target").GetString());
        Assert.Equal(0.99, r0.GetProperty("confidence").GetDouble(), precision: 2);
    }

    // ── 6. Combined filters ───────────────────────────────────────────────────

    [Fact]
    public async Task Recall_WithCombinedFilters_AllMappedSimultaneously()
    {
        const string query = "deployment";
        const string actorId = "user-eva";
        var categories = new List<string> { "devops" };
        var metadata = new Dictionary<string, object> { ["region"] = "us-east-1" };
        var createdFrom = DateTime.UtcNow.AddDays(-7);

        MemorySearchRequest? capturedRequest = null;
        _mockMemoryService
            .Setup(s => s.SearchMemoriesAsync(
                It.IsAny<MemorySearchRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .Callback<MemorySearchRequest, long, long?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .ReturnsAsync(new MemorySearchResponse { Query = query, Count = 0, Memories = new() });

        await _tools.Recall(
            query,
            actorId,
            topK: 20,
            categories: categories,
            metadataFilters: metadata,
            createdFrom: createdFrom,
            lastDays: 7,
            graphDepth: 1,
            recencyBoost: true);

        Assert.NotNull(capturedRequest);
        Assert.Equal(20, capturedRequest!.TopK);
        Assert.Equal(categories, capturedRequest.Categories);
        Assert.Equal(metadata, capturedRequest.MetadataFilters);
        Assert.NotNull(capturedRequest.Temporal);
        Assert.Equal(createdFrom, capturedRequest.Temporal!.CreatedAtFrom);
        Assert.Equal(7, capturedRequest.Temporal.LastDays);
        Assert.Equal(1, capturedRequest.GraphDepth);
        Assert.True(capturedRequest.RecencyBoost);
    }

    // ── 7. Input validation & Error conditions ────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Recall_EmptyQuery_ThrowsArgumentException(string? invalidQuery)
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Recall(invalidQuery!, "user-alice"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Recall_EmptyActorId_ThrowsArgumentException(string? invalidActorId)
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Recall("query", invalidActorId!));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(101)]
    public async Task Recall_InvalidTopK_ThrowsArgumentException(int invalidTopK)
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Recall("query", "user-alice", topK: invalidTopK));
    }

    [Fact]
    public async Task Recall_CreatedFromAfterCreatedTo_ThrowsArgumentException()
    {
        var from = DateTime.UtcNow;
        var to = from.AddDays(-1); // from > to

        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Recall("query", "user-alice", createdFrom: from, createdTo: to));

        Assert.Contains("createdFrom cannot be after createdTo", ex.Message);
    }

    [Fact]
    public async Task Recall_OccurredFromAfterOccurredTo_ThrowsArgumentException()
    {
        var from = DateTime.UtcNow;
        var to = from.AddHours(-2); // from > to

        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Recall("query", "user-alice", occurredFrom: from, occurredTo: to));

        Assert.Contains("occurredFrom cannot be after occurredTo", ex.Message);
    }

    [Fact]
    public async Task Recall_NegativeLastDays_ThrowsArgumentException()
    {
        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Recall("query", "user-alice", lastDays: -1));

        Assert.Contains("lastDays cannot be negative", ex.Message);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(3)]
    public async Task Recall_InvalidGraphDepth_ThrowsArgumentException(int invalidDepth)
    {
        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Recall("query", "user-alice", graphDepth: invalidDepth));

        Assert.Contains("graphDepth must be between 0 and 2", ex.Message);
    }

    [Fact]
    public async Task Recall_InvalidCategorySyntax_ThrowsArgumentException()
    {
        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Recall("query", "user-alice", categories: new List<string> { "invalid category with spaces!" }));

        Assert.Contains("contains invalid characters", ex.Message);
    }

    // ── 8. RerankScore & Deterministic ordering compatibility ────────────────

    [Fact]
    public async Task Recall_WithRerankedMemories_PreservesRerankScoreInSerialization()
    {
        const string query = "security";
        const string actorId = "user-alice";

        _mockMemoryService
            .Setup(s => s.SearchMemoriesAsync(
                It.IsAny<MemorySearchRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemorySearchResponse
            {
                Query = query,
                Count = 2,
                Memories = new List<RetrievedMemory>
                {
                    new()
                    {
                        MemoryId = 1,
                        Content = "Best match",
                        Similarity = 0.70,
                        RerankScore = 0.95
                    },
                    new()
                    {
                        MemoryId = 2,
                        Content = "Secondary match",
                        Similarity = 0.85,
                        RerankScore = 0.40
                    }
                }
            });

        var json = await _tools.Recall(query, actorId);
        using var doc = JsonDocument.Parse(json);
        var memories = doc.RootElement.GetProperty("memories");

        Assert.Equal(2, memories.GetArrayLength());
        Assert.Equal(1, memories[0].GetProperty("memoryId").GetInt64());
        Assert.Equal(0.95, memories[0].GetProperty("rerankScore").GetDouble(), precision: 2);
        Assert.Equal(0.70, memories[0].GetProperty("similarity").GetDouble(), precision: 2);

        Assert.Equal(2, memories[1].GetProperty("memoryId").GetInt64());
        Assert.Equal(0.40, memories[1].GetProperty("rerankScore").GetDouble(), precision: 2);
        Assert.Equal(0.85, memories[1].GetProperty("similarity").GetDouble(), precision: 2);
    }
}
