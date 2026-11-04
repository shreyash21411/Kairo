using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Meta;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Services;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace Kairo.Tests;

public class BeruServiceUnitTests
{
    private static IOptions<BeruOptions> MakeOptions(bool enabled = true) =>
        Options.Create(new BeruOptions
        {
            Enabled = enabled,
            Model = "muse-spark-1.3",
            MaxCompletionTokens = 800,
            Temperature = 0.3
        });

    [Fact]
    public async Task Disabled_ThrowsInvalidOperationException()
    {
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        var service = new BeruService(clientMock.Object, MakeOptions(enabled: false));

        var req = new BeruChatRequest { Message = "What is the project status?" };

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ProcessChatAsync(req));
    }

    [Fact]
    public async Task EmptyMessage_ThrowsArgumentException()
    {
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        var service = new BeruService(clientMock.Object, MakeOptions(enabled: true));

        var req = new BeruChatRequest { Message = "   " };

        await Assert.ThrowsAsync<ArgumentException>(() => service.ProcessChatAsync(req));
    }

    [Fact]
    public async Task ValidChat_CallsMetaClientAndReturnsResponse()
    {
        var clientMock = new Mock<IMetaAIClient>(MockBehavior.Strict);
        clientMock
            .Setup(c => c.CompleteAsync(It.IsAny<MetaAIRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MetaAIResponse
            {
                Content = "KAIRO is on track. The next step is environment and stack setup.",
                TokenUsage = new MetaTokenUsage { PromptTokens = 50, CompletionTokens = 20, TotalTokens = 70 }
            });

        var service = new BeruService(clientMock.Object, MakeOptions(enabled: true));

        var req = new BeruChatRequest
        {
            Message = "What is the next step for KAIRO?",
            ProjectContext = "Project: KAIRO, Stack: React + FastAPI",
            History = new List<BeruMessageItem>
            {
                new() { Role = "user", Content = "Hi BERU" },
                new() { Role = "assistant", Content = "Hello! How can I help with KAIRO?" }
            }
        };

        var response = await service.ProcessChatAsync(req);

        Assert.NotNull(response);
        Assert.Equal("KAIRO is on track. The next step is environment and stack setup.", response.Reply);
        Assert.Equal(70, response.TokenUsage.TotalTokens);
        Assert.NotEmpty(response.RespondedAt);

        clientMock.Verify(c => c.CompleteAsync(
            It.Is<MetaAIRequest>(r =>
                r.UserPrompt.Contains("KAIRO is on track") == false &&
                r.UserPrompt.Contains("Project: KAIRO") &&
                r.UserPrompt.Contains("What is the next step for KAIRO?")),
            It.IsAny<CancellationToken>()), Times.Once);
    }
}

