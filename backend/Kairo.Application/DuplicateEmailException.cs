namespace Kairo.Application;

/// <summary>
/// Thrown by AccountService.RegisterAsync when the requested email address
/// is already associated with an existing user account.
/// The future AuthController maps this to HTTP 409 Conflict.
/// </summary>
public sealed class DuplicateEmailException : Exception
{
    public DuplicateEmailException()
        : base("An account with this email address already exists.") { }
}
