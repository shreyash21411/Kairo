using System;

namespace Kairo.Infrastructure.Persistence.Entities;

/// <summary>
/// Phase 1: Junction table connecting Memories to Entities (many-to-many).
/// </summary>
public partial class MemoryEntities
{
    public long MemoryEntityId { get; set; }

    public long MemoryId { get; set; }

    public long EntityId { get; set; }

    public DateTime CreatedAt { get; set; }

    public virtual Memories Memory { get; set; } = null!;

    public virtual NamedEntity Entity { get; set; } = null!;
}
