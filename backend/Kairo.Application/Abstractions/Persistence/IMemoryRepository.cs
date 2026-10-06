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
}

// ── Data classes returned by IMemoryRepository ───────────────────────────────

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
}