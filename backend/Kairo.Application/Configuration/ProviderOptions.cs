namespace Kairo.Application.Configuration;

/// <summary>
/// Global provider configuration options.
/// PostgreSQL with pgvector is the sole supported runtime database provider.
/// </summary>
public class ProviderOptions
{
    public const string SectionName = "Providers";

    /// <summary>
    /// Database provider constants. PostgreSQL is the only active runtime provider.
    /// </summary>
    public static class DatabaseProviders
    {
        [Obsolete("SQL Server is no longer supported as a runtime database provider.")]
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
    /// Configured default Database provider ("PostgreSQL", "Postgres").
    /// Defaults to "PostgreSQL".
    /// </summary>
    public string DatabaseProvider { get; set; } = DatabaseProviders.PostgreSql;

    /// <summary>
    /// Configured default LLM provider (e.g. "Mistral").
    /// </summary>
    public string DefaultLlmProvider { get; set; } = LlmProviders.Mistral;

    /// <summary>
    /// Configured default Embedding provider (e.g. "Mistral").
    /// </summary>
    public string DefaultEmbeddingProvider { get; set; } = EmbeddingProviders.Mistral;
}
