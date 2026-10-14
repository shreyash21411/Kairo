-- ============================================================
-- Kairo Phase 5.8: Usage Metering Schema — SQL Server
-- ============================================================
-- Additive-only: no existing tables are altered.
-- Safe to run on an existing kairo_dev database.
-- Run as: sqlcmd -S <server> -d kairo_dev -i phase5_usage_schema_sqlserver.sql
-- ============================================================

-- ── UsageLedger ─────────────────────────────────────────────
IF OBJECT_ID('dbo.UsageLedger', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UsageLedger (
        EntryId       BIGINT        IDENTITY(1,1) NOT NULL,
        UserId        BIGINT        NOT NULL,
        ProjectId     BIGINT        NOT NULL,
        OperationType NVARCHAR(50)  NOT NULL,
        Outcome       NVARCHAR(20)  NOT NULL CONSTRAINT DF_UsageLedger_Outcome DEFAULT ('Success'),
        OccurredAt    DATETIME2(3)  NOT NULL,
        UnitCount     INT           NOT NULL CONSTRAINT DF_UsageLedger_UnitCount DEFAULT (1),
        TokensUsed    INT           NULL,

        CONSTRAINT PK_UsageLedger PRIMARY KEY CLUSTERED (EntryId),

        CONSTRAINT FK_UsageLedger_Users
            FOREIGN KEY (UserId) REFERENCES dbo.Users (UserId),

        CONSTRAINT FK_UsageLedger_Projects
            FOREIGN KEY (ProjectId) REFERENCES dbo.Projects (ProjectId)
    );

    -- Time-windowed per-project aggregation (most common access pattern).
    CREATE NONCLUSTERED INDEX IX_UsageLedger_Project_OccurredAt
        ON dbo.UsageLedger (ProjectId, OccurredAt);

    CREATE NONCLUSTERED INDEX IX_UsageLedger_User_OccurredAt
        ON dbo.UsageLedger (UserId, OccurredAt);

    -- Quota enforcement lookups include OperationType filter.
    CREATE NONCLUSTERED INDEX IX_UsageLedger_Project_Op_OccurredAt
        ON dbo.UsageLedger (ProjectId, OperationType, OccurredAt);

    PRINT 'Created table dbo.UsageLedger with indexes.';
END
ELSE
    PRINT 'Table dbo.UsageLedger already exists — skipped.';
GO

-- ── ProjectQuotas ────────────────────────────────────────────
IF OBJECT_ID('dbo.ProjectQuotas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProjectQuotas (
        ProjectId              BIGINT       NOT NULL,
        MaxOperationsPerMinute INT          NULL,
        MaxOperationsPerDay    INT          NULL,
        MaxTotalMemories       INT          NULL,
        MaxBatchSize           INT          NULL,
        UpdatedAt              DATETIME2(3) NOT NULL CONSTRAINT DF_ProjectQuotas_UpdatedAt DEFAULT (sysutcdatetime()),

        CONSTRAINT PK_ProjectQuotas PRIMARY KEY CLUSTERED (ProjectId),

        CONSTRAINT FK_ProjectQuotas_Projects
            FOREIGN KEY (ProjectId) REFERENCES dbo.Projects (ProjectId)
    );

    PRINT 'Created table dbo.ProjectQuotas.';
END
ELSE
    PRINT 'Table dbo.ProjectQuotas already exists — skipped.';
GO
