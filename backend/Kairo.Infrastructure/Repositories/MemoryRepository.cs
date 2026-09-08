using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kairo.Infrastructure.Repositories;

public class MemoryRepository : IMemoryRepository
{
    private readonly KairoDbContext _dbContext;

    public MemoryRepository(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<long> CreateAsync(
        long userId,
        ExtractedMemory memory,
        long? sourceChatId)
    {
        var entity = new Memories
        {
            UserId = userId,
            Content = memory.Content,
            MemoryType = memory.MemoryType,
            SourceChatId = sourceChatId,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _dbContext.Memories.Add(entity);

        await _dbContext.SaveChangesAsync();

        return entity.MemoryId;
    }

    public async Task<bool> ExistsAsync(
        long userId,
        string content)
    {
        var normalizedContent = content.Trim().ToLower();

        return await _dbContext.Memories
            .AsNoTracking()
            .AnyAsync(memory =>
                memory.UserId == userId &&
                memory.IsActive &&
                memory.Content.ToLower() == normalizedContent);
    }

    public async Task SaveEmbeddingAsync(
        long memoryId,
        string model,
        float[] embedding)
    {
        if (embedding.Length == 0)
        {
            throw new ArgumentException(
                "Embedding cannot be empty.",
                nameof(embedding));
        }

        var entity = new MemoryEmbeddings
        {
            MemoryId = memoryId,
            Model = model,
            Dimensions = embedding.Length,
            VectorData = System.Text.Json.JsonSerializer.Serialize(embedding),
            CreatedAt = DateTime.UtcNow
        };

        _dbContext.MemoryEmbeddings.Add(entity);

        await _dbContext.SaveChangesAsync();
    }

    public async Task<List<MemoryEmbeddingData>> GetActiveMemoryEmbeddingsAsync(
        long userId)
    {
        var embeddings =
            await _dbContext.MemoryEmbeddings
                .AsNoTracking()
                .Where(embedding =>
                    embedding.Memory.UserId == userId &&
                    embedding.Memory.IsActive)
                .Select(embedding => new
                {
                    embedding.MemoryId,
                    embedding.Memory.Content,
                    embedding.Memory.MemoryType,
                    embedding.Model,
                    embedding.Dimensions,
                    embedding.VectorData
                })
                .ToListAsync();

        var result = new List<MemoryEmbeddingData>();

        foreach (var embedding in embeddings)
        {
            var vector =
                System.Text.Json.JsonSerializer.Deserialize<float[]>(
                    embedding.VectorData);

            if (vector == null || vector.Length == 0)
            {
                continue;
            }

            result.Add(new MemoryEmbeddingData
            {
                MemoryId = embedding.MemoryId,
                Content = embedding.Content,
                MemoryType = embedding.MemoryType ?? string.Empty,
                Model = embedding.Model,
                Dimensions = embedding.Dimensions,
                Embedding = vector
            });
        }

        return result;
    }

    // ── New methods (Task 1: Embedding Backfill) ──────────────────────────────

    public async Task<List<MemoryWithoutEmbedding>> GetActiveMemoriesWithoutEmbeddingsAsync(
        long userId)
    {
        return await _dbContext.Memories
            .AsNoTracking()
            .Where(m =>
                m.UserId == userId &&
                m.IsActive &&
                !m.MemoryEmbeddings.Any())
            .Select(m => new MemoryWithoutEmbedding
            {
                MemoryId = m.MemoryId,
                Content = m.Content,
                MemoryType = m.MemoryType
            })
            .ToListAsync();
    }

    // ── New methods (Task 4: Safe Canonical Merge) ────────────────────────────

    public async Task<MemorySnapshot?> GetMemorySnapshotAsync(long memoryId)
    {
        return await _dbContext.Memories
            .AsNoTracking()
            .Where(m => m.MemoryId == memoryId)
            .Select(m => new MemorySnapshot
            {
                MemoryId    = m.MemoryId,
                UserId      = m.UserId,
                Content     = m.Content,
                MemoryType  = m.MemoryType,
                IsActive    = m.IsActive,
                CreatedAt   = m.CreatedAt,
                UpdatedAt   = m.UpdatedAt
            })
            .FirstOrDefaultAsync();
    }

    public async Task DeactivateMemoryAsync(long memoryId)
    {
        var memory = await _dbContext.Memories
            .FirstOrDefaultAsync(m => m.MemoryId == memoryId);

        if (memory == null || !memory.IsActive)
        {
            // Idempotent: already inactive or does not exist.
            return;
        }

        memory.IsActive = false;
        memory.UpdatedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync();
    }

    public async Task UpdateMemoryContentAsync(long memoryId, string newContent)
    {
        var memory = await _dbContext.Memories
            .FirstOrDefaultAsync(m => m.MemoryId == memoryId);

        if (memory == null)
        {
            throw new InvalidOperationException(
                $"Memory {memoryId} not found.");
        }

        memory.Content = newContent;
        memory.UpdatedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync();
    }

    public async Task CreateMemoryVersionAsync(
        long memoryId,
        string content,
        string operation)
    {
        var version = new MemoryVersions
        {
            MemoryId  = memoryId,
            Content   = content,
            Operation = operation,
            CreatedAt = DateTime.UtcNow
        };

        _dbContext.MemoryVersions.Add(version);

        await _dbContext.SaveChangesAsync();
    }

    // ── New methods (V1 Public Memory API) ───────────────────────────────────

    /// <summary>
    /// Returns a memory snapshot only when the row belongs to
    /// <paramref name="userId"/>. Ownership is enforced in the SQL query
    /// so callers never receive another user’s data.
    /// </summary>
    public async Task<MemorySnapshot?> GetMemorySnapshotForUserAsync(
        long memoryId,
        long userId)
    {
        return await _dbContext.Memories
            .AsNoTracking()
            .Where(m => m.MemoryId == memoryId && m.UserId == userId && m.IsActive == true)
            .Select(m => new MemorySnapshot
            {
                MemoryId   = m.MemoryId,
                UserId     = m.UserId,
                Content    = m.Content,
                MemoryType = m.MemoryType,
                IsActive   = m.IsActive,
                CreatedAt  = m.CreatedAt,
                UpdatedAt  = m.UpdatedAt
            })
            .FirstOrDefaultAsync();
    }

    /// <summary>
    /// Returns all active memories for <paramref name="userId"/>,
    /// newest first. Used by GET /api/v1/memories.
    /// </summary>
    public async Task<List<MemoryListItem>> GetActiveMemoriesAsync(long userId)
    {
        return await _dbContext.Memories
            .AsNoTracking()
            .Where(m => m.UserId == userId && m.IsActive)
            .OrderByDescending(m => m.CreatedAt)
            .Select(m => new MemoryListItem
            {
                MemoryId   = m.MemoryId,
                Content    = m.Content,
                MemoryType = m.MemoryType,
                CreatedAt  = m.CreatedAt,
                UpdatedAt  = m.UpdatedAt
            })
            .ToListAsync();
    }

    /// <summary>
    /// Removes all existing embedding rows for <paramref name="memoryId"/>
    /// and inserts a single fresh one. Keeps the embeddings table clean
    /// after a content update.
    /// </summary>
    public async Task ReplaceEmbeddingAsync(
        long memoryId,
        string model,
        float[] embedding)
    {
        if (embedding.Length == 0)
        {
            throw new ArgumentException(
                "Embedding cannot be empty.",
                nameof(embedding));
        }

        // Remove every stale embedding row for this memory.
        var staleRows = await _dbContext.MemoryEmbeddings
            .Where(e => e.MemoryId == memoryId)
            .ToListAsync();

        _dbContext.MemoryEmbeddings.RemoveRange(staleRows);

        // Insert the fresh embedding row.
        var fresh = new MemoryEmbeddings
        {
            MemoryId   = memoryId,
            Model      = model,
            Dimensions = embedding.Length,
            VectorData = System.Text.Json.JsonSerializer.Serialize(embedding),
            CreatedAt  = DateTime.UtcNow
        };

        _dbContext.MemoryEmbeddings.Add(fresh);

        await _dbContext.SaveChangesAsync();
    }
}