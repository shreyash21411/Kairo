namespace Kairo.Application.DTOs;

public class CreateMessageRequest
{
    public string ExternalMessageId { get; set; } = null!;

    public string Role { get; set; } = null!;

    public string Content { get; set; } = null!;

    public DateTime CreatedAt { get; set; }
}