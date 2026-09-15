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
        if (string.IsNullOrWhiteSpace(actorId))
        {
            throw new ArgumentException(
                "ActorId must not be null, empty, or whitespace.",
                nameof(actorId));
        }

        var scope = await _memoryScopeRepository.GetByProjectAndActorAsync(
            projectId,
            actorId,
            cancellationToken);

        if (scope == null)
        {
            throw new MemoryScopeNotFoundException();
        }

        return scope.ScopeId;
    }
}
