namespace Kairo.Application.Abstractions.Persistence;

public interface IApiKeyRepository
{
    Task<long> CreateAsync(
        long projectId,
        string keyHash,
        string keyPrefix,
        string name,
        DateTime? expiresAt);

    Task<ApiKeyData?> GetByHashAsync(
        string keyHash);

    Task<List<ApiKeyData>> GetByProjectAsync(
        long projectId);

    Task<ApiKeyData?> GetByIdAsync(
        long apiKeyId);

    Task<bool> RevokeAsync(
        long apiKeyId);

    Task UpdateLastUsedAtAsync(
        long apiKeyId);

    Task<bool> ProjectBelongsToUserAsync(
    long projectId,
    long userId);

    Task<long?> GetUserIdByApiKeyIdAsync(
    long apiKeyId);
}

public class ApiKeyData
{
    public long ApiKeyId { get; set; }

    public long ProjectId { get; set; }

    public string KeyHash { get; set; } = null!;

    public string KeyPrefix { get; set; } = null!;

    public string Name { get; set; } = null!;

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public DateTime? LastUsedAt { get; set; }

    public DateTime? ExpiresAt { get; set; }
}