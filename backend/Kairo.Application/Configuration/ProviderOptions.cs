namespace Kairo.Application.Configuration;

/// <summary>
/// Phase 4B: Global provider configuration options.
/// Defaults to Mistral for full backward compatibility with pre-Phase 4B settings.
/// </summary>
public class ProviderOptions
{
    public const string SectionName = "Providers";

    /// <summary>
    /// Configured default LLM provider (e.g. "Mistral").
    /// </summary>
    public string DefaultLlmProvider { get; set; } = "Mistral";

    /// <summary>
    /// Configured default Embedding provider (e.g. "Mistral").
    /// </summary>
    public string DefaultEmbeddingProvider { get; set; } = "Mistral";
}
