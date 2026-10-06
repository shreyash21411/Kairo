-- =============================================================================
-- Kairo Phase 2 Schema Migration
-- Purpose:
--   1. Add OccurredAt and Metadata columns to Memories table (Temporal & Metadata).
--   2. Add EntityRelationships table for Graph Memory (strictly scoped).
--   3. Add RelationshipEvidence junction table for graph provenance.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend Memories table
--    OccurredAt: nullable event/fact occurrence timestamp.
--    Metadata:   nullable JSON string representing arbitrary application metadata.
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Memories') AND name = 'OccurredAt')
BEGIN
    ALTER TABLE Memories ADD OccurredAt DATETIME2(3) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Memories') AND name = 'Metadata')
BEGIN
    ALTER TABLE Memories ADD Metadata NVARCHAR(MAX) NULL;
END

-- Supporting indexes for temporal filtering
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Memories') AND name = 'IX_Memories_OccurredAt')
BEGIN
    CREATE INDEX IX_Memories_OccurredAt ON Memories (OccurredAt);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Memories') AND name = 'IX_Memories_CreatedAt')
BEGIN
    CREATE INDEX IX_Memories_CreatedAt ON Memories (CreatedAt);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Memories') AND name = 'IX_Memories_UpdatedAt')
BEGIN
    CREATE INDEX IX_Memories_UpdatedAt ON Memories (UpdatedAt);
END

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. EntityRelationships table
--    Stores directional relationships between named entities within a project
--    and scoped to a specific MemoryScope.
--    Deduplication key: (ScopeId, SourceEntityId, TargetEntityId, RelationshipType)
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'EntityRelationships')
BEGIN
    CREATE TABLE EntityRelationships (
        RelationshipId    BIGINT IDENTITY(1,1) NOT NULL,
        ProjectId         BIGINT NOT NULL,
        ScopeId           BIGINT NOT NULL,
        SourceEntityId    BIGINT NOT NULL,
        TargetEntityId    BIGINT NOT NULL,
        RelationshipType  NVARCHAR(128) NOT NULL,
        Confidence        FLOAT NOT NULL DEFAULT 1.0,
        CreatedAt         DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt         DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_EntityRelationships PRIMARY KEY (RelationshipId),
        CONSTRAINT FK_EntityRelationships_Projects FOREIGN KEY (ProjectId)
            REFERENCES Projects(ProjectId),
        CONSTRAINT FK_EntityRelationships_MemoryScopes FOREIGN KEY (ScopeId)
            REFERENCES MemoryScopes(ScopeId),
        CONSTRAINT FK_EntityRelationships_SourceEntity FOREIGN KEY (SourceEntityId)
            REFERENCES Entities(EntityId),
        CONSTRAINT FK_EntityRelationships_TargetEntity FOREIGN KEY (TargetEntityId)
            REFERENCES Entities(EntityId),
        CONSTRAINT UX_EntityRelationships_Scope_Source_Target_Type
            UNIQUE (ScopeId, SourceEntityId, TargetEntityId, RelationshipType)
    );

    CREATE INDEX IX_EntityRelationships_ProjectId ON EntityRelationships (ProjectId);
    CREATE INDEX IX_EntityRelationships_ScopeId ON EntityRelationships (ScopeId);
    CREATE INDEX IX_EntityRelationships_SourceEntityId ON EntityRelationships (SourceEntityId);
    CREATE INDEX IX_EntityRelationships_TargetEntityId ON EntityRelationships (TargetEntityId);
END

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RelationshipEvidence junction table
--    Tracks provenance: connects an EntityRelationship to the specific Memory
--    records that provide evidence for it.
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RelationshipEvidence')
BEGIN
    CREATE TABLE RelationshipEvidence (
        EvidenceId        BIGINT IDENTITY(1,1) NOT NULL,
        RelationshipId    BIGINT NOT NULL,
        MemoryId          BIGINT NOT NULL,
        CreatedAt         DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_RelationshipEvidence PRIMARY KEY (EvidenceId),
        CONSTRAINT FK_RelationshipEvidence_EntityRelationships FOREIGN KEY (RelationshipId)
            REFERENCES EntityRelationships(RelationshipId) ON DELETE CASCADE,
        CONSTRAINT FK_RelationshipEvidence_Memories FOREIGN KEY (MemoryId)
            REFERENCES Memories(MemoryId) ON DELETE CASCADE,
        CONSTRAINT UX_RelationshipEvidence_Relationship_Memory
            UNIQUE (RelationshipId, MemoryId)
    );

    CREATE INDEX IX_RelationshipEvidence_RelationshipId ON RelationshipEvidence (RelationshipId);
    CREATE INDEX IX_RelationshipEvidence_MemoryId ON RelationshipEvidence (MemoryId);
END

PRINT 'Kairo Phase 2 schema migration complete.';
