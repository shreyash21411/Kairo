namespace Kairo.Application;

/// <summary>
/// Thrown by Infrastructure when a database write fails due to a unique
/// constraint violation. Contains no EF Core, SqlClient, or SQL Server
/// references — it is a pure Application-layer semantic exception.
///
/// Callers in AccountService translate this into the appropriate
/// application result (e.g. DuplicateEmailException for registration,
/// silent success for concurrent legacy migration).
/// </summary>
public sealed class UniqueConstraintViolationException : Exception
{
    public UniqueConstraintViolationException()
        : base("A unique constraint violation occurred.") { }

    public UniqueConstraintViolationException(string message)
        : base(message) { }
}
