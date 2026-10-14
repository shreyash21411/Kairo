using System.Text.Json;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.MCP.Tools;
using Moq;
using Xunit;

namespace Kairo.Tests;

public class McpSecurityUnitTests
{
    private readonly Mock<IApiKeyContext> _mockApiKeyContext;
    private readonly Mock<IMemoryService> _mockMemoryService;
    private readonly Mock<IScopeResolutionService> _mockScopeResolutionService;
    private readonly KairoMemoryTools _tools;

    private const long TestUserId = 42;
    private const long TestProjectId = 101;

    public McpSecurityUnitTests()
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

    [Fact]
    public void Ping_ReturnsAuthenticatedUserId_FromContext()
    {
        var result = _tools.Ping();

        Assert.Contains($"user {TestUserId}", result);
    }

    [Fact]
    public async Task Remember_EnforcesContextIdentity_AndCallsMemoryService()
    {
        const string actorId = "user-alice";
        const string content = "User prefers dark mode";
        const string memoryType = "Preference";

        _mockMemoryService
            .Setup(s => s.CreateMemoryAsync(
                It.Is<CreateMemoryRequest>(r => r.Content == content && r.MemoryType == memoryType && r.ActorId == actorId),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((new MemoryResponse
            {
                MemoryId = 77,
                UserId = TestUserId,
                Content = content,
                MemoryType = memoryType,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            }, null));

        var json = await _tools.Remember(content, memoryType, actorId);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.True(root.GetProperty("stored").GetBoolean());
        Assert.Equal(77, root.GetProperty("memoryId").GetInt64());
        Assert.Equal(TestUserId, root.GetProperty("userId").GetInt64());

        _mockMemoryService.Verify(s => s.CreateMemoryAsync(
            It.Is<CreateMemoryRequest>(r => r.ActorId == actorId),
            TestUserId,
            TestProjectId,
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Remember_RejectsEmptyActorId()
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Remember("Some content", "Fact", "   "));
    }

    [Fact]
    public async Task Recall_EnforcesContextIdentity_AndScoping()
    {
        const string actorId = "user-alice";
        const string query = "preferences";

        _mockMemoryService
            .Setup(s => s.SearchMemoriesAsync(
                It.Is<MemorySearchRequest>(r => r.Query == query && r.ActorId == actorId && r.TopK == 5),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
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

        var json = await _tools.Recall(query, actorId, topK: 5);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal(1, root.GetProperty("count").GetInt32());
        Assert.Equal(77, root.GetProperty("memories")[0].GetProperty("memoryId").GetInt64());

        _mockMemoryService.Verify(s => s.SearchMemoriesAsync(
            It.Is<MemorySearchRequest>(r => r.ActorId == actorId),
            TestUserId,
            TestProjectId,
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Recall_RejectsEmptyActorId()
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Recall("preferences", ""));
    }

    [Fact]
    public async Task Update_ResolvesScopeWithProjectId_AndEnforcesOwnership()
    {
        const long memoryId = 88;
        const string actorId = "user-bob";
        const long resolvedScopeId = 555;

        _mockScopeResolutionService
            .Setup(s => s.ResolveScopeAsync(TestProjectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(resolvedScopeId);

        _mockMemoryService
            .Setup(s => s.UpdateMemoryAsync(
                memoryId,
                It.IsAny<UpdateMemoryRequest>(),
                TestUserId,
                TestProjectId,
                resolvedScopeId))
            .ReturnsAsync(new MemoryResponse
            {
                MemoryId = memoryId,
                UserId = TestUserId,
                Content = "Updated content",
                MemoryType = "Fact",
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });

        var json = await _tools.Update(memoryId, "Updated content", "Fact", actorId);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.True(root.GetProperty("updated").GetBoolean());
        Assert.Equal(memoryId, root.GetProperty("memoryId").GetInt64());

        _mockScopeResolutionService.Verify(s => s.ResolveScopeAsync(TestProjectId, actorId, It.IsAny<CancellationToken>()), Times.Once);
        _mockMemoryService.Verify(s => s.UpdateMemoryAsync(memoryId, It.IsAny<UpdateMemoryRequest>(), TestUserId, TestProjectId, resolvedScopeId), Times.Once);
    }

    [Fact]
    public async Task Forget_ResolvesScopeWithProjectId_AndDeactivates()
    {
        const long memoryId = 88;
        const string actorId = "user-bob";
        const long resolvedScopeId = 555;

        _mockScopeResolutionService
            .Setup(s => s.ResolveScopeAsync(TestProjectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(resolvedScopeId);

        _mockMemoryService
            .Setup(s => s.DeleteMemoryAsync(
                memoryId,
                TestUserId,
                TestProjectId,
                resolvedScopeId))
            .Returns(Task.CompletedTask);

        var json = await _tools.Forget(memoryId, actorId);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.True(root.GetProperty("forgotten").GetBoolean());
        Assert.Equal(memoryId, root.GetProperty("memoryId").GetInt64());

        _mockScopeResolutionService.Verify(s => s.ResolveScopeAsync(TestProjectId, actorId, It.IsAny<CancellationToken>()), Times.Once);
        _mockMemoryService.Verify(s => s.DeleteMemoryAsync(memoryId, TestUserId, TestProjectId, resolvedScopeId), Times.Once);
    }

    [Fact]
    public async Task ProjectIsolation_ToolNeverAcceptsProjectId_EnforcedByContext()
    {
        // When client invokes tools, the context guarantees ProjectId = TestProjectId and UserId = TestUserId.
        // It is strictly forbidden for any MCP tool to accept caller-supplied projectId or userId parameters.
        var methods = typeof(KairoMemoryTools).GetMethods()
            .Where(m => m.GetCustomAttributes(false).Any(a => a.GetType().Name == "McpServerToolAttribute"))
            .ToList();

        Assert.NotEmpty(methods);

        foreach (var method in methods)
        {
            var parameters = method.GetParameters();
            Assert.DoesNotContain(parameters, p => p.Name!.Equals("projectId", StringComparison.OrdinalIgnoreCase));
            Assert.DoesNotContain(parameters, p => p.Name!.Equals("userId", StringComparison.OrdinalIgnoreCase));
        }
    }
}
