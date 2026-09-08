using Kairo.Application.Abstractions.Persistence;
using Kairo.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Kairo.Infrastructure.Repositories;

public class ProjectRepository : IProjectRepository
{
    private readonly KairoDbContext _dbContext;

    public ProjectRepository(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<long> CreateAsync(
        long userId,
        string name)
    {
        var project = new Persistence.Entities.Projects
        {
            UserId = userId,
            Name = name,
            IsDeleted = false
        };

        _dbContext.Projects.Add(project);

        await _dbContext.SaveChangesAsync();

        return project.ProjectId;
    }

    public async Task<List<ProjectData>> GetByUserAsync(
        long userId)
    {
        return await _dbContext.Projects
            .AsNoTracking()
            .Where(x =>
                x.UserId == userId &&
                !x.IsDeleted)
            .OrderByDescending(x => x.CreatedAt)
            .Select(x => new ProjectData
            {
                ProjectId = x.ProjectId,
                UserId = x.UserId,
                Name = x.Name,
                CreatedAt = x.CreatedAt,
                UpdatedAt = x.UpdatedAt
            })
            .ToListAsync();
    }

    public async Task<ProjectData?> GetByIdAsync(
        long projectId,
        long userId)
    {
        return await _dbContext.Projects
            .AsNoTracking()
            .Where(x =>
                x.ProjectId == projectId &&
                x.UserId == userId &&
                !x.IsDeleted)
            .Select(x => new ProjectData
            {
                ProjectId = x.ProjectId,
                UserId = x.UserId,
                Name = x.Name,
                CreatedAt = x.CreatedAt,
                UpdatedAt = x.UpdatedAt
            })
            .FirstOrDefaultAsync();
    }

    public async Task<bool> DeleteAsync(
        long projectId,
        long userId)
    {
        var project = await _dbContext.Projects
            .FirstOrDefaultAsync(x =>
                x.ProjectId == projectId &&
                x.UserId == userId &&
                !x.IsDeleted);

        if (project == null)
        {
            return false;
        }

        project.IsDeleted = true;
        project.UpdatedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync();

        return true;
    }
}