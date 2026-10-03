using System.Text;
using System.Text.Json;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Configuration;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Services;

public class MistralMemoryRelevanceEvaluator
    : IMemoryRelevanceEvaluator
{
    private readonly HttpClient _httpClient;
    private readonly MistralOptions _options;

    public MistralMemoryRelevanceEvaluator(
        HttpClient httpClient,
        IOptions<MistralOptions> options)
    {
        _httpClient = httpClient;
        _options = options.Value;
    }

    public async Task<List<RetrievedMemory>> EvaluateAsync(
        string query,
        List<RetrievedMemory> candidates)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            throw new ArgumentException(
                "Query cannot be empty.",
                nameof(query));
        }

        if (candidates.Count == 0)
        {
            return new List<RetrievedMemory>();
        }

        var candidateData = candidates.Select(memory => new
        {
            memoryId = memory.MemoryId,
            content = memory.Content,
            memoryType = memory.MemoryType
        });

        var promptData = new
        {
            query,
            memories = candidateData
        };

        var userPrompt =
            JsonSerializer.Serialize(promptData);

        var requestBody = new
        {
            model = _options.Model,
            temperature = 0,
            response_format = new
            {
                type = "json_object"
            },
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content =
                        """
                        You are a memory relevance evaluator.

                        Your job is to determine which stored memories are genuinely useful, relevant, or provide helpful context for answering the user's query.

                        A memory is relevant if:
                        - It directly answers, informs, or relates to the query.
                        - It represents a paraphrase, equivalent question, user preference, relevant fact, decision, or necessary context.

                        Reject memories that are completely unrelated or merely share coincidental words without meaningful connection.

                        If no memory is relevant, return an empty list.

                        Return valid JSON using exactly this structure:

                        {
                          "relevantMemoryIds": [1, 2]
                        }
                        """
                },
                new
                {
                    role = "user",
                    content = userPrompt
                }
            }
        };

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://api.mistral.ai/v1/chat/completions");

        request.Headers.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue(
                "Bearer",
                _options.ApiKey);

        var json =
            JsonSerializer.Serialize(requestBody);

        request.Content =
            new StringContent(
                json,
                Encoding.UTF8,
                "application/json");

        using var response =
            await _httpClient.SendAsync(request);

        var responseContent =
            await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Mistral relevance evaluation failed. " +
                $"Status: {(int)response.StatusCode}. " +
                $"Response: {responseContent}");
        }

        using var document =
            JsonDocument.Parse(responseContent);

        var content =
            document.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

        if (string.IsNullOrWhiteSpace(content))
        {
            return new List<RetrievedMemory>();
        }

        using var resultDocument =
            JsonDocument.Parse(content);

        if (!resultDocument.RootElement
                .TryGetProperty(
                    "relevantMemoryIds",
                    out var idsElement))
        {
            return new List<RetrievedMemory>();
        }

        var relevantIds =
            idsElement
                .EnumerateArray()
                .Select(x => x.GetInt64())
                .ToHashSet();

        return candidates
            .Where(memory =>
                relevantIds.Contains(memory.MemoryId))
            .ToList();
    }
}