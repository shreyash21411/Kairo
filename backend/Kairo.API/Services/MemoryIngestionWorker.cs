using System;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Kairo.API.Services;

/// <summary>
/// Phase 4A: Background worker executing durable memory ingestion jobs.
/// Uses scoped service resolution, atomic row claiming, and safe retry handling.
/// </summary>
public class MemoryIngestionWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MemoryIngestionWorker> _logger;
    private readonly string _workerId;

    public MemoryIngestionWorker(
        IServiceScopeFactory scopeFactory,
        ILogger<MemoryIngestionWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _workerId = $"worker-{Environment.MachineName}-{Guid.NewGuid():N}";
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[MemoryIngestionWorker] Started with WorkerId={WorkerId}", _workerId);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var jobRepo = scope.ServiceProvider.GetRequiredService<IIngestionJobRepository>();
                var jobService = scope.ServiceProvider.GetRequiredService<IMemoryJobService>();

                // Claim up to 5 jobs with a 2-minute lease
                var claimedJobs = await jobRepo.ClaimNextJobsAsync(
                    batchSize: 5,
                    workerId: _workerId,
                    leaseDuration: TimeSpan.FromMinutes(2),
                    cancellationToken: stoppingToken);

                if (claimedJobs.Count == 0)
                {
                    // No work available: back off slightly
                    await Task.Delay(TimeSpan.FromMilliseconds(500), stoppingToken);
                    continue;
                }

                _logger.LogDebug("[MemoryIngestionWorker] Claimed {Count} jobs", claimedJobs.Count);

                foreach (var job in claimedJobs)
                {
                    if (stoppingToken.IsCancellationRequested) break;

                    try
                    {
                        await jobService.ProcessJobAsync(job, stoppingToken);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "[MemoryIngestionWorker] Unexpected error handling job {JobId}", job.JobId);
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[MemoryIngestionWorker] Unhandled loop exception");
                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            }
        }

        _logger.LogInformation("[MemoryIngestionWorker] Stopped WorkerId={WorkerId}", _workerId);
    }
}
