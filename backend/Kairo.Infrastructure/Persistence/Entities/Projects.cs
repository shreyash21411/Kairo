using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class Projects
{
    public long ProjectId { get; set; }

    public long UserId { get; set; }

    public string Name { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public bool IsDeleted { get; set; }

    public virtual ICollection<Chats> Chats { get; set; } = new List<Chats>();

    public virtual Users User { get; set; } = null!;
}
