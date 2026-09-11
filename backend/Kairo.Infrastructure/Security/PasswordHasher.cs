using Kairo.Application.Abstractions.Security;
using Microsoft.AspNetCore.Identity;

namespace Kairo.Infrastructure.Security;

/// <summary>
/// Implements IPasswordHasher using ASP.NET Core's built-in PasswordHasher&lt;T&gt;.
/// PasswordHasher&lt;object&gt; is used because hashing requires no domain entity;
/// the generic parameter is only relevant for ASP.NET Identity's full pipeline.
///
/// Internally uses PBKDF2 with HMAC-SHA512, a 128-bit salt, and 100,000 iterations
/// (ASP.NET Core Identity V3 format). This is suitable for production use.
/// </summary>
public sealed class PasswordHasher : IPasswordHasher
{
    // A single shared instance is safe: PasswordHasher<T> is stateless and thread-safe.
    private static readonly PasswordHasher<object> _inner = new();

    /// <inheritdoc />
    public string Hash(string password)
    {
        // The user object passed to HashPassword is not used by the hasher itself —
        // it only exists because the generic API requires it.
        return _inner.HashPassword(null!, password);
    }

    /// <inheritdoc />
    public bool Verify(string password, string passwordHash)
    {
        var result = _inner.VerifyHashedPassword(null!, passwordHash, password);

        // PasswordVerificationResult.Success  → correct password, hash is current
        // PasswordVerificationResult.SuccessRehashNeeded → correct password, but hash
        //   was produced with an older algorithm iteration count. We treat this as a
        //   successful verification; rehashing on next login can be added in a future phase.
        return result is PasswordVerificationResult.Success
                      or PasswordVerificationResult.SuccessRehashNeeded;
    }
}
