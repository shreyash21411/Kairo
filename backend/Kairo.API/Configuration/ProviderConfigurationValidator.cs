using System;
using Kairo.Application.Configuration;
using Microsoft.Extensions.Configuration;

namespace Kairo.API.Configuration;

/// <summary>
/// Phase 4C: Fail-fast startup validator for database, LLM, and embedding provider configurations.
/// Validates required configuration keys before the application accepts traffic.
/// Never logs, prints, or exposes sensitive credentials or API keys.
/// </summary>
public static class ProviderConfigurationValidator
{
    /// <summary>
    /// Validates provider configuration from the application's configuration root.
    /// Throws <see cref="InvalidOperationException"/> with a clear message if any required
    /// provider or credential is missing, empty, or unsupported.
    /// </summary>
    /// <param name="configuration">The application configuration root.</param>
    /// <returns>A validated <see cref="ProviderValidationResult"/> containing canonical settings.</returns>
    /// <exception cref="ArgumentNullException">Thrown if configuration is null.</exception>
    /// <exception cref="InvalidOperationException">Thrown if configuration is invalid or missing.</exception>
    public static ProviderValidationResult Validate(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        // ── 1. Database Provider Discovery & Validation ─────────────────────────
        var rawDbProvider = configuration[$"{ProviderOptions.SectionName}:DatabaseProvider"]
            ?? configuration["DatabaseProvider"];

        string canonicalDbProvider;
        if (string.IsNullOrWhiteSpace(rawDbProvider))
        {
            // Default when setting is absent
            canonicalDbProvider = ProviderOptions.DatabaseProviders.SqlServer;
        }
        else if (string.Equals(rawDbProvider, ProviderOptions.DatabaseProviders.SqlServer, StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(rawDbProvider, "MSSQL", StringComparison.OrdinalIgnoreCase))
        {
            canonicalDbProvider = ProviderOptions.DatabaseProviders.SqlServer;
        }
        else if (string.Equals(rawDbProvider, ProviderOptions.DatabaseProviders.PostgreSql, StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(rawDbProvider, "Postgres", StringComparison.OrdinalIgnoreCase))
        {
            canonicalDbProvider = ProviderOptions.DatabaseProviders.PostgreSql;
        }
        else
        {
            throw new InvalidOperationException(
                $"Configured Database provider '{rawDbProvider}' is not supported. Supported providers: SqlServer, PostgreSQL.");
        }

        // ── 2. Database Connection String Validation ────────────────────────────
        string? connectionString;
        if (canonicalDbProvider == ProviderOptions.DatabaseProviders.SqlServer)
        {
            connectionString = configuration.GetConnectionString("KairoDatabase")
                ?? configuration.GetConnectionString("KairoSqlServer")
                ?? configuration.GetConnectionString("SqlServer");

            if (string.IsNullOrWhiteSpace(connectionString))
            {
                throw new InvalidOperationException(
                    "Connection string for SQL Server ('ConnectionStrings:KairoDatabase') is missing or empty.");
            }
        }
        else // PostgreSQL
        {
            connectionString = configuration.GetConnectionString("KairoPostgres")
                ?? configuration.GetConnectionString("KairoDatabase")
                ?? configuration.GetConnectionString("PostgreSQL");

            if (string.IsNullOrWhiteSpace(connectionString))
            {
                throw new InvalidOperationException(
                    "Connection string for PostgreSQL ('ConnectionStrings:KairoPostgres' or 'ConnectionStrings:KairoDatabase') is missing or empty.");
            }
        }

        // ── 3. LLM Provider Discovery & Validation ──────────────────────────────
        var rawLlmProvider = configuration[$"{ProviderOptions.SectionName}:DefaultLlmProvider"]
            ?? configuration["DefaultLlmProvider"];

        var canonicalLlmProvider = string.IsNullOrWhiteSpace(rawLlmProvider)
            ? ProviderOptions.LlmProviders.Mistral
            : rawLlmProvider;

        if (!string.Equals(canonicalLlmProvider, ProviderOptions.LlmProviders.Mistral, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Configured LLM provider '{canonicalLlmProvider}' is not supported. Supported providers: Mistral.");
        }

        // Validate Mistral LLM API key
        var mistralApiKey = configuration["Mistral:ApiKey"];
        if (string.IsNullOrWhiteSpace(mistralApiKey))
        {
            throw new InvalidOperationException(
                "Mistral LLM API key ('Mistral:ApiKey') is missing or empty.");
        }

        // ── 4. Embedding Provider Discovery & Validation ─────────────────────────
        var rawEmbeddingProvider = configuration[$"{ProviderOptions.SectionName}:DefaultEmbeddingProvider"]
            ?? configuration["DefaultEmbeddingProvider"];

        var canonicalEmbeddingProvider = string.IsNullOrWhiteSpace(rawEmbeddingProvider)
            ? ProviderOptions.EmbeddingProviders.Mistral
            : rawEmbeddingProvider;

        if (!string.Equals(canonicalEmbeddingProvider, ProviderOptions.EmbeddingProviders.Mistral, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Configured Embedding provider '{canonicalEmbeddingProvider}' is not supported. Supported providers: Mistral.");
        }

        // Validate Mistral Embedding API key
        var mistralEmbeddingApiKey = configuration["MistralEmbedding:ApiKey"];
        if (string.IsNullOrWhiteSpace(mistralEmbeddingApiKey))
        {
            throw new InvalidOperationException(
                "Mistral embedding API key ('MistralEmbedding:ApiKey') is missing or empty.");
        }

        return new ProviderValidationResult(
            canonicalDbProvider,
            connectionString,
            canonicalLlmProvider,
            canonicalEmbeddingProvider);
    }
}

/// <summary>
/// Contains validated provider settings returned by <see cref="ProviderConfigurationValidator.Validate"/>.
/// </summary>
public record ProviderValidationResult(
    string DatabaseProvider,
    string DatabaseConnectionString,
    string LlmProvider,
    string EmbeddingProvider);
