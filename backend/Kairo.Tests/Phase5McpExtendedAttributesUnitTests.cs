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
/// Phase 5.7 Task 5.7.1: Unit tests for extended memory attributes in MCP tools (remember, update).
/// Validates categories, metadata, expiresAt, occurredAt, update preservation semantics,
/// error handling, serialization, and tenant isolation.
/// </summary>
public class Phase5McpExtendedAttributesUnitTests
{
    private readonly Mock<IApiKeyContext> _mockApiKeyContext;
    private readonly Mock<IMemoryService> _mockMemoryService;
    private readonly Mock<IScopeResolutionService> _mockScopeResolutionService;
    private readonly KairoMemoryTools _tools;

    private const long TestUserId = 42;
    private const long TestProjectId = 101;

    public Phase5McpExtendedAttributesUnitTests()
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

    // ── 1. Remember: Extended attributes mapping & serialization ──────────────

    [Fact]
    public async Task Remember_WithAllExtendedAttributes_MapsAndPassesToMemoryService()
    {
        const string content = "User prefers PostgreSQL with pgvector";
        const string memoryType = "Preference";
        const string actorId = "user-alice";
        var categories = new List<string> { "database", "preferences" };
        var metadata = new Dictionary<string, object>
        {
            ["client"] = "mcp-agent",
            ["priority"] = 1
        };
        var expiresAt = new DateTime(2026, 12, 31, 23, 59, 59, DateTimeKind.Utc);
        var occurredAt = new DateTime(2026, 10, 14, 12, 0, 0, DateTimeKind.Utc);

        CreateMemoryRequest? capturedRequest = null;
        _mockMemoryService
            .Setup(s => s.CreateMemoryAsync(
                It.IsAny<CreateMemoryRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .Callback<CreateMemoryRequest, long, long?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .ReturnsAsync((new MemoryResponse
            {
                MemoryId = 1001,
                UserId = TestUserId,
                Content = content,
                MemoryType = memoryType,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                OccurredAt = occurredAt,
                Metadata = JsonSerializer.Serialize(metadata),
                ExpiresAt = expiresAt,
                Categories = categories
            }, null));

        var json = await _tools.Remember(
            content,
            memoryType,
            actorId,
            categories: categories,
            metadata: metadata,
            expiresAt: expiresAt,
            occurredAt: occurredAt);

        // Verify request DTO mapping
        Assert.NotNull(capturedRequest);
        Assert.Equal(content, capturedRequest!.Content);
        Assert.Equal(memoryType, capturedRequest.MemoryType);
        Assert.Equal(actorId, capturedRequest.ActorId);
        Assert.Equal(categories, capturedRequest.Categories);
        Assert.Equal(metadata, capturedRequest.Metadata);
        Assert.Equal(expiresAt, capturedRequest.ExpiresAt);
        Assert.Equal(occurredAt, capturedRequest.OccurredAt);

        // Verify returned JSON serialization
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        Assert.True(root.GetProperty("stored").GetBoolean());
        Assert.Equal(1001, root.GetProperty("memoryId").GetInt64());
        Assert.Equal(TestUserId, root.GetProperty("userId").GetInt64());
        Assert.Equal(content, root.GetProperty("content").GetString());
        Assert.Equal(memoryType, root.GetProperty("memoryType").GetString());
        Assert.Equal(occurredAt, root.GetProperty("occurredAt").GetDateTime());
        Assert.Equal(expiresAt, root.GetProperty("expiresAt").GetDateTime());
        Assert.NotNull(root.GetProperty("metadata").GetString());

        var returnedCats = root.GetProperty("categories").EnumerateArray()
            .Select(c => c.GetString()!)
            .ToList();
        Assert.Equal(new List<string> { "database", "preferences" }, returnedCats);
    }

    [Fact]
    public async Task Remember_OmittedOptionalAttributes_PreservesBackwardCompatibility()
    {
        const string content = "Simple memory without extras";
        const string memoryType = "Fact";
        const string actorId = "user-bob";

        CreateMemoryRequest? capturedRequest = null;
        _mockMemoryService
            .Setup(s => s.CreateMemoryAsync(
                It.IsAny<CreateMemoryRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .Callback<CreateMemoryRequest, long, long?, CancellationToken>((req, _, _, _) => capturedRequest = req)
            .ReturnsAsync((new MemoryResponse
            {
                MemoryId = 1002,
                UserId = TestUserId,
                Content = content,
                MemoryType = memoryType,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            }, null));

        // Invoke with only the 3 legacy parameters
        var json = await _tools.Remember(content, memoryType, actorId);

        Assert.NotNull(capturedRequest);
        Assert.Null(capturedRequest!.Categories);
        Assert.Null(capturedRequest.Metadata);
        Assert.Null(capturedRequest.ExpiresAt);
        Assert.Null(capturedRequest.OccurredAt);

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        Assert.True(root.GetProperty("stored").GetBoolean());
        Assert.Equal(1002, root.GetProperty("memoryId").GetInt64());
    }

    [Fact]
    public async Task Remember_WhenDuplicateDetected_SurfacesDuplicateResponse()
    {
        _mockMemoryService
            .Setup(s => s.CreateMemoryAsync(
                It.IsAny<CreateMemoryRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((null, new MemoryDuplicateResult
            {
                IsDuplicate = true,
                Reason = "Exact duplicate found"
            }));

        var json = await _tools.Remember("Duplicate content", "Fact", "user-alice");
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.False(root.GetProperty("stored").GetBoolean());
        Assert.True(root.GetProperty("isDuplicate").GetBoolean());
        Assert.Equal("Exact duplicate found", root.GetProperty("reason").GetString());
    }

    // ── 2. Update: Extended attributes mapping, preservation & clearing ───────

    [Fact]
    public async Task Update_WithAllExtendedAttributes_MapsAndPassesToMemoryService()
    {
        const long memoryId = 2001;
        const string content = "Refined memory content";
        const string memoryType = "Fact";
        const string actorId = "user-alice";
        const long resolvedScopeId = 777;

        var categories = new List<string> { "updated-category" };
        var metadata = new Dictionary<string, object> { ["version"] = 2 };
        var expiresAt = new DateTime(2027, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var occurredAt = new DateTime(2026, 10, 14, 15, 30, 0, DateTimeKind.Utc);

        _mockScopeResolutionService
            .Setup(s => s.ResolveScopeAsync(TestProjectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(resolvedScopeId);

        UpdateMemoryRequest? capturedRequest = null;
        _mockMemoryService
            .Setup(s => s.UpdateMemoryAsync(
                memoryId,
                It.IsAny<UpdateMemoryRequest>(),
                TestUserId,
                TestProjectId,
                resolvedScopeId))
            .Callback<long, UpdateMemoryRequest, long, long?, long?>((_, req, _, _, _) => capturedRequest = req)
            .ReturnsAsync(new MemoryResponse
            {
                MemoryId = memoryId,
                UserId = TestUserId,
                Content = content,
                MemoryType = memoryType,
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-1),
                UpdatedAt = DateTime.UtcNow,
                OccurredAt = occurredAt,
                Metadata = JsonSerializer.Serialize(metadata),
                ExpiresAt = expiresAt,
                Categories = categories
            });

        var json = await _tools.Update(
            memoryId,
            content,
            memoryType,
            actorId,
            categories: categories,
            metadata: metadata,
            expiresAt: expiresAt,
            occurredAt: occurredAt);

        Assert.NotNull(capturedRequest);
        Assert.Equal(content, capturedRequest!.Content);
        Assert.Equal(memoryType, capturedRequest.MemoryType);
        Assert.Equal(categories, capturedRequest.Categories);
        Assert.Equal(metadata, capturedRequest.Metadata);
        Assert.Equal(expiresAt, capturedRequest.ExpiresAt);
        Assert.Equal(occurredAt, capturedRequest.OccurredAt);

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        Assert.True(root.GetProperty("updated").GetBoolean());
        Assert.Equal(memoryId, root.GetProperty("memoryId").GetInt64());
        Assert.Equal(occurredAt, root.GetProperty("occurredAt").GetDateTime());
        Assert.Equal(expiresAt, root.GetProperty("expiresAt").GetDateTime());
        Assert.NotNull(root.GetProperty("metadata").GetString());
        Assert.Single(root.GetProperty("categories").EnumerateArray());
    }

    [Fact]
    public async Task Update_OmittedOptionalAttributes_SendsNullSoExistingValuesArePreserved()
    {
        const long memoryId = 2002;
        const string actorId = "user-bob";
        const long resolvedScopeId = 888;

        _mockScopeResolutionService
            .Setup(s => s.ResolveScopeAsync(TestProjectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(resolvedScopeId);

        UpdateMemoryRequest? capturedRequest = null;
        _mockMemoryService
            .Setup(s => s.UpdateMemoryAsync(
                memoryId,
                It.IsAny<UpdateMemoryRequest>(),
                TestUserId,
                TestProjectId,
                resolvedScopeId))
            .Callback<long, UpdateMemoryRequest, long, long?, long?>((_, req, _, _, _) => capturedRequest = req)
            .ReturnsAsync(new MemoryResponse
            {
                MemoryId = memoryId,
                UserId = TestUserId,
                Content = "Updated content",
                MemoryType = "Preference",
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-2),
                UpdatedAt = DateTime.UtcNow
            });

        // Omit optional arguments (legacy update invocation)
        var json = await _tools.Update(memoryId, "Updated content", "Preference", actorId);

        Assert.NotNull(capturedRequest);
        // Null values signify "do not mutate existing stored values" per update contract
        Assert.Null(capturedRequest!.Categories);
        Assert.Null(capturedRequest.Metadata);
        Assert.Null(capturedRequest.ExpiresAt);
        Assert.Null(capturedRequest.OccurredAt);

        using var doc = JsonDocument.Parse(json);
        Assert.True(doc.RootElement.GetProperty("updated").GetBoolean());
    }

    [Fact]
    public async Task Update_ExplicitEmptyCategories_PassesEmptyListToEnableClearing()
    {
        const long memoryId = 2003;
        const string actorId = "user-carol";
        const long resolvedScopeId = 999;

        _mockScopeResolutionService
            .Setup(s => s.ResolveScopeAsync(TestProjectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(resolvedScopeId);

        UpdateMemoryRequest? capturedRequest = null;
        _mockMemoryService
            .Setup(s => s.UpdateMemoryAsync(
                memoryId,
                It.IsAny<UpdateMemoryRequest>(),
                TestUserId,
                TestProjectId,
                resolvedScopeId))
            .Callback<long, UpdateMemoryRequest, long, long?, long?>((_, req, _, _, _) => capturedRequest = req)
            .ReturnsAsync(new MemoryResponse
            {
                MemoryId = memoryId,
                UserId = TestUserId,
                Content = "Content",
                MemoryType = "Fact",
                Categories = new List<string>()
            });

        // Explicit empty categories list
        await _tools.Update(
            memoryId,
            "Content",
            "Fact",
            actorId,
            categories: new List<string>());

        Assert.NotNull(capturedRequest);
        Assert.NotNull(capturedRequest!.Categories);
        Assert.Empty(capturedRequest.Categories);
    }

    // ── 3. Validation & Error Handling ────────────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Remember_EmptyOrWhitespaceActorId_ThrowsArgumentException(string? invalidActorId)
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Remember("Some content", "Fact", invalidActorId!));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Update_EmptyOrWhitespaceActorId_ThrowsArgumentException(string? invalidActorId)
    {
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Update(123, "Some content", "Fact", invalidActorId!));
    }

    [Fact]
    public async Task Remember_InvalidCategories_PropagatesArgumentExceptionFromService()
    {
        _mockMemoryService
            .Setup(s => s.CreateMemoryAsync(
                It.IsAny<CreateMemoryRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ArgumentException("Category 'bad category' contains invalid characters."));

        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Remember(
                "Content",
                "Fact",
                "user-alice",
                categories: new List<string> { "bad category" }));

        Assert.Contains("invalid characters", ex.Message);
    }

    [Fact]
    public async Task Remember_OversizedMetadata_PropagatesArgumentExceptionFromService()
    {
        _mockMemoryService
            .Setup(s => s.CreateMemoryAsync(
                It.IsAny<CreateMemoryRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ArgumentException("Metadata must not exceed 8,192 characters when serialized as JSON."));

        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            _tools.Remember(
                "Content",
                "Fact",
                "user-alice",
                metadata: new Dictionary<string, object> { ["huge"] = new string('x', 9000) }));

        Assert.Contains("Metadata must not exceed 8,192 characters", ex.Message);
    }

    [Fact]
    public async Task Update_ScopeResolutionFailure_PropagatesKeyNotFoundException()
    {
        _mockScopeResolutionService
            .Setup(s => s.ResolveScopeAsync(TestProjectId, "unknown-actor", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new KeyNotFoundException("Scope not found for actor."));

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            _tools.Update(123, "Content", "Fact", "unknown-actor"));
    }

    // ── 4. Tenant & Project Isolation ─────────────────────────────────────────

    [Fact]
    public void McpTools_NeverExposeUserIdOrProjectIdInSignatures()
    {
        var methods = typeof(KairoMemoryTools).GetMethods()
            .Where(m => new[] { "Remember", "Recall", "Update", "Forget" }.Contains(m.Name));

        foreach (var method in methods)
        {
            var parameters = method.GetParameters();
            Assert.DoesNotContain(parameters, p => p.Name!.Equals("projectId", StringComparison.OrdinalIgnoreCase));
            Assert.DoesNotContain(parameters, p => p.Name!.Equals("userId", StringComparison.OrdinalIgnoreCase));
        }
    }

    [Fact]
    public async Task Remember_AlwaysUsesContextIdentity_NeverAllowsCallerOverride()
    {
        _mockMemoryService
            .Setup(s => s.CreateMemoryAsync(
                It.IsAny<CreateMemoryRequest>(),
                TestUserId,
                TestProjectId,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((new MemoryResponse { MemoryId = 99 }, null));

        await _tools.Remember("Content", "Fact", "user-alice");

        // Verify that UserId and ProjectId are strictly sourced from IApiKeyContext
        _mockMemoryService.Verify(s => s.CreateMemoryAsync(
            It.IsAny<CreateMemoryRequest>(),
            TestUserId,
            TestProjectId,
            It.IsAny<CancellationToken>()), Times.Once);
    }
}
