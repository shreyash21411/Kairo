using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Meta;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;

namespace Kairo.Infrastructure.Meta;

/// <summary>
/// Memory Engine implementation powered by the Meta Model API.
/// Accepts a raw conversation transcript (or an ordered list of messages) and returns
/// typed structured project memory via IMetaAIClient.
///
/// This class is NOT IMemoryExtractor. It does NOT interact with MemoryIngestionService,
/// ILlmProvider, or any Mistral service. The result is returned to the caller — never persisted.
/// Calls are explicitly triggered by the user via VoidzoneController.
/// </summary>
public class MetaMemoryService : IMetaMemoryService
{
    private readonly IMetaAIClient _client;

    // ── Structured output schema (flat, non-recursive) ─────────────────────────
    // All properties are either string arrays or plain strings.
    // Recursive schemas are not supported by the Meta API.
    private static readonly object MemoryExtractionSchema = new
    {
        type = "object",
        properties = new
        {
            decisions       = new { type = "array", items = new { type = "string" } },
            requirements    = new { type = "array", items = new { type = "string" } },
            constraints     = new { type = "array", items = new { type = "string" } },
            goals           = new { type = "array", items = new { type = "string" } },
            technicalContext = new { type = "string" },
            pendingTasks    = new { type = "array", items = new { type = "string" } },
            projectFacts    = new { type = "array", items = new { type = "string" } }
        },
        required = new[] { "decisions", "requirements", "constraints", "goals",
                           "technicalContext", "pendingTasks", "projectFacts" },
        additionalProperties = false
    };

    private static readonly MetaAIJsonSchema OutputSchema = new()
    {
        Name   = "memory_extraction",
        Schema = MemoryExtractionSchema
    };

    private const string SystemPromptText =
        "You are a precise technical memory extractor. " +
        "Given the conversation, extract the structured project memory in valid JSON " +
        "matching the provided schema. " +
        "Return ONLY valid JSON — no markdown, no code fences, no explanation. " +
        "If a field has no relevant content, return an empty array or empty string.";

    public MetaMemoryService(IMetaAIClient client)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
    }

    /// <inheritdoc />
    public async Task<MetaMemoryResult> ExtractAsync(
        string rawTranscript,
        IReadOnlyList<MetaConversationMessage> messages,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(rawTranscript))
            throw new ArgumentException("rawTranscript must not be empty.", nameof(rawTranscript));

        // Build user prompt: prefer structured messages if provided; else use raw transcript.
        string userPrompt;
        if (messages is { Count: > 0 })
        {
            var sb = new StringBuilder();
            foreach (var msg in messages)
                sb.AppendLine($"{msg.Role.ToUpperInvariant()}: {msg.Content}");
            userPrompt = sb.ToString();
        }
        else
        {
            userPrompt = rawTranscript;
        }

        var request = new MetaAIRequest
        {
            SystemPrompt = SystemPromptText,
            UserPrompt   = userPrompt,
            Temperature  = 0.0,
            OutputSchema = OutputSchema
        };

        var response = await _client.CompleteAsync(request, cancellationToken).ConfigureAwait(false);

        // Empty content means the model returned nothing useful — return empty result.
        if (string.IsNullOrWhiteSpace(response.Content))
        {
            return new MetaMemoryResult
            {
                TokenUsage   = response.TokenUsage,
                ExtractedAt  = DateTime.UtcNow.ToString("O")
            };
        }

        try
        {
            using var doc = JsonDocument.Parse(response.Content);
            var root = doc.RootElement;

            return new MetaMemoryResult
            {
                Decisions        = ReadStringArray(root, "decisions"),
                Requirements     = ReadStringArray(root, "requirements"),
                Constraints      = ReadStringArray(root, "constraints"),
                Goals            = ReadStringArray(root, "goals"),
                TechnicalContext = ReadString(root, "technicalContext"),
                PendingTasks     = ReadStringArray(root, "pendingTasks"),
                ProjectFacts     = ReadStringArray(root, "projectFacts"),
                TokenUsage       = response.TokenUsage,
                ExtractedAt      = DateTime.UtcNow.ToString("O")
            };
        }
        catch (JsonException ex)
        {
            throw new MetaAIExceptions.MetaAIMalformedResponseException(
                "Memory extraction response was not valid JSON.", ex);
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private static List<string> ReadStringArray(JsonElement root, string propertyName)
    {
        var result = new List<string>();
        if (!root.TryGetProperty(propertyName, out var el)) return result;
        if (el.ValueKind != JsonValueKind.Array) return result;
        foreach (var item in el.EnumerateArray())
        {
            var s = item.GetString();
            if (!string.IsNullOrWhiteSpace(s))
                result.Add(s);
        }
        return result;
    }

    private static string ReadString(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var el)) return string.Empty;
        return el.GetString() ?? string.Empty;
    }
}

