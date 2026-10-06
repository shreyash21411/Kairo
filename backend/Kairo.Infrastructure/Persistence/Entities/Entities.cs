using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

/// <summary>
/// Phase 1: A normalized, deduplicated named entity extracted from memory content.
/// Scoped to a Project. Deduplication key: (ProjectId, NormalizedName).
/// </summary>
public partial class NamedEntity
{
    public long EntityId { get; set; }

    public long ProjectId { get; set; }

    /// <summary>
    /// Lowercase, trimmed, canonical form used for deduplication.
    /// Example: "microsoft", "postgresql", "azure".
    /// </summary>
    public string NormalizedName { get; set; } = null!;

    /// <summary>
    /// Human-readable display form as extracted.
    /// Example: "Microsoft", "PostgreSQL", "Azure".
    /// </summary>
    public string DisplayName { get; set; } = null!;

    /// <summary>
    /// Entity category. One of: PERSON, ORGANIZATION, PRODUCT, TECHNOLOGY,
    /// LOCATION, PROJECT, COMPANY, TOOL, CONCEPT.
    /// </summary>
    public string EntityType { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Projects Project { get; set; } = null!;

    public virtual ICollection<MemoryEntities> MemoryEntities { get; set; } = new List<MemoryEntities>();

    public virtual ICollection<EntityRelationship> SourceRelationships { get; set; } = new List<EntityRelationship>();

    public virtual ICollection<EntityRelationship> TargetRelationships { get; set; } = new List<EntityRelationship>();
}
