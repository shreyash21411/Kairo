using System;
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
/// Phase 4B: Concrete Mistral implementation of IEmbeddingProvider.
/// Generates vector embeddings using Mistral's /v1/embeddings endpoint.
/// Enforces dimensional consistency and normalizes error responses into typed exceptions.
/// </summary>
public class MistralEmbeddingProvider : IEmbeddingProvider
{
    private readonly HttpClient _httpClient;
    private readonly MistralEmbeddingOptions _options;
    private readonly ILogger<MistralEmbeddingProvider>? _logger;

    public const string ProviderIdentifier = "Mistral";
    public const int DefaultMistralDimensions = 1024;

    public string ProviderName => ProviderIdentifier;
    public string ModelName => string.IsNullOrWhiteSpace(_options.Model) ? "mistral-embed" : _options.Model;
    public int ExpectedDimensions => DefaultMistralDimensions;

    public MistralEmbeddingProvider(
        HttpClient httpClient,
        IOptions<MistralEmbeddingOptions> options,
        ILogger<MistralEmbeddingProvider>? logger = null)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _options = options?.Value ?? throw new ArgumentNullException(nameof(options));
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<float[]> GenerateEmbeddingAsync(
        string text,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new ArgumentException("Text cannot be empty.", nameof(text));
        }

        var requestBody = new
        {
            model = ModelName,
            input = new[] { text }
        };

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://api.mistral.ai/v1/embeddings");

        if (!string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        }

        var json = JsonSerializer.Serialize(requestBody);
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");

        HttpResponseMessage response;
        try
        {
            response = await _httpClient.SendAsync(request, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (HttpRequestException ex)
        {
            _logger?.LogWarning(ex, "[MistralEmbeddingProvider] Transient network error contacting Mistral API.");
            throw new ProviderTransientException(ProviderName, "Transient network error contacting Mistral embedding API.", null, ex);
        }

        using (response)
        {
            var statusCode = (int)response.StatusCode;

            if (!response.IsSuccessStatusCode)
            {
                if (statusCode == 401 || statusCode == 403)
                {
                    _logger?.LogError("[MistralEmbeddingProvider] Authentication failure: HTTP {Status}", statusCode);
                    throw new ProviderAuthenticationException(ProviderName, "Authentication failed for Mistral embedding API. Verify ApiKey.");
                }

                if (statusCode == 429)
                {
                    _logger?.LogWarning("[MistralEmbeddingProvider] Rate limit reached: HTTP 429");
                    throw new ProviderTransientException(ProviderName, "Mistral embedding API rate limit reached.", 429);
                }

                if (statusCode >= 500 && statusCode <= 599)
                {
                    _logger?.LogWarning("[MistralEmbeddingProvider] Upstream server error: HTTP {Status}", statusCode);
                    throw new ProviderTransientException(ProviderName, $"Mistral embedding API service error (HTTP {statusCode}).", statusCode);
                }

                _logger?.LogError("[MistralEmbeddingProvider] Request failed with HTTP {Status}", statusCode);
                throw new ProviderException(ProviderName, $"Mistral embedding request failed with HTTP {statusCode}.", statusCode);
            }

            var responseContent = await response.Content.ReadAsStringAsync(cancellationToken);

            using var document = JsonDocument.Parse(responseContent);
            if (!document.RootElement.TryGetProperty("data", out var dataElement) ||
                dataElement.GetArrayLength() == 0 ||
                !dataElement[0].TryGetProperty("embedding", out var embeddingElement))
            {
                throw new ProviderException(ProviderName, "Mistral embedding API returned a response missing the expected data[0].embedding property.");
            }

            var length = embeddingElement.GetArrayLength();
            if (length != ExpectedDimensions)
            {
                throw new IncompatibleEmbeddingDimensionException(ModelName, ExpectedDimensions, length);
            }

            var result = new float[length];
            var i = 0;
            foreach (var val in embeddingElement.EnumerateArray())
            {
                result[i++] = val.GetSingle();
            }

            return result;
        }
    }
}
