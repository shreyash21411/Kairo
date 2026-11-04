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
            projectName           = new { type = "string" },
            projectPurpose        = new { type = "string" },
            currentObjective      = new { type = "string" },
            importantDecisions    = new { type = "array", items = new { type = "string" } },
            proposedDecisions     = new { type = "array", items = new { type = "string" } },
            openQuestions         = new { type = "array", items = new { type = "string" } },
            confirmedRequirements = new { type = "array", items = new { type = "string" } },
            constraints           = new { type = "array", items = new { type = "string" } },
            completedWork         = new { type = "array", items = new { type = "string" } },
            currentProgress       = new { type = "string" },
            outstandingTasks      = new { type = "array", items = new { type = "string" } },
            blockers              = new { type = "array", items = new { type = "string" } },
            dependencies          = new { type = "array", items = new { type = "string" } },
            recommendedNextAction = new { type = "string" },
            technicalContext      = new { type = "string" },
            conversationContext   = new { type = "string" }
        },
        required = new[] {
            "projectName", "projectPurpose", "currentObjective",
            "importantDecisions", "proposedDecisions", "openQuestions",
            "confirmedRequirements", "constraints", "completedWork",
            "currentProgress", "outstandingTasks", "blockers",
            "dependencies", "recommendedNextAction", "technicalContext",
            "conversationContext"
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
        "You are an expert technical continuity synthesizer for the VOIDZONE platform ({0}).\n" +
        "Conversation context title: {1}.\n" +
        "Your purpose is to transform a conversation transcript into a dense, actionable continuity state so another AI assistant can seamlessly resume work without losing context or intent.\n\n" +
        "Follow these strict principles:\n" +
        "1. PROJECT NAME & PURPOSE: Extract the actual project name (e.g. 'KAIRO') and its explicit purpose (e.g. campus event management, ticketing, and payments). Never return 'Default' or empty if a name or purpose exists.\n" +
        "2. CURRENT OBJECTIVE: Identify the specific active goal (e.g. 'Setting up development stack and architecture for campus event management').\n" +
        "3. DECISION DISCIPLINE:\n" +
        "   - 'importantDecisions' must contain ONLY decisions confirmed, agreed to, or finalized by the user (e.g. finalized technology stack: React, TypeScript, Tailwind, Python, FastAPI, PostgreSQL, SQLAlchemy, Alembic, Pydantic, JWT, Razorpay).\n" +
        "   - 'proposedDecisions' contains assistant recommendations that have not yet been explicitly approved.\n" +
        "   - 'openQuestions' contains architectural, scope, or role questions that were asked but not yet answered (e.g. initial platform scope, user roles).\n" +
        "4. REQUIREMENTS & CONSTRAINTS:\n" +
        "   - 'confirmedRequirements': Concrete capabilities requested (e.g. event creation, ticket publishing, QR ticketing, entrance scanning, online payments, refund tracking).\n" +
        "   - 'constraints': Hard architectural, security, and timing boundaries (e.g. server-side signature verification and webhooks for payments; never trust frontend success alone; Redis is a later addition).\n" +
        "5. OUTSTANDING TASKS: Preserve the roadmap phases or pending tasks (e.g. Phases 1-9 roadmap items).\n" +
        "6. RECOMMENDED NEXT ACTION: Derive a concrete, high-leverage next step from the actual project state (e.g. 'Clarify initial platform scope and user roles, then begin Phase 1: Environment and stack setup'). Do NOT output generic clichés like 'Review outstanding tasks' or 'Continue active session'.\n" +
        "7. TECHNICAL CONTEXT: Compact summary of the finalized stack, languages, frameworks, and tools.\n" +
        "8. OUTPUT FORMAT: Return ONLY valid JSON matching the schema. No markdown fences, no explanatory text.";

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

        var sb = new StringBuilder();
        sb.AppendLine($"Platform: {platform ?? "Unknown"}");
        sb.AppendLine($"Title: {title ?? "Untitled"}");
        sb.AppendLine();
        sb.AppendLine("=== CONVERSATION TRANSCRIPT ===");
        sb.AppendLine(rawTranscript);
        sb.AppendLine("=== END TRANSCRIPT ===");
        sb.AppendLine();
        sb.AppendLine("Generate the structured continuity state according to the schema:");

        var request = new MetaAIRequest
        {
            SystemPrompt = systemPrompt,
            UserPrompt   = sb.ToString(),
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
            var cleanJson = ExtractJson(response.Content);
            using var doc = JsonDocument.Parse(cleanJson);
            var root = doc.RootElement;

            return new MetaContinuityResult
            {
                ProjectName           = ReadString(root, "projectName"),
                ProjectPurpose        = ReadString(root, "projectPurpose"),
                CurrentObjective      = ReadString(root, "currentObjective"),
                ImportantDecisions    = ReadStringArray(root, "importantDecisions"),
                ProposedDecisions     = ReadStringArray(root, "proposedDecisions"),
                OpenQuestions         = ReadStringArray(root, "openQuestions"),
                ConfirmedRequirements = ReadStringArray(root, "confirmedRequirements"),
                Constraints           = ReadStringArray(root, "constraints"),
                CompletedWork         = ReadStringArray(root, "completedWork"),
                CurrentProgress       = ReadString(root, "currentProgress"),
                OutstandingTasks      = ReadStringArray(root, "outstandingTasks"),
                Blockers              = ReadStringArray(root, "blockers"),
                Dependencies          = ReadStringArray(root, "dependencies"),
                RecommendedNextAction = ReadString(root, "recommendedNextAction"),
                TechnicalContext      = ReadString(root, "technicalContext"),
                ConversationContext   = ReadString(root, "conversationContext"),
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

    private static string ExtractJson(string content)
    {
        if (string.IsNullOrWhiteSpace(content)) return "{}";
        var trimmed = content.Trim();
        if (trimmed.StartsWith("```json", StringComparison.OrdinalIgnoreCase))
        {
            trimmed = trimmed.Substring(7);
            if (trimmed.EndsWith("```"))
                trimmed = trimmed.Substring(0, trimmed.Length - 3);
            trimmed = trimmed.Trim();
        }
        else if (trimmed.StartsWith("```"))
        {
            trimmed = trimmed.Substring(3);
            if (trimmed.EndsWith("```"))
                trimmed = trimmed.Substring(0, trimmed.Length - 3);
            trimmed = trimmed.Trim();
        }

        var startIdx = trimmed.IndexOf('{');
        var endIdx = trimmed.LastIndexOf('}');
        if (startIdx >= 0 && endIdx > startIdx)
        {
            return trimmed.Substring(startIdx, endIdx - startIdx + 1);
        }
        return trimmed;
    }

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
