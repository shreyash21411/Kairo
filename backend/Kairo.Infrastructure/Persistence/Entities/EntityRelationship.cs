using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

/// <summary>
/// Phase 2: Directed relationship between two named entities within a project
/// and strictly scoped to a specific MemoryScope.
/// Deduplication key: (ScopeId, SourceEntityId, TargetEntityId, RelationshipType).
/// </summary>
public partial class EntityRelationship
{
    public long RelationshipId { get; set; }

    public long ProjectId { get; set; }

    public long ScopeId { get; set; }

    public long SourceEntityId { get; set; }

    public long TargetEntityId { get; set; }

    public string RelationshipType { get; set; } = null!;

    public double Confidence { get; set; } = 1.0;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Projects Project { get; set; } = null!;

    public virtual MemoryScopes Scope { get; set; } = null!;

    public virtual NamedEntity SourceEntity { get; set; } = null!;

    public virtual NamedEntity TargetEntity { get; set; } = null!;

    public virtual ICollection<RelationshipEvidence> Evidence { get; set; } = new List<RelationshipEvidence>();
}
