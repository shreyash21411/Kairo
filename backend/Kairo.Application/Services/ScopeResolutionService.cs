using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;

namespace Kairo.Application.Services;

public class ScopeResolutionService : IScopeResolutionService
{
    private readonly IMemoryScopeRepository _memoryScopeRepository;

    public ScopeResolutionService(IMemoryScopeRepository memoryScopeRepository)
    {
        _memoryScopeRepository = memoryScopeRepository;
    }

    /// <inheritdoc/>
    public async Task<long> ResolveScopeAsync(
        long projectId,
        string actorId,
        CancellationToken cancellationToken = default)
    {
        var normalizedActorId = ValidateAndNormalizeActorId(actorId);

        var scope = await _memoryScopeRepository.GetByProjectAndActorAsync(
            projectId,
            normalizedActorId,
            cancellationToken);

        if (scope == null)
        {
            throw new MemoryScopeNotFoundException();
        }

        return scope.ScopeId;
    }

    /// <inheritdoc/>
    public async Task<long> GetOrCreateScopeAsync(
        long projectId,
        string actorId,
        CancellationToken cancellationToken = default)
    {
        var normalizedActorId = ValidateAndNormalizeActorId(actorId);

        var scope = await _memoryScopeRepository.GetOrCreateAsync(
            projectId,
            normalizedActorId,
            cancellationToken);

        return scope.ScopeId;
    }

    private static string ValidateAndNormalizeActorId(string actorId)
    {
        if (string.IsNullOrWhiteSpace(actorId))
        {
            throw new ArgumentException(
                "ActorId must not be null, empty, or whitespace.",
                nameof(actorId));
        }

        var normalized = actorId.Trim();

        if (normalized.Length > 128)
        {
            throw new ArgumentException(
                "ActorId must not exceed 128 characters.",
                nameof(actorId));
        }

        return normalized;
    }
}
