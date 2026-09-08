using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Persistence;

public interface IMemoryRepository
{
    // ── Existing methods (unchanged) ─────────────────────────────────────────

    Task<bool> ExistsAsync(
        long userId,
        string content);

    Task<long> CreateAsync(
        long userId,
        ExtractedMemory memory,
        long? sourceChatId);

    Task SaveEmbeddingAsync(
        long memoryId,
        string model,
        float[] embedding);

    Task<List<MemoryEmbeddingData>> GetActiveMemoryEmbeddingsAsync(
        long userId);

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
    /// Does NOT create a MemoryVersion.
    /// </summary>
    Task UpdateMemoryContentAsync(long memoryId, string newContent);

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
    /// <paramref name="userId"/>. Returns null if the memory does not exist
    /// or belongs to a different user. Enforces ownership at the query level.
    /// </summary>
    Task<MemorySnapshot?> GetMemorySnapshotForUserAsync(
        long memoryId,
        long userId);

    /// <summary>
    /// Returns all active memories for <paramref name="userId"/>,
    /// ordered by CreatedAt descending. Used by the list endpoint.
    /// </summary>
    Task<List<MemoryListItem>> GetActiveMemoriesAsync(long userId);

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
}

public class MemoryListItem
{
    public long MemoryId { get; set; }

    public string Content { get; set; } = null!;

    public string? MemoryType { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}