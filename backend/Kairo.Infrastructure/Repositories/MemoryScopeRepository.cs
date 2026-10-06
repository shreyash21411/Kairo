using System.Security.Cryptography;
using System.Text;
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
    /// Builds a deterministic, collision-resistant synthetic ActorId from the
    /// multi-dimensional scope key.  This encodes all Phase 1 dimensions into
    /// the existing ActorId column so the (ProjectId, ActorId) unique constraint
    /// still enforces deduplication.
    ///
    /// Algorithm:
    ///   1. Normalize each dimension (null/whitespace → empty string).
    ///   2. Build a canonical representation using length-prefixed segments.
    ///      Format: "u:<len>:<value>;a:<len>:<value>;s:<len>:<value>;r:<len>:<value>"
    ///      Length-prefixed encoding prevents any delimiter injection attack:
    ///      a value containing ';' or ':' cannot collide with a different combination
    ///      because the length field unambiguously separates values.
    ///   3. Compute SHA-256 of the canonical UTF-8 bytes.
    ///   4. Return "mdim:" + lower-hex SHA-256 (5 + 64 = 69 chars — safely under 128).
    ///
    /// Properties:
    ///   - Deterministic: same inputs → same output.
    ///   - Collision-resistant: SHA-256 makes collisions computationally infeasible.
    ///   - Fixed length: always 69 characters — no truncation.
    ///   - Backward compatible: V1 ActorIds (not starting with "mdim:") are unaffected.
    /// </summary>
    public static string BuildSyntheticActorId(
        string? userId,
        string? agentId,
        string? sessionId,
        string? runId)
    {
        // Normalize: null or whitespace → empty string
        static string Norm(string? v) => string.IsNullOrWhiteSpace(v) ? string.Empty : v.Trim();

        var u = Norm(userId);
        var a = Norm(agentId);
        var s = Norm(sessionId);
        var r = Norm(runId);

        // Length-prefixed canonical form prevents delimiter injection.
        // E.g. u="alice|a=bot" becomes "u:11:alice|a=bot;a:0:;s:0:;r:0:"
        // which is distinct from u="alice", a="bot" → "u:5:alice;a:3:bot;s:0:;r:0:"
        var canonical = $"u:{u.Length}:{u};a:{a.Length}:{a};s:{s.Length}:{s};r:{r.Length}:{r}";

        var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(canonical));
        var hashHex   = Convert.ToHexString(hashBytes).ToLowerInvariant();

        // "mdim:" (5) + 64 hex chars = 69 chars — always under the 128-char column limit.
        return "mdim:" + hashHex;
    }
}
