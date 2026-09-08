using Kairo.Application.Abstractions.Security;

namespace Kairo.API.Security;

public class ApiKeyContext : IApiKeyContext
{
    public long UserId { get; private set; }

    public long ProjectId { get; private set; }

    public long ApiKeyId { get; private set; }

    public void SetContext(
        long userId,
        long projectId,
        long apiKeyId)
    {
        UserId = userId;
        ProjectId = projectId;
        ApiKeyId = apiKeyId;
    }
}