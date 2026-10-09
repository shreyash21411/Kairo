using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Persistence;

/// <summary>
/// Phase 4A: Repository abstraction for durable ingestion jobs.
/// Supports atomic enqueueing, safe concurrency-leased claiming, and terminal state tracking.
/// </summary>
public interface IIngestionJobRepository
{
    /// <summary>
    /// Enqueues a new durable memory processing job.
    /// </summary>
    Task<Guid> EnqueueJobAsync(
        MemoryIngestionJobRecord job,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Retrieves a job by ID scoped to the authenticated user and project.
    /// </summary>
    Task<MemoryIngestionJobRecord?> GetJobAsync(
        Guid jobId,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Claims the next batch of pending or expired-lease jobs using atomic row leasing.
    /// </summary>
    Task<List<MemoryIngestionJobRecord>> ClaimNextJobsAsync(
        int batchSize,
        string workerId,
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Marks a job as successfully completed.
    /// </summary>
    Task<bool> CompleteJobAsync(
        Guid jobId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Marks a job as failed, scheduling a retry if eligible or moving to terminal Failed state.
    /// </summary>
    Task<bool> FailJobAsync(
        Guid jobId,
        string error,
        bool canRetry,
        TimeSpan? retryDelay = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Marks a job as cancelled (e.g. parent memory deleted or expired before execution).
    /// </summary>
    Task<bool> CancelJobAsync(
        Guid jobId,
        string reason,
        CancellationToken cancellationToken = default);
}
