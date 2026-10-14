using System;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.Extensions.Logging;

namespace Kairo.Infrastructure.Services;

/// <summary>
/// Phase 5.8.2: Durable usage metering implementation.
///
/// Inserts a single UsageLedgerEntry row per operation into KairoDbContext.
/// The method is deliberately non-throwing: any exception is logged and
/// swallowed so that a metering failure never blocks an API response.
///
/// Callers in the hot path may fire-and-forget without awaiting.
/// </summary>
public sealed class UsageMeterService : IUsageMeterService
{
    private readonly KairoDbContext _dbContext;
    private readonly ILogger<UsageMeterService> _logger;

    public UsageMeterService(KairoDbContext dbContext, ILogger<UsageMeterService> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    /// <inheritdoc/>
    public async Task RecordAsync(
        long userId,
        long projectId,
        string operationType,
        string outcome = UsageOutcome.Success,
        int unitCount = 1,
        int? tokensUsed = null,
        CancellationToken cancellationToken = default)
    {
        try
        {
            _dbContext.UsageLedger.Add(new UsageLedgerEntry
            {
                UserId        = userId,
                ProjectId     = projectId,
                OperationType = operationType,
                Outcome       = outcome,
                OccurredAt    = DateTime.UtcNow,
                UnitCount     = unitCount > 0 ? unitCount : 1,
                TokensUsed    = tokensUsed
            });

            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            // Metering must never fail the caller's request.
            _logger.LogWarning(
                ex,
                "Usage metering failed for userId={UserId} projectId={ProjectId} op={OperationType}. " +
                "The originating request was not affected.",
                userId, projectId, operationType);
        }
    }
}
