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
    private static readonly object MemoryExtractionSchema = new
    {
        type = "object",
        properties = new
        {
            projectName        = new { type = "string" },
            projectPurpose     = new { type = "string" },
            projectDescription = new { type = "string" },
            decisions          = new { type = "array", items = new { type = "string" } },
            requirements       = new { type = "array", items = new { type = "string" } },
            constraints        = new { type = "array", items = new { type = "string" } },
            goals              = new { type = "array", items = new { type = "string" } },
            techStack          = new { type = "array", items = new { type = "string" } },
            technicalContext   = new { type = "string" },
            architecture       = new { type = "string" },
            completedWork      = new { type = "array", items = new { type = "string" } },
            currentProgress    = new { type = "string" },
            pendingTasks       = new { type = "array", items = new { type = "string" } },
            blockers           = new { type = "array", items = new { type = "string" } },
            dependencies       = new { type = "array", items = new { type = "string" } },
            nextActions        = new { type = "array", items = new { type = "string" } },
            openQuestions      = new { type = "array", items = new { type = "string" } },
            entities           = new { type = "array", items = new { type = "string" } },
            projectFacts       = new { type = "array", items = new { type = "string" } }
        },
        required = new[] {
            "projectName", "projectPurpose", "projectDescription",
            "decisions", "requirements", "constraints", "goals",
            "techStack", "technicalContext", "architecture",
            "completedWork", "currentProgress", "pendingTasks",
            "blockers", "dependencies", "nextActions", "openQuestions",
            "entities", "projectFacts"
        },
        additionalProperties = false
    };

    private static readonly MetaAIJsonSchema OutputSchema = new()
    {
        Name   = "memory_extraction",
        Schema = MemoryExtractionSchema
    };

    private const string SystemPromptText =
        "You are an expert technical project memory extraction engine for VOIDZONE.\n" +
        "Your task is to analyze conversational project discussions between a user and an assistant and extract structured, high-fidelity project knowledge matching the provided schema.\n\n" +
        "Follow these strict principles:\n" +
        "1. ACCURACY & EVIDENCE: Extract only facts explicitly stated, proposed, or agreed upon in the transcript. Do NOT hallucinate, fabricate, or invent missing information. If a field has no information, return an empty string or empty array.\n" +
        "2. PROJECT IDENTITY & PURPOSE: Extract the exact project name (e.g. 'KAIRO'), purpose (e.g. campus event management, ticketing, and payments), and scope description. Never use placeholder values like 'Default' if a project name is present.\n" +
        "3. CONFIRMED DECISIONS VS PROPOSALS: Distinguish confirmed decisions (e.g. user-accepted technology stack, agreed architectures) from open proposals or suggestions.\n" +
        "4. REQUIREMENTS: Extract all functional and non-functional requirements mentioned (e.g. create events, publish details, set ticket prices, QR ticket generation, entrance QR scanning, duplicate ticket prevention, online payments, payment verification, refund tracking).\n" +
        "5. TECHNOLOGY STACK: Extract all finalized technologies, languages, frameworks, databases, and tools (e.g. React.js, TypeScript, Tailwind CSS, Python, FastAPI, PostgreSQL, SQLAlchemy, Alembic, Pydantic, JWT, Razorpay, Redis, Swagger/OpenAPI, Git+GitHub, VS Code). Preserve timing nuances (e.g. if Redis is designated for 'later', note it as 'Redis (later)').\n" +
        "6. HARD CONSTRAINTS: Capture explicit security, architectural, and operational constraints (e.g. 'Payment verification must occur server-side using gateway signature verification and webhooks; do not trust frontend success messages as proof of payment').\n" +
        "7. COMPLETED WORK VS ROADMAP TASKS: Distinguish work already completed from planned roadmap phases and pending tasks.\n" +
        "8. OPEN QUESTIONS: Capture unanswered architectural questions, scope decisions, or user role clarifications awaiting user decision.\n" +
        "9. OUTPUT FORMAT: Return ONLY valid JSON matching the schema. No markdown fences, no explanatory commentary.";

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
        var sb = new StringBuilder();
        sb.AppendLine("Analyze the following conversation and extract structured project memory according to the schema:");
        sb.AppendLine();
        sb.AppendLine("=== CONVERSATION TRANSCRIPT ===");
        if (messages is { Count: > 0 })
        {
            foreach (var msg in messages)
                sb.AppendLine($"{msg.Role.ToUpperInvariant()}: {msg.Content}");
        }
        else
        {
            sb.AppendLine(rawTranscript);
        }
        sb.AppendLine("=== END TRANSCRIPT ===");

        var request = new MetaAIRequest
        {
            SystemPrompt = SystemPromptText,
            UserPrompt   = sb.ToString(),
            Temperature  = 0.0,
            OutputSchema = OutputSchema
        };

        var response = await _client.CompleteAsync(request, cancellationToken).ConfigureAwait(false);

        // Empty content means the model returned nothing useful — return empty result.
        if (string.IsNullOrWhiteSpace(response.Content))
        {
            return new MetaMemoryResult
            {
                TokenUsage  = response.TokenUsage,
                ExtractedAt = DateTime.UtcNow.ToString("O")
            };
        }

        try
        {
            var cleanJson = ExtractJson(response.Content);
            using var doc = JsonDocument.Parse(cleanJson);
            var root = doc.RootElement;

            return new MetaMemoryResult
            {
                ProjectName        = ReadString(root, "projectName"),
                ProjectPurpose     = ReadString(root, "projectPurpose"),
                ProjectDescription = ReadString(root, "projectDescription"),
                Decisions          = ReadStringArray(root, "decisions"),
                Requirements       = ReadStringArray(root, "requirements"),
                Constraints        = ReadStringArray(root, "constraints"),
                Goals              = ReadStringArray(root, "goals"),
                TechStack          = ReadStringArray(root, "techStack"),
                TechnicalContext   = ReadString(root, "technicalContext"),
                Architecture       = ReadString(root, "architecture"),
                CompletedWork      = ReadStringArray(root, "completedWork"),
                CurrentProgress    = ReadString(root, "currentProgress"),
                PendingTasks       = ReadStringArray(root, "pendingTasks"),
                Blockers           = ReadStringArray(root, "blockers"),
                Dependencies       = ReadStringArray(root, "dependencies"),
                NextActions        = ReadStringArray(root, "nextActions"),
                OpenQuestions      = ReadStringArray(root, "openQuestions"),
                Entities           = ReadStringArray(root, "entities"),
                ProjectFacts       = ReadStringArray(root, "projectFacts"),
                TokenUsage         = response.TokenUsage,
                ExtractedAt        = DateTime.UtcNow.ToString("O")
            };
        }
        catch (JsonException ex)
        {
            throw new MetaAIExceptions.MetaAIMalformedResponseException(
                "Memory extraction response was not valid JSON.", ex);
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
