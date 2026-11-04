using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.API.Controllers;
using Kairo.Application.Abstractions.Meta;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace Kairo.Tests;

public class BeruControllerUnitTests
{
    private static IOptions<BeruOptions> MakeOptions(bool enabled = true) =>
        Options.Create(new BeruOptions { Enabled = enabled });

    private static (BeruController controller, Mock<IBeruService> serviceMock) CreateController(bool enabled = true)
    {
        var serviceMock = new Mock<IBeruService>(MockBehavior.Strict);
        var apiKeyContextMock = new Mock<IApiKeyContext>();
        apiKeyContextMock.Setup(c => c.UserId).Returns(42);
        apiKeyContextMock.Setup(c => c.ProjectId).Returns(101);

        var controller = new BeruController(
            serviceMock.Object,
            apiKeyContextMock.Object,
            MakeOptions(enabled));

        return (controller, serviceMock);
    }

    [Fact]
    public async Task Disabled_Returns503_WithoutCallingService()
    {
        var (controller, serviceMock) = CreateController(enabled: false);

        var result = await controller.Chat(new BeruChatRequest { Message = "Hello" }, CancellationToken.None);

        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(503, objectResult.StatusCode);
        serviceMock.Verify(s => s.ProcessChatAsync(It.IsAny<BeruChatRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task EmptyMessage_Returns400()
    {
        var (controller, serviceMock) = CreateController(enabled: true);

        var result = await controller.Chat(new BeruChatRequest { Message = "" }, CancellationToken.None);

        var badRequestResult = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(400, badRequestResult.StatusCode);
        serviceMock.Verify(s => s.ProcessChatAsync(It.IsAny<BeruChatRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task EnabledAndValid_Returns200WithResult()
    {
        var (controller, serviceMock) = CreateController(enabled: true);

        var expectedResponse = new BeruChatResponse
        {
            Reply = "KAIRO uses FastAPI and React.",
            TokenUsage = new MetaTokenUsage { TotalTokens = 45 },
            RespondedAt = DateTime.UtcNow.ToString("O")
        };

        serviceMock
            .Setup(s => s.ProcessChatAsync(It.IsAny<BeruChatRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(expectedResponse);

        var result = await controller.Chat(new BeruChatRequest { Message = "What is KAIRO's stack?" }, CancellationToken.None);

        var okResult = Assert.IsType<OkObjectResult>(result);
        Assert.Equal(200, okResult.StatusCode);

        var json = JsonSerializer.Serialize(okResult.Value);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(42, doc.RootElement.GetProperty("userId").GetInt32());
        Assert.Equal(101, doc.RootElement.GetProperty("projectId").GetInt32());
        Assert.Equal("KAIRO uses FastAPI and React.", doc.RootElement.GetProperty("result").GetProperty("Reply").GetString());
    }

    [Fact]
    public async Task RateLimited_Returns429()
    {
        var (controller, serviceMock) = CreateController(enabled: true);

        serviceMock
            .Setup(s => s.ProcessChatAsync(It.IsAny<BeruChatRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new MetaAIExceptions.MetaAIRateLimitException());

        var result = await controller.Chat(new BeruChatRequest { Message = "Hello" }, CancellationToken.None);

        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(429, objectResult.StatusCode);
    }
}
