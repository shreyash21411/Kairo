using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

public interface IApiKeyService
{
    Task<CreatedApiKeyResponse> CreateAsync(
        long userId,
        CreateApiKeyRequest request);

    Task<List<ApiKeyResponse>> GetByProjectAsync(
        long userId,
        long projectId);

    Task<bool> RevokeAsync(
        long userId,
        long apiKeyId);
}