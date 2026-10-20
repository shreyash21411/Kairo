namespace Kairo.Application.Abstractions.Security;

/// <summary>
/// Provides authorization constants and contracts for project-level data isolation.
/// </summary>
public static class ProjectAuthorizationContext
{
    /// <summary>
    /// Sentinel value used to explicitly authorize global/unscoped retrieval across all projects
    /// for a user (e.g., admin export, user-level maintenance, embedding backfill).
    /// </summary>
    public const long ExplicitGlobalRetrieval = -1L;

    /// <summary>
    /// Sentinel value indicating missing or invalid project context in a project-scoped operation,
    /// causing database queries to fail closed (match zero records).
    /// </summary>
    public const long MissingContextSentinel = 0L;
}
