namespace Kairo.Application.Abstractions.Security;

/// <summary>
/// Abstracts password hashing and verification for the authentication system.
/// The Application layer depends on this interface only — never on a concrete hasher.
/// </summary>
public interface IPasswordHasher
{
    /// <summary>
    /// Produces a secure, salted hash of the supplied plain-text password.
    /// The returned string is suitable for storage in AuthenticationIdentities.PasswordHash.
    /// </summary>
    string Hash(string password);

    /// <summary>
    /// Verifies a plain-text password candidate against a previously stored hash.
    /// Returns true when the password matches; false otherwise.
    /// Never reveals whether the failure is due to the email not existing or the
    /// password being wrong — that responsibility belongs to the caller.
    /// </summary>
    bool Verify(string password, string passwordHash);
}
