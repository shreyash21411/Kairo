namespace Kairo.Application.DTOs;

public class CreateProjectRequest
{
    public string Name { get; set; } = null!;
}

public class ProjectResponse
{
    public long ProjectId { get; set; }

    public long UserId { get; set; }

    public string Name { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}