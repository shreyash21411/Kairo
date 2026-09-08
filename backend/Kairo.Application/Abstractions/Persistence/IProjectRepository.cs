namespace Kairo.Application.Abstractions.Persistence;

public interface IProjectRepository
{
    Task<long> CreateAsync(
        long userId,
        string name);

    Task<List<ProjectData>> GetByUserAsync(
        long userId);

    Task<ProjectData?> GetByIdAsync(
        long projectId,
        long userId);

    Task<bool> DeleteAsync(
        long projectId,
        long userId);
}

public class ProjectData
{
    public long ProjectId { get; set; }

    public long UserId { get; set; }

    public string Name { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}