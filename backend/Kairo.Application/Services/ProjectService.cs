using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;

namespace Kairo.Application.Services;

public class ProjectService : IProjectService
{
    private readonly IProjectRepository _projectRepository;

    public ProjectService(
        IProjectRepository projectRepository)
    {
        _projectRepository = projectRepository;
    }

    public async Task<ProjectResponse> CreateAsync(
        long userId,
        CreateProjectRequest request)
    {
        if (userId <= 0)
        {
            throw new ArgumentException(
                "Invalid UserId.");
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            throw new ArgumentException(
                "Project name is required.");
        }

        var projectName = request.Name.Trim();

        if (projectName.Length > 200)
        {
            throw new ArgumentException(
                "Project name cannot exceed 200 characters.");
        }

        var projectId =
            await _projectRepository.CreateAsync(
                userId,
                projectName);

        return new ProjectResponse
        {
            ProjectId = projectId,
            UserId = userId,
            Name = projectName,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
    }

    public async Task<List<ProjectResponse>> GetByUserAsync(
        long userId)
    {
        if (userId <= 0)
        {
            throw new ArgumentException(
                "Invalid UserId.");
        }

        var projects =
            await _projectRepository.GetByUserAsync(userId);

        return projects
            .Select(x => new ProjectResponse
            {
                ProjectId = x.ProjectId,
                UserId = x.UserId,
                Name = x.Name,
                CreatedAt = x.CreatedAt,
                UpdatedAt = x.UpdatedAt
            })
            .ToList();
    }

    public async Task<ProjectResponse?> GetByIdAsync(
        long projectId,
        long userId)
    {
        if (projectId <= 0)
        {
            throw new ArgumentException(
                "Invalid ProjectId.");
        }

        if (userId <= 0)
        {
            throw new ArgumentException(
                "Invalid UserId.");
        }

        var project =
            await _projectRepository.GetByIdAsync(
                projectId,
                userId);

        if (project == null)
        {
            return null;
        }

        return new ProjectResponse
        {
            ProjectId = project.ProjectId,
            UserId = project.UserId,
            Name = project.Name,
            CreatedAt = project.CreatedAt,
            UpdatedAt = project.UpdatedAt
        };
    }

    public async Task<bool> DeleteAsync(
        long projectId,
        long userId)
    {
        if (projectId <= 0)
        {
            throw new ArgumentException(
                "Invalid ProjectId.");
        }

        if (userId <= 0)
        {
            throw new ArgumentException(
                "Invalid UserId.");
        }

        return await _projectRepository.DeleteAsync(
            projectId,
            userId);
    }
}