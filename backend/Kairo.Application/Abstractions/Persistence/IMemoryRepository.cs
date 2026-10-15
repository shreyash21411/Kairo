using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Persistence;

public interface IMemoryRepository
{
    // ── Existing methods (unchanged) ─────────────────────────────────────────

    Task<bool> ExistsAsync(
        long userId,
        string content,
        long? scopeId = null);

    /// <summary>
    /// Creates a new Memory row.
    /// </summary>
    /// <param name="userId">Owner of the memory.</param>
    /// <param name="memory">Extracted content and type.</param>
    /// <param name="sourceChatId">Chat that produced the memory, or null for direct API creates.</param>
    /// <param name="scopeId">
    ///     The resolved MemoryScope for this memory.
    ///     Null is permitted because pre-Phase-10.3 memories (chat pipeline, backfill)
    ///     do not yet carry a scope. All V1 API creates must supply this value.
    /// </param>
    Task<long> CreateAsync(
        long userId,
        ExtractedMemory memory,
        long? sourceChatId,
        long? scopeId = null,
        DateTime? occurredAt = null,
        string? metadata = null);

    Task<long> CreateAsync(
        long userId,
        ExtractedMemory memory,
        long? sourceChatId,
        long? scopeId,
        DateTime? occurredAt,
        string? metadata,
        DateTime? expiresAt,
        List<string>? categories);

    Task SaveEmbeddingAsync(
        long memoryId,
        string model,
        float[] embedding);

    Task<List<MemoryEmbeddingData>> GetActiveMemoryEmbeddingsAsync(
        long userId,
        long? scopeId = null);

    /// <summary>
    /// Phase 2: Returns active memory embeddings filtered by temporal and metadata constraints.
    /// Filtering is executed at query level before similarity scoring.
    /// </summary>
    Task<List<MemoryEmbeddingData>> GetFilteredActiveMemoryEmbeddingsAsync(
        long userId,
        long? scopeId = null,
        MemoryTemporalFilter? temporalFilter = null,
        List<MetadataFilterCondition>? metadataFilters = null);

    /// <summary>
    /// Phase 3: Returns active memory embeddings filtered by temporal, metadata, and category constraints.
    /// Filtering is executed at query level before similarity scoring.
    /// </summary>
    Task<List<MemoryEmbeddingData>> GetFilteredActiveMemoryEmbeddingsAsync(
        long userId,
        long? scopeId,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        List<string>? categoryFilters);

    // ── New methods (Task 1: Embedding Backfill) ──────────────────────────────

    /// <summary>
    /// Returns active memories for <paramref name="userId"/> that have
    /// no embedding row in MemoryEmbeddings.
    /// Used exclusively by the embedding backfill service.
    /// </summary>
    Task<List<MemoryWithoutEmbedding>> GetActiveMemoriesWithoutEmbeddingsAsync(
        long userId);

    // ── New methods (Task 4: Safe Canonical Merge) ────────────────────────────

    /// <summary>
    /// Reads the current state of a single memory (id, content, isActive).
    /// Returns null if the memory does not exist.
    /// </summary>
    Task<MemorySnapshot?> GetMemorySnapshotAsync(long memoryId);

    /// <summary>
    /// Phase 5 Task 5.3: Returns snapshots for a batch of memory IDs in one query.
    /// IDs are deduplicated before querying. Returns an empty dictionary immediately
    /// when <paramref name="memoryIds"/> is empty or null.
    /// Does NOT filter by IsActive or expiry — callers are responsible for those checks.
    /// Returns a dictionary keyed by <see cref="MemorySnapshot.MemoryId"/>.
    /// </summary>
    Task<Dictionary<long, MemorySnapshot>> GetMemorySnapshotsAsync(IEnumerable<long> memoryIds);

    /// <summary>
    /// Sets IsActive = false and stamps UpdatedAt.
    /// Idempotent: if already inactive, does nothing.
    /// Does NOT create a MemoryVersion — that responsibility belongs to
    /// the Application layer orchestrating the merge.
    /// </summary>
    Task DeactivateMemoryAsync(long memoryId);

    /// <summary>
    /// Updates Content and stamps UpdatedAt for the given memory.
    /// Optionally updates OccurredAt and Metadata.
    /// Does NOT create a MemoryVersion.
    /// </summary>
    Task UpdateMemoryContentAsync(
        long memoryId,
        string newContent,
        DateTime? occurredAt = null,
        string? metadata = null);

    /// <summary>
    /// Phase 3: Updates Content, OccurredAt, Metadata, ExpiresAt, and Categories.
    /// </summary>
    Task UpdateMemoryContentAsync(
        long memoryId,
        string newContent,
        DateTime? occurredAt,
        string? metadata,
        bool updateExpiresAt,
        DateTime? expiresAt,
        bool updateCategories,
        List<string>? categories);

    /// <summary>
    /// Persists a MemoryVersions row.
    /// Called by the Application layer BEFORE mutating the memory,
    /// so the version captures the state prior to the change.
    /// </summary>
    Task CreateMemoryVersionAsync(
        long memoryId,
        string content,
        string operation);

    // ── New methods (V1 Public Memory API) ───────────────────────────────────

    /// <summary>
    /// Returns a memory snapshot only when the memory belongs to
    /// <paramref name="userId"/> AND (when <paramref name="projectId"/> is
    /// supplied) the memory's resolved scope belongs to that project.
    /// Returns null if the memory does not exist, belongs to a different
    /// user, or belongs to a different project. Enforces ownership at the
    /// query level so callers never receive another project's data.
    /// </summary>
    Task<MemorySnapshot?> GetMemorySnapshotForUserAsync(
        long memoryId,
        long userId,
        long? projectId = null,
        long? scopeId = null);

    /// <summary>
    /// Returns all active memories for <paramref name="userId"/>,
    /// ordered by CreatedAt descending. When <paramref name="projectId"/>
    /// is supplied only memories whose scope belongs to that project are
    /// returned. Used by GET /api/v1/memories.
    /// </summary>
    Task<List<MemoryListItem>> GetActiveMemoriesAsync(
        long userId,
        long? projectId = null);

    /// <summary>
    /// Deletes all existing embedding rows for <paramref name="memoryId"/>
    /// and inserts a single fresh one. Used when memory content is updated
    /// so stale embedding vectors are not left in the table.
    /// </summary>
    Task ReplaceEmbeddingAsync(
        long memoryId,
        string model,
        float[] embedding);

    // ── Phase 4C Task 4C.4: Native vector retrieval ───────────────────────────

    /// <summary>
    /// Returns the top-<paramref name="topK"/> most similar active memory embeddings
    /// to <paramref name="queryVector"/> for <paramref name="userId"/>.
    /// When the active database is PostgreSQL, the similarity ranking is computed
    /// natively in the database using pgvector cosine distance (<code>&lt;=&gt;</code>).
    /// When the active database is SQL Server, all active embeddings matching the
    /// filters are loaded and ranked in memory by <see cref="GetFilteredActiveMemoryEmbeddingsAsync"/>.
    /// Returns results ordered by descending similarity (1 - cosine_distance).
    /// Expired embeddings are excluded. Dimension-mismatched embeddings are excluded.
    /// </summary>
    /// <param name="userId">Owner of the memories.</param>
    /// <param name="queryVector">Normalized query embedding vector.</param>
    /// <param name="queryModel">Model name of the query embedding — used to filter compatible records.</param>
    /// <param name="topK">Maximum number of results to return.</param>
    /// <param name="scopeId">Optional scope filter.</param>
    /// <param name="temporalFilter">Optional temporal filter applied before ranking.</param>
    /// <param name="metadataFilters">Optional metadata filter conditions applied before ranking.</param>
    /// <param name="categoryFilters">Optional category filter applied before ranking.</param>
    Task<List<RankedEmbeddingResult>> SearchSimilarEmbeddingsAsync(
        long userId,
        float[] queryVector,
        string queryModel,
        int topK,
        long? scopeId = null,
        MemoryTemporalFilter? temporalFilter = null,
        List<MetadataFilterCondition>? metadataFilters = null,
        List<string>? categoryFilters = null);

    // ── Phase 6.3: History & Purge Repository Methods ─────────────────────────

    /// <summary>
    /// Phase 6.3 (GAP-01): Returns the historical versions for a memory,
    /// ordered by CreatedAt descending, then MemoryVersionId descending.
    /// Returns empty list if no versions exist.
    /// </summary>
    Task<List<MemoryVersionResponse>> GetMemoryHistoryAsync(
        long memoryId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Phase 6.3 (GAP-02): Returns all active memories belonging to the specified user and scope.
    /// Used for actor-level memory purge.
    /// </summary>
    Task<List<MemorySnapshot>> GetActiveMemoriesForScopeAsync(
        long userId,
        long scopeId,
        CancellationToken cancellationToken = default);
}

// ── Data classes returned by IMemoryRepository ───────────────────────────────

/// <summary>
/// Phase 4C Task 4C.4: Result of a native vector similarity search.
/// Similarity is cosine similarity in [-1, 1] (1 = identical, 0 = orthogonal, -1 = opposite).
/// </summary>
public class RankedEmbeddingResult
{
    public long MemoryId { get; set; }

    public string Content { get; set; } = null!;

    public string MemoryType { get; set; } = null!;

    public string Model { get; set; } = null!;

    public int Dimensions { get; set; }

    /// <summary>Cosine similarity in [-1, 1]. 1 = identical direction, 0 = orthogonal, -1 = opposite.</summary>
    public double Similarity { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public DateTime? OccurredAt { get; set; }

    public string? Metadata { get; set; }

    public DateTime? ExpiresAt { get; set; }

    public List<string> Categories { get; set; } = new();
}

public class MemoryEmbeddingData
{
    public long MemoryId { get; set; }

    public string Content { get; set; } = null!;

    public string MemoryType { get; set; } = null!;

    public string Model { get; set; } = null!;

    public int Dimensions { get; set; }

    public float[] Embedding { get; set; } = Array.Empty<float>();

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public DateTime? OccurredAt { get; set; }

    public string? Metadata { get; set; }

    public DateTime? ExpiresAt { get; set; }

    public List<string> Categories { get; set; } = new();
}

public class MemoryWithoutEmbedding
{
    public long MemoryId { get; set; }

    public string Content { get; set; } = null!;

    public string? MemoryType { get; set; }
}

public class MemorySnapshot
{
    public long MemoryId { get; set; }

    public long UserId { get; set; }

    public string Content { get; set; } = null!;

    public string? MemoryType { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public DateTime? OccurredAt { get; set; }

    public string? Metadata { get; set; }

    public DateTime? ExpiresAt { get; set; }

    public List<string> Categories { get; set; } = new();
}

public class MemoryListItem
{
    public long MemoryId { get; set; }

    public string Content { get; set; } = null!;

    public string? MemoryType { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public DateTime? OccurredAt { get; set; }

    public string? Metadata { get; set; }

    public DateTime? ExpiresAt { get; set; }

    public List<string> Categories { get; set; } = new();
}