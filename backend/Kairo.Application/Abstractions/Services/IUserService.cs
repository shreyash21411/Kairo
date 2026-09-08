namespace Kairo.Application.Abstractions.Services;

public interface IUserService
{
    Task<long> RegisterAsync(
        string email,
        string password);

    Task<bool> LoginAsync(
        string email,
        string password);
}