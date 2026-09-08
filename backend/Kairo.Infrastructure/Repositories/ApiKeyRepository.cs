using Kairo.Application.Abstractions.Persistence;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kairo.Infrastructure.Repositories;

public class ApiKeyRepository : IApiKeyRepository
{
    private readonly KairoDbContext _dbContext;

    public ApiKeyRepository(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<long> CreateAsync(
        long projectId,
        string keyHash,
        string keyPrefix,
        string name,
        DateTime? expiresAt)
    {
        var apiKey = new ApiKeys
        {
            ProjectId = projectId,
            KeyHash = keyHash,
            KeyPrefix = keyPrefix,
            Name = name,
            IsActive = true,
            ExpiresAt = expiresAt
        };

        _dbContext.ApiKeys.Add(apiKey);

        await _dbContext.SaveChangesAsync();

        return apiKey.ApiKeyId;
    }

    public async Task<ApiKeyData?> GetByHashAsync(
        string keyHash)
    {
        return await _dbContext.ApiKeys
            .AsNoTracking()
            .Where(x =>
                x.KeyHash == keyHash &&
                x.IsActive)
            .Select(x => new ApiKeyData
            {
                ApiKeyId = x.ApiKeyId,
                ProjectId = x.ProjectId,
                KeyHash = x.KeyHash,
                KeyPrefix = x.KeyPrefix,
                Name = x.Name,
                IsActive = x.IsActive,
                CreatedAt = x.CreatedAt,
                UpdatedAt = x.UpdatedAt,
                LastUsedAt = x.LastUsedAt,
                ExpiresAt = x.ExpiresAt
            })
            .FirstOrDefaultAsync();
    }

    public async Task<List<ApiKeyData>> GetByProjectAsync(
        long projectId)
    {
        return await _dbContext.ApiKeys
            .AsNoTracking()
            .Where(x => x.ProjectId == projectId)
            .OrderByDescending(x => x.CreatedAt)
            .Select(x => new ApiKeyData
            {
                ApiKeyId = x.ApiKeyId,
                ProjectId = x.ProjectId,
                KeyHash = x.KeyHash,
                KeyPrefix = x.KeyPrefix,
                Name = x.Name,
                IsActive = x.IsActive,
                CreatedAt = x.CreatedAt,
                UpdatedAt = x.UpdatedAt,
                LastUsedAt = x.LastUsedAt,
                ExpiresAt = x.ExpiresAt
            })
            .ToListAsync();
    }

    public async Task<ApiKeyData?> GetByIdAsync(
        long apiKeyId)
    {
        return await _dbContext.ApiKeys
            .AsNoTracking()
            .Where(x => x.ApiKeyId == apiKeyId)
            .Select(x => new ApiKeyData
            {
                ApiKeyId = x.ApiKeyId,
                ProjectId = x.ProjectId,
                KeyHash = x.KeyHash,
                KeyPrefix = x.KeyPrefix,
                Name = x.Name,
                IsActive = x.IsActive,
                CreatedAt = x.CreatedAt,
                UpdatedAt = x.UpdatedAt,
                LastUsedAt = x.LastUsedAt,
                ExpiresAt = x.ExpiresAt
            })
            .FirstOrDefaultAsync();
    }

    public async Task<bool> RevokeAsync(
        long apiKeyId)
    {
        var apiKey = await _dbContext.ApiKeys
            .FirstOrDefaultAsync(x => x.ApiKeyId == apiKeyId);

        if (apiKey == null)
        {
            return false;
        }

        if (!apiKey.IsActive)
        {
            return true;
        }

        apiKey.IsActive = false;
        apiKey.UpdatedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync();

        return true;
    }

    public async Task UpdateLastUsedAtAsync(
        long apiKeyId)
    {
        // Use ExecuteUpdateAsync for a single targeted UPDATE without loading the entity.
        await _dbContext.ApiKeys
            .Where(x => x.ApiKeyId == apiKeyId)
            .ExecuteUpdateAsync(setters =>
                setters.SetProperty(
                    x => x.LastUsedAt,
                    DateTime.UtcNow));
    }

    public async Task<bool> ProjectBelongsToUserAsync(
        long projectId,
        long userId)
    {
        return await _dbContext.Projects
            .AnyAsync(x =>
                x.ProjectId == projectId &&
                x.UserId == userId &&
                !x.IsDeleted);
    }

    public async Task<long?> GetUserIdByApiKeyIdAsync(
    long apiKeyId)
{
    return await _dbContext.ApiKeys
        .AsNoTracking()
        .Where(x => x.ApiKeyId == apiKeyId)
        .Select(x => (long?)x.Project.UserId)
        .FirstOrDefaultAsync();
}
}