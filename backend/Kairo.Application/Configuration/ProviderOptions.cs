namespace Kairo.Application.Configuration;

/// <summary>
/// Phase 4B/4C: Global provider configuration options.
/// Defaults to SqlServer and Mistral for full backward compatibility with pre-Phase 4B settings.
/// </summary>
public class ProviderOptions
{
    public const string SectionName = "Providers";

    /// <summary>
    /// Supported database provider constants.
    /// </summary>
    public static class DatabaseProviders
    {
        public const string SqlServer = "SqlServer";
        public const string PostgreSql = "PostgreSQL";
        public const string Postgres = "Postgres";
    }

    /// <summary>
    /// Supported LLM provider constants.
    /// </summary>
    public static class LlmProviders
    {
        public const string Mistral = "Mistral";
    }

    /// <summary>
    /// Supported Embedding provider constants.
    /// </summary>
    public static class EmbeddingProviders
    {
        public const string Mistral = "Mistral";
    }

    /// <summary>
    /// Configured default Database provider ("SqlServer", "PostgreSQL").
    /// Defaults to "SqlServer" when absent.
    /// </summary>
    public string DatabaseProvider { get; set; } = DatabaseProviders.SqlServer;

    /// <summary>
    /// Configured default LLM provider (e.g. "Mistral").
    /// </summary>
    public string DefaultLlmProvider { get; set; } = LlmProviders.Mistral;

    /// <summary>
    /// Configured default Embedding provider (e.g. "Mistral").
    /// </summary>
    public string DefaultEmbeddingProvider { get; set; } = EmbeddingProviders.Mistral;
}
