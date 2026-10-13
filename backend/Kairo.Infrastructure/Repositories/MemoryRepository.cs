using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
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

    public Task<long> CreateAsync(
        long userId,
        ExtractedMemory memory,
        long? sourceChatId,
        long? scopeId = null,
        DateTime? occurredAt = null,
        string? metadata = null)
    {
        return CreateAsync(userId, memory, sourceChatId, scopeId, occurredAt, metadata, null, null);
    }

    public async Task<long> CreateAsync(
        long userId,
        ExtractedMemory memory,
        long? sourceChatId,
        long? scopeId,
        DateTime? occurredAt,
        string? metadata,
        DateTime? expiresAt,
        List<string>? categories)
    {
        var entity = new Memories
        {
            UserId = userId,
            Content = memory.Content,
            MemoryType = memory.MemoryType,
            SourceChatId = sourceChatId,
            ScopeId = scopeId,
            OccurredAt = occurredAt,
            Metadata = metadata,
            ExpiresAt = expiresAt,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        if (categories != null && categories.Count > 0)
        {
            var normalizedCats = CategoryValidator.ValidateAndNormalize(categories);
            foreach (var cat in normalizedCats)
            {
                entity.MemoryCategories.Add(new MemoryCategory
                {
                    Category = cat,
                    CreatedAt = DateTime.UtcNow
                });
            }
        }

        _dbContext.Memories.Add(entity);

        await _dbContext.SaveChangesAsync();

        return entity.MemoryId;
    }

    public async Task<bool> ExistsAsync(
        long userId,
        string content,
        long? scopeId = null)
    {
        var normalizedContent = content.Trim().ToLower();

        var query = _dbContext.Memories
            .AsNoTracking()
            .Where(memory =>
                memory.UserId == userId &&
                memory.IsActive &&
                memory.Content.ToLower() == normalizedContent);

        if (scopeId.HasValue)
        {
            query = query.Where(memory => memory.ScopeId == scopeId.Value);
        }

        return await query.AnyAsync();
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
        long userId,
        long? scopeId = null)
    {
        return await GetFilteredActiveMemoryEmbeddingsAsync(userId, scopeId, null, null, null);
    }

    public Task<List<MemoryEmbeddingData>> GetFilteredActiveMemoryEmbeddingsAsync(
        long userId,
        long? scopeId = null,
        MemoryTemporalFilter? temporalFilter = null,
        List<MetadataFilterCondition>? metadataFilters = null)
    {
        return GetFilteredActiveMemoryEmbeddingsAsync(userId, scopeId, temporalFilter, metadataFilters, null);
    }

    /// <inheritdoc/>
    public async Task<List<MemoryEmbeddingData>> GetFilteredActiveMemoryEmbeddingsAsync(
        long userId,
        long? scopeId,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        List<string>? categoryFilters)
    {
        var now = DateTime.UtcNow;
        var query = _dbContext.MemoryEmbeddings
            .AsNoTracking()
            .Where(embedding =>
                embedding.Memory.UserId == userId &&
                embedding.Memory.IsActive &&
                (embedding.Memory.ExpiresAt == null || embedding.Memory.ExpiresAt > now));

        if (scopeId.HasValue)
        {
            query = query.Where(embedding => embedding.Memory.ScopeId == scopeId.Value);
        }

        if (categoryFilters != null && categoryFilters.Count > 0)
        {
            var normalizedFilters = categoryFilters.Select(c => c.Trim().ToLowerInvariant()).ToList();
            query = query.Where(e => e.Memory.MemoryCategories.Any(c => normalizedFilters.Contains(c.Category)));
        }

        if (temporalFilter != null)
        {
            var effectiveCreatedAtFrom = temporalFilter.GetEffectiveCreatedAtFrom();
            if (effectiveCreatedAtFrom.HasValue)
            {
                query = query.Where(e => e.Memory.CreatedAt >= effectiveCreatedAtFrom.Value);
            }
            if (temporalFilter.CreatedAtTo.HasValue)
            {
                query = query.Where(e => e.Memory.CreatedAt <= temporalFilter.CreatedAtTo.Value);
            }
            if (temporalFilter.UpdatedAtFrom.HasValue)
            {
                query = query.Where(e => e.Memory.UpdatedAt >= temporalFilter.UpdatedAtFrom.Value);
            }
            if (temporalFilter.UpdatedAtTo.HasValue)
            {
                query = query.Where(e => e.Memory.UpdatedAt <= temporalFilter.UpdatedAtTo.Value);
            }
            if (temporalFilter.OccurredAtFrom.HasValue)
            {
                query = query.Where(e => e.Memory.OccurredAt != null && e.Memory.OccurredAt >= temporalFilter.OccurredAtFrom.Value);
            }
            if (temporalFilter.OccurredAtTo.HasValue)
            {
                query = query.Where(e => e.Memory.OccurredAt != null && e.Memory.OccurredAt <= temporalFilter.OccurredAtTo.Value);
            }
        }

        var embeddings =
            await query
                .Select(embedding => new
                {
                    embedding.MemoryId,
                    embedding.Memory.Content,
                    embedding.Memory.MemoryType,
                    embedding.Memory.CreatedAt,
                    embedding.Memory.UpdatedAt,
                    embedding.Memory.OccurredAt,
                    embedding.Memory.Metadata,
                    embedding.Memory.ExpiresAt,
                    Categories = embedding.Memory.MemoryCategories.Select(c => c.Category).ToList(),
                    embedding.Model,
                    embedding.Dimensions,
                    embedding.VectorData
                })
                .ToListAsync();

        var result = new List<MemoryEmbeddingData>();

        foreach (var embedding in embeddings)
        {
            if (metadataFilters != null && metadataFilters.Count > 0)
            {
                if (!MetadataFilterEvaluator.Matches(embedding.Metadata, metadataFilters))
                    continue;
            }

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
                Embedding = vector,
                CreatedAt = embedding.CreatedAt,
                UpdatedAt = embedding.UpdatedAt,
                OccurredAt = embedding.OccurredAt,
                Metadata = embedding.Metadata,
                ExpiresAt = embedding.ExpiresAt,
                Categories = embedding.Categories
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
                UpdatedAt   = m.UpdatedAt,
                OccurredAt  = m.OccurredAt,
                Metadata    = m.Metadata,
                ExpiresAt   = m.ExpiresAt,
                Categories  = m.MemoryCategories.Select(c => c.Category).ToList()
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

        // ── Phase 1: Clean up MemoryEntities links (Defect 5 fix) ─────────────
        var entityLinks = await _dbContext.MemoryEntities
            .Where(me => me.MemoryId == memoryId)
            .ToListAsync();

        if (entityLinks.Count > 0)
            _dbContext.MemoryEntities.RemoveRange(entityLinks);

        // ── Phase 2: Clean up RelationshipEvidence & orphan EntityRelationships ──
        var evidence = await _dbContext.RelationshipEvidence
            .Where(e => e.MemoryId == memoryId)
            .ToListAsync();

        if (evidence.Count > 0)
        {
            var affectedRelIds = evidence.Select(e => e.RelationshipId).Distinct().ToList();
            _dbContext.RelationshipEvidence.RemoveRange(evidence);
            await _dbContext.SaveChangesAsync();

            var orphanRels = await _dbContext.EntityRelationships
                .Where(r => affectedRelIds.Contains(r.RelationshipId) && !r.Evidence.Any())
                .ToListAsync();

            if (orphanRels.Count > 0)
                _dbContext.EntityRelationships.RemoveRange(orphanRels);
        }

        // ── Phase 3: Clean up MemoryCategories links ──────────────────────────
        var catLinks = await _dbContext.MemoryCategories
            .Where(c => c.MemoryId == memoryId)
            .ToListAsync();

        if (catLinks.Count > 0)
            _dbContext.MemoryCategories.RemoveRange(catLinks);

        await _dbContext.SaveChangesAsync();
    }

    public Task UpdateMemoryContentAsync(
        long memoryId,
        string newContent,
        DateTime? occurredAt = null,
        string? metadata = null)
    {
        return UpdateMemoryContentAsync(memoryId, newContent, occurredAt, metadata, false, null, false, null);
    }

    public async Task UpdateMemoryContentAsync(
        long memoryId,
        string newContent,
        DateTime? occurredAt,
        string? metadata,
        bool updateExpiresAt,
        DateTime? expiresAt,
        bool updateCategories,
        List<string>? categories)
    {
        var memory = await _dbContext.Memories
            .FirstOrDefaultAsync(m => m.MemoryId == memoryId);

        if (memory == null)
        {
            throw new InvalidOperationException(
                $"Memory {memoryId} not found.");
        }

        memory.Content = newContent;
        if (occurredAt.HasValue)
            memory.OccurredAt = occurredAt.Value;
        if (metadata != null)
            memory.Metadata = metadata;
        if (updateExpiresAt)
            memory.ExpiresAt = expiresAt;

        if (updateCategories)
        {
            var oldCats = await _dbContext.MemoryCategories
                .Where(c => c.MemoryId == memoryId)
                .ToListAsync();
            if (oldCats.Count > 0)
                _dbContext.MemoryCategories.RemoveRange(oldCats);

            if (categories != null && categories.Count > 0)
            {
                var normalizedCats = CategoryValidator.ValidateAndNormalize(categories);
                foreach (var cat in normalizedCats)
                {
                    _dbContext.MemoryCategories.Add(new MemoryCategory
                    {
                        MemoryId = memoryId,
                        Category = cat,
                        CreatedAt = DateTime.UtcNow
                    });
                }
            }
        }

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
    /// <paramref name="userId"/> AND (when <paramref name="projectId"/> is
    /// supplied) the memory's scope belongs to that project.
    /// Ownership is enforced in the SQL query so callers never receive
    /// another project's data. Memories with a null ScopeId are excluded
    /// when a projectId is provided.
    /// </summary>
    public async Task<MemorySnapshot?> GetMemorySnapshotForUserAsync(
        long memoryId,
        long userId,
        long? projectId = null,
        long? scopeId = null)
    {
        var now = DateTime.UtcNow;
        var query = _dbContext.Memories
            .AsNoTracking()
            .Where(m =>
                m.MemoryId == memoryId &&
                m.UserId   == userId   &&
                m.IsActive &&
                (m.ExpiresAt == null || m.ExpiresAt > now));

        if (projectId.HasValue)
        {
            // Only memories with a scope that belongs to this project.
            // Memories with ScopeId == null are excluded (no scope = no project).
            query = query.Where(m =>
                m.ScopeId != null &&
                m.Scope!.ProjectId == projectId.Value);
        }

        if (scopeId.HasValue)
        {
            // Only memories belonging specifically to this scope.
            query = query.Where(m => m.ScopeId == scopeId.Value);
        }

        return await query
            .Select(m => new MemorySnapshot
            {
                MemoryId   = m.MemoryId,
                UserId     = m.UserId,
                Content    = m.Content,
                MemoryType = m.MemoryType,
                IsActive   = m.IsActive,
                CreatedAt  = m.CreatedAt,
                UpdatedAt  = m.UpdatedAt,
                OccurredAt = m.OccurredAt,
                Metadata   = m.Metadata,
                ExpiresAt  = m.ExpiresAt,
                Categories = m.MemoryCategories.Select(c => c.Category).ToList()
            })
            .FirstOrDefaultAsync();
    }

    /// <summary>
    /// Returns all active memories for <paramref name="userId"/>,
    /// newest first. When <paramref name="projectId"/> is supplied, only
    /// memories whose scope belongs to that project are returned.
    /// Used by GET /api/v1/memories.
    /// </summary>
    public async Task<List<MemoryListItem>> GetActiveMemoriesAsync(
        long userId,
        long? projectId = null)
    {
        var now = DateTime.UtcNow;
        var query = _dbContext.Memories
            .AsNoTracking()
            .Where(m => m.UserId == userId && m.IsActive && (m.ExpiresAt == null || m.ExpiresAt > now));

        if (projectId.HasValue)
        {
            // Only memories with a scope that belongs to this project.
            // Memories with ScopeId == null are excluded.
            query = query.Where(m =>
                m.ScopeId != null &&
                m.Scope!.ProjectId == projectId.Value);
        }

        return await query
            .OrderByDescending(m => m.CreatedAt)
            .Select(m => new MemoryListItem
            {
                MemoryId   = m.MemoryId,
                Content    = m.Content,
                MemoryType = m.MemoryType,
                CreatedAt  = m.CreatedAt,
                UpdatedAt  = m.UpdatedAt,
                OccurredAt = m.OccurredAt,
                Metadata   = m.Metadata,
                ExpiresAt  = m.ExpiresAt,
                Categories = m.MemoryCategories.Select(c => c.Category).ToList()
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

    // ── Phase 4C Task 4C.4: Native vector retrieval ───────────────────────────

    /// <inheritdoc/>
    public async Task<List<RankedEmbeddingResult>> SearchSimilarEmbeddingsAsync(
        long userId,
        float[] queryVector,
        string queryModel,
        int topK,
        long? scopeId = null,
        MemoryTemporalFilter? temporalFilter = null,
        List<MetadataFilterCondition>? metadataFilters = null,
        List<string>? categoryFilters = null)
    {
        if (queryVector.Length == 0)
            throw new ArgumentException("Query vector cannot be empty.", nameof(queryVector));
        if (queryVector.Any(v => float.IsNaN(v) || float.IsInfinity(v)))
            throw new ArgumentException("Query vector cannot contain NaN or Infinity values.", nameof(queryVector));
        if (topK <= 0)
            throw new ArgumentException("topK must be greater than zero.", nameof(topK));

        if (_dbContext.Database.IsNpgsql())
        {
            return await SearchSimilarEmbeddingsNativePostgreSqlAsync(
                userId, queryVector, queryModel, topK, scopeId, temporalFilter, metadataFilters, categoryFilters);
        }

        // SQL Server / fallback: load all matching embeddings and rank in-memory.
        return await SearchSimilarEmbeddingsSqlServerFallbackAsync(
            userId, queryVector, queryModel, topK, scopeId, temporalFilter, metadataFilters, categoryFilters);
    }

    // ── Phase 4C Task 4C.4: PostgreSQL native vector similarity retrieval ─────

    /// <summary>
    /// PostgreSQL-native similarity search using pgvector cosine distance
    /// (<c>VectorData::vector &lt;=&gt; query::vector</c>).
    /// Pushes ranking into the database engine via raw SQL; only the top-K rows
    /// are returned. The query vector is serialized to a pgvector literal
    /// string so no custom Npgsql type-mapping is required.
    /// </summary>
    private async Task<List<RankedEmbeddingResult>> SearchSimilarEmbeddingsNativePostgreSqlAsync(
        long userId,
        float[] queryVector,
        string queryModel,
        int topK,
        long? scopeId,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        List<string>? categoryFilters)
    {
        var now = DateTime.UtcNow;

        // Serialize the query vector to pgvector-compatible literal: '[x,x,x,...]' using InvariantCulture
        var pgLiteral = "[" + string.Join(",", queryVector.Select(v => v.ToString(System.Globalization.CultureInfo.InvariantCulture))) + "]";

        // Build the base EF Core query for dimension/expiry/user filtering
        var query = _dbContext.MemoryEmbeddings
            .AsNoTracking()
            .Where(e =>
                e.Memory.UserId == userId &&
                e.Memory.IsActive &&
                (e.Memory.ExpiresAt == null || e.Memory.ExpiresAt > now) &&
                e.Dimensions == queryVector.Length);

        // Model compatibility filter (case-insensitive and trimmed, matching IsModelCompatible)
        if (!string.IsNullOrWhiteSpace(queryModel))
        {
            var trimmedQueryModel = queryModel.Trim().ToLowerInvariant();
            query = query.Where(e =>
                e.Model == null ||
                e.Model == string.Empty ||
                e.Model.ToLower() == trimmedQueryModel);
        }

        if (scopeId.HasValue)
            query = query.Where(e => e.Memory.ScopeId == scopeId.Value);

        if (categoryFilters != null && categoryFilters.Count > 0)
        {
            var normalized = categoryFilters.Select(c => c.Trim().ToLowerInvariant()).ToList();
            query = query.Where(e => e.Memory.MemoryCategories.Any(c => normalized.Contains(c.Category)));
        }

        if (temporalFilter != null)
        {
            var effectiveFrom = temporalFilter.GetEffectiveCreatedAtFrom();
            if (effectiveFrom.HasValue)
                query = query.Where(e => e.Memory.CreatedAt >= effectiveFrom.Value);
            if (temporalFilter.CreatedAtTo.HasValue)
                query = query.Where(e => e.Memory.CreatedAt <= temporalFilter.CreatedAtTo.Value);
            if (temporalFilter.UpdatedAtFrom.HasValue)
                query = query.Where(e => e.Memory.UpdatedAt >= temporalFilter.UpdatedAtFrom.Value);
            if (temporalFilter.UpdatedAtTo.HasValue)
                query = query.Where(e => e.Memory.UpdatedAt <= temporalFilter.UpdatedAtTo.Value);
            if (temporalFilter.OccurredAtFrom.HasValue)
                query = query.Where(e => e.Memory.OccurredAt != null && e.Memory.OccurredAt >= temporalFilter.OccurredAtFrom.Value);
            if (temporalFilter.OccurredAtTo.HasValue)
                query = query.Where(e => e.Memory.OccurredAt != null && e.Memory.OccurredAt <= temporalFilter.OccurredAtTo.Value);
        }

        // Materialize filtered candidates including metadata (for in-memory metadata filter)
        var candidates = await query
            .Select(e => new
            {
                e.EmbeddingId,
                e.MemoryId,
                e.Memory.Content,
                e.Memory.MemoryType,
                e.Memory.CreatedAt,
                e.Memory.UpdatedAt,
                e.Memory.OccurredAt,
                e.Memory.Metadata,
                e.Memory.ExpiresAt,
                Categories = e.Memory.MemoryCategories.Select(c => c.Category).ToList(),
                e.Model,
                e.Dimensions
            })
            .ToListAsync();

        // Apply metadata filter in-memory (consistent with existing GetFilteredActiveMemoryEmbeddingsAsync)
        if (metadataFilters != null && metadataFilters.Count > 0)
        {
            candidates = candidates
                .Where(c => MetadataFilterEvaluator.Matches(c.Metadata, metadataFilters))
                .ToList();
        }

        if (candidates.Count == 0)
            return new List<RankedEmbeddingResult>();

        // Build native pgvector distance query using parameterized IN list
        // VectorData::vector <=> 'pgLiteral'::vector  returns cosine distance in [0, 2]
        // (0 = identical, 2 = opposite)
        var idList = string.Join(",", candidates.Select(c => c.EmbeddingId));
        var sql = string.Format(
            @"SELECT ""EmbeddingId"", (""VectorData""::vector <=> '{0}'::vector) AS dist
              FROM ""MemoryEmbeddings""
              WHERE ""EmbeddingId"" = ANY(ARRAY[{1}]::bigint[])
              ORDER BY dist, ""EmbeddingId""
              LIMIT {2}",
            pgLiteral, idList, topK);

        var distanceMap = new Dictionary<long, double>();
        var conn = _dbContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var embId = reader.GetInt64(0);
                var dist = reader.GetDouble(1);
                distanceMap[embId] = dist;
            }
        }
        finally
        {
            if (!wasOpen) await conn.CloseAsync();
        }

        // Map survivors back to results
        var candidateMap = candidates.ToDictionary(c => c.EmbeddingId);
        var results = new List<RankedEmbeddingResult>();

        foreach (var (embId, dist) in distanceMap)
        {
            if (!candidateMap.TryGetValue(embId, out var c)) continue;

            results.Add(new RankedEmbeddingResult
            {
                MemoryId   = c.MemoryId,
                Content    = c.Content,
                MemoryType = c.MemoryType ?? string.Empty,
                Model      = c.Model,
                Dimensions = c.Dimensions,
                Similarity = 1.0 - dist,   // cosine distance [0,2] → cosine similarity in [-1,1]; pgvector uses [0,2] range
                CreatedAt  = c.CreatedAt,
                UpdatedAt  = c.UpdatedAt,
                OccurredAt = c.OccurredAt,
                Metadata   = c.Metadata,
                ExpiresAt  = c.ExpiresAt,
                Categories = c.Categories
            });
        }

        return results.OrderByDescending(r => r.Similarity).ThenBy(r => r.MemoryId).ToList();
    }

    // ── Phase 4C Task 4C.4: SQL Server / fallback in-memory similarity path ───

    private async Task<List<RankedEmbeddingResult>> SearchSimilarEmbeddingsSqlServerFallbackAsync(
        long userId,
        float[] queryVector,
        string queryModel,
        int topK,
        long? scopeId,
        MemoryTemporalFilter? temporalFilter,
        List<MetadataFilterCondition>? metadataFilters,
        List<string>? categoryFilters)
    {
        // Reuse existing full-load path for filter application
        var embeddings = await GetFilteredActiveMemoryEmbeddingsAsync(
            userId, scopeId, temporalFilter, metadataFilters, categoryFilters);

        var similarityService = new SemanticSimilarityService();
        var now = DateTime.UtcNow;
        var results = new List<RankedEmbeddingResult>();

        foreach (var emb in embeddings)
        {
            // Dimension and model compatibility guard
            if (emb.Dimensions != queryVector.Length) continue;
            if (!EmbeddingGeneratorExtensions.IsModelCompatible(emb.Model, queryModel)) continue;
            if (!ExpirationHelper.IsNotExpired(emb.ExpiresAt, now)) continue;

            var sim = similarityService.CalculateCosineSimilarity(queryVector, emb.Embedding);
            results.Add(new RankedEmbeddingResult
            {
                MemoryId   = emb.MemoryId,
                Content    = emb.Content,
                MemoryType = emb.MemoryType,
                Model      = emb.Model,
                Dimensions = emb.Dimensions,
                Similarity = sim,
                CreatedAt  = emb.CreatedAt,
                UpdatedAt  = emb.UpdatedAt,
                OccurredAt = emb.OccurredAt,
                Metadata   = emb.Metadata,
                ExpiresAt  = emb.ExpiresAt,
                Categories = emb.Categories
            });
        }

        return results.OrderByDescending(r => r.Similarity).ThenBy(r => r.MemoryId).Take(topK).ToList();
    }
}