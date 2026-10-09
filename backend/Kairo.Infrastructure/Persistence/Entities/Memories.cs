using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class Memories
{
    public long MemoryId { get; set; }

    public long UserId { get; set; }

    public string Content { get; set; } = null!;

    public string? MemoryType { get; set; }

    public long? SourceChatId { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public long? ScopeId { get; set; }

    /// <summary>Phase 2: Event or fact occurrence timestamp (optional).</summary>
    public DateTime? OccurredAt { get; set; }

    /// <summary>Phase 2: Arbitrary application-defined metadata JSON.</summary>
    public string? Metadata { get; set; }

    /// <summary>Phase 3: Expiration timestamp in UTC (optional). NULL = no expiration.</summary>
    public DateTime? ExpiresAt { get; set; }

    public virtual ICollection<MemoryEmbeddings> MemoryEmbeddings { get; set; } = new List<MemoryEmbeddings>();

    public virtual ICollection<MemoryVersions> MemoryVersions { get; set; } = new List<MemoryVersions>();

    /// <summary>Phase 1: Entities extracted from this memory.</summary>
    public virtual ICollection<MemoryEntities> MemoryEntities { get; set; } = new List<MemoryEntities>();

    /// <summary>Phase 2: Graph relationship evidence linked to this memory.</summary>
    public virtual ICollection<RelationshipEvidence> RelationshipEvidence { get; set; } = new List<RelationshipEvidence>();

    /// <summary>Phase 3: Extensible categories assigned to this memory.</summary>
    public virtual ICollection<MemoryCategory> MemoryCategories { get; set; } = new List<MemoryCategory>();

    public virtual MemoryScopes? Scope { get; set; }

    public virtual Chats? SourceChat { get; set; }

    public virtual Users User { get; set; } = null!;
}
