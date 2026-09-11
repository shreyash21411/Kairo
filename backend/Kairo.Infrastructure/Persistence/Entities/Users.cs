using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class Users
{
    public long UserId { get; set; }

    public string Email { get; set; } = null!;

    public string? PasswordHash { get; set; }

    public bool IsEmailVerified { get; set; }

    public byte AccountStatus { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public DateTime? LastLoginAt { get; set; }

    public virtual ICollection<AuthenticationIdentities> AuthenticationIdentities { get; set; } = new List<AuthenticationIdentities>();

    public virtual ICollection<Chats> Chats { get; set; } = new List<Chats>();

    public virtual ICollection<Memories> Memories { get; set; } = new List<Memories>();

    public virtual ICollection<MemorySettingHistory> MemorySettingHistory { get; set; } = new List<MemorySettingHistory>();

    public virtual ICollection<Projects> Projects { get; set; } = new List<Projects>();

    public virtual ICollection<RefreshTokens> RefreshTokens { get; set; } = new List<RefreshTokens>();

    public virtual UserMemorySettings? UserMemorySettings { get; set; }
}
