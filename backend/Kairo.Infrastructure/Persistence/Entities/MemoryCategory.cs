using System;

namespace Kairo.Infrastructure.Persistence.Entities;

/// <summary>
/// Phase 3: Relational entity representing an extensible category assigned to a memory.
/// </summary>
public partial class MemoryCategory
{
    public long MemoryCategoryId { get; set; }

    public long MemoryId { get; set; }

    public string Category { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public virtual Memories Memory { get; set; } = null!;
}
