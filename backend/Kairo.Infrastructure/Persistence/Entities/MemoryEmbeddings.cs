using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class MemoryEmbeddings
{
    public long EmbeddingId { get; set; }

    public long MemoryId { get; set; }

    public string Model { get; set; } = null!;

    public int Dimensions { get; set; }

    public string VectorData { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public virtual Memories Memory { get; set; } = null!;
}
