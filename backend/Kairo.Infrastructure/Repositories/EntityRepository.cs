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

    // ── Phase 2: Graph Memory Methods ─────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<List<GraphRelationData>> UpsertRelationshipsForMemoryAsync(
        long projectId,
        long scopeId,
        long memoryId,
        List<ExtractedRelationship> relationships,
        CancellationToken cancellationToken = default)
    {
        if (relationships == null || relationships.Count == 0)
            return new List<GraphRelationData>();

        var result = new List<GraphRelationData>();

        await using var transaction = await _dbContext.Database
            .BeginTransactionAsync(cancellationToken);

        try
        {
            foreach (var rel in relationships)
            {
                if (string.IsNullOrWhiteSpace(rel.Source) ||
                    string.IsNullOrWhiteSpace(rel.Target) ||
                    string.IsNullOrWhiteSpace(rel.RelationshipType))
                    continue;

                var sourceNorm = rel.Source.Trim().ToLowerInvariant();
                var targetNorm = rel.Target.Trim().ToLowerInvariant();
                var relType    = rel.RelationshipType.Trim().ToLowerInvariant();

                if (sourceNorm == targetNorm)
                    continue; // Skip self-loops

                // 1. Resolve or create source entity
                var sourceEntity = await GetOrCreateEntityAsync(projectId, rel.Source.Trim(), sourceNorm, "CONCEPT", cancellationToken);
                // 2. Resolve or create target entity
                var targetEntity = await GetOrCreateEntityAsync(projectId, rel.Target.Trim(), targetNorm, "CONCEPT", cancellationToken);

                // 3. Upsert scoped EntityRelationship
                var existingRel = await _dbContext.EntityRelationships
                    .FirstOrDefaultAsync(r =>
                        r.ScopeId == scopeId &&
                        r.SourceEntityId == sourceEntity.EntityId &&
                        r.TargetEntityId == targetEntity.EntityId &&
                        r.RelationshipType == relType,
                        cancellationToken);

                long relationshipId;
                double finalConfidence = Math.Clamp(rel.Confidence, 0.0, 1.0);

                if (existingRel != null)
                {
                    existingRel.UpdatedAt = DateTime.UtcNow;
                    existingRel.Confidence = Math.Max(existingRel.Confidence, finalConfidence);
                    relationshipId = existingRel.RelationshipId;
                    await _dbContext.SaveChangesAsync(cancellationToken);
                }
                else
                {
                    var newRel = new EntityRelationship
                    {
                        ProjectId        = projectId,
                        ScopeId          = scopeId,
                        SourceEntityId   = sourceEntity.EntityId,
                        TargetEntityId   = targetEntity.EntityId,
                        RelationshipType = relType,
                        Confidence       = finalConfidence,
                        CreatedAt        = DateTime.UtcNow,
                        UpdatedAt        = DateTime.UtcNow
                    };

                    _dbContext.EntityRelationships.Add(newRel);

                    try
                    {
                        await _dbContext.SaveChangesAsync(cancellationToken);
                        relationshipId = newRel.RelationshipId;
                    }
                    catch (DbUpdateException)
                    {
                        // Concurrent insert race — detach and refetch
                        _dbContext.Entry(newRel).State = EntityState.Detached;
                        var concurrent = await _dbContext.EntityRelationships
                            .FirstAsync(r =>
                                r.ScopeId == scopeId &&
                                r.SourceEntityId == sourceEntity.EntityId &&
                                r.TargetEntityId == targetEntity.EntityId &&
                                r.RelationshipType == relType,
                                cancellationToken);
                        relationshipId = concurrent.RelationshipId;
                    }
                }

                // 4. Link evidence
                var evidenceExists = await _dbContext.RelationshipEvidence
                    .AnyAsync(e => e.RelationshipId == relationshipId && e.MemoryId == memoryId,
                        cancellationToken);

                if (!evidenceExists)
                {
                    var evidence = new RelationshipEvidence
                    {
                        RelationshipId = relationshipId,
                        MemoryId       = memoryId,
                        CreatedAt      = DateTime.UtcNow
                    };

                    _dbContext.RelationshipEvidence.Add(evidence);
                    try
                    {
                        await _dbContext.SaveChangesAsync(cancellationToken);
                    }
                    catch (DbUpdateException)
                    {
                        _dbContext.ChangeTracker.Clear();
                    }
                }

                result.Add(new GraphRelationData
                {
                    RelationshipId       = relationshipId,
                    ScopeId              = scopeId,
                    SourceEntityId       = sourceEntity.EntityId,
                    SourceDisplayName    = sourceEntity.DisplayName,
                    SourceNormalizedName = sourceNorm,
                    TargetEntityId       = targetEntity.EntityId,
                    TargetDisplayName    = targetEntity.DisplayName,
                    TargetNormalizedName = targetNorm,
                    RelationshipType     = relType,
                    Confidence           = finalConfidence
                });
            }

            await transaction.CommitAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "[EntityRepository] Relationship upsert failed for MemoryId={MemoryId}. Rolling back.",
                memoryId);
            await transaction.RollbackAsync(cancellationToken);
            return new List<GraphRelationData>();
        }

        return result;
    }

    private async Task<NamedEntity> GetOrCreateEntityAsync(
        long projectId,
        string displayName,
        string normalizedName,
        string defaultType,
        CancellationToken cancellationToken)
    {
        var existing = await _dbContext.Entities
            .FirstOrDefaultAsync(e => e.ProjectId == projectId && e.NormalizedName == normalizedName,
                cancellationToken);

        if (existing != null)
            return existing;

        var entity = new NamedEntity
        {
            ProjectId      = projectId,
            NormalizedName = normalizedName,
            DisplayName    = displayName,
            EntityType     = defaultType,
            CreatedAt      = DateTime.UtcNow,
            UpdatedAt      = DateTime.UtcNow
        };

        _dbContext.Entities.Add(entity);

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
            return entity;
        }
        catch (DbUpdateException)
        {
            _dbContext.Entry(entity).State = EntityState.Detached;
            return await _dbContext.Entities
                .FirstAsync(e => e.ProjectId == projectId && e.NormalizedName == normalizedName,
                    cancellationToken);
        }
    }

    /// <inheritdoc/>
    public async Task<List<GraphRelationData>> GetScopedRelationshipsForEntitiesAsync(
        long projectId,
        long scopeId,
        IEnumerable<string> normalizedEntityNames,
        int maxDepth = 1,
        CancellationToken cancellationToken = default)
    {
        var targetNames = new HashSet<string>(
            normalizedEntityNames.Where(n => !string.IsNullOrWhiteSpace(n)).Select(n => n.Trim().ToLowerInvariant()),
            StringComparer.OrdinalIgnoreCase);

        if (targetNames.Count == 0)
            return new List<GraphRelationData>();

        int safeDepth = Math.Clamp(maxDepth, 1, 2);
        var visitedEntityNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var discoveredRelationships = new Dictionary<long, GraphRelationData>();

        var currentFrontier = new HashSet<string>(targetNames, StringComparer.OrdinalIgnoreCase);

        for (int depth = 0; depth < safeDepth && currentFrontier.Count > 0; depth++)
        {
            foreach (var n in currentFrontier)
                visitedEntityNames.Add(n);

            var frontierList = currentFrontier.ToList();

            var now = DateTime.UtcNow;
            var matches = await _dbContext.EntityRelationships
                .AsNoTracking()
                .Where(r =>
                    r.ProjectId == projectId &&
                    r.ScopeId == scopeId &&
                    (!r.Evidence.Any() || r.Evidence.Any(e => e.Memory.IsActive && (e.Memory.ExpiresAt == null || e.Memory.ExpiresAt > now))) &&
                    (frontierList.Contains(r.SourceEntity.NormalizedName) ||
                     frontierList.Contains(r.TargetEntity.NormalizedName)))
                .Select(r => new GraphRelationData
                {
                    RelationshipId       = r.RelationshipId,
                    ScopeId              = r.ScopeId,
                    SourceEntityId       = r.SourceEntityId,
                    SourceDisplayName    = r.SourceEntity.DisplayName,
                    SourceNormalizedName = r.SourceEntity.NormalizedName,
                    TargetEntityId       = r.TargetEntityId,
                    TargetDisplayName    = r.TargetEntity.DisplayName,
                    TargetNormalizedName = r.TargetEntity.NormalizedName,
                    RelationshipType     = r.RelationshipType,
                    Confidence           = r.Confidence
                })
                .ToListAsync(cancellationToken);

            var nextFrontier = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var m in matches)
            {
                discoveredRelationships[m.RelationshipId] = m;

                if (!visitedEntityNames.Contains(m.SourceNormalizedName))
                    nextFrontier.Add(m.SourceNormalizedName);
                if (!visitedEntityNames.Contains(m.TargetNormalizedName))
                    nextFrontier.Add(m.TargetNormalizedName);
            }

            currentFrontier = nextFrontier;
        }

        return discoveredRelationships.Values.ToList();
    }

    /// <inheritdoc/>
    public async Task CleanupRelationshipsForMemoryAsync(
        long memoryId,
        CancellationToken cancellationToken = default)
    {
        // 1. Remove evidence for this memory
        var evidence = await _dbContext.RelationshipEvidence
            .Where(e => e.MemoryId == memoryId)
            .ToListAsync(cancellationToken);

        if (evidence.Count == 0)
            return;

        var affectedRelIds = evidence.Select(e => e.RelationshipId).Distinct().ToList();

        _dbContext.RelationshipEvidence.RemoveRange(evidence);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 2. Identify relationships that have zero remaining evidence
        var orphanRels = await _dbContext.EntityRelationships
            .Where(r => affectedRelIds.Contains(r.RelationshipId) && !r.Evidence.Any())
            .ToListAsync(cancellationToken);

        if (orphanRels.Count > 0)
        {
            _dbContext.EntityRelationships.RemoveRange(orphanRels);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
    }
}
