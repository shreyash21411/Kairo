using System;
using System.Collections.Generic;
using Kairo.API.Configuration;
using Kairo.Application.Configuration;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Phase 4C Task 4C.1: Unit tests for provider discovery and fail-fast startup configuration validation.
/// Tests valid configurations, defaults, unsupported providers, missing connection strings,
/// missing API keys, and verifies that secrets are never leaked in exception messages.
/// </summary>
public class Phase4CConfigurationValidationUnitTests
{
    private static IConfiguration BuildConfig(Dictionary<string, string?> values)
    {
        return new ConfigurationBuilder()
            .AddInMemoryCollection(values)
            .Build();
    }

    private static Dictionary<string, string?> CreateValidPostgreSqlConfig() => new()
    {
        ["ConnectionStrings:KairoPostgres"] = "Host=127.0.0.1;Port=5433;Database=kairo_dev;Username=kairo_dev;Password=secret",
        ["Providers:DatabaseProvider"] = "PostgreSQL",
        ["Providers:DefaultLlmProvider"] = "Mistral",
        ["Providers:DefaultEmbeddingProvider"] = "Mistral",
        ["Mistral:ApiKey"] = "test-mistral-llm-key",
        ["Mistral:Model"] = "mistral-small-latest",
        ["MistralEmbedding:ApiKey"] = "test-mistral-embed-key",
        ["MistralEmbedding:Model"] = "mistral-embed"
    };

    [Fact]
    public void Validate_SqlServerConfiguration_ThrowsInvalidOperationException()
    {
        var values = CreateValidPostgreSqlConfig();
        values["Providers:DatabaseProvider"] = "SqlServer";

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("SQL Server is no longer supported", ex.Message);
    }

    [Fact]
    public void Validate_ValidPostgreSqlConfiguration_SucceedsAndReturnsCanonicalSettings()
    {
        var config = BuildConfig(CreateValidPostgreSqlConfig());

        var result = ProviderConfigurationValidator.Validate(config);

        Assert.NotNull(result);
        Assert.Equal(ProviderOptions.DatabaseProviders.PostgreSql, result.DatabaseProvider);
        Assert.Equal("Host=127.0.0.1;Port=5433;Database=kairo_dev;Username=kairo_dev;Password=secret", result.DatabaseConnectionString);
        Assert.Equal(ProviderOptions.LlmProviders.Mistral, result.LlmProvider);
        Assert.Equal(ProviderOptions.EmbeddingProviders.Mistral, result.EmbeddingProvider);
    }

    [Fact]
    public void Validate_ValidPostgresAlias_NormalizesToPostgreSql()
    {
        var values = CreateValidPostgreSqlConfig();
        values["Providers:DatabaseProvider"] = "postgres";

        var config = BuildConfig(values);

        var result = ProviderConfigurationValidator.Validate(config);

        Assert.Equal(ProviderOptions.DatabaseProviders.PostgreSql, result.DatabaseProvider);
    }

    [Fact]
    public void Validate_OmittedDatabaseProvider_DefaultsToPostgreSql()
    {
        var values = CreateValidPostgreSqlConfig();
        values.Remove("Providers:DatabaseProvider");

        var config = BuildConfig(values);

        var result = ProviderConfigurationValidator.Validate(config);

        Assert.Equal(ProviderOptions.DatabaseProviders.PostgreSql, result.DatabaseProvider);
    }

    [Fact]
    public void Validate_EmptyDatabaseProvider_DefaultsToPostgreSql()
    {
        var values = CreateValidPostgreSqlConfig();
        values["Providers:DatabaseProvider"] = "   ";

        var config = BuildConfig(values);

        var result = ProviderConfigurationValidator.Validate(config);

        Assert.Equal(ProviderOptions.DatabaseProviders.PostgreSql, result.DatabaseProvider);
    }

    [Fact]
    public void Validate_UnsupportedDatabaseProvider_ThrowsInvalidOperationException()
    {
        var values = CreateValidPostgreSqlConfig();
        values["Providers:DatabaseProvider"] = "Oracle";

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("Oracle", ex.Message);
        Assert.Contains("Supported provider: PostgreSQL.", ex.Message);
    }

    [Fact]
    public void Validate_MissingPostgreSqlConnectionString_ThrowsInvalidOperationException()
    {
        var values = CreateValidPostgreSqlConfig();
        values.Remove("ConnectionStrings:KairoPostgres");
        values.Remove("ConnectionStrings:KairoDatabase");

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("Connection string for PostgreSQL ('ConnectionStrings:KairoPostgres' or 'ConnectionStrings:KairoDatabase') is missing or empty.", ex.Message);
    }

    [Fact]
    public void Validate_PostgreSqlFallbackToKairoDatabase_SucceedsWhenKairoPostgresAbsent()
    {
        var values = CreateValidPostgreSqlConfig();
        values.Remove("ConnectionStrings:KairoPostgres");
        values["ConnectionStrings:KairoDatabase"] = "Host=127.0.0.1;Database=fallback_pg;";

        var config = BuildConfig(values);

        var result = ProviderConfigurationValidator.Validate(config);

        Assert.Equal(ProviderOptions.DatabaseProviders.PostgreSql, result.DatabaseProvider);
        Assert.Equal("Host=127.0.0.1;Database=fallback_pg;", result.DatabaseConnectionString);
    }

    [Fact]
    public void Validate_PostgreSqlThrowsWhenKairoDatabaseContainsSqlServerConnectionString()
    {
        var values = CreateValidPostgreSqlConfig();
        values.Remove("ConnectionStrings:KairoPostgres");
        values["ConnectionStrings:KairoDatabase"] = "Server=10.30.73.176;Database=SonaliDB;TrustServerCertificate=True;";

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("SQL Server connection string", ex.Message);
    }

    [Fact]
    public void Validate_PostgreSqlPrefersKairoPostgresOverKairoDatabase()
    {
        var values = CreateValidPostgreSqlConfig();
        values["ConnectionStrings:KairoPostgres"] = "Host=127.0.0.1;Port=5433;Database=kairo_dev;Username=kairo_dev;Password=secret";
        values["ConnectionStrings:KairoDatabase"] = "Server=10.30.73.176;Database=SonaliDB;TrustServerCertificate=True;";

        var config = BuildConfig(values);

        var result = ProviderConfigurationValidator.Validate(config);

        Assert.Equal(ProviderOptions.DatabaseProviders.PostgreSql, result.DatabaseProvider);
        Assert.Equal("Host=127.0.0.1;Port=5433;Database=kairo_dev;Username=kairo_dev;Password=secret", result.DatabaseConnectionString);
    }

    [Fact]
    public void Validate_UnsupportedLlmProvider_ThrowsInvalidOperationException()
    {
        var values = CreateValidPostgreSqlConfig();
        values["Providers:DefaultLlmProvider"] = "OpenAI";

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("OpenAI", ex.Message);
        Assert.Contains("Supported providers: Mistral.", ex.Message);
    }

    [Fact]
    public void Validate_MissingMistralLlmApiKey_ThrowsInvalidOperationException()
    {
        var values = CreateValidPostgreSqlConfig();
        values["Mistral:ApiKey"] = "   ";

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("Mistral LLM API key ('Mistral:ApiKey') is missing or empty.", ex.Message);
    }

    [Fact]
    public void Validate_UnsupportedEmbeddingProvider_ThrowsInvalidOperationException()
    {
        var values = CreateValidPostgreSqlConfig();
        values["Providers:DefaultEmbeddingProvider"] = "Cohere";

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("Cohere", ex.Message);
        Assert.Contains("Supported providers: Mistral.", ex.Message);
    }

    [Fact]
    public void Validate_MissingMistralEmbeddingApiKey_ThrowsInvalidOperationException()
    {
        var values = CreateValidPostgreSqlConfig();
        values["MistralEmbedding:ApiKey"] = "";

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("Mistral embedding API key ('MistralEmbedding:ApiKey') is missing or empty.", ex.Message);
    }

    [Fact]
    public void Validate_SecretValuesAreNeverExposedInExceptionMessages()
    {
        const string mockSecretApiKey = "sk-live-super-secret-password-xyz123";
        const string mockDbPassword = "SuperSecretDbPassword456!";

        var values = new Dictionary<string, string?>
        {
            ["ConnectionStrings:KairoPostgres"] = $"Host=127.0.0.1;Password={mockDbPassword};",
            ["Providers:DatabaseProvider"] = "PostgreSQL",
            ["Providers:DefaultLlmProvider"] = "UnsupportedVendor",
            ["Mistral:ApiKey"] = mockSecretApiKey,
            ["MistralEmbedding:ApiKey"] = mockSecretApiKey
        };

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        // Exception message should discuss the configuration error, never print secrets
        Assert.DoesNotContain(mockSecretApiKey, ex.Message);
        Assert.DoesNotContain(mockDbPassword, ex.Message);
    }

    [Fact]
    public void Validate_NullConfiguration_ThrowsArgumentNullException()
    {
        Assert.Throws<ArgumentNullException>(() =>
            ProviderConfigurationValidator.Validate(null!));
    }
}
