using System;
using System.Collections.Generic;
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
/// Unit tests for MetaMemoryService.
/// All tests use a mocked IMetaAIClient — no real HTTP calls.
/// </summary>
public class MetaMemoryServiceUnitTests
{
    // ── Helpers ────────────────────────────────────────────────────────────────

    private static MetaTokenUsage SampleUsage => new() { PromptTokens = 30, CompletionTokens = 60, TotalTokens = 90 };

    private static string BuildValidMemoryJson() => JsonSerializer.Serialize(new
    {
        decisions        = new[] { "Use PostgreSQL", "Keep Mistral unchanged" },
        requirements     = new[] { "Must pass all existing tests" },
        constraints      = new[] { "No live API calls during development" },
        goals            = new[] { "Implement Memory Engine" },
        technicalContext = ".NET 10, C#, xUnit, Moq",
        pendingTasks     = new[] { "Write tests" },
        projectFacts     = new[] { "VOIDZONE is a Chrome Extension" }
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
    public async Task ValidResponse_ReturnsFullyParsedMemoryResult()
    {
        var service = new MetaMemoryService(MakeClientMock(BuildValidMemoryJson()).Object);

        var result = await service.ExtractAsync("transcript", new List<MetaConversationMessage>());

        Assert.Equal(2, result.Decisions.Count);
        Assert.Contains("Use PostgreSQL", result.Decisions);
        Assert.Single(result.Requirements);
        Assert.Single(result.Constraints);
        Assert.Single(result.Goals);
        Assert.Equal(".NET 10, C#, xUnit, Moq", result.TechnicalContext);
        Assert.Single(result.PendingTasks);
        Assert.Single(result.ProjectFacts);
        Assert.NotEmpty(result.ExtractedAt);
    }

    [Fact]
    public async Task TokenUsage_PropagatedFromClientResponse()
    {
        var service = new MetaMemoryService(MakeClientMock(BuildValidMemoryJson()).Object);

        var result = await service.ExtractAsync("transcript", new List<MetaConversationMessage>());

        Assert.Equal(30, result.TokenUsage.PromptTokens);
        Assert.Equal(60, result.TokenUsage.CompletionTokens);
        Assert.Equal(90, result.TokenUsage.TotalTokens);
    }

    [Fact]
    public async Task MalformedJson_ThrowsMetaAIMalformedResponseException()
    {
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        clientMock.Setup(c => c.CompleteAsync(It.IsAny<MetaAIRequest>(), It.IsAny<CancellationToken>()))
                  .ReturnsAsync(new MetaAIResponse { Content = "not-valid-json", TokenUsage = SampleUsage });
        var service = new MetaMemoryService(clientMock.Object);

        await Assert.ThrowsAsync<MetaAIExceptions.MetaAIMalformedResponseException>(
            () => service.ExtractAsync("transcript", new List<MetaConversationMessage>()));
    }

    [Fact]
    public async Task EmptyContent_ReturnsEmptyResultWithUsage()
    {
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        clientMock.Setup(c => c.CompleteAsync(It.IsAny<MetaAIRequest>(), It.IsAny<CancellationToken>()))
                  .ReturnsAsync(new MetaAIResponse { Content = string.Empty, TokenUsage = SampleUsage });
        var service = new MetaMemoryService(clientMock.Object);

        var result = await service.ExtractAsync("transcript", new List<MetaConversationMessage>());

        Assert.Empty(result.Decisions);
        Assert.Empty(result.TechnicalContext);
        Assert.Equal(90, result.TokenUsage.TotalTokens);
        Assert.NotEmpty(result.ExtractedAt);
    }

    [Fact]
    public async Task UsesStructuredMessages_WhenMessagesProvided()
    {
        MetaAIRequest? captured = null;
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        clientMock.Setup(c => c.CompleteAsync(It.IsAny<MetaAIRequest>(), It.IsAny<CancellationToken>()))
                  .Callback<MetaAIRequest, CancellationToken>((req, _) => captured = req)
                  .ReturnsAsync(new MetaAIResponse { Content = BuildValidMemoryJson(), TokenUsage = SampleUsage });
        var service = new MetaMemoryService(clientMock.Object);

        var messages = new List<MetaConversationMessage>
        {
            new() { Role = "user",      Content = "Hello" },
            new() { Role = "assistant", Content = "Hi there" }
        };

        await service.ExtractAsync("raw", messages);

        Assert.NotNull(captured);
        Assert.Contains("USER:", captured!.UserPrompt);
        Assert.Contains("ASSISTANT:", captured.UserPrompt);
        Assert.Contains("Hello", captured.UserPrompt);
    }

    [Fact]
    public async Task UsesJsonSchema_WithCorrectSchemaName()
    {
        MetaAIRequest? captured = null;
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        clientMock.Setup(c => c.CompleteAsync(It.IsAny<MetaAIRequest>(), It.IsAny<CancellationToken>()))
                  .Callback<MetaAIRequest, CancellationToken>((req, _) => captured = req)
                  .ReturnsAsync(new MetaAIResponse { Content = BuildValidMemoryJson(), TokenUsage = SampleUsage });
        var service = new MetaMemoryService(clientMock.Object);

        await service.ExtractAsync("transcript", new List<MetaConversationMessage>());

        Assert.NotNull(captured?.OutputSchema);
        Assert.Equal("memory_extraction", captured!.OutputSchema!.Name);
    }

    [Fact]
    public void NullClient_ThrowsArgumentNullException()
    {
        Assert.Throws<ArgumentNullException>(() => new MetaMemoryService(null!));
    }

    [Fact]
    public async Task EmptyTranscript_ThrowsArgumentException()
    {
        var service = new MetaMemoryService(Mock.Of<IMetaAIClient>());

        await Assert.ThrowsAsync<ArgumentException>(
            () => service.ExtractAsync("   ", new List<MetaConversationMessage>()));
    }
}

