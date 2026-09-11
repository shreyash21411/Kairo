namespace Kairo.Application.DTOs;

public sealed record AuthenticationIdentityData(
    long AuthenticationIdentityId,
    long UserId,
    string Provider,
    string ProviderSubject,
    string? PasswordHash); 