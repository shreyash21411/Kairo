using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Kairo.Application.Configuration;
using Kairo.Infrastructure.Persistence;

namespace Kairo.API.Configuration;

/// <summary>
/// Phase 4C: Conditional DbContext registration for SQL Server and PostgreSQL with pgvector.
/// </summary>
public static class DatabaseServiceExtensions
{
    public static IServiceCollection AddKairoDatabase(
        this IServiceCollection services,
        ProviderValidationResult providerSettings)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(providerSettings);

        if (string.Equals(providerSettings.DatabaseProvider, ProviderOptions.DatabaseProviders.SqlServer, StringComparison.OrdinalIgnoreCase))
        {
            services.AddDbContext<KairoDbContext>(options =>
                options.UseSqlServer(providerSettings.DatabaseConnectionString));
        }
        else if (string.Equals(providerSettings.DatabaseProvider, ProviderOptions.DatabaseProviders.PostgreSql, StringComparison.OrdinalIgnoreCase)
            || string.Equals(providerSettings.DatabaseProvider, ProviderOptions.DatabaseProviders.Postgres, StringComparison.OrdinalIgnoreCase))
        {
            services.AddDbContext<KairoDbContext>(options =>
                options.UseNpgsql(
                    providerSettings.DatabaseConnectionString,
                    npgsqlOptions =>
                    {
                        npgsqlOptions.UseVector();
                    }));
        }
        else
        {
            throw new InvalidOperationException(
                $"Unsupported database provider '{providerSettings.DatabaseProvider}'. Supported providers are: SqlServer, PostgreSql (or Postgres).");
        }

        return services;
    }
}
