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

    public virtual DbSet<Chats> Chats { get; set; }

    public virtual DbSet<Memories> Memories { get; set; }

    public virtual DbSet<MemoryEmbeddings> MemoryEmbeddings { get; set; }

    public virtual DbSet<MemorySettingHistory> MemorySettingHistory { get; set; }

    public virtual DbSet<MemoryVersions> MemoryVersions { get; set; }

    public virtual DbSet<Messages> Messages { get; set; }

    public virtual DbSet<Projects> Projects { get; set; }

    public virtual DbSet<UserMemorySettings> UserMemorySettings { get; set; }

    public virtual DbSet<Users> Users { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
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
