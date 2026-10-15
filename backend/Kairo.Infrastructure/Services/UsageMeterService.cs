using System;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Kairo.Infrastructure.Services;

/// <summary>
/// Phase 5.8.2: Durable usage metering implementation.
///
/// Inserts a single <see cref="UsageLedgerEntry"/> row per operation into KairoDbContext.
/// When constructed with <see cref="IServiceScopeFactory"/>, each recording creates an isolated
/// DI scope and DbContext instance to eliminate ObjectDisposedException, thread-safety violations,
/// and request-lifecycle disposal bugs.
/// The method is non-throwing: any exception is logged and swallowed so that a metering failure
/// never blocks or fails an API response.
/// </summary>
public sealed class UsageMeterService : IUsageMeterService
{
    private readonly IServiceScopeFactory? _scopeFactory;
    private readonly KairoDbContext? _dbContext;
    private readonly ILogger<UsageMeterService> _logger;
    private readonly IQuotaEnforcementService? _quotaService;

    /// <summary>
    /// Production DI constructor: uses <see cref="IServiceScopeFactory"/> to isolate scope per operation.
    /// </summary>
    [Microsoft.Extensions.DependencyInjection.ActivatorUtilitiesConstructor]
    public UsageMeterService(
        IServiceScopeFactory scopeFactory,
        ILogger<UsageMeterService> logger,
        IQuotaEnforcementService? quotaService = null)
    {
        _scopeFactory = scopeFactory ?? throw new ArgumentNullException(nameof(scopeFactory));
        _logger       = logger ?? throw new ArgumentNullException(nameof(logger));
        _quotaService = quotaService;
    }

    /// <summary>
    /// Direct DbContext constructor for unit tests and lightweight testing scenarios.
    /// </summary>
    public UsageMeterService(
        KairoDbContext dbContext,
        ILogger<UsageMeterService> logger,
        IQuotaEnforcementService? quotaService = null)
    {
        _dbContext    = dbContext ?? throw new ArgumentNullException(nameof(dbContext));
        _logger       = logger ?? throw new ArgumentNullException(nameof(logger));
        _quotaService = quotaService;
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
            var effectiveUnits = unitCount > 0 ? unitCount : 1;
            var entry = new UsageLedgerEntry
            {
                UserId        = userId,
                ProjectId     = projectId,
                OperationType = operationType,
                Outcome       = outcome,
                OccurredAt    = DateTime.UtcNow,
                UnitCount     = effectiveUnits,
                TokensUsed    = tokensUsed
            };

            if (_scopeFactory != null)
            {
                using var scope = _scopeFactory.CreateScope();
                var dbContext = scope.ServiceProvider.GetRequiredService<KairoDbContext>();
                dbContext.UsageLedger.Add(entry);
                // Use CancellationToken.None so client disconnection at response write does not cancel usage audit persistence
                await dbContext.SaveChangesAsync(CancellationToken.None);
            }
            else if (_dbContext != null)
            {
                _dbContext.UsageLedger.Add(entry);
                await _dbContext.SaveChangesAsync(cancellationToken);
            }

            // Successfully committed to DB: release in-flight quota reservation if applicable
            _quotaService?.ReleaseReservation(projectId, effectiveUnits);
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
