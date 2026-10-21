using System;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Kairo.API.Services;

/// <summary>
/// Phase 4A: Background worker executing durable memory ingestion jobs.
/// Uses scoped service resolution, atomic row claiming, and safe retry handling.
///
/// Lease renewal (Task 1):
///   A dedicated background heartbeat task renews the active job lease every
///   <see cref="LeaseRenewalIntervalSeconds"/> seconds, using a separate DI scope
///   so the heartbeat does not share an EF DbContext with the processing scope.
///   If <see cref="IIngestionJobRepository.RenewLeaseAsync"/> returns false (ownership
///   lost), a linked CancellationToken is cancelled to abort the running job.
///   The heartbeat is always cleaned up before the next iteration.
/// </summary>
public class MemoryIngestionWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MemoryIngestionWorker> _logger;
    private readonly string _workerId;

    /// <summary>
    /// Lease duration granted when claiming a job.
    /// </summary>
    private static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(2);

    /// <summary>
    /// How often the heartbeat renews the lease — must be comfortably shorter than
    /// <see cref="LeaseDuration"/> to guarantee renewal always arrives before expiry.
    /// </summary>
    private static readonly TimeSpan LeaseRenewalInterval = TimeSpan.FromSeconds(90);

    /// <summary>
    /// How much each renewal extends the lease.
    /// </summary>
    private static readonly TimeSpan LeaseRenewalExtension = TimeSpan.FromMinutes(2);

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

                // Claim 1 job at a time to prevent head-of-line lease expiration during sequential processing
                var claimedJobs = await jobRepo.ClaimNextJobsAsync(
                    batchSize: 1,
                    workerId: _workerId,
                    leaseDuration: LeaseDuration,
                    cancellationToken: stoppingToken);

                if (claimedJobs.Count == 0)
                {
                    // No work available: back off slightly
                    await Task.Delay(TimeSpan.FromMilliseconds(500), stoppingToken);
                    continue;
                }

                _logger.LogDebug("[MemoryIngestionWorker] Claimed {Count} job(s)", claimedJobs.Count);

                foreach (var job in claimedJobs)
                {
                    if (stoppingToken.IsCancellationRequested) break;

                    // Verify the lease has not expired before processing begins
                    if (job.LockedUntil.HasValue && job.LockedUntil.Value <= DateTime.UtcNow)
                    {
                        _logger.LogWarning("[MemoryIngestionWorker] Skipping job {JobId}: lease expired before processing started", job.JobId);
                        continue;
                    }

                    await ProcessJobWithLeaseRenewalAsync(jobService, job, stoppingToken);
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

    /// <summary>
    /// Processes a single claimed job while running a background lease-renewal heartbeat.
    /// The heartbeat operates on its own DI scope so it does not share the EF DbContext
    /// with the processing scope.  If renewal fails (ownership lost), the job's linked
    /// CancellationToken is cancelled and processing is aborted without completing the job.
    /// </summary>
    private async Task ProcessJobWithLeaseRenewalAsync(
        IMemoryJobService jobService,
        MemoryIngestionJobRecord job,
        CancellationToken stoppingToken)
    {
        // Combine the worker's stopping token with a per-job ownership-loss token.
        using var ownershipLostCts = new CancellationTokenSource();
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, ownershipLostCts.Token);
        var jobToken = linkedCts.Token;

        Task? heartbeatTask = null;

        try
        {
            // Start lease renewal heartbeat on a separate DI scope.
            heartbeatTask = RunLeaseRenewalHeartbeatAsync(job, ownershipLostCts, stoppingToken);

            await jobService.ProcessJobAsync(job, jobToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Worker is shutting down — expected, propagate.
            _logger.LogInformation("[MemoryIngestionWorker] Processing was cancelled for job {JobId}", job.JobId);
        }
        catch (OperationCanceledException) when (ownershipLostCts.IsCancellationRequested)
        {
            // Ownership was lost mid-processing — do NOT complete or fail the job;
            // a different worker or recovery will handle it.
            _logger.LogWarning(
                "[MemoryIngestionWorker] Lease ownership lost for job {JobId}; aborting processing without state transition.",
                job.JobId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[MemoryIngestionWorker] Unexpected error handling job {JobId}", job.JobId);

            // Attempt to record failure only if we still appear to own the lease.
            if (!ownershipLostCts.IsCancellationRequested)
            {
                try
                {
                    using var failScope = _scopeFactory.CreateScope();
                    var failRepo = failScope.ServiceProvider.GetRequiredService<IIngestionJobRepository>();
                    await failRepo.FailJobAsync(
                        job.JobId,
                        $"Unhandled worker exception: {ex.Message}",
                        canRetry: job.Attempts < job.MaxAttempts,
                        retryDelay: TimeSpan.FromSeconds(5),
                        lockOwner: job.LockOwner,
                        cancellationToken: CancellationToken.None);
                }
                catch (Exception failEx)
                {
                    _logger.LogError(failEx, "[MemoryIngestionWorker] Failed to record failure transition for job {JobId}", job.JobId);
                }
            }
        }
        finally
        {
            // Signal the heartbeat to stop and wait for it to finish cleanly.
            ownershipLostCts.Cancel();
            if (heartbeatTask != null)
            {
                try
                {
                    await heartbeatTask;
                }
                catch (OperationCanceledException)
                {
                    // Expected — heartbeat was cancelled because the job finished.
                }
                catch (Exception htEx)
                {
                    _logger.LogError(htEx, "[MemoryIngestionWorker] Heartbeat task faulted for job {JobId}", job.JobId);
                }
            }
        }
    }

    /// <summary>
    /// Background heartbeat that periodically renews the lease for <paramref name="job"/>
    /// using a fresh DI scope on each iteration.  If renewal returns false the worker no
    /// longer owns the lease; <paramref name="ownershipLostCts"/> is cancelled to abort
    /// the paired processing task.
    /// </summary>
    private async Task RunLeaseRenewalHeartbeatAsync(
        MemoryIngestionJobRecord job,
        CancellationTokenSource ownershipLostCts,
        CancellationToken stoppingToken)
    {
        // A combined token: stop if the worker shuts down or if ownership is already lost.
        using var heartbeatCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, ownershipLostCts.Token);
        var heartbeatToken = heartbeatCts.Token;

        while (!heartbeatToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(LeaseRenewalInterval, heartbeatToken);
            }
            catch (OperationCanceledException)
            {
                // Normal shutdown — stop quietly.
                return;
            }

            if (heartbeatToken.IsCancellationRequested) return;

            try
            {
                // Use a dedicated scope so the heartbeat never shares a DbContext.
                using var renewScope = _scopeFactory.CreateScope();
                var renewRepo = renewScope.ServiceProvider.GetRequiredService<IIngestionJobRepository>();

                var renewed = await renewRepo.RenewLeaseAsync(
                    job.JobId,
                    job.LockOwner!,
                    LeaseRenewalExtension,
                    CancellationToken.None);

                if (!renewed)
                {
                    _logger.LogWarning(
                        "[MemoryIngestionWorker] Lease renewal failed for job {JobId} (ownership lost). Cancelling processing.",
                        job.JobId);

                    // Signal the processing task to abort.
                    ownershipLostCts.Cancel();
                    return;
                }

                _logger.LogDebug(
                    "[MemoryIngestionWorker] Renewed lease for job {JobId} by {Extension}",
                    job.JobId, LeaseRenewalExtension);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                // Log but do not abort on a transient heartbeat error — next iteration will retry.
                _logger.LogError(ex, "[MemoryIngestionWorker] Heartbeat renewal error for job {JobId}; will retry on next interval", job.JobId);
            }
        }
    }
}
