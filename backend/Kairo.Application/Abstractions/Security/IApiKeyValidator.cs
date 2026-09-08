namespace Kairo.Application.Abstractions.Security;

public interface IApiKeyValidator
{
    Task<ApiKeyValidationResult> ValidateAsync(
        string rawApiKey);
}

public class ApiKeyValidationResult
{
    public bool IsValid { get; set; }

    public long UserId { get; set; }

    public long ProjectId { get; set; }

    public long ApiKeyId { get; set; }
}