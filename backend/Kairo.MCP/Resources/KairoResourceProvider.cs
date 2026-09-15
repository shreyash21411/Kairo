using System.ComponentModel;
using System.Text.Json;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using ModelContextProtocol.Server;

namespace Kairo.MCP.Resources;

/// <summary>
/// Kairo MCP Resource Provider — Phase 9 Step 9: Read-Only Resource Layer.
///
/// ── Architecture Contract ──────────────────────────────────────────────────
/// Exposes authenticated, read-only MCP resources for clients:
///   1. kairo://user/profile           — Current user profile & tenant context
///   2. kairo://projects               — Projects belonging to the authenticated user
///   3. kairo://memories               — All active memories for the authenticated user
///   4. kairo://memories/{memoryId}    — Single memory by ID for the authenticated user
///
/// ── Tenancy & Security ─────────────────────────────────────────────────────
///   - User identity is ALWAYS resolved from IApiKeyContext.UserId (populated by
///     KairoApiKeyAuthenticationHandler). Never accepted from client input.
///   - MapMcp("/mcp").RequireAuthorization() ensures only authenticated requests
///     reach these resources.
///   - All read operations delegate directly to existing Application services
///     (IProjectService, IMemoryService).
///   - Zero repository injection, zero DbContext, zero SQL, zero EF Core, zero Mistral.
///   - No business logic or validation is duplicated here.
/// </summary>
[McpServerResourceType]
public sealed class KairoResourceProvider
{
    private readonly IApiKeyContext _apiKeyContext;
    private readonly IProjectService _projectService;
    private readonly IMemoryService _memoryService;

    // Shared serialization options matching KairoMemoryTools.
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public KairoResourceProvider(
        IApiKeyContext apiKeyContext,
        IProjectService projectService,
        IMemoryService memoryService)
    {
        _apiKeyContext = apiKeyContext;
        _projectService = projectService;
        _memoryService = memoryService;
    }

    // ── 1. kairo://user/profile ──────────────────────────────────────────────

    /// <summary>
    /// Exposes the authenticated user profile, active project, and tenant identity.
    /// </summary>
    [McpServerResource(
        UriTemplate = "kairo://user/profile",
        Name = "user_profile",
        Title = "User Profile",
        MimeType = "application/json")]
    [Description("Returns the profile and tenant context of the authenticated user.")]
    public async Task<string> GetUserProfile()
    {
        var userId = _apiKeyContext.UserId;
        var projects = await _projectService.GetByUserAsync(userId);

        var profile = new
        {
            userId = userId,
            projectId = _apiKeyContext.ProjectId,
            apiKeyId = _apiKeyContext.ApiKeyId,
            projectCount = projects.Count,
            projects = projects
        };

        return JsonSerializer.Serialize(profile, JsonOptions);
    }

    // ── 2. kairo://projects ──────────────────────────────────────────────────

    /// <summary>
    /// Exposes all active projects belonging to the authenticated user.
    /// </summary>
    [McpServerResource(
        UriTemplate = "kairo://projects",
        Name = "projects",
        Title = "Projects",
        MimeType = "application/json")]
    [Description("Returns all active projects belonging to the authenticated user.")]
    public async Task<string> GetProjects()
    {
        var userId = _apiKeyContext.UserId;
        var projects = await _projectService.GetByUserAsync(userId);

        return JsonSerializer.Serialize(projects, JsonOptions);
    }

    // ── 3. kairo://memories ──────────────────────────────────────────────────

    /// <summary>
    /// Exposes all active durable memories for the authenticated user, newest first.
    /// </summary>
    [McpServerResource(
        UriTemplate = "kairo://memories",
        Name = "memories",
        Title = "Memories",
        MimeType = "application/json")]
    [Description("Returns all active durable memories belonging to the authenticated user.")]
    public async Task<string> GetMemories()
    {
        var userId = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;
        var memories = await _memoryService.ListMemoriesAsync(userId, projectId);

        return JsonSerializer.Serialize(memories, JsonOptions);
    }

    // ── 4. kairo://memories/{memoryId} ───────────────────────────────────────

    /// <summary>
    /// Exposes a single memory by ID for the authenticated user and project.
    /// Enforces tenant boundary: MemoryService validates ownership at the SQL level.
    /// </summary>
    [McpServerResource(
        UriTemplate = "kairo://memories/{memoryId}",
        Name = "memory_by_id",
        Title = "Memory by ID",
        MimeType = "application/json")]
    [Description("Returns a single memory by its unique ID for the authenticated user.")]
    public async Task<string> GetMemoryById(
        [Description("The unique ID of the memory to retrieve.")]
        long memoryId)
    {
        var userId = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;
        var memory = await _memoryService.GetMemoryAsync(memoryId, userId, projectId);

        return JsonSerializer.Serialize(memory, JsonOptions);
    }
}
