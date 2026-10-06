using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Kairo.Infrastructure.Repositories;

/// <summary>
/// Phase 1: Persists and retrieves entities and memory-entity associations.
/// Uses NamedEntity (EF class) which maps to the SQL Entities table.
/// All entity upserts and link insertions for a single memory are wrapped
/// in a single database transaction to prevent partial entity state.
/// </summary>
public class EntityRepository : IEntityRepository
{
    private readonly KairoDbContext _dbContext;
    private readonly ILogger<EntityRepository> _logger;

    public EntityRepository(KairoDbContext dbContext, ILogger<EntityRepository> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    /// <inheritdoc/>
    public async Task<List<EntityData>> UpsertEntitiesForMemoryAsync(
        long projectId,
        long memoryId,
        List<ExtractedEntity> entities,
        CancellationToken cancellationToken = default)
    {
        if (entities == null || entities.Count == 0)
            return new List<EntityData>();

        var result = new List<EntityData>();

        // ── Wrap the entire operation in one transaction ───────────────────────
        // This ensures we never leave a memory with only a partial set of entity
        // links if the process fails midway.
        await using var transaction = await _dbContext.Database
            .BeginTransactionAsync(cancellationToken);

        try
        {
            foreach (var extracted in entities)
            {
                if (string.IsNullOrWhiteSpace(extracted.NormalizedName))
                    continue;

                var normalizedName = extracted.NormalizedName.Trim().ToLowerInvariant();

                // ── Upsert entity ──────────────────────────────────────────────────
                EntityData entityData;
                try
                {
                    var existing = await _dbContext.Entities
                        .Where(e => e.ProjectId == projectId && e.NormalizedName == normalizedName)
                        .Select(e => new EntityData
                        {
                            EntityId       = e.EntityId,
                            NormalizedName = e.NormalizedName,
                            DisplayName    = e.DisplayName,
                            EntityType     = e.EntityType
                        })
                        .FirstOrDefaultAsync(cancellationToken);

                    if (existing != null)
                    {
                        entityData = existing;
                    }
                    else
                    {
                        var now = DateTime.UtcNow;
                        var entity = new NamedEntity
                        {
                            ProjectId      = projectId,
                            NormalizedName = normalizedName,
                            DisplayName    = extracted.DisplayName.Trim(),
                            EntityType     = extracted.EntityType.Trim(),
                            CreatedAt      = now,
                            UpdatedAt      = now
                        };

                        _dbContext.Entities.Add(entity);

                        try
                        {
                            await _dbContext.SaveChangesAsync(cancellationToken);
                        }
                        catch (DbUpdateException)
                        {
                            // Concurrent insert — detach and re-fetch within the transaction
                            _dbContext.Entry(entity).State = EntityState.Detached;

                            var concurrent = await _dbContext.Entities
                                .AsNoTracking()
                                .Where(e => e.ProjectId == projectId && e.NormalizedName == normalizedName)
                                .Select(e => new EntityData
                                {
                                    EntityId       = e.EntityId,
                                    NormalizedName = e.NormalizedName,
                                    DisplayName    = e.DisplayName,
                                    EntityType     = e.EntityType
                                })
                                .FirstOrDefaultAsync(cancellationToken);

                            if (concurrent == null)
                            {
                                _logger.LogWarning(
                                    "[EntityRepository] Concurrent insert race for entity '{Name}' in project {ProjectId}.",
                                    normalizedName, projectId);
                                continue;
                            }

                            entityData = concurrent;
                            goto LinkEntity;
                        }

                        entityData = new EntityData
                        {
                            EntityId       = entity.EntityId,
                            NormalizedName = entity.NormalizedName,
                            DisplayName    = entity.DisplayName,
                            EntityType     = entity.EntityType
                        };
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "[EntityRepository] Failed to upsert entity '{Name}'. Skipping.",
                        normalizedName);
                    continue;
                }

                LinkEntity:
                // ── Link entity to memory ──────────────────────────────────────────
                try
                {
                    var linkExists = await _dbContext.MemoryEntities
                        .AnyAsync(me => me.MemoryId == memoryId && me.EntityId == entityData.EntityId,
                                  cancellationToken);

                    if (!linkExists)
                    {
                        _dbContext.MemoryEntities.Add(new MemoryEntities
                        {
                            MemoryId  = memoryId,
                            EntityId  = entityData.EntityId,
                            CreatedAt = DateTime.UtcNow
                        });

                        try
                        {
                            await _dbContext.SaveChangesAsync(cancellationToken);
                        }
                        catch (DbUpdateException)
                        {
                            // Link already exists (concurrent) — ignore
                            _dbContext.ChangeTracker.Clear();
                        }
                    }

                    result.Add(entityData);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "[EntityRepository] Failed to link entity {EntityId} to memory {MemoryId}. Skipping.",
                        entityData.EntityId, memoryId);
                }
            }

            await transaction.CommitAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "[EntityRepository] Entity upsert transaction failed for memory {MemoryId}. Rolling back.",
                memoryId);
            await transaction.RollbackAsync(cancellationToken);
            // Return empty — no partial entity state was committed.
            return new List<EntityData>();
        }

        return result;
    }

    /// <inheritdoc/>
    public async Task<Dictionary<long, List<EntityData>>> GetEntitiesForMemoriesAsync(
        IEnumerable<long> memoryIds,
        CancellationToken cancellationToken = default)
    {
        var ids = memoryIds.ToList();
        if (ids.Count == 0)
            return new Dictionary<long, List<EntityData>>();

        var rows = await _dbContext.MemoryEntities
            .AsNoTracking()
            .Where(me => ids.Contains(me.MemoryId))
            .Select(me => new
            {
                me.MemoryId,
                me.Entity.EntityId,
                me.Entity.NormalizedName,
                me.Entity.DisplayName,
                me.Entity.EntityType
            })
            .ToListAsync(cancellationToken);

        var result = new Dictionary<long, List<EntityData>>();
        foreach (var row in rows)
        {
            if (!result.TryGetValue(row.MemoryId, out var list))
            {
                list = new List<EntityData>();
                result[row.MemoryId] = list;
            }
            list.Add(new EntityData
            {
                EntityId       = row.EntityId,
                NormalizedName = row.NormalizedName,
                DisplayName    = row.DisplayName,
                EntityType     = row.EntityType
            });
        }

        return result;
    }

    /// <inheritdoc/>
    public async Task<List<string>> GetNormalizedNamesForProjectAsync(
        long projectId,
        IEnumerable<string> normalizedNames,
        CancellationToken cancellationToken = default)
    {
        var names = normalizedNames.ToList();
        if (names.Count == 0)
            return new List<string>();

        return await _dbContext.Entities
            .AsNoTracking()
            .Where(e => e.ProjectId == projectId && names.Contains(e.NormalizedName))
            .Select(e => e.NormalizedName)
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc/>
    public async Task DeleteLinksForMemoryAsync(
        long memoryId,
        CancellationToken cancellationToken = default)
    {
        var links = await _dbContext.MemoryEntities
            .Where(me => me.MemoryId == memoryId)
            .ToListAsync(cancellationToken);

        if (links.Count == 0)
            return;

        _dbContext.MemoryEntities.RemoveRange(links);
        await _dbContext.SaveChangesAsync(cancellationToken);
    }
}
