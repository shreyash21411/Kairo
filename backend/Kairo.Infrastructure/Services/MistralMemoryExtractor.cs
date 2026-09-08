using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Services;

public class MistralMemoryExtractor : IMemoryExtractor
{
    private readonly HttpClient _httpClient;
    private readonly MistralOptions _options;

    public MistralMemoryExtractor(
        HttpClient httpClient,
        IOptions<MistralOptions> options)
    {
        _httpClient = httpClient;
        _options = options.Value;
    }

    public async Task<List<ExtractedMemory>> ExtractAsync(
        IEnumerable<CreateMessageRequest> messages)
    {
        var conversation = string.Join(
            "\n",
            messages.Select(message =>
                $"{message.Role}: {message.Content}"));

        var systemPrompt = """
            You are Kairo's memory extraction engine.

            Your job is to identify durable information from a conversation
            that would be useful in future conversations with the same user.

            Extract only information that is genuinely worth remembering.

            Valid memory types:
            - Fact
            - Preference
            - Goal
            - Decision
            - ProjectContext
            - Instruction

            Do NOT extract:
            - greetings
            - acknowledgements
            - temporary debugging information
            - ordinary conversational filler
            - questions that do not reveal durable information
            - information that is only useful for the current moment
            - the entire conversation
            - duplicate information

            Rewrite memories as concise standalone statements.

            Return ONLY valid JSON in this exact format:

            {
              "memories": [
                {
                  "content": "string",
                  "memoryType": "Fact"
                }
              ]
            }

            If there are no useful memories, return:

            {
              "memories": []
            }
            """;

        var requestBody = new
        {
            model = _options.Model,
            messages = new[]
            {
                new
                {
                    role = "system",
                    content = systemPrompt
                },
                new
                {
                    role = "user",
                    content = conversation
                }
            },
            temperature = 0.1,
            response_format = new
            {
                type = "json_object"
            }
        };

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://api.mistral.ai/v1/chat/completions");

        request.Headers.Authorization =
            new AuthenticationHeaderValue(
                "Bearer",
                _options.ApiKey);

        var json = JsonSerializer.Serialize(requestBody);

        request.Content = new StringContent(
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
                $"Mistral API request failed. " +
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
            return new List<ExtractedMemory>();
        }

        var extraction =
            JsonSerializer.Deserialize<MemoryExtractionResponse>(
                content,
                new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

        return extraction?.Memories
            ?? new List<ExtractedMemory>();
    }
}

public class MemoryExtractionResponse
{
    public List<ExtractedMemory> Memories { get; set; } = new();
}