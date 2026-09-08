namespace Kairo.Application.DTOs;

public class CreateApiKeyRequest
{
    public long ProjectId { get; set; }

    public string Name { get; set; } = null!;

    public DateTime? ExpiresAt { get; set; }
}

public class ApiKeyResponse
{
    public long ApiKeyId { get; set; }

    public long ProjectId { get; set; }

    public string Name { get; set; } = null!;

    public string KeyPrefix { get; set; } = null!;

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? LastUsedAt { get; set; }

    public DateTime? ExpiresAt { get; set; }
}

public class CreatedApiKeyResponse : ApiKeyResponse
{
    public string ApiKey { get; set; } = null!;
}