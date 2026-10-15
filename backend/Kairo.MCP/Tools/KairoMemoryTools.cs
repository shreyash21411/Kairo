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
    private readonly IMemoryIngestionService? _ingestionService;
    private readonly IQuotaEnforcementService? _quotaService;
    private readonly IUsageMeterService? _usageMeter;

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
        IScopeResolutionService scopeResolutionService,
        IMemoryIngestionService? ingestionService = null,
        IQuotaEnforcementService? quotaService = null,
        IUsageMeterService? usageMeter = null)
    {
        _apiKeyContext = apiKeyContext;
        _memoryService = memoryService;
        _scopeResolutionService = scopeResolutionService;
        _ingestionService = ingestionService;
        _quotaService = quotaService;
        _usageMeter = usageMeter;
    }

    private async Task<string?> CheckQuotaAsync(string operationType, int unitCount)
    {
        if (_quotaService == null) return null;
        var projectId = _apiKeyContext.ProjectId;
        var check = await _quotaService.CheckAsync(projectId, operationType, unitCount);
        if (!check.IsAllowed)
        {
            if (_usageMeter != null)
            {
                await _usageMeter.RecordAsync(
                    _apiKeyContext.UserId,
                    projectId,
                    operationType,
                    UsageOutcome.Throttled,
                    unitCount);
            }
            return JsonSerializer.Serialize(new
            {
                error = "quota_exceeded",
                message = check.Reason ?? "Rate limit exceeded.",
                retryAfterSeconds = check.RetryAfterSeconds
            }, JsonOptions);
        }
        return null;
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
        string actorId,

        [Description(
            "Optional list of category tags assigned to this memory (e.g. ['work', 'preferences']).")]
        List<string>? categories = null,

        [Description(
            "Optional arbitrary key-value metadata object associated with this memory.")]
        Dictionary<string, object>? metadata = null,

        [Description(
            "Optional expiration timestamp in UTC (ISO 8601 string) after which this memory expires.")]
        DateTime? expiresAt = null,

        [Description(
            "Optional event or fact occurrence timestamp in UTC (ISO 8601 string).")]
        DateTime? occurredAt = null)
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

        var quotaErr = await CheckQuotaAsync(UsageOperationType.MemoryCreate, 1);
        if (quotaErr != null) return quotaErr;

        // Build the existing Application DTO — no new DTOs introduced.
        var request = new CreateMemoryRequest
        {
            Content = content,
            MemoryType = memoryType,
            ActorId = actorId,
            Categories = categories,
            Metadata = metadata,
            ExpiresAt = expiresAt,
            OccurredAt = occurredAt
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

        if (_usageMeter != null)
        {
            await _usageMeter.RecordAsync(userId, projectId, UsageOperationType.MemoryCreate, UsageOutcome.Success, 1);
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
            updatedAt = memory.UpdatedAt,
            occurredAt = memory.OccurredAt,
            metadata = memory.Metadata,
            expiresAt = memory.ExpiresAt,
            categories = memory.Categories
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
        "Uses hybrid embedding similarity, metadata/temporal filtering, and continuous relevance reranking. " +
        "Returns up to topK results (default 5, max 100) with matching graph relations.")]
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
        int topK = 5,

        [Description(
            "Optional list of categories to filter memories by (inclusion match).")]
        List<string>? categories = null,

        [Description(
            "Optional key-value metadata filter dictionary (e.g. {'env': 'prod'}).")]
        Dictionary<string, object>? metadataFilters = null,

        [Description(
            "Optional lower bound for memory creation timestamp in UTC (ISO 8601 string).")]
        DateTime? createdFrom = null,

        [Description(
            "Optional upper bound for memory creation timestamp in UTC (ISO 8601 string).")]
        DateTime? createdTo = null,

        [Description(
            "Optional lower bound for memory occurrence timestamp in UTC (ISO 8601 string).")]
        DateTime? occurredFrom = null,

        [Description(
            "Optional upper bound for memory occurrence timestamp in UTC (ISO 8601 string).")]
        DateTime? occurredTo = null,

        [Description(
            "Optional relative time constraint: return memories created within the last N days.")]
        int? lastDays = null,

        [Description(
            "Optional graph traversal depth for retrieving connected entity relationships (0 to 2, default 0).")]
        int? graphDepth = null,

        [Description(
            "Optional boolean flag to apply recency boosting to relevance ranking.")]
        bool? recencyBoost = null)
    {
        // Identity comes from the authenticated context — never from tool args.
        var userId = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;

        if (string.IsNullOrWhiteSpace(query))
        {
            throw new ArgumentException(
                "Query cannot be empty.",
                nameof(query));
        }

        if (string.IsNullOrWhiteSpace(actorId))
        {
            throw new ArgumentException(
                "ActorId cannot be empty.",
                nameof(actorId));
        }

        var quotaErr = await CheckQuotaAsync(UsageOperationType.MemoryRecall, 1);
        if (quotaErr != null) return quotaErr;

        if (topK <= 0 || topK > 100)
        {
            throw new ArgumentException(
                "TopK must be between 1 and 100.",
                nameof(topK));
        }

        if (createdFrom.HasValue && createdTo.HasValue && createdFrom.Value > createdTo.Value)
        {
            throw new ArgumentException(
                "createdFrom cannot be after createdTo.",
                nameof(createdFrom));
        }

        if (occurredFrom.HasValue && occurredTo.HasValue && occurredFrom.Value > occurredTo.Value)
        {
            throw new ArgumentException(
                "occurredFrom cannot be after occurredTo.",
                nameof(occurredFrom));
        }

        if (lastDays.HasValue && lastDays.Value < 0)
        {
            throw new ArgumentException(
                "lastDays cannot be negative.",
                nameof(lastDays));
        }

        if (graphDepth.HasValue && (graphDepth.Value < 0 || graphDepth.Value > 2))
        {
            throw new ArgumentException(
                "graphDepth must be between 0 and 2.",
                nameof(graphDepth));
        }

        if (categories != null && categories.Count > 0)
        {
            // Validates category syntax and format consistent with CategoryValidator
            CategoryValidator.ValidateAndNormalize(categories);
        }

        MemoryTemporalFilter? temporal = null;
        if (createdFrom.HasValue || createdTo.HasValue || occurredFrom.HasValue || occurredTo.HasValue || lastDays.HasValue)
        {
            temporal = new MemoryTemporalFilter
            {
                CreatedAtFrom = createdFrom,
                CreatedAtTo = createdTo,
                OccurredAtFrom = occurredFrom,
                OccurredAtTo = occurredTo,
                LastDays = lastDays
            };
        }

        // Build the existing Application DTO — no new DTOs introduced.
        var request = new MemorySearchRequest
        {
            Query = query,
            TopK = topK,
            ActorId = actorId,
            Categories = categories,
            MetadataFilters = metadataFilters,
            Temporal = temporal,
            GraphDepth = graphDepth,
            RecencyBoost = recencyBoost
        };

        // Delegate entirely to the existing Application retrieval pipeline.
        // Embedding, cosine similarity, candidate ranking, and relevance
        // evaluation are scoped to the resolved MemoryScope. No global search.
        var result =
            await _memoryService.SearchMemoriesAsync(request, userId, projectId);

        if (_usageMeter != null)
        {
            await _usageMeter.RecordAsync(userId, projectId, UsageOperationType.MemoryRecall, UsageOutcome.Success, 1);
        }

        return JsonSerializer.Serialize(new
        {
            query = result.Query,
            count = result.Count,
            memories = result.Memories.Select(m => new
            {
                memoryId = m.MemoryId,
                content = m.Content,
                memoryType = m.MemoryType,
                similarity = m.Similarity,
                rerankScore = m.RerankScore,
                categories = m.Categories,
                metadata = m.Metadata,
                occurredAt = m.OccurredAt,
                createdAt = m.CreatedAt,
                expiresAt = m.ExpiresAt
            }),
            relations = result.Relations?.Select(r => new
            {
                source = r.Source,
                relationship = r.Relationship,
                target = r.Target,
                confidence = r.Confidence
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
        string actorId,

        [Description(
            "Optional updated list of category tags. When omitted, existing categories are preserved.")]
        List<string>? categories = null,

        [Description(
            "Optional updated arbitrary key-value metadata object. When omitted, existing metadata is preserved.")]
        Dictionary<string, object>? metadata = null,

        [Description(
            "Optional updated expiration timestamp in UTC (ISO 8601 string). When omitted, existing expiration is preserved.")]
        DateTime? expiresAt = null,

        [Description(
            "Optional updated occurrence timestamp in UTC (ISO 8601 string). When omitted, existing occurrence timestamp is preserved.")]
        DateTime? occurredAt = null)
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

        var quotaErr = await CheckQuotaAsync(UsageOperationType.MemoryUpdate, 1);
        if (quotaErr != null) return quotaErr;

        // Resolve the scope for this project and actor.
        // If the scope does not exist, throws MemoryScopeNotFoundException.
        var scopeId = await _scopeResolutionService.ResolveScopeAsync(projectId, actorId);

        // Build the existing Application DTO — no new DTOs introduced.
        var request = new UpdateMemoryRequest
        {
            Content = content,
            MemoryType = memoryType,
            Categories = categories,
            Metadata = metadata,
            ExpiresAt = expiresAt,
            OccurredAt = occurredAt
        };

        // Delegate entirely to the existing Application memory pipeline with scope validation.
        var updated = await _memoryService.UpdateMemoryAsync(
            memoryId,
            request,
            userId,
            projectId,
            scopeId);

        if (_usageMeter != null)
        {
            await _usageMeter.RecordAsync(userId, projectId, UsageOperationType.MemoryUpdate, UsageOutcome.Success, 1);
        }

        return JsonSerializer.Serialize(new
        {
            updated = true,
            memoryId = updated.MemoryId,
            userId = updated.UserId,
            content = updated.Content,
            memoryType = updated.MemoryType,
            isActive = updated.IsActive,
            createdAt = updated.CreatedAt,
            updatedAt = updated.UpdatedAt,
            occurredAt = updated.OccurredAt,
            metadata = updated.Metadata,
            expiresAt = updated.ExpiresAt,
            categories = updated.Categories
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

        var quotaErr = await CheckQuotaAsync(UsageOperationType.MemoryDelete, 1);
        if (quotaErr != null) return quotaErr;

        // Resolve the scope for this project and actor.
        // If the scope does not exist, throws MemoryScopeNotFoundException.
        var scopeId = await _scopeResolutionService.ResolveScopeAsync(projectId, actorId);

        // Delegate entirely to the existing Application memory pipeline with scope validation.
        await _memoryService.DeleteMemoryAsync(
            memoryId,
            userId,
            projectId,
            scopeId);

        if (_usageMeter != null)
        {
            await _usageMeter.RecordAsync(userId, projectId, UsageOperationType.MemoryDelete, UsageOutcome.Success, 1);
        }

        return JsonSerializer.Serialize(new
        {
            forgotten = true,
            memoryId = memoryId,
            message = "Memory deactivated. The record is preserved in the database."
        }, JsonOptions);
    }

    // ── get_memory ───────────────────────────────────────────────────────────

    /// <summary>
    /// MCP get_memory → IMemoryService.GetMemoryAsync
    ///
    /// Retrieves a single memory by ID for the authenticated project and actor scope.
    /// Enforces ownership and tenant boundary: memory must belong to the resolved scope and user.
    /// </summary>
    [McpServerTool(Name = "get_memory")]
    [Description(
        "Retrieves a single durable memory by its unique ID for the authenticated project and actor scope. " +
        "Validates ownership and project boundary at the database level.")]
    public async Task<string> GetMemory(
        [Description(
            "The unique ID of the memory to retrieve. Must belong to the authenticated project and actor scope.")]
        long memoryId,

        [Description(
            "The actor identifier for the memory scope within the authenticated project. " +
            "Must not be empty.")]
        string actorId)
    {
        var userId = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;

        if (string.IsNullOrWhiteSpace(actorId))
        {
            throw new ArgumentException(
                "ActorId cannot be empty.",
                nameof(actorId));
        }

        var quotaErr = await CheckQuotaAsync(UsageOperationType.MemoryGet, 1);
        if (quotaErr != null) return quotaErr;

        var scopeId = await _scopeResolutionService.ResolveScopeAsync(projectId, actorId);
        var memory = await _memoryService.GetMemoryAsync(memoryId, userId, projectId, scopeId);

        if (_usageMeter != null)
        {
            await _usageMeter.RecordAsync(userId, projectId, UsageOperationType.MemoryGet, UsageOutcome.Success, 1);
        }

        return JsonSerializer.Serialize(new
        {
            found = true,
            memoryId = memory.MemoryId,
            userId = memory.UserId,
            content = memory.Content,
            memoryType = memory.MemoryType,
            isActive = memory.IsActive,
            createdAt = memory.CreatedAt,
            updatedAt = memory.UpdatedAt,
            occurredAt = memory.OccurredAt,
            metadata = memory.Metadata,
            expiresAt = memory.ExpiresAt,
            categories = memory.Categories
        }, JsonOptions);
    }

    // ── remember_batch ────────────────────────────────────────────────────────

    /// <summary>
    /// MCP remember_batch → IMemoryService.BatchCreateMemoriesAsync
    ///
    /// Stores a batch of memories (up to 100) for the authenticated project and actor scope.
    /// Reuses the existing batch memory creation pipeline with per-item validation and deduplication.
    /// </summary>
    [McpServerTool(Name = "remember_batch")]
    [Description(
        "Stores multiple durable memories in bulk (up to 100) for the authenticated project and actor scope. " +
        "Validates and deduplicates each item, returning batch creation status and per-item outcomes.")]
    public async Task<string> RememberBatch(
        [Description(
            "List of memory items to create. Must contain between 1 and 100 items.")]
        List<BatchCreateMemoryItem> memories,

        [Description(
            "The default actor identifier for this batch of memories within the authenticated project. " +
            "Must not be empty.")]
        string actorId)
    {
        var userId = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;

        if (string.IsNullOrWhiteSpace(actorId))
        {
            throw new ArgumentException(
                "ActorId cannot be empty.",
                nameof(actorId));
        }

        if (memories == null || memories.Count == 0)
        {
            throw new ArgumentException(
                "Memories batch cannot be empty.",
                nameof(memories));
        }

        if (memories.Count > BatchCreateMemoryRequest.MaxBatchSize)
        {
            throw new ArgumentException(
                $"Batch size ({memories.Count}) exceeds maximum allowed ({BatchCreateMemoryRequest.MaxBatchSize}) items.",
                nameof(memories));
        }

        var quotaErr = await CheckQuotaAsync(UsageOperationType.BatchCreate, memories.Count);
        if (quotaErr != null) return quotaErr;

        // Apply default actorId to items that omit it
        foreach (var item in memories)
        {
            if (string.IsNullOrWhiteSpace(item.ActorId) && item.Scope == null)
            {
                item.ActorId = actorId;
            }
        }

        var request = new BatchCreateMemoryRequest
        {
            Memories = memories
        };

        var response = await _memoryService.BatchCreateMemoriesAsync(request, userId, projectId);

        if (_usageMeter != null)
        {
            await _usageMeter.RecordAsync(userId, projectId, UsageOperationType.BatchCreate, UsageOutcome.Success, memories.Count);
        }

        return JsonSerializer.Serialize(new
        {
            success = response.Success,
            createdCount = response.CreatedCount,
            memories = response.Memories.Select(m => new
            {
                memoryId = m.MemoryId,
                content = m.Content,
                memoryType = m.MemoryType,
                categories = m.Categories,
                createdAt = m.CreatedAt
            }),
            errors = response.Errors.Select(e => new
            {
                index = e.Index,
                memoryId = e.MemoryId,
                message = e.Message
            })
        }, JsonOptions);
    }

    // ── forget_batch ──────────────────────────────────────────────────────────

    /// <summary>
    /// MCP forget_batch → IMemoryService.BatchDeleteMemoriesAsync
    ///
    /// Soft-deletes a batch of memories (up to 100) for the authenticated project.
    /// Validates ownership and IDOR defense for every item before applying deactivations.
    /// </summary>
    [McpServerTool(Name = "forget_batch")]
    [Description(
        "Deactivates (soft-deletes) multiple memories in bulk (up to 100) for the authenticated project. " +
        "Validates ownership for every item, archives historical versions, and marks records inactive.")]
    public async Task<string> ForgetBatch(
        [Description(
            "List of memory IDs to deactivate. Must contain between 1 and 100 IDs.")]
        List<long> memoryIds,

        [Description(
            "The actor identifier for the memory scope within the authenticated project. " +
            "Must not be empty.")]
        string actorId)
    {
        var userId = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;

        if (string.IsNullOrWhiteSpace(actorId))
        {
            throw new ArgumentException(
                "ActorId cannot be empty.",
                nameof(actorId));
        }

        if (memoryIds == null || memoryIds.Count == 0)
        {
            throw new ArgumentException(
                "MemoryIds list cannot be empty.",
                nameof(memoryIds));
        }

        if (memoryIds.Count > BatchDeleteMemoryRequest.MaxBatchSize)
        {
            throw new ArgumentException(
                $"Batch size ({memoryIds.Count}) exceeds maximum allowed ({BatchDeleteMemoryRequest.MaxBatchSize}) items.",
                nameof(memoryIds));
        }

        var quotaErr = await CheckQuotaAsync(UsageOperationType.BatchDelete, memoryIds.Count);
        if (quotaErr != null) return quotaErr;

        // Verify scope exists for this actor
        _ = await _scopeResolutionService.ResolveScopeAsync(projectId, actorId);

        var request = new BatchDeleteMemoryRequest
        {
            MemoryIds = memoryIds
        };

        var response = await _memoryService.BatchDeleteMemoriesAsync(request, userId, projectId);

        if (_usageMeter != null)
        {
            await _usageMeter.RecordAsync(userId, projectId, UsageOperationType.BatchDelete, UsageOutcome.Success, memoryIds.Count);
        }

        return JsonSerializer.Serialize(new
        {
            success = response.Success,
            deletedCount = response.DeletedCount,
            deletedIds = response.DeletedIds,
            errors = response.Errors.Select(e => new
            {
                index = e.Index,
                memoryId = e.MemoryId,
                message = e.Message
            })
        }, JsonOptions);
    }

    // ── ingest_dialogue ───────────────────────────────────────────────────────

    /// <summary>
    /// MCP ingest_dialogue → IMemoryIngestionService.IngestAsync
    ///
    /// Analyzes a conversational dialogue, extracts salient facts/preferences using LLM NER,
    /// performs consolidation evaluation (Add, Merge, NoAction), and persists durable memories.
    /// </summary>
    [McpServerTool(Name = "ingest_dialogue")]
    [Description(
        "Ingests a conversational dialogue, extracts durable memories (facts, preferences), " +
        "evaluates consolidation against existing memories, and updates memory partition.")]
    public async Task<string> IngestDialogue(
        [Description(
            "The conversation messages to analyze. Each message must have 'role' (user/assistant/system) and 'content'.")]
        List<IngestMessageItem> messages,

        [Description(
            "The actor identifier for this ingestion within the authenticated project. " +
            "Must not be empty.")]
        string actorId)
    {
        // Identity comes from authenticated API key
        var userId = _apiKeyContext.UserId;
        var projectId = _apiKeyContext.ProjectId;

        if (string.IsNullOrWhiteSpace(actorId))
        {
            throw new ArgumentException(
                "ActorId cannot be empty.",
                nameof(actorId));
        }

        var quotaErr = await CheckQuotaAsync(UsageOperationType.DialogueIngest, 1);
        if (quotaErr != null) return quotaErr;

        if (messages == null || messages.Count == 0)
        {
            throw new ArgumentException(
                "Messages cannot be empty.",
                nameof(messages));
        }

        if (messages.Count > 100)
        {
            throw new ArgumentException(
                "Conversation exceeds maximum allowed 100 messages.",
                nameof(messages));
        }

        foreach (var msg in messages)
        {
            if (string.IsNullOrWhiteSpace(msg.Role) || string.IsNullOrWhiteSpace(msg.Content))
            {
                throw new ArgumentException(
                    "Each message must have a non-empty role and content.",
                    nameof(messages));
            }
        }

        if (_ingestionService == null)
        {
            throw new InvalidOperationException(
                "Dialogue ingestion service is not configured.");
        }

        var request = new IngestConversationRequest
        {
            ActorId = actorId,
            Messages = messages
        };

        var response = await _ingestionService.IngestAsync(request, userId, projectId);

        if (_usageMeter != null)
        {
            await _usageMeter.RecordAsync(userId, projectId, UsageOperationType.DialogueIngest, UsageOutcome.Success, 1);
        }

        return JsonSerializer.Serialize(new
        {
            processed = response.Processed,
            extractedCount = response.ExtractedCount,
            memories = response.Memories.Select(m => new
            {
                action = m.Action.ToString(),
                memoryId = m.MemoryId,
                content = m.Content,
                reason = m.Reason
            })
        }, JsonOptions);
    }
}
