using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Services;

public class MistralEmbeddingGenerator : IEmbeddingGenerator
{
    private readonly HttpClient _httpClient;
    private readonly MistralEmbeddingOptions _options;

    public MistralEmbeddingGenerator(
        HttpClient httpClient,
        IOptions<MistralEmbeddingOptions> options)
    {
        _httpClient = httpClient;
        _options = options.Value;
    }

    public async Task<float[]> GenerateAsync(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new ArgumentException(
                "Text cannot be empty.",
                nameof(text));
        }

        var requestBody = new
        {
            model = _options.Model,
            input = new[]
            {
                text
            }
        };

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://api.mistral.ai/v1/embeddings");

        request.Headers.Authorization =
            new AuthenticationHeaderValue(
                "Bearer",
                _options.ApiKey);

        var json = JsonSerializer.Serialize(requestBody);

        request.Content = new StringContent(
            json,
            Encoding.UTF8,
            "application/json");

        using var response = await _httpClient.SendAsync(request);

        var responseContent =
            await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Mistral embedding request failed. " +
                $"Status: {(int)response.StatusCode}. " +
                $"Response: {responseContent}");
        }

        using var document =
            JsonDocument.Parse(responseContent);

        var embedding =
            document.RootElement
                .GetProperty("data")[0]
                .GetProperty("embedding");

        var result = new float[embedding.GetArrayLength()];

        for (var i = 0; i < result.Length; i++)
        {
            result[i] =
                embedding[i].GetSingle();
        }

        return result;
    }
}