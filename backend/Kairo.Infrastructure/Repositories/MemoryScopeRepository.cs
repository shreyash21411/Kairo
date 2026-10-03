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
                ActorId   = x.ActorId
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
}

