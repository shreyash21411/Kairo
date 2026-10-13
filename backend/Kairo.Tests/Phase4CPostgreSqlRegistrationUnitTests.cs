using System;
using System.IO;
using System.Threading.Tasks;
using Kairo.API.Configuration;
using Kairo.Application.Configuration;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Phase 4C Task 4C.2: Unit and integration tests for PostgreSQL provider registration,
/// pgvector configuration, conditional DbContext resolution, resilience/execution strategy,
/// and live container connection verification against the isolated test database.
/// </summary>
public class Phase4CPostgreSqlRegistrationUnitTests
{
    [Fact]
    public void AddKairoDatabase_WithSqlServer_RegistersSqlServerProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        var validationResult = new ProviderValidationResult(
            ProviderOptions.DatabaseProviders.SqlServer,
            "Server=(localdb)\\MSSQLLocalDB;Database=kairo_dev;Trusted_Connection=True;",
            ProviderOptions.LlmProviders.Mistral,
            ProviderOptions.EmbeddingProviders.Mistral);

        // Act
        services.AddKairoDatabase(validationResult);
        using var serviceProvider = services.BuildServiceProvider();
        using var scope = serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<KairoDbContext>();

        // Assert
        Assert.NotNull(dbContext);
        Assert.Equal("Microsoft.EntityFrameworkCore.SqlServer", dbContext.Database.ProviderName);
        Assert.True(dbContext.Database.IsSqlServer());
        Assert.False(dbContext.Database.IsNpgsql());
    }

    [Fact]
    public void AddKairoDatabase_WithPostgreSql_RegistersNpgsqlProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        var validationResult = new ProviderValidationResult(
            ProviderOptions.DatabaseProviders.PostgreSql,
            "Host=127.0.0.1;Port=5433;Database=kairo_provider_test;Username=kairo_dev;Password=dummy;",
            ProviderOptions.LlmProviders.Mistral,
            ProviderOptions.EmbeddingProviders.Mistral);

        // Act
        services.AddKairoDatabase(validationResult);
        using var serviceProvider = services.BuildServiceProvider();
        using var scope = serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<KairoDbContext>();

        // Assert
        Assert.NotNull(dbContext);
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", dbContext.Database.ProviderName);
        Assert.True(dbContext.Database.IsNpgsql());
        Assert.False(dbContext.Database.IsSqlServer());
    }

    [Fact]
    public void AddKairoDatabase_WithPostgresAlias_RegistersNpgsqlProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        var validationResult = new ProviderValidationResult(
            "Postgres",
            "Host=127.0.0.1;Port=5433;Database=kairo_provider_test;Username=kairo_dev;Password=dummy;",
            ProviderOptions.LlmProviders.Mistral,
            ProviderOptions.EmbeddingProviders.Mistral);

        // Act
        services.AddKairoDatabase(validationResult);
        using var serviceProvider = services.BuildServiceProvider();
        using var scope = serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<KairoDbContext>();

        // Assert
        Assert.NotNull(dbContext);
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", dbContext.Database.ProviderName);
        Assert.True(dbContext.Database.IsNpgsql());
    }

    [Fact]
    public void AddKairoDatabase_WithUnsupportedProvider_ThrowsInvalidOperationException()
    {
        // Arrange
        var services = new ServiceCollection();
        var validationResult = new ProviderValidationResult(
            "Sqlite",
            "Data Source=kairo.db;",
            ProviderOptions.LlmProviders.Mistral,
            ProviderOptions.EmbeddingProviders.Mistral);

        // Act & Assert
        var ex = Assert.Throws<InvalidOperationException>(() =>
            services.AddKairoDatabase(validationResult));
        Assert.Contains("Unsupported database provider 'Sqlite'", ex.Message);
    }

    [Fact]
    public void AddKairoDatabase_WithNullServices_ThrowsArgumentNullException()
    {
        var validationResult = new ProviderValidationResult(
            ProviderOptions.DatabaseProviders.SqlServer,
            "Server=localhost;Database=kairo;",
            ProviderOptions.LlmProviders.Mistral,
            ProviderOptions.EmbeddingProviders.Mistral);

        Assert.Throws<ArgumentNullException>(() =>
            DatabaseServiceExtensions.AddKairoDatabase(null!, validationResult));
    }

    [Fact]
    public void AddKairoDatabase_WithNullSettings_ThrowsArgumentNullException()
    {
        var services = new ServiceCollection();
        Assert.Throws<ArgumentNullException>(() =>
            services.AddKairoDatabase(null!));
    }

    [Fact]
    public void MemoryEmbeddings_VectorData_RemainsStringClrProperty()
    {
        // Verifies the SQL Server JSON embedding representation is preserved as CLR string
        // and has not been mutated into an incompatible CLR type.
        var property = typeof(MemoryEmbeddings).GetProperty(nameof(MemoryEmbeddings.VectorData));
        Assert.NotNull(property);
        Assert.Equal(typeof(string), property.PropertyType);
    }

    [Fact]
    public void AddKairoDatabase_WithPostgreSql_ConfiguresVectorExtension()
    {
        var services = new ServiceCollection();
        var validationResult = new ProviderValidationResult(
            ProviderOptions.DatabaseProviders.PostgreSql,
            "Host=127.0.0.1;Port=5433;Database=kairo_provider_test;Username=kairo_dev;Password=dummy;",
            ProviderOptions.LlmProviders.Mistral,
            ProviderOptions.EmbeddingProviders.Mistral);

        services.AddKairoDatabase(validationResult);
        using var sp = services.BuildServiceProvider();
        var options = sp.GetRequiredService<DbContextOptions<KairoDbContext>>();

        var hasVector = System.Linq.Enumerable.Any(options.Extensions, e => e.GetType().Name == "VectorDbContextOptionsExtension");
        Assert.True(hasVector, "Expected VectorDbContextOptionsExtension to be registered for PostgreSQL provider.");
    }

    [Fact]
    public void AddKairoDatabase_WithSqlServer_DoesNotConfigureVectorExtension()
    {
        var services = new ServiceCollection();
        var validationResult = new ProviderValidationResult(
            ProviderOptions.DatabaseProviders.SqlServer,
            "Server=(localdb)\\MSSQLLocalDB;Database=kairo_dev;Trusted_Connection=True;",
            ProviderOptions.LlmProviders.Mistral,
            ProviderOptions.EmbeddingProviders.Mistral);

        services.AddKairoDatabase(validationResult);
        using var sp = services.BuildServiceProvider();
        var options = sp.GetRequiredService<DbContextOptions<KairoDbContext>>();

        var hasVector = System.Linq.Enumerable.Any(options.Extensions, e => e.GetType().Name == "VectorDbContextOptionsExtension");
        Assert.False(hasVector, "Expected VectorDbContextOptionsExtension to NOT be registered for SQL Server provider.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Real PostgreSQL Connection Tests (against isolated test database)
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RealPostgreSqlContainer_CanConnect_AndQueryPgVector()
    {
        var credentials = DiscoverPostgresCredentials();
        if (credentials == null)
        {
            // Container or credentials not accessible in this environment
            return;
        }

        var connString = $"Host={credentials.Value.Host};Port={credentials.Value.Port};Database={credentials.Value.Database};Username={credentials.Value.Username};Password={credentials.Value.Password};";

        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseNpgsql(connString, o => o.UseVector())
            .Options;

        using var context = new KairoDbContext(options);

        // 1. Can connect to isolated test database
        var canConnect = await context.Database.CanConnectAsync();
        Assert.True(canConnect, "Expected successful connection to kairo-postgres test database.");

        // 2. Verify connection was to kairo_provider_test, NOT kairo_dev
        using var conn = new NpgsqlConnection(connString);
        await conn.OpenAsync();

        using var dbCmd = new NpgsqlCommand("SELECT current_database(), current_user;", conn);
        using var dbReader = await dbCmd.ExecuteReaderAsync();
        Assert.True(await dbReader.ReadAsync());
        var currentDb = dbReader.GetString(0);
        var currentUser = dbReader.GetString(1);
        Assert.Equal("kairo_provider_test", currentDb);
        Assert.Equal("kairo_dev", currentUser);
        await dbReader.CloseAsync();

        // 3. Verify pgvector extension is present and enabled
        using var extCmd = new NpgsqlCommand("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';", conn);
        using var extReader = await extCmd.ExecuteReaderAsync();
        Assert.True(await extReader.ReadAsync(), "Expected pgvector extension to be present in test database.");
        var extName = extReader.GetString(0);
        var extVersion = extReader.GetString(1);
        Assert.Equal("vector", extName);
        Assert.False(string.IsNullOrWhiteSpace(extVersion));
    }

    [Fact]
    public async Task RealPostgreSqlContainer_InvalidPassword_FailsFast()
    {
        var credentials = DiscoverPostgresCredentials();
        if (credentials == null)
        {
            return;
        }

        // Deliberately incorrect password
        var badConnString = $"Host={credentials.Value.Host};Port={credentials.Value.Port};Database={credentials.Value.Database};Username={credentials.Value.Username};Password=invalid_wrong_password;Timeout=3;";

        var options = new DbContextOptionsBuilder<KairoDbContext>()
            .UseNpgsql(badConnString, o => o.UseVector())
            .Options;

        using var context = new KairoDbContext(options);

        // CanConnectAsync returns false for invalid credentials, or throws PostgresException
        var canConnect = await context.Database.CanConnectAsync();
        Assert.False(canConnect, "Expected connection with invalid credentials to fail.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: Dynamic credential discovery without hardcoded secrets
    // ─────────────────────────────────────────────────────────────────────────

    private static (string Host, int Port, string Database, string Username, string Password)? DiscoverPostgresCredentials()
    {
        var host = Environment.GetEnvironmentVariable("POSTGRES_HOST") ?? "127.0.0.1";
        var portStr = Environment.GetEnvironmentVariable("POSTGRES_HOST_PORT") ?? "5433";
        int.TryParse(portStr, out var port);
        if (port == 0) port = 5433;
        var user = Environment.GetEnvironmentVariable("KAIRO_APP_USER") ?? "kairo_dev";
        var db = Environment.GetEnvironmentVariable("POSTGRES_TEST_DB") ?? "kairo_provider_test";

        var envPass = Environment.GetEnvironmentVariable("KAIRO_APP_PASSWORD");
        if (!string.IsNullOrWhiteSpace(envPass))
        {
            return (host, port, db, user, envPass);
        }

        // Try reading local docker .env (untracked)
        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        var dir = new DirectoryInfo(baseDir);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "infrastructure", "docker", ".env")))
        {
            dir = dir.Parent;
        }

        if (dir != null)
        {
            var envFilePath = Path.Combine(dir.FullName, "infrastructure", "docker", ".env");
            var lines = File.ReadAllLines(envFilePath);
            string? discoveredUser = null;
            string? discoveredPass = null;
            string? discoveredPort = null;
            foreach (var rawLine in lines)
            {
                var line = rawLine.Trim();
                if (line.StartsWith('#') || !line.Contains('=')) continue;
                var parts = line.Split('=', 2);
                var key = parts[0].Trim();
                var val = parts[1].Trim();
                if (key == "KAIRO_APP_USER") discoveredUser = val;
                if (key == "KAIRO_APP_PASSWORD") discoveredPass = val;
                if (key == "POSTGRES_HOST_PORT") discoveredPort = val;
            }

            if (!string.IsNullOrWhiteSpace(discoveredPass))
            {
                if (!string.IsNullOrWhiteSpace(discoveredUser)) user = discoveredUser;
                if (int.TryParse(discoveredPort, out var p)) port = p;
                return (host, port, db, user, discoveredPass);
            }
        }

        return null;
    }
}
