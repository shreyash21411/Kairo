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
/// Phase 5.7 Task 5.7.3: Unit tests for missing MCP tools:
/// get_memory, remember_batch, forget_batch, and ingest_dialogue.
/// </summary>
public class Phase5McpBatchAndIngestUnitTests
{
    private readonly Mock<IApiKeyContext> _mockApiKeyContext;
    private readonly Mock<IMemoryService> _mockMemoryService;
    private readonly Mock<IScopeResolutionService> _mockScopeResolutionService;
    private readonly Mock<IMemoryIngestionService> _mockIngestionService;
    private readonly KairoMemoryTools _tools;

    private const long TestUserId = 42;
    private const long TestProjectId = 101;
    private const long TestScopeId = 202;

    public Phase5McpBatchAndIngestUnitTests()
    {
        _mockApiKeyContext = new Mock<IApiKeyContext>();
        _mockApiKeyContext.Setup(c => c.UserId).Returns(TestUserId);
        _mockApiKeyContext.Setup(c => c.ProjectId).Returns(TestProjectId);

        _mockMemoryService = new Mock<IMemoryService>();
        _mockScopeResolutionService = new Mock<IScopeResolutionService>();
        _mockIngestionService = new Mock<IMemoryIngestionService>();

        _tools = new KairoMemoryTools(
            _mockApiKeyContext.Object,
            _mockMemoryService.Object,
            _mockScopeResolutionService.Object,
            _mockIngestionService.Object);
    }

    // ── 1. get_memory ─────────────────────────────────────────────────────────

    [Fact]
    public async Task GetMemory_ValidRequest_ResolvesScopeAndReturnsMemory()
    {
        const long memoryId = 55;
        const string actorId = "user-alice";

        _mockScopeResolutionService
            .Setup(s => s.ResolveScopeAsync(TestProjectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(TestScopeId);

        _mockMemoryService
            .Setup(s => s.GetMemoryAsync(memoryId, TestUserId, TestProjectId, TestScopeId))
            .ReturnsAsync(new MemoryResponse
            {
                MemoryId = memoryId,
                UserId = TestUserId,
                Content = "User loves TypeScript",
                MemoryType = "Preference",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-1),
                Categories = new List<string> { "tech" }
            });

        var json = await _tools.GetMemory(memoryId, actorId);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.True(root.GetProperty("found").GetBoolean());
        Assert.Equal(memoryId, root.GetProperty("memoryId").GetInt64());
        Assert.Equal(TestUserId, root.GetProperty("userId").GetInt64());
        Assert.Equal("User loves TypeScript", root.GetProperty("content").GetString());
        Assert.Equal("Preference", root.GetProperty("memoryType").GetString());
        Assert.True(root.GetProperty("isActive").GetBoolean());
        Assert.Equal("tech", root.GetProperty("categories")[0].GetString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task GetMemory_EmptyActorId_ThrowsArgumentException(string? invalidActorId)
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.GetMemory(123, invalidActorId!));
    }

    [Fact]
    public async Task GetMemory_NotFound_PropagatesKeyNotFoundException()
    {
        const long memoryId = 999;
        const string actorId = "user-alice";

        _mockScopeResolutionService
            .Setup(s => s.ResolveScopeAsync(TestProjectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(TestScopeId);

        _mockMemoryService
            .Setup(s => s.GetMemoryAsync(memoryId, TestUserId, TestProjectId, TestScopeId))
            .ThrowsAsync(new KeyNotFoundException($"Memory {memoryId} not found"));

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            _tools.GetMemory(memoryId, actorId));
    }

    // ── 2. remember_batch ─────────────────────────────────────────────────────

    [Fact]
    public async Task RememberBatch_ValidBatch_AppliesDefaultActorIdAndCallsService()
    {
        const string defaultActor = "user-alice";
        var memories = new List<BatchCreateMemoryItem>
        {
            new() { Content = "Prefers dark mode", MemoryType = "Preference" },
            new() { Content = "Lives in London", MemoryType = "Fact", ActorId = "explicit-actor" }
        };

        BatchCreateMemoryRequest? capturedRequest = null;
        _mockMemoryService
            .Setup(s => s.BatchCreateMemoriesAsync(
                It.IsAny<BatchCreateMemoryRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .Callback<BatchCreateMemoryRequest, long, long?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .ReturnsAsync(new BatchCreateResponse
            {
                Success = true,
                CreatedCount = 2,
                Memories = new List<MemoryResponse>
                {
                    new() { MemoryId = 1, Content = "Prefers dark mode", MemoryType = "Preference" },
                    new() { MemoryId = 2, Content = "Lives in London", MemoryType = "Fact" }
                },
                Errors = new List<BatchOperationError>()
            });

        var json = await _tools.RememberBatch(memories, defaultActor);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.True(root.GetProperty("success").GetBoolean());
        Assert.Equal(2, root.GetProperty("createdCount").GetInt32());
        Assert.Equal(2, root.GetProperty("memories").GetArrayLength());

        Assert.NotNull(capturedRequest);
        Assert.Equal("user-alice", capturedRequest!.Memories[0].ActorId);
        Assert.Equal("explicit-actor", capturedRequest.Memories[1].ActorId);
    }

    [Fact]
    public async Task RememberBatch_WithPartialErrors_SerializesErrorsCorrectly()
    {
        const string actorId = "user-alice";
        var memories = new List<BatchCreateMemoryItem>
        {
            new() { Content = "Prefers dark mode", MemoryType = "Preference" },
            new() { Content = "", MemoryType = "Fact" }
        };

        _mockMemoryService
            .Setup(s => s.BatchCreateMemoriesAsync(
                It.IsAny<BatchCreateMemoryRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BatchCreateResponse
            {
                Success = false,
                CreatedCount = 1,
                Memories = new List<MemoryResponse>
                {
                    new() { MemoryId = 1, Content = "Prefers dark mode", MemoryType = "Preference" }
                },
                Errors = new List<BatchOperationError>
                {
                    new() { Index = 1, Message = "Content cannot be empty." }
                }
            });

        var json = await _tools.RememberBatch(memories, actorId);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.False(root.GetProperty("success").GetBoolean());
        Assert.Equal(1, root.GetProperty("createdCount").GetInt32());
        Assert.Equal(1, root.GetProperty("errors").GetArrayLength());
        Assert.Equal("Content cannot be empty.", root.GetProperty("errors")[0].GetProperty("message").GetString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task RememberBatch_EmptyActorId_ThrowsArgumentException(string? invalidActorId)
    {
        var memories = new List<BatchCreateMemoryItem>
        {
            new() { Content = "Test", MemoryType = "Fact" }
        };

        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.RememberBatch(memories, invalidActorId!));
    }

    [Fact]
    public async Task RememberBatch_EmptyBatch_ThrowsArgumentException()
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.RememberBatch(new List<BatchCreateMemoryItem>(), "user-alice"));
    }

    [Fact]
    public async Task RememberBatch_OversizedBatch_ThrowsArgumentException()
    {
        var memories = new List<BatchCreateMemoryItem>();
        for (int i = 0; i < 101; i++)
        {
            memories.Add(new BatchCreateMemoryItem { Content = $"Memory {i}", MemoryType = "Fact" });
        }

        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.RememberBatch(memories, "user-alice"));
        Assert.Contains("exceeds maximum allowed", ex.Message);
    }

    // ── 3. forget_batch ───────────────────────────────────────────────────────

    [Fact]
    public async Task ForgetBatch_ValidRequest_ResolvesScopeAndDeactivatesMemories()
    {
        const string actorId = "user-alice";
        var ids = new List<long> { 10, 11, 12 };

        _mockScopeResolutionService
            .Setup(s => s.ResolveScopeAsync(TestProjectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(TestScopeId);

        _mockMemoryService
            .Setup(s => s.BatchDeleteMemoriesAsync(
                It.Is<BatchDeleteMemoryRequest>(r => r.MemoryIds.SequenceEqual(ids)),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BatchDeleteResponse
            {
                Success = true,
                DeletedCount = 3,
                DeletedIds = ids,
                Errors = new List<BatchOperationError>()
            });

        var json = await _tools.ForgetBatch(ids, actorId);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.True(root.GetProperty("success").GetBoolean());
        Assert.Equal(3, root.GetProperty("deletedCount").GetInt32());
        Assert.Equal(3, root.GetProperty("deletedIds").GetArrayLength());
        _mockScopeResolutionService.Verify(s => s.ResolveScopeAsync(TestProjectId, actorId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ForgetBatch_OversizedBatch_ThrowsArgumentException()
    {
        var ids = Enumerable.Range(1, 101).Select(i => (long)i).ToList();

        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.ForgetBatch(ids, "user-alice"));
        Assert.Contains("exceeds maximum allowed", ex.Message);
    }

    [Fact]
    public async Task ForgetBatch_EmptyBatch_ThrowsArgumentException()
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.ForgetBatch(new List<long>(), "user-alice"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task ForgetBatch_EmptyActorId_ThrowsArgumentException(string? invalidActorId)
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.ForgetBatch(new List<long> { 1 }, invalidActorId!));
    }

    // ── 4. ingest_dialogue ────────────────────────────────────────────────────

    [Fact]
    public async Task IngestDialogue_ValidRequest_CallsIngestionServiceAndSerializes()
    {
        const string actorId = "user-alice";
        var messages = new List<IngestMessageItem>
        {
            new() { Role = "user", Content = "I am a backend engineer specializing in .NET and PostgreSQL." },
            new() { Role = "assistant", Content = "Great to know! How can I assist your .NET project?" }
        };

        IngestConversationRequest? capturedRequest = null;
        _mockIngestionService
            .Setup(s => s.IngestAsync(
                It.IsAny<IngestConversationRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .Callback<IngestConversationRequest, long, long?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .ReturnsAsync(new MemoryIngestionResponse
            {
                Processed = true,
                ExtractedCount = 1,
                Memories = new List<IngestionMemoryResult>
                {
                    new()
                    {
                        Action = IngestionOperation.Add,
                        MemoryId = 301,
                        Content = "Backend engineer specializing in .NET and PostgreSQL",
                        Reason = "New professional skill detected"
                    }
                }
            });

        var json = await _tools.IngestDialogue(messages, actorId);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.True(root.GetProperty("processed").GetBoolean());
        Assert.Equal(1, root.GetProperty("extractedCount").GetInt32());
        var mems = root.GetProperty("memories");
        Assert.Equal(1, mems.GetArrayLength());
        Assert.Equal("Add", mems[0].GetProperty("action").GetString());
        Assert.Equal(301, mems[0].GetProperty("memoryId").GetInt64());
        Assert.Equal("New professional skill detected", mems[0].GetProperty("reason").GetString());

        Assert.NotNull(capturedRequest);
        Assert.Equal(actorId, capturedRequest!.ActorId);
        Assert.Equal(2, capturedRequest.Messages.Count);
    }

    [Fact]
    public async Task IngestDialogue_UnconfiguredIngestionService_ThrowsInvalidOperationException()
    {
        // Construct tools without ingestion service
        var toolsWithoutIngest = new KairoMemoryTools(
            _mockApiKeyContext.Object,
            _mockMemoryService.Object,
            _mockScopeResolutionService.Object,
            ingestionService: null);

        var messages = new List<IngestMessageItem>
        {
            new() { Role = "user", Content = "Hello" }
        };

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            toolsWithoutIngest.IngestDialogue(messages, "user-alice"));
    }

    [Fact]
    public async Task IngestDialogue_EmptyMessages_ThrowsArgumentException()
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.IngestDialogue(new List<IngestMessageItem>(), "user-alice"));
    }

    [Fact]
    public async Task IngestDialogue_OversizedMessages_ThrowsArgumentException()
    {
        var messages = Enumerable.Range(1, 101)
            .Select(i => new IngestMessageItem { Role = "user", Content = $"msg {i}" })
            .ToList();

        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.IngestDialogue(messages, "user-alice"));
        Assert.Contains("maximum allowed 100", ex.Message);
    }

    [Theory]
    [InlineData("", "Valid content")]
    [InlineData("user", "")]
    [InlineData("   ", "Valid content")]
    [InlineData("user", "   ")]
    public async Task IngestDialogue_InvalidMessageRoleOrContent_ThrowsArgumentException(string role, string content)
    {
        var messages = new List<IngestMessageItem>
        {
            new() { Role = role, Content = content }
        };

        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.IngestDialogue(messages, "user-alice"));
    }
}
