namespace Kairo.Application.Configuration;

/// <summary>
/// Configuration options for the Meta Model API integration.
/// Bound from the "MetaAI" section in IConfiguration.
/// The API key is sourced exclusively from .NET User Secrets ("MetaAI:ApiKey")
/// or the MetaAI__ApiKey environment variable. It is never in appsettings.json.
/// </summary>
public class MetaAIOptions
{
    public const string SectionName = "MetaAI";

    /// <summary>
    /// Enables or disables the Meta AI integration entirely.
    /// Defaults to false — both VoidzoneController endpoints reject requests when false.
    /// Must be explicitly set to true to permit any API call.
    /// No live API calls are made during development or testing.
    /// </summary>
    public bool Enabled { get; set; } = false;

    /// <summary>
    /// Meta Model API key. Never log, return from endpoints, or include in exception messages.
    /// </summary>
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>
    /// Model identifier — configurable so it can be updated without code changes.
    /// Verified against GET /v1/models at implementation time: muse-spark-1.3.
    /// </summary>
    public string Model { get; set; } = "muse-spark-1.3";

    /// <summary>
    /// Maximum estimated input size in tokens (approximated as characters / 4).
    /// This is a preflight estimate, not a precise token count.
    /// Requests estimated to exceed this limit are rejected before any API call is made.
    /// </summary>
    public int MaxInputTokenEstimate { get; set; } = 8000;

    /// <summary>
    /// Maximum completion tokens sent as max_completion_tokens in every request.
    /// Enforced by the Meta API — the model stops generating before this limit.
    /// </summary>
    public int MaxCompletionTokens { get; set; } = 1000;

    /// <summary>HTTP request timeout in seconds for Meta API calls.</summary>
    public int TimeoutSeconds { get; set; } = 30;
}

