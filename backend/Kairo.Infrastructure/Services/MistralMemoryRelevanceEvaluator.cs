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
/// Phase 4B: Mistral-backed memory relevance evaluator.
/// Determines which retrieved candidate memories are relevant to the query.
/// Delegates raw chat completion transport to ILlmProvider while preserving prompt engineering and JSON parsing.
/// </summary>
public class MistralMemoryRelevanceEvaluator : IMemoryRelevanceEvaluator
{
    private readonly ILlmProvider _llmProvider;

    /// <summary>
    /// Modern constructor resolving ILlmProvider via DI.
    /// </summary>
    [ActivatorUtilitiesConstructor]
    public MistralMemoryRelevanceEvaluator(ILlmProvider llmProvider)
    {
        _llmProvider = llmProvider ?? throw new ArgumentNullException(nameof(llmProvider));
    }

    /// <summary>
    /// Backward-compatible constructor for existing callers and legacy test fixtures.
    /// </summary>
    public MistralMemoryRelevanceEvaluator(
        HttpClient httpClient,
        IOptions<MistralOptions> options)
        : this(new MistralLlmProvider(httpClient, options))
    {
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

        var systemPrompt = """
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
            """;

        var request = new LlmCompletionRequest
        {
            SystemPrompt = systemPrompt,
            UserPrompt = userPrompt,
            Temperature = 0.0,
            EnforceJsonOutput = true
        };

        var content = await _llmProvider.GenerateChatCompletionAsync(request);

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