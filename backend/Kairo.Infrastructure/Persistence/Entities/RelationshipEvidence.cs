using System;

namespace Kairo.Infrastructure.Persistence.Entities;

/// <summary>
/// Phase 2: Tracks provenance connecting an EntityRelationship to the specific
/// Memory records that provide evidence for it.
/// </summary>
public partial class RelationshipEvidence
{
    public long EvidenceId { get; set; }

    public long RelationshipId { get; set; }

    public long MemoryId { get; set; }

    public DateTime CreatedAt { get; set; }

    public virtual EntityRelationship Relationship { get; set; } = null!;

    public virtual Memories Memory { get; set; } = null!;
}
