using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class Messages
{
    public long MessageId { get; set; }

    public long ChatId { get; set; }

    public string ExternalMessageId { get; set; } = null!;

    public string Role { get; set; } = null!;

    public string Content { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public bool IsDeleted { get; set; }

    public virtual Chats Chat { get; set; } = null!;
}
