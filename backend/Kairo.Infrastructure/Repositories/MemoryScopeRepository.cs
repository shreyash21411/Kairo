using Kairo.Application.Abstractions.Persistence;
using Kairo.Infrastructure.Persistence;
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
}
