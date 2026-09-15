using System.ComponentModel;
using System.Text.Json;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using ModelContextProtocol.Server;

namespace Kairo.MCP.Tools;

/// <summary>
/// Kairo MCP tool class — Phase 9: V1 Tools (kairo_ping, remember, recall, update, forget).
///
/// ── Adapter contract ──────────────────────────────────────────────────────
/// This class is a pure adapter. It:
///   1. Reads the authenticated user identity from IApiKeyContext (populated
///      by the existing KairoApiKeyAuthenticationHandler before any tool runs).
///   2. Translates MCP tool arguments into existing Application DTOs.
///   3. Calls the existing IMemoryService — the SAME service used by
///      MemoryController. No memory logic is duplicated here.
///   4. Translates the Application response into an MCP-idiomatic string result.
///
/// ── Authentication contract ───────────────────────────────────────────────
/// The user identity is NEVER accepted from MCP tool arguments.
/// It is always read from IApiKeyContext.UserId, which is set by the existing
/// KairoApiKeyAuthenticationHandler during the ASP.NET Core auth pipeline.
/// MapMcp("/mcp").RequireAuthorization() in Program.cs ensures a 401 is
/// returned for any unauthenticated request before tools execute.
///
/// ── Tenant / project isolation ────────────────────────────────────────────
/// Isolation is enforced at two layers neither of which lives in this class:
///   1. API-key layer: each key resolves to a specific (UserId, ProjectId).
///   2. Repository layer: every IMemoryRepository query includes userId,
///      so a user can never access another user's memories at the SQL level.
///
/// ── DI lifetime ───────────────────────────────────────────────────────────
/// The MCP SDK creates a new DI scope per tool invocation (Streamable HTTP
/// transport). IMemoryService and IApiKeyContext are Scoped — they are the
/// same instances the current HTTP request would resolve in MemoryController.
///
/// ── Phase 8 contract ──────────────────────────────────────────────────────
///   - IMemoryService is NOT re-implemented — only injected and called.
///   - IApiKeyContext is NOT re-implemented — only injected and read.
///   - No embedding, similarity, duplicate-check, or consolidation logic
///     exists in this file or anywhere in Kairo.MCP.
///   - No database access occurs directly from this class.
/// </summary>
[McpServerToolType]
public sealed class KairoMemoryTools
{
    private readonly IApiKeyContext _apiKeyContext;
    private readonly IMemoryService _memoryService;
    private readonly IScopeResolutionService _scopeResolutionService;

    // Shared serialization options used for all MCP result payloads.
    // camelCase keeps output idiomatic for MCP clients.
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public KairoMemoryTools(
        IApiKeyContext apiKeyContext,
        IMemoryService memoryService,
        IScopeResolutionService scopeResolutionService)
    {
        _apiKeyContext = apiKeyContext;
        _memoryService = memoryService;
        _scopeResolutionService = scopeResolutionService;
    }

    // ── kairo_ping ───────────────────────────────────────────────────────────
    // Health-check tool: confirms the MCP endpoint is live and the API-key
    // authentication pipeline is wired correctly.

    [McpServerTool(Name = "kairo_ping")]
    [Description(
        "Confirms the Kairo MCP server is reachable and the API key is valid. " +
        "Returns the authenticated user ID.")]
    public string Ping()
    {
        return $"Kairo MCP v1 online. Authenticated as user {_apiKeyContext.UserId}.";
    }

    // ── remember ─────────────────────────────────────────────────────────────

    /// <summary>
    /// MCP remember → IMemoryService.CreateMemoryAsync
    ///
    /// Delegates entirely to the existing Kairo memory creation pipeline:
    ///   exact duplicate check → embedding → semantic duplicate check → persist.
    ///
    /// The authenticated userId comes from IApiKeyContext — never from the
    /// tool arguments. Validation, deduplication, embedding, and storage are
    /// all performed by the existing MemoryService; this method is a thin adapter.
    ///
    /// Valid memoryType values: Preference, Fact, Goal, Context, Skill,
    /// Relationship, Other. Validation is enforced by MemoryService.
    /// </summary>
    [McpServerTool(Name = "remember")]
    [Description(
        "Stores a durable memory in Kairo for the authenticated user and resolved actor scope. " +
        "The memory is deduplicated (exact and semantic) and embedded automatically. " +
        "Returns the created memory or a notice if a duplicate was detected. " +
        "Valid memoryType values: Preference, Fact, Goal, Context, Skill, Relationship, Other.")]
    public async Task<string> Remember(
        [Description(
            "The memory content to store. Must not be empty and must not exceed " +
            "10,000 characters.")]
        string content,

        [Description(
            "The category of the memory. Must be one of: " +
            "Preference, Fact, Goal, Context, Skill, Relationship, Other.")]
        string memoryType,

        [Description(
            "The actor identifier for this memory partition within the authenticated project. " +
            "Must not be empty.")]
        string actorId)
    {
        // Identity comes from the authenticated context — never from tool args.
        var userId = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;

        if (string.IsNullOrWhiteSpace(actorId))
        {
            throw new ArgumentException(
                "ActorId cannot be empty.",
                nameof(actorId));
        }

        // Build the existing Application DTO — no new DTOs introduced.
        var request = new CreateMemoryRequest
        {
            Content = content,
            MemoryType = memoryType,
            ActorId = actorId
        };

        // Delegate entirely to the existing Application memory pipeline.
        // MemoryService resolves the scope via IScopeResolutionService using
        // (projectId, actorId), enforces deduplication within that scope,
        // and persists the memory with the resolved ScopeId. ScopeId is never null.
        var (memory, duplicate) =
            await _memoryService.CreateMemoryAsync(request, userId, projectId);

        if (duplicate is not null)
        {
            // The memory was not stored because a duplicate exists.
            // Surface this clearly to the MCP client.
            return JsonSerializer.Serialize(new
            {
                stored = false,
                isDuplicate = duplicate.IsDuplicate,
                reason = duplicate.Reason
            }, JsonOptions);
        }

        // Memory was created successfully.
        return JsonSerializer.Serialize(new
        {
            stored = true,
            memoryId = memory!.MemoryId,
            userId = memory.UserId,
            content = memory.Content,
            memoryType = memory.MemoryType,
            isActive = memory.IsActive,
            createdAt = memory.CreatedAt,
            updatedAt = memory.UpdatedAt
        }, JsonOptions);
    }

    // ── recall ───────────────────────────────────────────────────────────────

    /// <summary>
    /// MCP recall → IMemoryService.SearchMemoriesAsync
    ///
    /// Delegates entirely to the existing Kairo semantic retrieval pipeline:
    ///   query embedding → cosine similarity → Mistral relevance evaluation.
    ///
    /// The authenticated userId comes from IApiKeyContext — never from the
    /// tool arguments. The retrieval pipeline is owned entirely by the existing
    /// MemoryService and MemoryRetrievalService; this method is a thin adapter.
    /// </summary>
    [McpServerTool(Name = "recall")]
    [Description(
        "Semantically searches the authenticated user's memories in Kairo within the specified actor scope. " +
        "Uses embedding similarity and relevance evaluation to return the most " +
        "relevant memories. Returns up to topK results (default 5, max 100).")]
    public async Task<string> Recall(
        [Description(
            "The search query. The system embeds this query and finds semantically " +
            "similar memories. Must not be empty.")]
        string query,

        [Description(
            "The actor identifier for the memory scope to search within the authenticated project. " +
            "Must not be empty.")]
        string actorId,

        [Description(
            "The maximum number of memories to return. Must be between 1 and 100. " +
            "Defaults to 5 if not specified.")]
        int topK = 5)
    {
        // Identity comes from the authenticated context — never from tool args.
        var userId = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;

        if (string.IsNullOrWhiteSpace(actorId))
        {
            throw new ArgumentException(
                "ActorId cannot be empty.",
                nameof(actorId));
        }

        // Build the existing Application DTO — no new DTOs introduced.
        var request = new MemorySearchRequest
        {
            Query = query,
            TopK = topK,
            ActorId = actorId
        };

        // Delegate entirely to the existing Application retrieval pipeline.
        // Embedding, cosine similarity, candidate ranking, and relevance
        // evaluation are scoped to the resolved MemoryScope. No global search.
        var result =
            await _memoryService.SearchMemoriesAsync(request, userId, projectId);

        return JsonSerializer.Serialize(new
        {
            query = result.Query,
            count = result.Count,
            memories = result.Memories.Select(m => new
            {
                memoryId = m.MemoryId,
                content = m.Content,
                memoryType = m.MemoryType,
                similarity = m.Similarity
            })
        }, JsonOptions);
    }

    // ── update ───────────────────────────────────────────────────────────────

    /// <summary>
    /// MCP update → IMemoryService.UpdateMemoryAsync
    ///
    /// Delegates entirely to the existing Kairo memory update pipeline:
    ///   ownership check → archive version (ApiUpdate) → update content → regenerate embedding.
    ///
    /// The authenticated userId comes from IApiKeyContext — never from the
    /// tool arguments. Validation, ownership verification, version archiving,
    /// embedding regeneration, and persistence are all performed by the existing
    /// MemoryService; this method is a thin adapter.
    ///
    /// Valid memoryType values: Preference, Fact, Goal, Context, Skill,
    /// Relationship, Other. Validation is enforced by MemoryService.
    /// </summary>
    [McpServerTool(Name = "update")]
    [Description(
        "Corrects or refines an existing memory in Kairo for the authenticated project and actor scope. " +
        "Archives the previous state as a historical version and regenerates the embedding. " +
        "Returns the updated memory details. " +
        "Valid memoryType values: Preference, Fact, Goal, Context, Skill, Relationship, Other.")]
    public async Task<string> Update(
        [Description(
            "The unique ID of the memory to update. Must belong to the authenticated project and actor scope.")]
        long memoryId,

        [Description(
            "The updated memory content. Must not be empty and must not exceed 10,000 characters.")]
        string content,

        [Description(
            "The category of the memory. Must be one of: " +
            "Preference, Fact, Goal, Context, Skill, Relationship, Other.")]
        string memoryType,

        [Description(
            "The actor identifier for the memory scope within the authenticated project. " +
            "Must not be empty.")]
        string actorId)
    {
        // Identity comes from the authenticated context — never from tool args.
        var userId = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;

        if (string.IsNullOrWhiteSpace(actorId))
        {
            throw new ArgumentException(
                "ActorId cannot be empty.",
                nameof(actorId));
        }

        // Resolve the scope for this project and actor.
        // If the scope does not exist, throws MemoryScopeNotFoundException.
        var scopeId = await _scopeResolutionService.ResolveScopeAsync(projectId, actorId);

        // Build the existing Application DTO — no new DTOs introduced.
        var request = new UpdateMemoryRequest
        {
            Content = content,
            MemoryType = memoryType
        };

        // Delegate entirely to the existing Application memory pipeline with scope validation.
        var updated = await _memoryService.UpdateMemoryAsync(
            memoryId,
            request,
            userId,
            projectId,
            scopeId);

        return JsonSerializer.Serialize(new
        {
            updated = true,
            memoryId = updated.MemoryId,
            userId = updated.UserId,
            content = updated.Content,
            memoryType = updated.MemoryType,
            isActive = updated.IsActive,
            createdAt = updated.CreatedAt,
            updatedAt = updated.UpdatedAt
        }, JsonOptions);
    }

    // ── forget ───────────────────────────────────────────────────────────────

    /// <summary>
    /// MCP forget → IMemoryService.DeleteMemoryAsync
    ///
    /// Delegates entirely to the existing Kairo memory soft-deletion pipeline:
    ///   ownership check → archive version (ApiDelete) → deactivate memory.
    ///
    /// The authenticated userId comes from IApiKeyContext — never from the
    /// tool arguments. The memory record is preserved in the database but deactivated
    /// so it no longer appears in recall/search results.
    /// </summary>
    [McpServerTool(Name = "forget")]
    [Description(
        "Deactivates (soft-deletes) a memory in Kairo for the authenticated project and actor scope. " +
        "Archives the state as a historical version and marks it inactive so it no longer " +
        "appears in recall results. The record is preserved in the database for auditing.")]
    public async Task<string> Forget(
        [Description(
            "The unique ID of the memory to deactivate / forget. Must belong to the authenticated project and actor scope.")]
        long memoryId,

        [Description(
            "The actor identifier for the memory scope within the authenticated project. " +
            "Must not be empty.")]
        string actorId)
    {
        // Identity comes from the authenticated context — never from tool args.
        var userId = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;

        if (string.IsNullOrWhiteSpace(actorId))
        {
            throw new ArgumentException(
                "ActorId cannot be empty.",
                nameof(actorId));
        }

        // Resolve the scope for this project and actor.
        // If the scope does not exist, throws MemoryScopeNotFoundException.
        var scopeId = await _scopeResolutionService.ResolveScopeAsync(projectId, actorId);

        // Delegate entirely to the existing Application memory pipeline with scope validation.
        await _memoryService.DeleteMemoryAsync(
            memoryId,
            userId,
            projectId,
            scopeId);

        return JsonSerializer.Serialize(new
        {
            forgotten = true,
            memoryId = memoryId,
            message = "Memory deactivated. The record is preserved in the database."
        }, JsonOptions);
    }
}
