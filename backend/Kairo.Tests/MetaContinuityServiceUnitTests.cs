using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Meta;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Meta;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Unit tests for MetaContinuityService.
/// All tests use a mocked IMetaAIClient — no real HTTP calls.
/// </summary>
public class MetaContinuityServiceUnitTests
{
    // ── Helpers ────────────────────────────────────────────────────────────────

    private static MetaTokenUsage SampleUsage => new() { PromptTokens = 40, CompletionTokens = 80, TotalTokens = 120 };

    private static string BuildValidContinuityJson() => JsonSerializer.Serialize(new
    {
        projectName           = "VOIDZONE",
        currentObjective      = "Implement Meta AI backend",
        importantDecisions    = new[] { "Use dedicated IMetaAIClient", "Enabled defaults to false" },
        constraints           = new[] { "No Mistral changes", "No extension changes" },
        completedWork         = new[] { "Wrote MetaAIClient", "Wrote MetaMemoryService" },
        outstandingTasks      = new[] { "Continuity service tests", "Program.cs update" },
        blockers              = new[] { "None at this time" },
        recommendedNextAction = "Run the build and test suite",
        technicalContext      = ".NET 10, ASP.NET Core, xUnit, Moq"
    });

    private static Mock<IMetaAIClient> MakeClientMock(string content)
    {
        var mock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        mock.Setup(c => c.CompleteAsync(It.IsAny<MetaAIRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MetaAIResponse { Content = content, TokenUsage = SampleUsage });
        return mock;
    }

    // ── Tests ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ValidResponse_ParsesAllContinuityFields()
    {
        var service = new MetaContinuityService(MakeClientMock(BuildValidContinuityJson()).Object);

        var result = await service.GenerateAsync("transcript", "chatgpt", "VOIDZONE Session");

        Assert.Equal("VOIDZONE", result.ProjectName);
        Assert.Equal("Implement Meta AI backend", result.CurrentObjective);
        Assert.Equal(2, result.ImportantDecisions.Count);
        Assert.Equal(2, result.Constraints.Count);
        Assert.Equal(2, result.CompletedWork.Count);
        Assert.Equal(2, result.OutstandingTasks.Count);
        Assert.Single(result.Blockers);
        Assert.Equal("Run the build and test suite", result.RecommendedNextAction);
        Assert.Equal(".NET 10, ASP.NET Core, xUnit, Moq", result.TechnicalContext);
        Assert.NotEmpty(result.GeneratedAt);
    }

    [Fact]
    public async Task TokenUsage_PropagatedFromClientResponse()
    {
        var service = new MetaContinuityService(MakeClientMock(BuildValidContinuityJson()).Object);

        var result = await service.GenerateAsync("transcript", "chatgpt", "session");

        Assert.Equal(40, result.TokenUsage.PromptTokens);
        Assert.Equal(80, result.TokenUsage.CompletionTokens);
        Assert.Equal(120, result.TokenUsage.TotalTokens);
    }

    [Fact]
    public async Task MalformedJson_ThrowsMetaAIMalformedResponseException()
    {
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        clientMock.Setup(c => c.CompleteAsync(It.IsAny<MetaAIRequest>(), It.IsAny<CancellationToken>()))
                  .ReturnsAsync(new MetaAIResponse { Content = ">>>bad<<<", TokenUsage = SampleUsage });
        var service = new MetaContinuityService(clientMock.Object);

        await Assert.ThrowsAsync<MetaAIExceptions.MetaAIMalformedResponseException>(
            () => service.GenerateAsync("transcript", "chatgpt", "session"));
    }

    [Fact]
    public async Task EmptyContent_ReturnsEmptyResultWithUsage()
    {
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        clientMock.Setup(c => c.CompleteAsync(It.IsAny<MetaAIRequest>(), It.IsAny<CancellationToken>()))
                  .ReturnsAsync(new MetaAIResponse { Content = "", TokenUsage = SampleUsage });
        var service = new MetaContinuityService(clientMock.Object);

        var result = await service.GenerateAsync("transcript", "chatgpt", "session");

        Assert.Empty(result.ProjectName);
        Assert.Empty(result.OutstandingTasks);
        Assert.Equal(120, result.TokenUsage.TotalTokens);
        Assert.NotEmpty(result.GeneratedAt);
    }

    [Fact]
    public async Task UsesJsonSchema_WithCorrectSchemaName()
    {
        MetaAIRequest? captured = null;
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        clientMock.Setup(c => c.CompleteAsync(It.IsAny<MetaAIRequest>(), It.IsAny<CancellationToken>()))
                  .Callback<MetaAIRequest, CancellationToken>((req, _) => captured = req)
                  .ReturnsAsync(new MetaAIResponse { Content = BuildValidContinuityJson(), TokenUsage = SampleUsage });
        var service = new MetaContinuityService(clientMock.Object);

        await service.GenerateAsync("transcript", "claude", "Project X");

        Assert.NotNull(captured?.OutputSchema);
        Assert.Equal("continuity_summary", captured!.OutputSchema!.Name);
    }

    [Fact]
    public async Task PlatformAndTitle_AppearInSystemPrompt()
    {
        MetaAIRequest? captured = null;
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        clientMock.Setup(c => c.CompleteAsync(It.IsAny<MetaAIRequest>(), It.IsAny<CancellationToken>()))
                  .Callback<MetaAIRequest, CancellationToken>((req, _) => captured = req)
                  .ReturnsAsync(new MetaAIResponse { Content = BuildValidContinuityJson(), TokenUsage = SampleUsage });
        var service = new MetaContinuityService(clientMock.Object);

        await service.GenerateAsync("transcript", "gemini", "My Project Title");

        Assert.NotNull(captured);
        Assert.Contains("gemini", captured!.SystemPrompt);
        Assert.Contains("My Project Title", captured.SystemPrompt);
    }

    [Fact]
    public void NullClient_ThrowsArgumentNullException()
    {
        Assert.Throws<ArgumentNullException>(() => new MetaContinuityService(null!));
    }

    [Fact]
    public async Task EmptyTranscript_ThrowsArgumentException()
    {
        var service = new MetaContinuityService(Mock.Of<IMetaAIClient>());

        await Assert.ThrowsAsync<ArgumentException>(
            () => service.GenerateAsync("", "chatgpt", "title"));
    }
}

