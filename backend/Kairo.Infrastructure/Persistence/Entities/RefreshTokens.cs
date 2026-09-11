using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class RefreshTokens
{
    public long RefreshTokenId { get; set; }

    public long UserId { get; set; }

    public string TokenHash { get; set; } = null!;

    public Guid FamilyId { get; set; }

    public DateTime ExpiresAt { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? RevokedAt { get; set; }

    public long? ReplacedByTokenId { get; set; }

    public virtual ICollection<RefreshTokens> InverseReplacedByToken { get; set; } = new List<RefreshTokens>();

    public virtual RefreshTokens? ReplacedByToken { get; set; }

    public virtual Users User { get; set; } = null!;
}
