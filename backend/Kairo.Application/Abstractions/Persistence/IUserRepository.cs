using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Persistence;

public interface IUserRepository
{
    Task<bool> ExistsByEmailAsync(string email);

    Task<bool> ExistsByIdAsync(long userId);

    Task<long> CreateAsync(
        string email,
        string passwordHash,
        bool isEmailVerified,
        byte accountStatus);

    Task<UserLoginData?> GetLoginDataByEmailAsync(string email);
}