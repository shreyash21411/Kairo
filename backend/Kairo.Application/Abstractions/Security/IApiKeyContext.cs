namespace Kairo.Application.Abstractions.Security;

public interface IApiKeyContext
{
    long UserId { get; }

    long ProjectId { get; }

    long ApiKeyId { get; }
}