using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Providers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Services;

/// <summary>
/// Phase 4B: Adapter implementing IMemoryExtractor.
/// Preserves exact memory extraction prompt engineering, temperature (0.1), and response schema,
/// while delegating raw HTTP chat completion transport to ILlmProvider.
/// </summary>
public class MistralMemoryExtractor : IMemoryExtractor
{
    private readonly ILlmProvider _llmProvider;

    /// <summary>
    /// Modern constructor resolving ILlmProvider via DI.
    /// </summary>
    [ActivatorUtilitiesConstructor]
    public MistralMemoryExtractor(ILlmProvider llmProvider)
    {
        _llmProvider = llmProvider ?? throw new ArgumentNullException(nameof(llmProvider));
    }

    /// <summary>
    /// Backward-compatible constructor for existing callers and legacy test fixtures.
    /// </summary>
    public MistralMemoryExtractor(
        HttpClient httpClient,
        IOptions<MistralOptions> options)
        : this(new MistralLlmProvider(httpClient, options))
    {
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

        var request = new LlmCompletionRequest
        {
            SystemPrompt = systemPrompt,
            UserPrompt = conversation,
            Temperature = 0.1,
            EnforceJsonOutput = true
        };

        var content = await _llmProvider.GenerateChatCompletionAsync(request);

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