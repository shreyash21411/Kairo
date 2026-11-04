using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Meta;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;

namespace Kairo.Infrastructure.Meta;

/// <summary>
/// Continuity Engine implementation powered by the Meta Model API.
/// Generates a structured continuity summary from a raw conversation transcript.
///
/// The result is a standalone document — it does NOT modify ContinuityArchive,
/// does NOT change schemaVersion (remains 1.0), does NOT alter archive hashing,
/// and is NOT embedded in any archive field.
/// Calls are explicitly triggered by the user via VoidzoneController.
/// </summary>
public class MetaContinuityService : IMetaContinuityService
{
    private readonly IMetaAIClient _client;

    // ── Structured output schema (flat, non-recursive) ─────────────────────────
    private static readonly object ContinuitySchema = new
    {
        type = "object",
        properties = new
        {
            projectName             = new { type = "string" },
            currentObjective        = new { type = "string" },
            importantDecisions      = new { type = "array", items = new { type = "string" } },
            constraints             = new { type = "array", items = new { type = "string" } },
            completedWork           = new { type = "array", items = new { type = "string" } },
            outstandingTasks        = new { type = "array", items = new { type = "string" } },
            blockers                = new { type = "array", items = new { type = "string" } },
            recommendedNextAction   = new { type = "string" },
            technicalContext        = new { type = "string" }
        },
        required = new[] {
            "projectName", "currentObjective", "importantDecisions", "constraints",
            "completedWork", "outstandingTasks", "blockers",
            "recommendedNextAction", "technicalContext"
        },
        additionalProperties = false
    };

    private static readonly MetaAIJsonSchema OutputSchema = new()
    {
        Name   = "continuity_summary",
        Schema = ContinuitySchema
    };

    // {0} = platform, {1} = title
    private const string SystemPromptTemplate =
        "You are a precise technical continuity summariser for the {0} platform. " +
        "The conversation title is: {1}. " +
        "Given the conversation transcript, produce a structured continuity summary in valid JSON " +
        "matching the provided schema. " +
        "Return ONLY valid JSON — no markdown, no code fences, no explanation. " +
        "If a field has no relevant content, return an empty array or empty string.";

    public MetaContinuityService(IMetaAIClient client)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
    }

    /// <inheritdoc />
    public async Task<MetaContinuityResult> GenerateAsync(
        string rawTranscript,
        string platform,
        string title,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(rawTranscript))
            throw new ArgumentException("rawTranscript must not be empty.", nameof(rawTranscript));

        var systemPrompt = string.Format(SystemPromptTemplate, platform ?? string.Empty, title ?? string.Empty);

        var request = new MetaAIRequest
        {
            SystemPrompt = systemPrompt,
            UserPrompt   = rawTranscript,
            Temperature  = 0.0,
            OutputSchema = OutputSchema
        };

        var response = await _client.CompleteAsync(request, cancellationToken).ConfigureAwait(false);

        // Empty content — return empty result with usage and timestamp.
        if (string.IsNullOrWhiteSpace(response.Content))
        {
            return new MetaContinuityResult
            {
                TokenUsage  = response.TokenUsage,
                GeneratedAt = DateTime.UtcNow.ToString("O")
            };
        }

        try
        {
            using var doc = JsonDocument.Parse(response.Content);
            var root = doc.RootElement;

            return new MetaContinuityResult
            {
                ProjectName           = ReadString(root, "projectName"),
                CurrentObjective      = ReadString(root, "currentObjective"),
                ImportantDecisions    = ReadStringArray(root, "importantDecisions"),
                Constraints           = ReadStringArray(root, "constraints"),
                CompletedWork         = ReadStringArray(root, "completedWork"),
                OutstandingTasks      = ReadStringArray(root, "outstandingTasks"),
                Blockers              = ReadStringArray(root, "blockers"),
                RecommendedNextAction = ReadString(root, "recommendedNextAction"),
                TechnicalContext      = ReadString(root, "technicalContext"),
                TokenUsage            = response.TokenUsage,
                GeneratedAt           = DateTime.UtcNow.ToString("O")
            };
        }
        catch (JsonException ex)
        {
            throw new MetaAIExceptions.MetaAIMalformedResponseException(
                "Continuity generation response was not valid JSON.", ex);
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

