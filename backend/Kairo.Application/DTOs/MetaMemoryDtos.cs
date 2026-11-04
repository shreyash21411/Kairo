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
    /// <summary>Inferred or declared project name.</summary>
    public string ProjectName { get; set; } = string.Empty;

    /// <summary>High-level purpose and problem the project solves.</summary>
    public string ProjectPurpose { get; set; } = string.Empty;

    /// <summary>Description of the project scope and functionality.</summary>
    public string ProjectDescription { get; set; } = string.Empty;

    /// <summary>Key confirmed decisions made in this conversation.</summary>
    public List<string> Decisions { get; set; } = new();

    /// <summary>Explicit functional and technical requirements stated or confirmed.</summary>
    public List<string> Requirements { get; set; } = new();

    /// <summary>Hard constraints and security/architectural boundaries that must be respected.</summary>
    public List<string> Constraints { get; set; } = new();

    /// <summary>Goals the project is working toward.</summary>
    public List<string> Goals { get; set; } = new();

    /// <summary>Finalized technology stack components (languages, frameworks, tools, databases).</summary>
    public List<string> TechStack { get; set; } = new();

    /// <summary>Technical context: stack, tools, architecture, patterns.</summary>
    public string TechnicalContext { get; set; } = string.Empty;

    /// <summary>High-level technical architecture or modular structure.</summary>
    public string Architecture { get; set; } = string.Empty;

    /// <summary>Work that has actually been completed or implemented.</summary>
    public List<string> CompletedWork { get; set; } = new();

    /// <summary>Current state of progress.</summary>
    public string CurrentProgress { get; set; } = string.Empty;

    /// <summary>Tasks or roadmap phases that remain outstanding.</summary>
    public List<string> PendingTasks { get; set; } = new();

    /// <summary>Known blockers preventing progress.</summary>
    public List<string> Blockers { get; set; } = new();

    /// <summary>Key dependencies between components or systems.</summary>
    public List<string> Dependencies { get; set; } = new();

    /// <summary>Recommended next actions based on memory state.</summary>
    public List<string> NextActions { get; set; } = new();

    /// <summary>Unanswered architectural questions or pending scope clarifications.</summary>
    public List<string> OpenQuestions { get; set; } = new();

    /// <summary>Key domain entities, concepts, or terminology.</summary>
    public List<string> Entities { get; set; } = new();

    /// <summary>Other important project facts worth preserving.</summary>
    public List<string> ProjectFacts { get; set; } = new();

    /// <summary>Token usage as reported by the Meta API.</summary>
    public MetaTokenUsage TokenUsage { get; set; } = new();

    /// <summary>ISO-8601 timestamp of when the extraction was performed.</summary>
    public string ExtractedAt { get; set; } = string.Empty;
}
