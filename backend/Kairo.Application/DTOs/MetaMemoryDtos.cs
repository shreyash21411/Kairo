using System.Collections.Generic;
using Kairo.Application.Abstractions.Meta;

namespace Kairo.Application.DTOs;

/// <summary>
/// A single conversation message submitted for Meta memory extraction.
/// </summary>
public class MetaConversationMessage
{
    /// <summary>Message role: "user", "assistant", or "system".</summary>
    public string Role { get; set; } = string.Empty;

    /// <summary>Message content text.</summary>
    public string Content { get; set; } = string.Empty;
}

/// <summary>
/// Structured project memory extracted by the Meta Memory Engine.
/// Returned to the caller — never persisted to the database by this operation.
///
/// MetaTokenUsage is defined once in Kairo.Application.Abstractions.Meta
/// and reused here and in MetaContinuityResult.
/// </summary>
public class MetaMemoryResult
{
    /// <summary>Key decisions made in this conversation.</summary>
    public List<string> Decisions { get; set; } = new();

    /// <summary>Explicit requirements stated or confirmed.</summary>
    public List<string> Requirements { get; set; } = new();

    /// <summary>Hard constraints that must be respected.</summary>
    public List<string> Constraints { get; set; } = new();

    /// <summary>Goals the project is working toward.</summary>
    public List<string> Goals { get; set; } = new();

    /// <summary>Technical context: stack, tools, architecture, patterns.</summary>
    public string TechnicalContext { get; set; } = string.Empty;

    /// <summary>Tasks that remain outstanding.</summary>
    public List<string> PendingTasks { get; set; } = new();

    /// <summary>Other important project facts worth preserving.</summary>
    public List<string> ProjectFacts { get; set; } = new();

    /// <summary>Token usage as reported by the Meta API.</summary>
    public MetaTokenUsage TokenUsage { get; set; } = new();

    /// <summary>ISO-8601 timestamp of when the extraction was performed.</summary>
    public string ExtractedAt { get; set; } = string.Empty;
}

