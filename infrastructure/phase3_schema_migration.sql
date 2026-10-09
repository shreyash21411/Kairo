-- =============================================================================
-- Kairo Phase 3 Schema Migration
-- Purpose:
--   1. Add ExpiresAt column to Memories table (Expiration / TTL).
--   2. Add MemoryCategories table for extensible, normalized, multi-valued categories.
--   3. Supporting indexes for ExpiresAt, category lookups, and batch operations.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend Memories table with ExpiresAt
--    ExpiresAt: nullable UTC timestamp after which the memory is considered expired.
--    NULL means no expiration.
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Memories') AND name = 'ExpiresAt')
BEGIN
    ALTER TABLE Memories ADD ExpiresAt DATETIME2(3) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Memories') AND name = 'IX_Memories_ExpiresAt')
BEGIN
    CREATE INDEX IX_Memories_ExpiresAt ON Memories (ExpiresAt);
END

-- Composite index for fast active & unexpired memory lookups
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Memories') AND name = 'IX_Memories_Active_ExpiresAt')
BEGIN
    CREATE INDEX IX_Memories_Active_ExpiresAt ON Memories (UserId, IsActive, ExpiresAt);
END

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. MemoryCategories table
--    Stores normalized categories assigned to a memory.
--    A memory can have 0, 1, or multiple categories.
--    Deduplication key: (MemoryId, Category)
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MemoryCategories')
BEGIN
    CREATE TABLE MemoryCategories (
        MemoryCategoryId  BIGINT IDENTITY(1,1) NOT NULL,
        MemoryId          BIGINT NOT NULL,
        Category          NVARCHAR(64) NOT NULL,
        CreatedAt         DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_MemoryCategories PRIMARY KEY (MemoryCategoryId),
        CONSTRAINT FK_MemoryCategories_Memories FOREIGN KEY (MemoryId)
            REFERENCES Memories(MemoryId) ON DELETE CASCADE,
        CONSTRAINT UX_MemoryCategories_Memory_Category UNIQUE (MemoryId, Category)
    );

    CREATE INDEX IX_MemoryCategories_MemoryId ON MemoryCategories (MemoryId);
    CREATE INDEX IX_MemoryCategories_Category ON MemoryCategories (Category);
END

PRINT 'Kairo Phase 3 schema migration complete.';
