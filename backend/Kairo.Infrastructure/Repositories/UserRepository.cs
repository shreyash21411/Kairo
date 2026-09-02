using Kairo.Application.Abstractions.Persistence;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;

namespace Kairo.Infrastructure.Repositories;

public class UserRepository : IUserRepository
{
    private readonly KairoDbContext _dbContext;

    public UserRepository(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }
}