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

    public virtual ICollection<MemoryEmbeddings> MemoryEmbeddings { get; set; } = new List<MemoryEmbeddings>();

    public virtual ICollection<MemoryVersions> MemoryVersions { get; set; } = new List<MemoryVersions>();

    public virtual MemoryScopes? Scope { get; set; }

    public virtual Chats? SourceChat { get; set; }

    public virtual Users User { get; set; } = null!;
}
