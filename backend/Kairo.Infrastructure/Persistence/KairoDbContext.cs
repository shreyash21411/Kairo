using System;
using System.Collections.Generic;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kairo.Infrastructure.Persistence;

public partial class KairoDbContext : DbContext
{
    public KairoDbContext(DbContextOptions<KairoDbContext> options)
        : base(options)
    {
    }

    public virtual DbSet<ApiKeys> ApiKeys { get; set; }

    public virtual DbSet<AuthenticationIdentities> AuthenticationIdentities { get; set; }

    public virtual DbSet<Chats> Chats { get; set; }

    public virtual DbSet<NamedEntity> Entities { get; set; }

    public virtual DbSet<EntityRelationship> EntityRelationships { get; set; }

    public virtual DbSet<RelationshipEvidence> RelationshipEvidence { get; set; }

    public virtual DbSet<Memories> Memories { get; set; }

    public virtual DbSet<MemoryEmbeddings> MemoryEmbeddings { get; set; }

    public virtual DbSet<MemoryEntities> MemoryEntities { get; set; }

    public virtual DbSet<MemoryCategory> MemoryCategories { get; set; }

    public virtual DbSet<MemoryScopes> MemoryScopes { get; set; }

    public virtual DbSet<MemorySettingHistory> MemorySettingHistory { get; set; }

    public virtual DbSet<MemoryVersions> MemoryVersions { get; set; }

    public virtual DbSet<Messages> Messages { get; set; }

    public virtual DbSet<Projects> Projects { get; set; }

    public virtual DbSet<RefreshTokens> RefreshTokens { get; set; }

    public virtual DbSet<UserMemorySettings> UserMemorySettings { get; set; }

    public virtual DbSet<Users> Users { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ApiKeys>(entity =>
        {
            entity.HasKey(e => e.ApiKeyId);

            entity.HasIndex(e => new { e.KeyHash, e.IsActive }, "IX_ApiKeys_Active");

            entity.HasIndex(e => e.ProjectId, "IX_ApiKeys_ProjectId");

            entity.HasIndex(e => e.KeyHash, "UX_ApiKeys_KeyHash").IsUnique();

            entity.Property(e => e.CreatedAt).HasDefaultValueSql("(getutcdate())");
            entity.Property(e => e.IsActive).HasDefaultValue(true);
            entity.Property(e => e.KeyHash).HasMaxLength(256);
            entity.Property(e => e.KeyPrefix).HasMaxLength(20);
            entity.Property(e => e.Name).HasMaxLength(100);
            entity.Property(e => e.UpdatedAt).HasDefaultValueSql("(getutcdate())");

            entity.HasOne(d => d.Project).WithMany(p => p.ApiKeys)
                .HasForeignKey(d => d.ProjectId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_ApiKeys_Projects");
        });

        modelBuilder.Entity<AuthenticationIdentities>(entity =>
        {
            entity.HasKey(e => e.AuthenticationIdentityId);

            entity.HasIndex(e => new { e.Provider, e.ProviderSubject }, "UQ_AuthenticationIdentities_Provider_Subject").IsUnique();

            entity.Property(e => e.PasswordHash).HasMaxLength(500);
            entity.Property(e => e.Provider).HasMaxLength(50);
            entity.Property(e => e.ProviderSubject).HasMaxLength(320);

            entity.HasOne(d => d.User).WithMany(p => p.AuthenticationIdentities)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_AuthenticationIdentities_Users");
        });

        modelBuilder.Entity<Chats>(entity =>
        {
            entity.HasKey(e => e.ChatId);

            entity.HasIndex(e => new { e.Source, e.ExternalConversationId }, "IX_Chats_ExternalConversation");

            entity.HasIndex(e => e.ProjectId, "IX_Chats_ProjectId");

            entity.HasIndex(e => e.UserId, "IX_Chats_UserId");

            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_Chats_CreatedAt");
            entity.Property(e => e.ExternalConversationId).HasMaxLength(200);
            entity.Property(e => e.Name).HasMaxLength(500);
            entity.Property(e => e.ProcessingError).HasMaxLength(2000);
            entity.Property(e => e.ProcessingStatus).HasDefaultValue((byte)1, "DF_Chats_ProcessingStatus");
            entity.Property(e => e.RawChatStatus).HasDefaultValue((byte)1, "DF_Chats_RawChatStatus");
            entity.Property(e => e.Source).HasMaxLength(50);
            entity.Property(e => e.UpdatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_Chats_UpdatedAt");

            entity.HasOne(d => d.Project).WithMany(p => p.Chats)
                .HasForeignKey(d => d.ProjectId)
                .HasConstraintName("FK_Chats_Projects");

            entity.HasOne(d => d.User).WithMany(p => p.Chats)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Chats_Users");
        });

        modelBuilder.Entity<Memories>(entity =>
        {
            entity.HasKey(e => e.MemoryId);

            entity.HasIndex(e => e.ScopeId, "IX_Memories_ScopeId");

            entity.HasIndex(e => e.SourceChatId, "IX_Memories_SourceChatId");

            entity.HasIndex(e => new { e.UserId, e.IsActive }, "IX_Memories_UserId_IsActive");

            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_Memories_CreatedAt");
            entity.Property(e => e.IsActive).HasDefaultValue(true, "DF_Memories_IsActive");
            entity.Property(e => e.MemoryType).HasMaxLength(50);
            entity.Property(e => e.UpdatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_Memories_UpdatedAt");

            // Phase 2: OccurredAt and Metadata
            entity.Property(e => e.OccurredAt).HasPrecision(3);
            entity.Property(e => e.Metadata);
            entity.HasIndex(e => e.OccurredAt, "IX_Memories_OccurredAt");
            entity.HasIndex(e => e.CreatedAt, "IX_Memories_CreatedAt");

            // Phase 3: ExpiresAt
            entity.Property(e => e.ExpiresAt).HasPrecision(3);
            entity.HasIndex(e => e.ExpiresAt, "IX_Memories_ExpiresAt");
            entity.HasIndex(e => new { e.UserId, e.IsActive, e.ExpiresAt }, "IX_Memories_Active_ExpiresAt");

            entity.HasOne(d => d.Scope).WithMany(p => p.Memories)
                .HasForeignKey(d => d.ScopeId)
                .HasConstraintName("FK_Memories_MemoryScopes");

            entity.HasOne(d => d.SourceChat).WithMany(p => p.Memories)
                .HasForeignKey(d => d.SourceChatId)
                .HasConstraintName("FK_Memories_SourceChat");

            entity.HasOne(d => d.User).WithMany(p => p.Memories)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Memories_Users");
        });

        modelBuilder.Entity<MemoryEmbeddings>(entity =>
        {
            entity.HasKey(e => e.EmbeddingId);

            entity.HasIndex(e => e.MemoryId, "IX_MemoryEmbeddings_MemoryId");

            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_MemoryEmbeddings_CreatedAt");
            entity.Property(e => e.Model).HasMaxLength(150);

            entity.HasOne(d => d.Memory).WithMany(p => p.MemoryEmbeddings)
                .HasForeignKey(d => d.MemoryId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_MemoryEmbeddings_Memories");
        });

        modelBuilder.Entity<MemoryScopes>(entity =>
        {
            entity.HasKey(e => e.ScopeId);

            entity.HasIndex(e => e.ProjectId, "IX_MemoryScopes_ProjectId");

            entity.HasIndex(e => new { e.ProjectId, e.ActorId }, "UX_MemoryScopes_ProjectId_ActorId").IsUnique();

            entity.Property(e => e.ActorId).HasMaxLength(128);
            entity.Property(e => e.CreatedAt).HasPrecision(3);
            entity.Property(e => e.UpdatedAt).HasPrecision(3);

            // Phase 1: optional multi-dimensional scope columns
            entity.Property(e => e.UserId).HasMaxLength(256);
            entity.Property(e => e.AgentId).HasMaxLength(256);
            entity.Property(e => e.SessionId).HasMaxLength(256);
            entity.Property(e => e.RunId).HasMaxLength(256);

            entity.HasOne(d => d.Project).WithMany(p => p.MemoryScopes)
                .HasForeignKey(d => d.ProjectId)
                .HasConstraintName("FK_MemoryScopes_Projects");
        });

        // ── Phase 1: Entities ────────────────────────────────────────────────

        modelBuilder.Entity<NamedEntity>(entity =>
        {
            entity.ToTable("Entities");
            entity.HasKey(e => e.EntityId);

            entity.HasIndex(e => e.ProjectId, "IX_Entities_ProjectId");

            entity.HasIndex(e => new { e.ProjectId, e.NormalizedName }, "UX_Entities_ProjectId_NormalizedName").IsUnique();

            entity.Property(e => e.NormalizedName).HasMaxLength(256);
            entity.Property(e => e.DisplayName).HasMaxLength(256);
            entity.Property(e => e.EntityType).HasMaxLength(64);
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())");
            entity.Property(e => e.UpdatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())");

            entity.HasOne(d => d.Project).WithMany(p => p.Entities)
                .HasForeignKey(d => d.ProjectId)
                .HasConstraintName("FK_Entities_Projects");
        });

        // ── Phase 1: MemoryEntities ──────────────────────────────────────────

        modelBuilder.Entity<MemoryEntities>(entity =>
        {
            entity.HasKey(e => e.MemoryEntityId);

            entity.HasIndex(e => e.MemoryId, "IX_MemoryEntities_MemoryId");
            entity.HasIndex(e => e.EntityId, "IX_MemoryEntities_EntityId");
            entity.HasIndex(e => new { e.MemoryId, e.EntityId }, "UX_MemoryEntities_MemoryId_EntityId").IsUnique();

            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())");

            entity.HasOne(d => d.Memory).WithMany(p => p.MemoryEntities)
                .HasForeignKey(d => d.MemoryId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_MemoryEntities_Memories");

            entity.HasOne(d => d.Entity).WithMany(p => p.MemoryEntities)
                .HasForeignKey(d => d.EntityId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_MemoryEntities_Entities");
        });

        // ── Phase 2: EntityRelationships & RelationshipEvidence ─────────────

        modelBuilder.Entity<EntityRelationship>(entity =>
        {
            entity.ToTable("EntityRelationships");
            entity.HasKey(e => e.RelationshipId);

            entity.HasIndex(e => e.ProjectId, "IX_EntityRelationships_ProjectId");
            entity.HasIndex(e => e.ScopeId, "IX_EntityRelationships_ScopeId");
            entity.HasIndex(e => e.SourceEntityId, "IX_EntityRelationships_SourceEntityId");
            entity.HasIndex(e => e.TargetEntityId, "IX_EntityRelationships_TargetEntityId");

            entity.HasIndex(e => new { e.ScopeId, e.SourceEntityId, e.TargetEntityId, e.RelationshipType },
                "UX_EntityRelationships_Scope_Source_Target_Type").IsUnique();

            entity.Property(e => e.RelationshipType).HasMaxLength(128);
            entity.Property(e => e.Confidence).HasDefaultValue(1.0);
            entity.Property(e => e.CreatedAt).HasPrecision(3).HasDefaultValueSql("(sysutcdatetime())");
            entity.Property(e => e.UpdatedAt).HasPrecision(3).HasDefaultValueSql("(sysutcdatetime())");

            entity.HasOne(d => d.Project).WithMany()
                .HasForeignKey(d => d.ProjectId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_EntityRelationships_Projects");

            entity.HasOne(d => d.Scope).WithMany(p => p.EntityRelationships)
                .HasForeignKey(d => d.ScopeId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_EntityRelationships_MemoryScopes");

            entity.HasOne(d => d.SourceEntity).WithMany(p => p.SourceRelationships)
                .HasForeignKey(d => d.SourceEntityId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_EntityRelationships_SourceEntity");

            entity.HasOne(d => d.TargetEntity).WithMany(p => p.TargetRelationships)
                .HasForeignKey(d => d.TargetEntityId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_EntityRelationships_TargetEntity");
        });

        modelBuilder.Entity<RelationshipEvidence>(entity =>
        {
            entity.ToTable("RelationshipEvidence");
            entity.HasKey(e => e.EvidenceId);

            entity.HasIndex(e => e.RelationshipId, "IX_RelationshipEvidence_RelationshipId");
            entity.HasIndex(e => e.MemoryId, "IX_RelationshipEvidence_MemoryId");
            entity.HasIndex(e => new { e.RelationshipId, e.MemoryId },
                "UX_RelationshipEvidence_Relationship_Memory").IsUnique();

            entity.Property(e => e.CreatedAt).HasPrecision(3).HasDefaultValueSql("(sysutcdatetime())");

            entity.HasOne(d => d.Relationship).WithMany(p => p.Evidence)
                .HasForeignKey(d => d.RelationshipId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK_RelationshipEvidence_EntityRelationships");

            entity.HasOne(d => d.Memory).WithMany(p => p.RelationshipEvidence)
                .HasForeignKey(d => d.MemoryId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK_RelationshipEvidence_Memories");
        });

        // ── Phase 3: MemoryCategories ────────────────────────────────────────
        modelBuilder.Entity<MemoryCategory>(entity =>
        {
            entity.ToTable("MemoryCategories");
            entity.HasKey(e => e.MemoryCategoryId);

            entity.HasIndex(e => e.MemoryId, "IX_MemoryCategories_MemoryId");
            entity.HasIndex(e => e.Category, "IX_MemoryCategories_Category");
            entity.HasIndex(e => new { e.MemoryId, e.Category }, "UX_MemoryCategories_Memory_Category").IsUnique();

            entity.Property(e => e.Category).HasMaxLength(64);
            entity.Property(e => e.CreatedAt).HasPrecision(3).HasDefaultValueSql("(sysutcdatetime())");

            entity.HasOne(d => d.Memory).WithMany(p => p.MemoryCategories)
                .HasForeignKey(d => d.MemoryId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK_MemoryCategories_Memories");
        });

        modelBuilder.Entity<MemorySettingHistory>(entity =>
        {
            entity.HasIndex(e => new { e.UserId, e.ChangedAt }, "IX_MemorySettingHistory_UserId_ChangedAt").IsDescending(false, true);

            entity.Property(e => e.Action).HasMaxLength(20);
            entity.Property(e => e.ChangedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_MemorySettingHistory_ChangedAt");

            entity.HasOne(d => d.User).WithMany(p => p.MemorySettingHistory)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_MemorySettingHistory_Users");
        });

        modelBuilder.Entity<MemoryVersions>(entity =>
        {
            entity.HasKey(e => e.MemoryVersionId);

            entity.HasIndex(e => e.MemoryId, "IX_MemoryVersions_MemoryId");

            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_MemoryVersions_CreatedAt");
            entity.Property(e => e.Operation).HasMaxLength(30);

            entity.HasOne(d => d.Memory).WithMany(p => p.MemoryVersions)
                .HasForeignKey(d => d.MemoryId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_MemoryVersions_Memories");
        });

        modelBuilder.Entity<Messages>(entity =>
        {
            entity.HasKey(e => e.MessageId);

            entity.HasIndex(e => e.ChatId, "IX_Messages_ChatId");

            entity.HasIndex(e => e.ExternalMessageId, "IX_Messages_ExternalMessageId");

            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_Messages_CreatedAt");
            entity.Property(e => e.ExternalMessageId).HasMaxLength(200);
            entity.Property(e => e.Role).HasMaxLength(30);
            entity.Property(e => e.UpdatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_Messages_UpdatedAt");

            entity.HasOne(d => d.Chat).WithMany(p => p.Messages)
                .HasForeignKey(d => d.ChatId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Messages_Chats");
        });

        modelBuilder.Entity<Projects>(entity =>
        {
            entity.HasKey(e => e.ProjectId);

            entity.HasIndex(e => e.UserId, "IX_Projects_UserId");

            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_Projects_CreatedAt");
            entity.Property(e => e.Name).HasMaxLength(200);
            entity.Property(e => e.UpdatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_Projects_UpdatedAt");

            entity.HasOne(d => d.User).WithMany(p => p.Projects)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_Projects_Users");
        });

        modelBuilder.Entity<RefreshTokens>(entity =>
        {
            entity.HasKey(e => e.RefreshTokenId);

            entity.HasIndex(e => e.TokenHash, "UQ_RefreshTokens_TokenHash").IsUnique();

            entity.Property(e => e.TokenHash).HasMaxLength(128);

            entity.HasOne(d => d.ReplacedByToken).WithMany(p => p.InverseReplacedByToken)
                .HasForeignKey(d => d.ReplacedByTokenId)
                .HasConstraintName("FK_RefreshTokens_ReplacedBy");

            entity.HasOne(d => d.User).WithMany(p => p.RefreshTokens)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_RefreshTokens_Users");
        });

        modelBuilder.Entity<UserMemorySettings>(entity =>
        {
            entity.HasKey(e => e.UserId);

            entity.Property(e => e.UserId).ValueGeneratedNever();
            entity.Property(e => e.DisabledAt).HasPrecision(3);
            entity.Property(e => e.EnabledAt).HasPrecision(3);
            entity.Property(e => e.IsEnabled).HasDefaultValue(true, "DF_UserMemorySettings_IsEnabled");
            entity.Property(e => e.UpdatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_UserMemorySettings_UpdatedAt");

            entity.HasOne(d => d.User).WithOne(p => p.UserMemorySettings)
                .HasForeignKey<UserMemorySettings>(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK_UserMemorySettings_Users");
        });

        modelBuilder.Entity<Users>(entity =>
        {
            entity.HasKey(e => e.UserId);

            entity.HasIndex(e => e.Email, "UQ_Users_Email").IsUnique();

            entity.Property(e => e.AccountStatus).HasDefaultValue((byte)1, "DF_Users_AccountStatus");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_Users_CreatedAt");
            entity.Property(e => e.Email).HasMaxLength(320);
            entity.Property(e => e.LastLoginAt).HasPrecision(3);
            entity.Property(e => e.PasswordHash).HasMaxLength(500);
            entity.Property(e => e.UpdatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysutcdatetime())", "DF_Users_UpdatedAt");
        });

        OnModelCreatingPartial(modelBuilder);
    }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
}
