namespace Kairo.Application.Abstractions.Meta;

/// <summary>
/// Token usage reported by the Meta Model API in every completion response.
/// Defined exactly once — reused by MetaMemoryResult and MetaContinuityResult.
/// </summary>
public class MetaTokenUsage
{
    public int PromptTokens { get; set; }
    public int CompletionTokens { get; set; }
    public int TotalTokens { get; set; }
}

/// <summary>
/// Internal request payload passed to IMetaAIClient.
/// </summary>
public class MetaAIRequest
{
    /// <summary>System instructions establishing extraction persona and output schema.</summary>
    public string SystemPrompt { get; set; } = string.Empty;

    /// <summary>User content — the raw transcript or conversation to analyse.</summary>
    public string UserPrompt { get; set; } = string.Empty;

    /// <summary>Sampling temperature. Use 0.0 for deterministic structured extraction.</summary>
    public double Temperature { get; set; } = 0.0;

    /// <summary>
    /// JSON Schema definition for structured output enforcement.
    /// When non-null, sent as response_format type json_schema with strict: true.
    /// When null, falls back to response_format type json_object.
    /// </summary>
    public MetaAIJsonSchema? OutputSchema { get; set; }
}

/// <summary>
/// Carries the JSON Schema definition for structured output (response_format: json_schema).
/// The schema must be flat and non-recursive — recursive schemas are not supported
/// by the Meta API and will cause an HTTP 400 error.
/// </summary>
public class MetaAIJsonSchema
{
    /// <summary>Schema name — lowercase, underscore-separated. Required by the API.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// JSON Schema object. Must not contain recursive references.
    /// </summary>
    public object Schema { get; set; } = new object();
}

/// <summary>
/// Response returned by IMetaAIClient after a successful completion.
/// </summary>
public class MetaAIResponse
{
    /// <summary>Raw content string returned by the model (choices[0].message.content).</summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>Token usage as reported by the Meta API (usage.prompt_tokens etc.).</summary>
    public MetaTokenUsage TokenUsage { get; set; } = new();
}

