using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class UserMemorySettings
{
    public long UserId { get; set; }

    public bool IsEnabled { get; set; }

    public DateTime? EnabledAt { get; set; }

    public DateTime? DisabledAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Users User { get; set; } = null!;
}
