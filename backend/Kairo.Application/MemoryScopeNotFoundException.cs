namespace Kairo.Application;

/// <summary>
/// Thrown by <see cref="Services.ScopeResolutionService"/> when no MemoryScope
/// exists for the requested (ProjectId, ActorId) combination.
///
/// This is a pure Application-layer exception. It contains no EF Core, SQL
/// Server, or Infrastructure references. Callers (controllers or higher-level
/// services) are responsible for mapping this to the appropriate HTTP response.
/// </summary>
public sealed class MemoryScopeNotFoundException : Exception
{
    public MemoryScopeNotFoundException()
        : base("No memory scope exists for the specified project and actor.") { }

    public MemoryScopeNotFoundException(string message)
        : base(message) { }
}
