-- =============================================================================
-- Kairo Phase 4A Schema Migration
-- Purpose:
--   1. Create MemoryIngestionJobs table for durable background memory processing.
--   2. Supporting indexes for atomic claiming, worker concurrency, and lookups.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MemoryIngestionJobs')
BEGIN
    CREATE TABLE MemoryIngestionJobs (
        JobId           UNIQUEIDENTIFIER NOT NULL,
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
END

PRINT 'Kairo Phase 4A schema migration complete.';
