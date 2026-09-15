using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class MemoryScopes
{
    public long ScopeId { get; set; }

    public long ProjectId { get; set; }

    public string ActorId { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<Memories> Memories { get; set; } = new List<Memories>();

    public virtual Projects Project { get; set; } = null!;
}
