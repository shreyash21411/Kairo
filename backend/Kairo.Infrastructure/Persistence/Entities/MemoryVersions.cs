using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class MemoryVersions
{
    public long MemoryVersionId { get; set; }

    public long MemoryId { get; set; }

    public string Content { get; set; } = null!;

    public string Operation { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public virtual Memories Memory { get; set; } = null!;
}
