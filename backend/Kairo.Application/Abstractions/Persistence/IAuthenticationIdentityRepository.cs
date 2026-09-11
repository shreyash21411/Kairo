using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Persistence;

public interface IAuthenticationIdentityRepository
{
    Task<AuthenticationIdentityData?> GetByProviderSubjectAsync(
        string provider,
        string providerSubject,
        CancellationToken cancellationToken = default);

    Task<AuthenticationIdentityData?> GetPasswordIdentityByUserIdAsync(
        long userId,
        CancellationToken cancellationToken = default);

    Task AddAsync(
        AuthenticationIdentityData identity,
        CancellationToken cancellationToken = default);
}