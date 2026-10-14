using System;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Phase 5.8.2: Records a single metered platform operation durably.
///
/// Fire-and-forget pattern: callers should not await this if they need to avoid
/// blocking the response path. The implementation must be internally resilient
/// (non-throwing on failure), though the interface makes the contract explicit.
/// </summary>
public interface IUsageMeterService
{
    /// <summary>
    /// Records a single metered operation durably.
    /// Implementations must not throw — failures must be logged and swallowed.
    /// </summary>
    /// <param name="userId">Authenticated user ID from IApiKeyContext.</param>
    /// <param name="projectId">Project ID from IApiKeyContext.</param>
    /// <param name="operationType">One of the <see cref="UsageOperationType"/> constants.</param>
    /// <param name="outcome">One of the <see cref="UsageOutcome"/> constants. Default: Success.</param>
    /// <param name="unitCount">Logical units consumed (1 per single op, N per batch).</param>
    /// <param name="tokensUsed">LLM/embedding tokens, null when not reliably reported.</param>
    /// <param name="cancellationToken">Propagates caller cancellation.</param>
    Task RecordAsync(
        long userId,
        long projectId,
        string operationType,
        string outcome = UsageOutcome.Success,
        int unitCount = 1,
        int? tokensUsed = null,
        CancellationToken cancellationToken = default);
}
