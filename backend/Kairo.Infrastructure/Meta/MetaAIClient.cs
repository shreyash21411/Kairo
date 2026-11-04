using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Meta;
using Kairo.Application.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Meta;

/// <summary>
/// Concrete HTTP client for the Meta Model API.
/// Implements IMetaAIClient — NOT ILlmProvider.
///
/// Safety guarantees:
/// - MetaAI:Enabled checked before every request; throws MetaAIDisabledException if false.
/// - Input token preflight guard (chars / 4 approximation) rejects oversized requests
///   before any HTTP call. This is an estimate — not a precise token count.
/// - max_completion_tokens enforced at the API level on every request.
/// - API key never logged, never included in exception messages.
/// - Single attempt only — no automatic retries.
/// - Structured output (json_schema, strict: true) used when OutputSchema is provided.
/// </summary>
public class MetaAIClient : IMetaAIClient
{
    private readonly HttpClient _httpClient;
    private readonly MetaAIOptions _options;
    private readonly ILogger<MetaAIClient>? _logger;

    private const string ChatCompletionsEndpoint = "https://api.meta.ai/v1/chat/completions";

    public MetaAIClient(
        HttpClient httpClient,
        IOptions<MetaAIOptions> options,
        ILogger<MetaAIClient>? logger = null)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _options = options?.Value ?? throw new ArgumentNullException(nameof(options));
        _logger = logger;

        // Apply configured timeout to the IHttpClientFactory-managed client.
        if (_httpClient.Timeout == TimeSpan.FromSeconds(100) ||
            _httpClient.Timeout == System.Threading.Timeout.InfiniteTimeSpan)
        {
            _httpClient.Timeout = TimeSpan.FromSeconds(
                _options.TimeoutSeconds > 0 ? _options.TimeoutSeconds : 30);
        }
    }

    /// <inheritdoc />
    public async Task<MetaAIResponse> CompleteAsync(
        MetaAIRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request is null) throw new ArgumentNullException(nameof(request));

        // ── Guard 1: Integration enabled check ────────────────────────────────
        if (!_options.Enabled)
            throw new MetaAIExceptions.MetaAIDisabledException();

        // ── Guard 2: Estimated input token preflight ───────────────────────────
        // Approximation: 1 token ≈ 4 characters (English text).
        // This is a preflight estimate, not a precise token count.
        // Requests estimated to exceed the limit are rejected before any HTTP call.
        var estimatedTokens = (request.SystemPrompt.Length + request.UserPrompt.Length) / 4;
        var maxEstimate = _options.MaxInputTokenEstimate > 0 ? _options.MaxInputTokenEstimate : 8000;

        if (estimatedTokens > maxEstimate)
        {
            _logger?.LogWarning(
                "[MetaAIClient] Preflight rejected: estimated {Estimated} tokens > limit {Max}.",
                estimatedTokens, maxEstimate);
            throw new MetaAIExceptions.MetaAIInputTooLargeException(estimatedTokens, maxEstimate);
        }

        // ── Build messages ─────────────────────────────────────────────────────
        var messages = new System.Collections.Generic.List<object>();
        if (!string.IsNullOrWhiteSpace(request.SystemPrompt))
            messages.Add(new { role = "system", content = request.SystemPrompt });
        messages.Add(new { role = "user", content = request.UserPrompt });

        // ── Build response_format ──────────────────────────────────────────────
        // Prefer json_schema (schema-constrained decoding) when a schema is provided.
        // Fall back to json_object (valid JSON guaranteed, no schema constraint).
        object responseFormat = request.OutputSchema is not null
            ? (object)new
            {
                type = "json_schema",
                json_schema = new
                {
                    name   = request.OutputSchema.Name,
                    strict = true,
                    schema = request.OutputSchema.Schema
                }
            }
            : new { type = "json_object" };

        var model = !string.IsNullOrWhiteSpace(_options.Model) ? _options.Model : "muse-spark-1.3";
        var maxCompletionTokens = _options.MaxCompletionTokens > 0 ? _options.MaxCompletionTokens : 2000;

        var requestBody = new
        {
            model,
            messages,
            temperature            = request.Temperature,
            max_completion_tokens  = maxCompletionTokens,
            response_format        = responseFormat
        };

        // ── Build HTTP request ─────────────────────────────────────────────────
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, ChatCompletionsEndpoint);

        // Key used in header only — never stored in logs or exception messages.
        if (!string.IsNullOrWhiteSpace(_options.ApiKey))
            httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);

        var json = JsonSerializer.Serialize(requestBody);
        httpRequest.Content = new StringContent(json, Encoding.UTF8, "application/json");

        // ── Send — single attempt, no retry ───────────────────────────────────
        HttpResponseMessage response;
        try
        {
            response = await _httpClient.SendAsync(httpRequest, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException ocEx)
            when (ocEx is TaskCanceledException tcEx && tcEx.InnerException is TimeoutException)
        {
            _logger?.LogWarning("[MetaAIClient] Request timed out.");
            throw new MetaAIExceptions.MetaAIException("Meta AI request timed out.", null, ocEx);
        }
        catch (OperationCanceledException)
        {
            // Caller cancellation — preserve semantics, do not wrap.
            throw;
        }
        catch (HttpRequestException ex)
        {
            _logger?.LogWarning("[MetaAIClient] Network error contacting Meta AI API.");
            throw new MetaAIExceptions.MetaAIException("Network error contacting Meta AI API.", null, ex);
        }

        // ── Process response ───────────────────────────────────────────────────
        using (response)
        {
            var statusCode = (int)response.StatusCode;

            if (!response.IsSuccessStatusCode)
            {
                // Log status code only — never log response body which may contain sensitive content.
                if (statusCode is 401 or 403)
                {
                    _logger?.LogError("[MetaAIClient] Authentication failure: HTTP {Status}.", statusCode);
                    throw new MetaAIExceptions.MetaAIAuthException(statusCode);
                }
                if (statusCode == 429)
                {
                    _logger?.LogWarning("[MetaAIClient] Rate limit reached: HTTP 429.");
                    throw new MetaAIExceptions.MetaAIRateLimitException();
                }
                if (statusCode >= 500)
                {
                    _logger?.LogWarning("[MetaAIClient] Meta AI upstream error: HTTP {Status}.", statusCode);
                    throw new MetaAIExceptions.MetaAIException(
                        $"Meta AI API returned server error (HTTP {statusCode}).", statusCode);
                }
                _logger?.LogError("[MetaAIClient] Unexpected response: HTTP {Status}.", statusCode);
                throw new MetaAIExceptions.MetaAIException(
                    $"Meta AI API returned HTTP {statusCode}.", statusCode);
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;

                // Extract content from choices[0].message.content
                var choices = root.GetProperty("choices");
                if (choices.GetArrayLength() == 0)
                    throw new MetaAIExceptions.MetaAIMalformedResponseException("Response contained zero choices.");

                var msg = choices[0].GetProperty("message");
                var content = msg.TryGetProperty("content", out var contentEl)
                    ? contentEl.GetString() ?? string.Empty
                    : string.Empty;

                // Extract token usage from usage object
                var tokenUsage = new MetaTokenUsage();
                if (root.TryGetProperty("usage", out var usageEl))
                {
                    if (usageEl.TryGetProperty("prompt_tokens", out var pt))
                        tokenUsage.PromptTokens = pt.GetInt32();
                    if (usageEl.TryGetProperty("completion_tokens", out var ct))
                        tokenUsage.CompletionTokens = ct.GetInt32();
                    if (usageEl.TryGetProperty("total_tokens", out var tt))
                        tokenUsage.TotalTokens = tt.GetInt32();
                }

                return new MetaAIResponse { Content = content, TokenUsage = tokenUsage };
            }
            catch (MetaAIExceptions.MetaAIMalformedResponseException)
            {
                throw;
            }
            catch (JsonException ex)
            {
                _logger?.LogError("[MetaAIClient] Malformed JSON from Meta AI API.");
                throw new MetaAIExceptions.MetaAIMalformedResponseException("Response was not valid JSON.", ex);
            }
        }
    }
}
