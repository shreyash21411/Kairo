namespace Kairo.Application.DTOs;

public class UserLoginData
{
    public long UserId { get; set; }
    public string Email { get; set; } = null!;
    public string? PasswordHash { get; set; }
    public bool IsEmailVerified { get; set; }
    public byte AccountStatus { get; set; }
}