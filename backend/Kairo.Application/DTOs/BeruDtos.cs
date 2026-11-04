using System.Collections.Generic;
using Kairo.Application.Abstractions.Meta;

namespace Kairo.Application.DTOs;

/// <summary>
/// A single turn in a conversational exchange with BERU.
/// </summary>
public class BeruMessageItem
{
    public string Role { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
}

/// <summary>
/// Request payload for chatting with the BERU voice agent.
/// </summary>
public class BeruChatRequest
{
    /// <summary>The spoken transcript or typed message from the user.</summary>
    public string Message { get; set; } = string.Empty;

    /// <summary>Optional explicit project identifier to constrain context.</summary>
    public string? ProjectId { get; set; }

    /// <summary>Optional structured project context (e.g. extracted memory or continuity state).</summary>
    public string? ProjectContext { get; set; }

    /// <summary>Optional prior turns in the voice conversation session.</summary>
    public List<BeruMessageItem>? History { get; set; }
}

/// <summary>
/// Response payload from the BERU voice agent.
/// </summary>
public class BeruChatResponse
{
    /// <summary>Natural voice-friendly text response to be synthesized by the client.</summary>
    public string Reply { get; set; } = string.Empty;

    /// <summary>Token usage as reported by the Meta reasoning backend.</summary>
    public MetaTokenUsage TokenUsage { get; set; } = new();

    /// <summary>ISO-8601 timestamp of when the response was generated.</summary>
    public string RespondedAt { get; set; } = string.Empty;
}

