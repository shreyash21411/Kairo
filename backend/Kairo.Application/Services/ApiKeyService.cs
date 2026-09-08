using System.Security.Cryptography;
using System.Text;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;

namespace Kairo.Application.Services;

public class ApiKeyService : IApiKeyService
{
    private readonly IApiKeyRepository _apiKeyRepository;

    public ApiKeyService(IApiKeyRepository apiKeyRepository)
    {
        _apiKeyRepository = apiKeyRepository;
    }

    public async Task<CreatedApiKeyResponse> CreateAsync(
        long userId,
        CreateApiKeyRequest request)
    {
        // 1. Validate project ownership
        var projectBelongsToUser =
            await _apiKeyRepository.ProjectBelongsToUserAsync(
                request.ProjectId,
                userId);

        if (!projectBelongsToUser)
        {
            throw new UnauthorizedAccessException(
                "Project does not belong to the authenticated user.");
        }

        // 2. Validate API key name
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            throw new ArgumentException(
                "API key name is required.");
        }

        // 3. Generate secure random API key
        var randomBytes = RandomNumberGenerator.GetBytes(32);

        var randomPart = Convert.ToBase64String(randomBytes)
            .Replace("+", "-")
            .Replace("/", "_")
            .Replace("=", "");

        var rawApiKey = $"kairo_live_{randomPart}";

        // 4. Create a safe prefix for displaying the key later
        var keyPrefix = rawApiKey[..16];

        // 5. Hash the API key
        var keyHash = Convert.ToHexString(
            SHA256.HashData(
                Encoding.UTF8.GetBytes(rawApiKey)));

        // 6. Store only the hash
        var apiKeyId = await _apiKeyRepository.CreateAsync(
            request.ProjectId,
            keyHash,
            keyPrefix,
            request.Name.Trim(),
            request.ExpiresAt);

        // 7. Return the raw key ONLY during creation
        return new CreatedApiKeyResponse
        {
            ApiKeyId = apiKeyId,
            ProjectId = request.ProjectId,
            Name = request.Name.Trim(),
            KeyPrefix = keyPrefix,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            LastUsedAt = null,
            ExpiresAt = request.ExpiresAt,
            ApiKey = rawApiKey
        };
    }

    public async Task<List<ApiKeyResponse>> GetByProjectAsync(
        long userId,
        long projectId)
    {
        // 1. Verify project ownership
        var projectBelongsToUser =
            await _apiKeyRepository.ProjectBelongsToUserAsync(
                projectId,
                userId);

        if (!projectBelongsToUser)
        {
            throw new UnauthorizedAccessException(
                "Project does not belong to the user.");
        }

        // 2. Get API keys
        var apiKeys =
            await _apiKeyRepository.GetByProjectAsync(projectId);

        // 3. Never expose hash or raw API key
        return apiKeys.Select(x => new ApiKeyResponse
        {
            ApiKeyId = x.ApiKeyId,
            ProjectId = x.ProjectId,
            Name = x.Name,
            KeyPrefix = x.KeyPrefix,
            IsActive = x.IsActive,
            CreatedAt = x.CreatedAt,
            LastUsedAt = x.LastUsedAt,
            ExpiresAt = x.ExpiresAt
        }).ToList();
    }

    public async Task<bool> RevokeAsync(
        long userId,
        long apiKeyId)
    {
        // 1. Find the API key
        var apiKey =
            await _apiKeyRepository.GetByIdAsync(apiKeyId);

        if (apiKey == null)
        {
            return false;
        }

        // 2. Verify project ownership
        var projectBelongsToUser =
            await _apiKeyRepository.ProjectBelongsToUserAsync(
                apiKey.ProjectId,
                userId);

        if (!projectBelongsToUser)
        {
            throw new UnauthorizedAccessException(
                "API key does not belong to the user.");
        }

        // 3. Revoke the key
        return await _apiKeyRepository.RevokeAsync(apiKeyId);
    }
}