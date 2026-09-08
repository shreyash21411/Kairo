using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

public interface IProjectService
{
    Task<ProjectResponse> CreateAsync(
        long userId,
        CreateProjectRequest request);

    Task<List<ProjectResponse>> GetByUserAsync(
        long userId);

    Task<ProjectResponse?> GetByIdAsync(
        long projectId,
        long userId);

    Task<bool> DeleteAsync(
        long projectId,
        long userId);
}