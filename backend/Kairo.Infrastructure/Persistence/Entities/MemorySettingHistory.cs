using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class MemorySettingHistory
{
    public long MemorySettingHistoryId { get; set; }

    public long UserId { get; set; }

    public string Action { get; set; } = null!;

    public DateTime ChangedAt { get; set; }

    public virtual Users User { get; set; } = null!;
}
