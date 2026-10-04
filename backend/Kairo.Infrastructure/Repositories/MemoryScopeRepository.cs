using Kairo.Application.Abstractions.Persistence;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kairo.Infrastructure.Repositories;

public class MemoryScopeRepository : IMemoryScopeRepository
{
    private readonly KairoDbContext _dbContext;

    public MemoryScopeRepository(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <inheritdoc/>
    public async Task<MemoryScopeData?> GetByProjectAndActorAsync(
        long projectId,
        string actorId,
        CancellationToken cancellationToken = default)
    {
        return await _dbContext.MemoryScopes
            .AsNoTracking()
            .Where(x =>
                x.ProjectId == projectId &&
                x.ActorId == actorId)
            .Select(x => new MemoryScopeData
            {
                ScopeId   = x.ScopeId,
                ProjectId = x.ProjectId,
                ActorId   = x.ActorId,
                UserId    = x.UserId,
                AgentId   = x.AgentId,
                SessionId = x.SessionId,
                RunId     = x.RunId
            })
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<MemoryScopeData> GetOrCreateAsync(
        long projectId,
        string actorId,
        CancellationToken cancellationToken = default)
    {
        var existing = await GetByProjectAndActorAsync(projectId, actorId, cancellationToken);
        if (existing != null)
        {
            return existing;
        }

        var now = DateTime.UtcNow;
        var entity = new MemoryScopes
        {
            ProjectId = projectId,
            ActorId   = actorId,
            CreatedAt = now,
            UpdatedAt = now
        };

        try
        {
            _dbContext.MemoryScopes.Add(entity);
            await _dbContext.SaveChangesAsync(cancellationToken);

            return new MemoryScopeData
            {
                ScopeId   = entity.ScopeId,
                ProjectId = entity.ProjectId,
                ActorId   = entity.ActorId
            };
        }
        catch (DbUpdateException)
        {
            _dbContext.Entry(entity).State = EntityState.Detached;

            var created = await GetByProjectAndActorAsync(projectId, actorId, cancellationToken);
            if (created != null)
            {
                return created;
            }

            throw;
        }
    }

    // ── Phase 1: Multi-dimensional scope methods ───────────────────────────────

    /// <inheritdoc/>
    public async Task<MemoryScopeData?> GetByMultiDimKeyAsync(
        long projectId,
        string? userId,
        string? agentId,
        string? sessionId,
        string? runId,
        CancellationToken cancellationToken = default)
    {
        var syntheticActorId = BuildSyntheticActorId(userId, agentId, sessionId, runId);
        return await GetByProjectAndActorAsync(projectId, syntheticActorId, cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<MemoryScopeData> GetOrCreateMultiDimAsync(
        long projectId,
        string? userId,
        string? agentId,
        string? sessionId,
        string? runId,
        CancellationToken cancellationToken = default)
    {
        var syntheticActorId = BuildSyntheticActorId(userId, agentId, sessionId, runId);

        var existing = await GetByProjectAndActorAsync(projectId, syntheticActorId, cancellationToken);
        if (existing != null)
        {
            return existing;
        }

        var now = DateTime.UtcNow;
        var entity = new MemoryScopes
        {
            ProjectId = projectId,
            ActorId   = syntheticActorId,
            UserId    = userId?.Trim(),
            AgentId   = agentId?.Trim(),
            SessionId = sessionId?.Trim(),
            RunId     = runId?.Trim(),
            CreatedAt = now,
            UpdatedAt = now
        };

        try
        {
            _dbContext.MemoryScopes.Add(entity);
            await _dbContext.SaveChangesAsync(cancellationToken);

            return new MemoryScopeData
            {
                ScopeId   = entity.ScopeId,
                ProjectId = entity.ProjectId,
                ActorId   = entity.ActorId,
                UserId    = entity.UserId,
                AgentId   = entity.AgentId,
                SessionId = entity.SessionId,
                RunId     = entity.RunId
            };
        }
        catch (DbUpdateException)
        {
            _dbContext.Entry(entity).State = EntityState.Detached;

            var created = await GetByProjectAndActorAsync(projectId, syntheticActorId, cancellationToken);
            if (created != null)
            {
                return created;
            }

            throw;
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Builds a deterministic synthetic ActorId from the multi-dimensional scope key.
    /// This encodes all Phase 1 dimensions into the existing ActorId column so the
    /// (ProjectId, ActorId) unique constraint still enforces deduplication.
    ///
    /// Format: "mdim:u={userId}|a={agentId}|s={sessionId}|r={runId}"
    /// Empty/null dimensions are encoded as "-".
    /// Truncated to 128 chars (the ActorId column max length) if needed.
    /// </summary>
    internal static string BuildSyntheticActorId(
        string? userId,
        string? agentId,
        string? sessionId,
        string? runId)
    {
        static string Seg(string? v) =>
            string.IsNullOrWhiteSpace(v) ? "-" : v.Trim();

        var composite =
            $"mdim:u={Seg(userId)}|a={Seg(agentId)}|s={Seg(sessionId)}|r={Seg(runId)}";

        if (composite.Length > 128)
            composite = composite[..128];

        return composite;
    }
}
