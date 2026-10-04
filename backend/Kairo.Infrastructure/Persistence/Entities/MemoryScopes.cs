using System;
using System.Collections.Generic;

namespace Kairo.Infrastructure.Persistence.Entities;

public partial class MemoryScopes
{
    public long ScopeId { get; set; }

    public long ProjectId { get; set; }

    /// <summary>
    /// V1 legacy actor identifier. Combined with ProjectId for backward-compatible
    /// scope resolution. Callers that only supply actorId continue to work via the
    /// existing (ProjectId, ActorId) unique index.
    /// </summary>
    public string ActorId { get; set; } = null!;

    // ── Phase 1: Multi-dimensional scope columns (all optional) ──────────────

    /// <summary>Application-level user identifier (Phase 1+).</summary>
    public string? UserId { get; set; }

    /// <summary>Application-level agent identifier (Phase 1+).</summary>
    public string? AgentId { get; set; }

    /// <summary>Conversation session identifier (Phase 1+).</summary>
    public string? SessionId { get; set; }

    /// <summary>Execution run identifier (Phase 1+).</summary>
    public string? RunId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<Memories> Memories { get; set; } = new List<Memories>();

    public virtual Projects Project { get; set; } = null!;
}
