using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class ApiKeys
{
    public long ApiKeyId { get; set; }

    public long ProjectId { get; set; }

    public string KeyHash { get; set; } = null!;

    public string KeyPrefix { get; set; } = null!;

    public string Name { get; set; } = null!;

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public DateTime? LastUsedAt { get; set; }

    public DateTime? ExpiresAt { get; set; }

    public virtual Projects Project { get; set; } = null!;
}
