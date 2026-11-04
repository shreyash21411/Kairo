using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Meta;
using Kairo.Application.Configuration;
using Kairo.Infrastructure.Meta;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Moq.Protected;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Unit tests for MetaAIClient.
/// All tests use mocked HttpMessageHandler — no real HTTP requests are made.
/// MetaAI:Enabled is kept false by default; only tests that must reach the HTTP layer set it to true.
/// </summary>
public class MetaAIClientUnitTests
{
    // ── Helpers ────────────────────────────────────────────────────────────────

    private static IOptions<MetaAIOptions> MakeOptions(bool enabled = true, int maxInput = 8000, int maxOutput = 500, string apiKey = "test-key")
        => Options.Create(new MetaAIOptions
        {
            Enabled               = enabled,
            ApiKey                = apiKey,
            Model                 = "muse-spark-1.3",
            MaxInputTokenEstimate = maxInput,
            MaxCompletionTokens   = maxOutput,
            TimeoutSeconds        = 10
        });

    private static (MetaAIClient client, Mock<HttpMessageHandler> handlerMock) MakeClient(
        IOptions<MetaAIOptions>? options = null,
        HttpResponseMessage? httpResponse = null)
    {
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Strict);
        var response = httpResponse ?? new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(BuildSuccessBody("hello"), Encoding.UTF8, "application/json")
        };

        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(response);

        var httpClient = new HttpClient(handlerMock.Object);
        var client = new MetaAIClient(httpClient, options ?? MakeOptions(), null);
        return (client, handlerMock);
    }

    private static string BuildSuccessBody(string content, int prompt = 10, int completion = 20)
    {
        return JsonSerializer.Serialize(new
        {
            choices = new[]
            {
                new { message = new { role = "assistant", content } }
            },
            usage = new { prompt_tokens = prompt, completion_tokens = completion, total_tokens = prompt + completion }
        });
    }

    private static MetaAIRequest MakeRequest(string system = "sys", string user = "hello world wide web")
        => new() { SystemPrompt = system, UserPrompt = user, Temperature = 0.0 };

    // ── Tests ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DisabledFlag_ThrowsMetaAIDisabledException_BeforeHttpCall()
    {
        var (client, handler) = MakeClient(MakeOptions(enabled: false));

        await Assert.ThrowsAsync<MetaAIExceptions.MetaAIDisabledException>(
            () => client.CompleteAsync(MakeRequest()));

        // Handler must not have been called.
        handler.Protected().Verify("SendAsync",
            Times.Never(),
            ItExpr.IsAny<HttpRequestMessage>(),
            ItExpr.IsAny<CancellationToken>());
    }

    [Fact]
    public async Task InputTooLarge_ThrowsMetaAIInputTooLargeException_BeforeHttpCall()
    {
        // maxInput = 5 estimated tokens → any real text will exceed.
        var (client, handler) = MakeClient(MakeOptions(maxInput: 5));
        var request = new MetaAIRequest
        {
            SystemPrompt = "system",
            UserPrompt   = new string('x', 100), // 100 chars / 4 = 25 estimated tokens > 5
            Temperature  = 0.0
        };

        var ex = await Assert.ThrowsAsync<MetaAIExceptions.MetaAIInputTooLargeException>(
            () => client.CompleteAsync(request));

        Assert.True(ex.EstimatedTokens > ex.MaxTokens);

        handler.Protected().Verify("SendAsync",
            Times.Never(),
            ItExpr.IsAny<HttpRequestMessage>(),
            ItExpr.IsAny<CancellationToken>());
    }

    [Fact]
    public async Task SuccessResponse_ParsesContentAndTokenUsage()
    {
        var body = BuildSuccessBody("extracted content", prompt: 50, completion: 100);
        var httpResponse = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        var (client, _) = MakeClient(httpResponse: httpResponse);

        var result = await client.CompleteAsync(MakeRequest());

        Assert.Equal("extracted content", result.Content);
        Assert.Equal(50, result.TokenUsage.PromptTokens);
        Assert.Equal(100, result.TokenUsage.CompletionTokens);
        Assert.Equal(150, result.TokenUsage.TotalTokens);
    }

    [Fact]
    public async Task Http401_ThrowsMetaAIAuthException()
    {
        var httpResponse = new HttpResponseMessage(HttpStatusCode.Unauthorized);
        var (client, _) = MakeClient(httpResponse: httpResponse);

        await Assert.ThrowsAsync<MetaAIExceptions.MetaAIAuthException>(
            () => client.CompleteAsync(MakeRequest()));
    }

    [Fact]
    public async Task Http403_ThrowsMetaAIAuthException()
    {
        var httpResponse = new HttpResponseMessage(HttpStatusCode.Forbidden);
        var (client, _) = MakeClient(httpResponse: httpResponse);

        await Assert.ThrowsAsync<MetaAIExceptions.MetaAIAuthException>(
            () => client.CompleteAsync(MakeRequest()));
    }

    [Fact]
    public async Task Http429_ThrowsMetaAIRateLimitException()
    {
        var httpResponse = new HttpResponseMessage((HttpStatusCode)429);
        var (client, _) = MakeClient(httpResponse: httpResponse);

        await Assert.ThrowsAsync<MetaAIExceptions.MetaAIRateLimitException>(
            () => client.CompleteAsync(MakeRequest()));
    }

    [Fact]
    public async Task Http500_ThrowsMetaAIException()
    {
        var httpResponse = new HttpResponseMessage(HttpStatusCode.InternalServerError);
        var (client, _) = MakeClient(httpResponse: httpResponse);

        await Assert.ThrowsAsync<MetaAIExceptions.MetaAIException>(
            () => client.CompleteAsync(MakeRequest()));
    }

    [Fact]
    public async Task NetworkError_ThrowsMetaAIException()
    {
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Strict);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        var httpClient = new HttpClient(handlerMock.Object);
        var client = new MetaAIClient(httpClient, MakeOptions(), null);

        await Assert.ThrowsAsync<MetaAIExceptions.MetaAIException>(
            () => client.CompleteAsync(MakeRequest()));
    }

    [Fact]
    public async Task Cancellation_PropagatesOperationCanceledException()
    {
        var cts = new CancellationTokenSource();
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Strict);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Returns<HttpRequestMessage, CancellationToken>(async (_, ct) =>
            {
                await Task.Delay(500, ct);
                return new HttpResponseMessage(HttpStatusCode.OK);
            });

        var httpClient = new HttpClient(handlerMock.Object);
        var client = new MetaAIClient(httpClient, MakeOptions(), null);

        cts.CancelAfter(10);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => client.CompleteAsync(MakeRequest(), cts.Token));
    }

    [Fact]
    public async Task MalformedJson_ThrowsMetaAIMalformedResponseException()
    {
        var httpResponse = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("not-json-at-all", Encoding.UTF8, "application/json")
        };
        var (client, _) = MakeClient(httpResponse: httpResponse);

        await Assert.ThrowsAsync<MetaAIExceptions.MetaAIMalformedResponseException>(
            () => client.CompleteAsync(MakeRequest()));
    }

    [Fact]
    public async Task EmptyChoices_ThrowsMetaAIMalformedResponseException()
    {
        var body = JsonSerializer.Serialize(new
        {
            choices = Array.Empty<object>(),
            usage   = new { prompt_tokens = 5, completion_tokens = 5, total_tokens = 10 }
        });
        var httpResponse = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        var (client, _) = MakeClient(httpResponse: httpResponse);

        await Assert.ThrowsAsync<MetaAIExceptions.MetaAIMalformedResponseException>(
            () => client.CompleteAsync(MakeRequest()));
    }

    [Fact]
    public async Task ApiKey_NeverAppearsInExceptionMessage()
    {
        // Use a distinctive API key — confirm it is absent from all exception messages.
        const string secretKey = "SUPER_SECRET_API_KEY_DO_NOT_EXPOSE";
        var opts = Options.Create(new MetaAIOptions
        {
            Enabled = true, ApiKey = secretKey, Model = "muse-spark-1.3",
            MaxInputTokenEstimate = 8000, MaxCompletionTokens = 500, TimeoutSeconds = 10
        });

        var httpResponse = new HttpResponseMessage(HttpStatusCode.Unauthorized);
        var (client, _) = MakeClient(opts, httpResponse);

        var ex = await Assert.ThrowsAsync<MetaAIExceptions.MetaAIAuthException>(
            () => client.CompleteAsync(MakeRequest()));

        Assert.DoesNotContain(secretKey, ex.Message);
    }

    [Fact]
    public async Task RequestBody_ContainsMaxCompletionTokens()
    {
        string? capturedBody = null;
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Strict);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Returns<HttpRequestMessage, CancellationToken>(async (req, _) =>
            {
                capturedBody = await req.Content!.ReadAsStringAsync();
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(BuildSuccessBody("ok"), Encoding.UTF8, "application/json")
                };
            });

        var httpClient = new HttpClient(handlerMock.Object);
        var client = new MetaAIClient(httpClient, MakeOptions(), null);
        await client.CompleteAsync(MakeRequest());

        Assert.NotNull(capturedBody);
        Assert.Contains("max_completion_tokens", capturedBody);
        Assert.DoesNotContain("\"max_tokens\"", capturedBody);
    }

    [Fact]
    public async Task RequestBody_UsesJsonSchema_WhenOutputSchemaProvided()
    {
        string? capturedBody = null;
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Strict);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Returns<HttpRequestMessage, CancellationToken>(async (req, _) =>
            {
                // Read body inside the callback — before HttpRequestMessage is disposed.
                capturedBody = await req.Content!.ReadAsStringAsync();
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(BuildSuccessBody("{}"), Encoding.UTF8, "application/json")
                };
            });

        var httpClient = new HttpClient(handlerMock.Object);
        var client = new MetaAIClient(httpClient, MakeOptions(), null);

        var request = new MetaAIRequest
        {
            SystemPrompt = "sys",
            UserPrompt   = "user",
            Temperature  = 0.0,
            OutputSchema = new MetaAIJsonSchema
            {
                Name   = "test_schema",
                Schema = new { type = "object", properties = new { value = new { type = "string" } } }
            }
        };

        await client.CompleteAsync(request);

        Assert.NotNull(capturedBody);
        Assert.Contains("\"json_schema\"", capturedBody);
        Assert.Contains("\"test_schema\"", capturedBody);
        Assert.DoesNotContain("\"json_object\"", capturedBody);
    }

    [Fact]
    public async Task RequestBody_UsesJsonObject_WhenNoOutputSchema()
    {
        string? capturedBody = null;
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Strict);
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Returns<HttpRequestMessage, CancellationToken>(async (req, _) =>
            {
                capturedBody = await req.Content!.ReadAsStringAsync();
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(BuildSuccessBody("{}"), Encoding.UTF8, "application/json")
                };
            });

        var httpClient = new HttpClient(handlerMock.Object);
        var client = new MetaAIClient(httpClient, MakeOptions(), null);

        await client.CompleteAsync(new MetaAIRequest
        {
            SystemPrompt = "sys",
            UserPrompt   = "user",
            Temperature  = 0.0,
            OutputSchema = null
        });

        Assert.NotNull(capturedBody);
        Assert.Contains("\"json_object\"", capturedBody);
        Assert.DoesNotContain("\"json_schema\"", capturedBody);
    }

    [Fact]
    public async Task NullRequest_ThrowsArgumentNullException()
    {
        var handlerMock = new Mock<HttpMessageHandler>(MockBehavior.Loose);
        var httpClient = new HttpClient(handlerMock.Object);
        var client = new MetaAIClient(httpClient, MakeOptions(), null);

        await Assert.ThrowsAsync<ArgumentNullException>(() => client.CompleteAsync(null!));
    }
}

