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

    private static Dictionary<string, string?> CreateValidSqlServerConfig() => new()
    {
        ["ConnectionStrings:KairoDatabase"] = "Server=(localdb)\\MSSQLLocalDB;Database=kairo_dev;Trusted_Connection=True;",
        ["Providers:DatabaseProvider"] = "SqlServer",
        ["Providers:DefaultLlmProvider"] = "Mistral",
        ["Providers:DefaultEmbeddingProvider"] = "Mistral",
        ["Mistral:ApiKey"] = "test-mistral-llm-key",
        ["Mistral:Model"] = "mistral-small-latest",
        ["MistralEmbedding:ApiKey"] = "test-mistral-embed-key",
        ["MistralEmbedding:Model"] = "mistral-embed"
    };

    [Fact]
    public void Validate_ValidSqlServerConfiguration_SucceedsAndReturnsCanonicalSettings()
    {
        var config = BuildConfig(CreateValidSqlServerConfig());

        var result = ProviderConfigurationValidator.Validate(config);

        Assert.NotNull(result);
        Assert.Equal(ProviderOptions.DatabaseProviders.SqlServer, result.DatabaseProvider);
        Assert.Equal("Server=(localdb)\\MSSQLLocalDB;Database=kairo_dev;Trusted_Connection=True;", result.DatabaseConnectionString);
        Assert.Equal(ProviderOptions.LlmProviders.Mistral, result.LlmProvider);
        Assert.Equal(ProviderOptions.EmbeddingProviders.Mistral, result.EmbeddingProvider);
    }

    [Fact]
    public void Validate_ValidPostgreSqlConfiguration_SucceedsAndReturnsCanonicalSettings()
    {
        var values = CreateValidSqlServerConfig();
        values["Providers:DatabaseProvider"] = "PostgreSQL";
        values["ConnectionStrings:KairoPostgres"] = "Host=127.0.0.1;Port=5433;Database=kairo_dev;Username=kairo_dev;Password=secret";

        var config = BuildConfig(values);

        var result = ProviderConfigurationValidator.Validate(config);

        Assert.NotNull(result);
        Assert.Equal(ProviderOptions.DatabaseProviders.PostgreSql, result.DatabaseProvider);
        Assert.Equal("Host=127.0.0.1;Port=5433;Database=kairo_dev;Username=kairo_dev;Password=secret", result.DatabaseConnectionString);
    }

    [Fact]
    public void Validate_ValidPostgresAlias_NormalizesToPostgreSql()
    {
        var values = CreateValidSqlServerConfig();
        values["Providers:DatabaseProvider"] = "postgres";
        values["ConnectionStrings:KairoPostgres"] = "Host=localhost;Database=test;";

        var config = BuildConfig(values);

        var result = ProviderConfigurationValidator.Validate(config);

        Assert.Equal(ProviderOptions.DatabaseProviders.PostgreSql, result.DatabaseProvider);
    }

    [Fact]
    public void Validate_OmittedDatabaseProvider_DefaultsToSqlServer()
    {
        var values = CreateValidSqlServerConfig();
        values.Remove("Providers:DatabaseProvider");

        var config = BuildConfig(values);

        var result = ProviderConfigurationValidator.Validate(config);

        Assert.Equal(ProviderOptions.DatabaseProviders.SqlServer, result.DatabaseProvider);
    }

    [Fact]
    public void Validate_EmptyDatabaseProvider_DefaultsToSqlServer()
    {
        var values = CreateValidSqlServerConfig();
        values["Providers:DatabaseProvider"] = "   ";

        var config = BuildConfig(values);

        var result = ProviderConfigurationValidator.Validate(config);

        Assert.Equal(ProviderOptions.DatabaseProviders.SqlServer, result.DatabaseProvider);
    }

    [Fact]
    public void Validate_UnsupportedDatabaseProvider_ThrowsInvalidOperationException()
    {
        var values = CreateValidSqlServerConfig();
        values["Providers:DatabaseProvider"] = "Oracle";

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("Oracle", ex.Message);
        Assert.Contains("Supported providers: SqlServer, PostgreSQL.", ex.Message);
    }

    [Fact]
    public void Validate_MissingSqlServerConnectionString_ThrowsInvalidOperationException()
    {
        var values = CreateValidSqlServerConfig();
        values["ConnectionStrings:KairoDatabase"] = "";

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("Connection string for SQL Server ('ConnectionStrings:KairoDatabase') is missing or empty.", ex.Message);
    }

    [Fact]
    public void Validate_MissingPostgreSqlConnectionString_ThrowsInvalidOperationException()
    {
        var values = CreateValidSqlServerConfig();
        values["Providers:DatabaseProvider"] = "PostgreSQL";
        values.Remove("ConnectionStrings:KairoDatabase");
        values["ConnectionStrings:KairoPostgres"] = "  ";

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("Connection string for PostgreSQL ('ConnectionStrings:KairoPostgres' or 'ConnectionStrings:KairoDatabase') is missing or empty.", ex.Message);
    }

    [Fact]
    public void Validate_PostgreSqlFallbackToKairoDatabase_SucceedsWhenKairoPostgresAbsent()
    {
        var values = CreateValidSqlServerConfig();
        values["Providers:DatabaseProvider"] = "PostgreSQL";
        values["ConnectionStrings:KairoDatabase"] = "Host=127.0.0.1;Database=fallback_pg;";

        var config = BuildConfig(values);

        var result = ProviderConfigurationValidator.Validate(config);

        Assert.Equal(ProviderOptions.DatabaseProviders.PostgreSql, result.DatabaseProvider);
        Assert.Equal("Host=127.0.0.1;Database=fallback_pg;", result.DatabaseConnectionString);
    }

    [Fact]
    public void Validate_PostgreSqlThrowsWhenKairoDatabaseContainsSqlServerConnectionString()
    {
        var values = CreateValidSqlServerConfig();
        values["Providers:DatabaseProvider"] = "PostgreSQL";
        values["ConnectionStrings:KairoDatabase"] = "Server=10.30.73.176;Database=SonaliDB;TrustServerCertificate=True;";
        values.Remove("ConnectionStrings:KairoPostgres");

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("contains a SQL Server connection string", ex.Message);
    }

    [Fact]
    public void Validate_PostgreSqlPrefersKairoPostgresOverKairoDatabase()
    {
        var values = CreateValidSqlServerConfig();
        values["Providers:DatabaseProvider"] = "PostgreSQL";
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
        var values = CreateValidSqlServerConfig();
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
        var values = CreateValidSqlServerConfig();
        values["Mistral:ApiKey"] = "   ";

        var config = BuildConfig(values);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProviderConfigurationValidator.Validate(config));

        Assert.Contains("Mistral LLM API key ('Mistral:ApiKey') is missing or empty.", ex.Message);
    }

    [Fact]
    public void Validate_UnsupportedEmbeddingProvider_ThrowsInvalidOperationException()
    {
        var values = CreateValidSqlServerConfig();
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
        var values = CreateValidSqlServerConfig();
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
            ["ConnectionStrings:KairoDatabase"] = $"Server=db;Password={mockDbPassword};",
            ["Providers:DatabaseProvider"] = "SqlServer",
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
