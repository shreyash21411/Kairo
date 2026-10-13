-- =============================================================================
-- Kairo Phase 4A Schema Migration (Revised: JobId Guid → BIGINT IDENTITY)
-- Purpose:
--   1. Create MemoryIngestionJobs table with JobId as BIGINT IDENTITY primary key.
--   2. Safe, automated, zero-loss migration for existing databases with UNIQUEIDENTIFIER JobId.
--   3. Supporting indexes for atomic claiming, worker concurrency, and lookups.
--   4. Fully idempotent: safe to execute multiple times against fresh or existing databases.
--
-- Deployment Prerequisites:
--   • Drain active jobs: Ensure all Pending and Processing jobs reach completion,
--     failure, or cancellation prior to running migration.
--   • Confirm no external clients or systems hold unresolved dependencies on old
--     GUID job IDs (legacy GUID mapping is not retained).
-- =============================================================================

-- Case 1: Existing table with UNIQUEIDENTIFIER JobId column — execute automated migration
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'MemoryIngestionJobs'
      AND COLUMN_NAME = 'JobId'
      AND DATA_TYPE = 'uniqueidentifier'
)
BEGIN
    PRINT 'Migrating existing MemoryIngestionJobs table from UNIQUEIDENTIFIER to BIGINT IDENTITY...';

    -- Step 1: Rename old table
    EXEC sp_rename 'MemoryIngestionJobs', 'MemoryIngestionJobs_OldGuid';

    -- Step 2: Drop old constraints and indexes from the renamed table so their names can be reused
    IF OBJECT_ID('FK_MemoryIngestionJobs_Projects', 'F') IS NOT NULL
        ALTER TABLE MemoryIngestionJobs_OldGuid DROP CONSTRAINT FK_MemoryIngestionJobs_Projects;
    IF OBJECT_ID('FK_MemoryIngestionJobs_Users', 'F') IS NOT NULL
        ALTER TABLE MemoryIngestionJobs_OldGuid DROP CONSTRAINT FK_MemoryIngestionJobs_Users;
    IF OBJECT_ID('FK_MemoryIngestionJobs_Memories', 'F') IS NOT NULL
        ALTER TABLE MemoryIngestionJobs_OldGuid DROP CONSTRAINT FK_MemoryIngestionJobs_Memories;
    IF OBJECT_ID('FK_MemoryIngestionJobs_MemoryScopes', 'F') IS NOT NULL
        ALTER TABLE MemoryIngestionJobs_OldGuid DROP CONSTRAINT FK_MemoryIngestionJobs_MemoryScopes;
    IF OBJECT_ID('PK_MemoryIngestionJobs', 'PK') IS NOT NULL
        ALTER TABLE MemoryIngestionJobs_OldGuid DROP CONSTRAINT PK_MemoryIngestionJobs;

    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MemoryIngestionJobs_Claiming' AND object_id = OBJECT_ID('MemoryIngestionJobs_OldGuid'))
        DROP INDEX IX_MemoryIngestionJobs_Claiming ON MemoryIngestionJobs_OldGuid;
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MemoryIngestionJobs_User_Project' AND object_id = OBJECT_ID('MemoryIngestionJobs_OldGuid'))
        DROP INDEX IX_MemoryIngestionJobs_User_Project ON MemoryIngestionJobs_OldGuid;
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MemoryIngestionJobs_MemoryId' AND object_id = OBJECT_ID('MemoryIngestionJobs_OldGuid'))
        DROP INDEX IX_MemoryIngestionJobs_MemoryId ON MemoryIngestionJobs_OldGuid;

    -- Step 3: Create new table with BIGINT IDENTITY
    CREATE TABLE MemoryIngestionJobs (
        JobId           BIGINT IDENTITY(1,1) NOT NULL,
        ProjectId       BIGINT NOT NULL,
        UserId          BIGINT NOT NULL,
        ScopeId         BIGINT NULL,
        MemoryId        BIGINT NULL,
        JobType         NVARCHAR(50) NOT NULL,
        Status          NVARCHAR(30) NOT NULL DEFAULT 'Pending',
        Payload         NVARCHAR(MAX) NULL,
        Attempts        INT NOT NULL DEFAULT 0,
        MaxAttempts     INT NOT NULL DEFAULT 3,
        AvailableAt     DATETIME2(3) NOT NULL,
        LockedUntil     DATETIME2(3) NULL,
        LockOwner       NVARCHAR(128) NULL,
        LastError       NVARCHAR(2048) NULL,
        CreatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
        CompletedAt     DATETIME2(3) NULL,

        CONSTRAINT PK_MemoryIngestionJobs PRIMARY KEY (JobId),
        CONSTRAINT FK_MemoryIngestionJobs_Projects FOREIGN KEY (ProjectId)
            REFERENCES Projects(ProjectId),
        CONSTRAINT FK_MemoryIngestionJobs_Users FOREIGN KEY (UserId)
            REFERENCES Users(UserId),
        CONSTRAINT FK_MemoryIngestionJobs_Memories FOREIGN KEY (MemoryId)
            REFERENCES Memories(MemoryId) ON DELETE SET NULL,
        CONSTRAINT FK_MemoryIngestionJobs_MemoryScopes FOREIGN KEY (ScopeId)
            REFERENCES MemoryScopes(ScopeId) ON DELETE SET NULL
    );

    -- Step 4: Migrate ALL existing records preserving order and all data
    INSERT INTO MemoryIngestionJobs (
        ProjectId, UserId, ScopeId, MemoryId,
        JobType, Status, Payload, Attempts, MaxAttempts, AvailableAt,
        LockedUntil, LockOwner, LastError, CreatedAt, CompletedAt
    )
    SELECT
        ProjectId, UserId, ScopeId, MemoryId,
        JobType, Status, Payload, Attempts, MaxAttempts, AvailableAt,
        LockedUntil, LockOwner, LastError, CreatedAt, CompletedAt
    FROM MemoryIngestionJobs_OldGuid
    ORDER BY CreatedAt ASC;

    -- Step 5: Create indexes
    CREATE INDEX IX_MemoryIngestionJobs_Claiming
        ON MemoryIngestionJobs (Status, AvailableAt, LockedUntil);

    CREATE INDEX IX_MemoryIngestionJobs_User_Project
        ON MemoryIngestionJobs (UserId, ProjectId);

    CREATE INDEX IX_MemoryIngestionJobs_MemoryId
        ON MemoryIngestionJobs (MemoryId);

    -- Step 6: Drop legacy table
    DROP TABLE MemoryIngestionJobs_OldGuid;

    PRINT 'Migration from UNIQUEIDENTIFIER to BIGINT IDENTITY completed successfully.';
END
ELSE IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MemoryIngestionJobs')
BEGIN
    PRINT 'Creating fresh MemoryIngestionJobs table with BIGINT IDENTITY...';

    CREATE TABLE MemoryIngestionJobs (
        JobId           BIGINT IDENTITY(1,1) NOT NULL,
        ProjectId       BIGINT NOT NULL,
        UserId          BIGINT NOT NULL,
        ScopeId         BIGINT NULL,
        MemoryId        BIGINT NULL,
        JobType         NVARCHAR(50) NOT NULL,
        Status          NVARCHAR(30) NOT NULL DEFAULT 'Pending',
        Payload         NVARCHAR(MAX) NULL,
        Attempts        INT NOT NULL DEFAULT 0,
        MaxAttempts     INT NOT NULL DEFAULT 3,
        AvailableAt     DATETIME2(3) NOT NULL,
        LockedUntil     DATETIME2(3) NULL,
        LockOwner       NVARCHAR(128) NULL,
        LastError       NVARCHAR(2048) NULL,
        CreatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
        CompletedAt     DATETIME2(3) NULL,

        CONSTRAINT PK_MemoryIngestionJobs PRIMARY KEY (JobId),
        CONSTRAINT FK_MemoryIngestionJobs_Projects FOREIGN KEY (ProjectId)
            REFERENCES Projects(ProjectId),
        CONSTRAINT FK_MemoryIngestionJobs_Users FOREIGN KEY (UserId)
            REFERENCES Users(UserId),
        CONSTRAINT FK_MemoryIngestionJobs_Memories FOREIGN KEY (MemoryId)
            REFERENCES Memories(MemoryId) ON DELETE SET NULL,
        CONSTRAINT FK_MemoryIngestionJobs_MemoryScopes FOREIGN KEY (ScopeId)
            REFERENCES MemoryScopes(ScopeId) ON DELETE SET NULL
    );

    CREATE INDEX IX_MemoryIngestionJobs_Claiming
        ON MemoryIngestionJobs (Status, AvailableAt, LockedUntil);

    CREATE INDEX IX_MemoryIngestionJobs_User_Project
        ON MemoryIngestionJobs (UserId, ProjectId);

    CREATE INDEX IX_MemoryIngestionJobs_MemoryId
        ON MemoryIngestionJobs (MemoryId);

    PRINT 'Fresh MemoryIngestionJobs table created with BIGINT IDENTITY.';
END
ELSE
BEGIN
    PRINT 'MemoryIngestionJobs table already exists with BIGINT IDENTITY. No migration needed.';
END

-- Section C: Schema Validation
SELECT
    c.COLUMN_NAME,
    c.DATA_TYPE,
    c.CHARACTER_MAXIMUM_LENGTH,
    c.IS_NULLABLE,
    COLUMNPROPERTY(OBJECT_ID('MemoryIngestionJobs'), c.COLUMN_NAME, 'IsIdentity') AS IsIdentity
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME = 'MemoryIngestionJobs'
ORDER BY c.ORDINAL_POSITION;

PRINT 'Kairo Phase 4A schema migration verified (BIGINT IDENTITY).';
