using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Microsoft.AspNetCore.Identity;

namespace Kairo.Application.Services;

public class UserService : IUserService
{
    private readonly IUserRepository _userRepository;
    private readonly PasswordHasher<object> _passwordHasher;

    public UserService(IUserRepository userRepository)
    {
        _userRepository = userRepository;
        _passwordHasher = new PasswordHasher<object>();
    }

    public async Task<long> RegisterAsync(
        string email,
        string password)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            throw new ArgumentException("Email is required.");
        }

        if (string.IsNullOrWhiteSpace(password))
        {
            throw new ArgumentException("Password is required.");
        }

        email = email.Trim().ToLowerInvariant();

        var exists = await _userRepository.ExistsByEmailAsync(email);

        if (exists)
        {
            throw new InvalidOperationException(
                "A user with this email already exists.");
        }

        var passwordHash = _passwordHasher.HashPassword(
            null!,
            password);

        return await _userRepository.CreateAsync(
            email,
            passwordHash,
            false,
            1);
    }
    public async Task<bool> LoginAsync(
    string email,
    string password)
{
    if (string.IsNullOrWhiteSpace(email))
    {
        throw new ArgumentException("Email is required.");
    }

    if (string.IsNullOrWhiteSpace(password))
    {
        throw new ArgumentException("Password is required.");
    }

    email = email.Trim().ToLowerInvariant();

    var user = await _userRepository
        .GetLoginDataByEmailAsync(email);

    if (user == null)
    {
        return false;
    }

    var passwordResult = _passwordHasher.VerifyHashedPassword(
        null!,
        user.PasswordHash,
        password);

    return passwordResult == PasswordVerificationResult.Success ||
           passwordResult == PasswordVerificationResult.SuccessRehashNeeded;
}
}