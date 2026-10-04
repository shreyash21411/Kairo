using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;

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

    // ── Phase 1: Multi-dimensional scope resolution ────────────────────────────

    /// <inheritdoc/>
    public async Task<long> GetOrCreateFromScopeKeyAsync(
        long projectId,
        MemoryScopeKey key,
        CancellationToken cancellationToken = default)
    {
        if (key == null) throw new ArgumentNullException(nameof(key));
        if (key.IsEmpty) throw new ArgumentException(
            "MemoryScopeKey must have at least one dimension set.", nameof(key));

        // When any Phase 1 multi-dim dimension is present, use the multi-dim path.
        if (!string.IsNullOrWhiteSpace(key.UserId)    ||
            !string.IsNullOrWhiteSpace(key.AgentId)   ||
            !string.IsNullOrWhiteSpace(key.SessionId) ||
            !string.IsNullOrWhiteSpace(key.RunId))
        {
            var scope = await _memoryScopeRepository.GetOrCreateMultiDimAsync(
                projectId,
                key.UserId?.Trim(),
                key.AgentId?.Trim(),
                key.SessionId?.Trim(),
                key.RunId?.Trim(),
                cancellationToken);

            return scope.ScopeId;
        }

        // Fall back to V1 legacy path when only ActorId is set.
        return await GetOrCreateScopeAsync(projectId, key.ActorId!, cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<long> ResolveFromScopeKeyAsync(
        long projectId,
        MemoryScopeKey key,
        CancellationToken cancellationToken = default)
    {
        if (key == null) throw new ArgumentNullException(nameof(key));
        if (key.IsEmpty) throw new ArgumentException(
            "MemoryScopeKey must have at least one dimension set.", nameof(key));

        if (!string.IsNullOrWhiteSpace(key.UserId)    ||
            !string.IsNullOrWhiteSpace(key.AgentId)   ||
            !string.IsNullOrWhiteSpace(key.SessionId) ||
            !string.IsNullOrWhiteSpace(key.RunId))
        {
            var scope = await _memoryScopeRepository.GetByMultiDimKeyAsync(
                projectId,
                key.UserId?.Trim(),
                key.AgentId?.Trim(),
                key.SessionId?.Trim(),
                key.RunId?.Trim(),
                cancellationToken);

            if (scope == null) throw new MemoryScopeNotFoundException();
            return scope.ScopeId;
        }

        return await ResolveScopeAsync(projectId, key.ActorId!, cancellationToken);
    }

    // ── Private helpers ────────────────────────────────────────────────────────

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
