using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class AuthenticationIdentities
{
    public long AuthenticationIdentityId { get; set; }

    public long UserId { get; set; }

    public string Provider { get; set; } = null!;

    public string ProviderSubject { get; set; } = null!;

    public string? PasswordHash { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Users User { get; set; } = null!;
}
