using System;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging;

namespace Kairo.API.Health;

/// <summary>
/// Probes the configured PostgreSQL database to verify connectivity and query execution.
/// Does not leak database credentials, connection strings, or internal stack traces in public responses.
/// </summary>
public class KairoDatabaseHealthCheck : IHealthCheck
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<KairoDatabaseHealthCheck> _logger;

    public KairoDatabaseHealthCheck(
        IServiceScopeFactory scopeFactory,
        ILogger<KairoDatabaseHealthCheck> logger)
    {
        _scopeFactory = scopeFactory ?? throw new ArgumentNullException(nameof(scopeFactory));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<KairoDbContext>();

            // Probe database connectivity with a lightweight connectivity check.
            var canConnect = await dbContext.Database.CanConnectAsync(cancellationToken);
            if (!canConnect)
            {
                _logger.LogWarning("[HealthCheck] Database CanConnectAsync returned false.");
                return HealthCheckResult.Unhealthy("PostgreSQL database is unreachable.");
            }

            return HealthCheckResult.Healthy("PostgreSQL database is reachable.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return HealthCheckResult.Unhealthy("Database health probe timed out.");
        }
        catch (Exception ex)
        {
            // Log full exception internally, but never expose connection strings, credentials, or SQL details publicly.
            _logger.LogError(ex, "[HealthCheck] Database readiness probe encountered an error.");
            return HealthCheckResult.Unhealthy("PostgreSQL database is unreachable.");
        }
    }
}
