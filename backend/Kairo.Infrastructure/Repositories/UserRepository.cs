using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kairo.Infrastructure.Repositories;

public class UserRepository : IUserRepository
{
    private readonly KairoDbContext _dbContext;

    public UserRepository(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<bool> ExistsByEmailAsync(string email)
    {
        return await _dbContext.Users
            .AnyAsync(user => user.Email == email);
    }

    public async Task<bool> ExistsByIdAsync(long userId)
    {
        return await _dbContext.Users
            .AnyAsync(user => user.UserId == userId);
    }

    public async Task<long> CreateAsync(
        string email,
        string passwordHash,
        bool isEmailVerified,
        byte accountStatus)
    {
        var user = new Users
        {
            Email = email,
            PasswordHash = passwordHash,
            IsEmailVerified = isEmailVerified,
            AccountStatus = accountStatus,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _dbContext.Users.Add(user);

        await _dbContext.SaveChangesAsync();

        return user.UserId;
    }

    public async Task<UserLoginData?> GetLoginDataByEmailAsync(string email)
    {
        return await _dbContext.Users
            .Where(user => user.Email == email)
            .Select(user => new UserLoginData
            {
                UserId = user.UserId,
                Email = user.Email,
                PasswordHash = user.PasswordHash,
                IsEmailVerified = user.IsEmailVerified,
                AccountStatus = user.AccountStatus
            })
            .FirstOrDefaultAsync();
    }
}