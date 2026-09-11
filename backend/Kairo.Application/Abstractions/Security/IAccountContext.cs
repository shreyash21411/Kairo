namespace Kairo.Application.Abstractions.Authentication;

public interface IAccountContext
{
    long UserId { get; }

    string Email { get; }
}