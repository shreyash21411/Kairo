using System.Security.Cryptography;
using System.Text;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Security;

namespace Kairo.Application.Security;

public class ApiKeyValidator : IApiKeyValidator
{
    private readonly IApiKeyRepository _apiKeyRepository;

    public ApiKeyValidator(
        IApiKeyRepository apiKeyRepository)
    {
        _apiKeyRepository = apiKeyRepository;
    }

    public async Task<ApiKeyValidationResult> ValidateAsync(
        string rawApiKey)
    {
        if (string.IsNullOrWhiteSpace(rawApiKey))
        {
            return new ApiKeyValidationResult
            {
                IsValid = false
            };
        }

        // Hash the incoming raw API key.
        var keyHash = Convert.ToHexString(
            SHA256.HashData(
                Encoding.UTF8.GetBytes(rawApiKey)));

        // Find an active API key with this hash.
        var apiKey =
            await _apiKeyRepository.GetByHashAsync(keyHash);

        if (apiKey == null)
        {
            return new ApiKeyValidationResult
            {
                IsValid = false
            };
        }

        // Check expiration.
        if (apiKey.ExpiresAt.HasValue &&
            apiKey.ExpiresAt.Value <= DateTime.UtcNow)
        {
            return new ApiKeyValidationResult
            {
                IsValid = false
            };
        }

        // Resolve the owning user through the project.
        var userId =
            await _apiKeyRepository.GetUserIdByApiKeyIdAsync(
                apiKey.ApiKeyId);

        if (!userId.HasValue)
        {
            return new ApiKeyValidationResult
            {
                IsValid = false
            };
        }

        // Update LastUsedAt only on successful authentication.
        await _apiKeyRepository.UpdateLastUsedAtAsync(apiKey.ApiKeyId);

        return new ApiKeyValidationResult
        {
            IsValid = true,
            UserId = userId.Value,
            ProjectId = apiKey.ProjectId,
            ApiKeyId = apiKey.ApiKeyId
        };
    }
}