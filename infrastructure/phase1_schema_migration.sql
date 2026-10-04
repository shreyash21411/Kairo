-- =============================================================================
-- Kairo Phase 1 Schema Migration
-- Purpose: Extend MemoryScopes for multi-dimensional scope support,
--          add Entities and MemoryEntities tables for entity extraction.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend MemoryScopes with optional scope dimension columns
--    V1 backward compat: all new columns are nullable.
--    The existing (ProjectId, ActorId) unique index is PRESERVED as-is.
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MemoryScopes') AND name = 'UserId')
    ALTER TABLE MemoryScopes ADD UserId NVARCHAR(256) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MemoryScopes') AND name = 'AgentId')
    ALTER TABLE MemoryScopes ADD AgentId NVARCHAR(256) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MemoryScopes') AND name = 'SessionId')
    ALTER TABLE MemoryScopes ADD SessionId NVARCHAR(256) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MemoryScopes') AND name = 'RunId')
    ALTER TABLE MemoryScopes ADD RunId NVARCHAR(256) NULL;

-- Index to support efficient lookup of the new multi-dimensional scope key
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('MemoryScopes') AND name = 'IX_MemoryScopes_MultiDim')
    CREATE INDEX IX_MemoryScopes_MultiDim
        ON MemoryScopes (ProjectId, UserId, AgentId, SessionId, RunId);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Entities table
--    Stores normalized extracted entities scoped to a project.
--    Deduplication key: (ProjectId, NormalizedName)
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Entities')
BEGIN
    CREATE TABLE Entities (
        EntityId        BIGINT IDENTITY(1,1) NOT NULL,
        ProjectId       BIGINT NOT NULL,
        NormalizedName  NVARCHAR(256) NOT NULL,
        DisplayName     NVARCHAR(256) NOT NULL,
        EntityType      NVARCHAR(64)  NOT NULL,
        CreatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_Entities PRIMARY KEY (EntityId),
        CONSTRAINT FK_Entities_Projects FOREIGN KEY (ProjectId)
            REFERENCES Projects(ProjectId),
        CONSTRAINT UX_Entities_ProjectId_NormalizedName
            UNIQUE (ProjectId, NormalizedName)
    );

    CREATE INDEX IX_Entities_ProjectId ON Entities (ProjectId);
END

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. MemoryEntities junction table
--    Many-to-many: Memory <-> Entity
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MemoryEntities')
BEGIN
    CREATE TABLE MemoryEntities (
        MemoryEntityId  BIGINT IDENTITY(1,1) NOT NULL,
        MemoryId        BIGINT NOT NULL,
        EntityId        BIGINT NOT NULL,
        CreatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_MemoryEntities PRIMARY KEY (MemoryEntityId),
        CONSTRAINT FK_MemoryEntities_Memories FOREIGN KEY (MemoryId)
            REFERENCES Memories(MemoryId),
        CONSTRAINT FK_MemoryEntities_Entities FOREIGN KEY (EntityId)
            REFERENCES Entities(EntityId),
        CONSTRAINT UX_MemoryEntities_MemoryId_EntityId
            UNIQUE (MemoryId, EntityId)
    );

    CREATE INDEX IX_MemoryEntities_MemoryId ON MemoryEntities (MemoryId);
    CREATE INDEX IX_MemoryEntities_EntityId ON MemoryEntities (EntityId);
END

PRINT 'Kairo Phase 1 schema migration complete.';
