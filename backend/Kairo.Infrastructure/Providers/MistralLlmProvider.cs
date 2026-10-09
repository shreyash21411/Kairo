using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Providers;

/// <summary>
/// Phase 4B: Concrete Mistral implementation of ILlmProvider.
/// Sends chat completion requests to Mistral's /v1/chat/completions endpoint.
/// Centralizes transport, JSON-mode formatting, error normalization, and credential protection.
/// </summary>
public class MistralLlmProvider : ILlmProvider
{
    private readonly HttpClient _httpClient;
    private readonly MistralOptions _options;
    private readonly ILogger<MistralLlmProvider>? _logger;

    public const string ProviderIdentifier = "Mistral";

    public string ProviderName => ProviderIdentifier;
    public string DefaultModel => string.IsNullOrWhiteSpace(_options.Model) ? "mistral-small-latest" : _options.Model;

    public MistralLlmProvider(
        HttpClient httpClient,
        IOptions<MistralOptions> options,
        ILogger<MistralLlmProvider>? logger = null)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _options = options?.Value ?? throw new ArgumentNullException(nameof(options));
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<string> GenerateChatCompletionAsync(
        LlmCompletionRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request == null)
        {
            throw new ArgumentNullException(nameof(request));
        }

        var messages = new List<object>();

        if (!string.IsNullOrWhiteSpace(request.SystemPrompt))
        {
            messages.Add(new
            {
                role = "system",
                content = request.SystemPrompt
            });
        }

        messages.Add(new
        {
            role = "user",
            content = request.UserPrompt
        });

        object requestBody;
        if (request.EnforceJsonOutput)
        {
            requestBody = new
            {
                model = !string.IsNullOrWhiteSpace(request.Model) ? request.Model : DefaultModel,
                messages,
                temperature = request.Temperature,
                response_format = new { type = "json_object" }
            };
        }
        else
        {
            requestBody = new
            {
                model = !string.IsNullOrWhiteSpace(request.Model) ? request.Model : DefaultModel,
                messages,
                temperature = request.Temperature
            };
        }

        using var httpRequest = new HttpRequestMessage(
            HttpMethod.Post,
            "https://api.mistral.ai/v1/chat/completions");

        if (!string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        }

        var json = JsonSerializer.Serialize(requestBody);
        httpRequest.Content = new StringContent(json, Encoding.UTF8, "application/json");

        HttpResponseMessage response;
        try
        {
            response = await _httpClient.SendAsync(httpRequest, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (HttpRequestException ex)
        {
            _logger?.LogWarning(ex, "[MistralLlmProvider] Transient network error contacting Mistral API.");
            throw new ProviderTransientException(ProviderName, "Transient network error contacting Mistral chat API.", null, ex);
        }

        using (response)
        {
            var statusCode = (int)response.StatusCode;

            if (!response.IsSuccessStatusCode)
            {
                if (statusCode == 401 || statusCode == 403)
                {
                    _logger?.LogError("[MistralLlmProvider] Authentication failure: HTTP {Status}", statusCode);
                    throw new ProviderAuthenticationException(ProviderName, "Authentication failed for Mistral chat API. Verify ApiKey.");
                }

                if (statusCode == 429)
                {
                    _logger?.LogWarning("[MistralLlmProvider] Rate limit reached: HTTP 429");
                    throw new ProviderTransientException(ProviderName, "Mistral chat completion API rate limit reached.", 429);
                }

                if (statusCode >= 500 && statusCode <= 599)
                {
                    _logger?.LogWarning("[MistralLlmProvider] Upstream server error: HTTP {Status}", statusCode);
                    throw new ProviderTransientException(ProviderName, $"Mistral chat completion API service error (HTTP {statusCode}).", statusCode);
                }

                _logger?.LogError("[MistralLlmProvider] Request failed with HTTP {Status}", statusCode);
                throw new ProviderException(ProviderName, $"Mistral chat completion request failed with HTTP {statusCode}.", statusCode);
            }

            var responseContent = await response.Content.ReadAsStringAsync(cancellationToken);

            try
            {
                using var document = JsonDocument.Parse(responseContent);
                var choices = document.RootElement.GetProperty("choices");
                if (choices.GetArrayLength() == 0)
                {
                    return string.Empty;
                }

                var message = choices[0].GetProperty("message");
                if (!message.TryGetProperty("content", out var contentElement))
                {
                    return string.Empty;
                }

                return contentElement.GetString() ?? string.Empty;
            }
            catch (JsonException ex)
            {
                _logger?.LogError(ex, "[MistralLlmProvider] Malformed JSON received from Mistral API.");
                throw new ProviderException(ProviderName, "Mistral API returned malformed JSON response.", statusCode, ex);
            }
        }
    }
}
