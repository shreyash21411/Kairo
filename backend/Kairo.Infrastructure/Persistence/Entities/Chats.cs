using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class Chats
{
    public long ChatId { get; set; }

    public long UserId { get; set; }

    public long? ProjectId { get; set; }

    public string ExternalConversationId { get; set; } = null!;

    public string Source { get; set; } = null!;

    public string? Name { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public bool IsDeleted { get; set; }

    public byte ProcessingStatus { get; set; }

    public DateTime? ProcessingStartedAt { get; set; }

    public DateTime? ProcessedAt { get; set; }

    public string? ProcessingError { get; set; }

    public byte RawChatStatus { get; set; }

    public DateTime? RawChatRetentionUntil { get; set; }

    public DateTime? ArchivedAt { get; set; }

    public virtual ICollection<Memories> Memories { get; set; } = new List<Memories>();

    public virtual ICollection<Messages> Messages { get; set; } = new List<Messages>();

    public virtual Projects? Project { get; set; }

    public virtual Users User { get; set; } = null!;
}
