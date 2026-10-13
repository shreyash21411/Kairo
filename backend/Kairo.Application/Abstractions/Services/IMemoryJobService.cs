using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Phase 4A: Application service coordinating asynchronous memory ingestion jobs.
/// </summary>
public interface IMemoryJobService
{
    /// <summary>
    /// Atomically persists an accepted memory and enqueues a durable background job for heavy processing.
    /// </summary>
    Task<AsyncJobAcceptedResponse> EnqueueAsyncCreateMemoryAsync(
        CreateMemoryRequest request,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Enqueues a durable background job for conversational memory ingestion.
    /// </summary>
    Task<AsyncJobAcceptedResponse> EnqueueAsyncIngestConversationAsync(
        IngestConversationRequest request,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Retrieves the status of a background processing job, authorized by user and project.
    /// </summary>
    Task<JobStatusResponse?> GetJobStatusAsync(
        long jobId,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Executes the business logic for a claimed background job.
    /// Called by the background worker.
    /// </summary>
    Task ProcessJobAsync(
        MemoryIngestionJobRecord job,
        CancellationToken cancellationToken = default);
}
