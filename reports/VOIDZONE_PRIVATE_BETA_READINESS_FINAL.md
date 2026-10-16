# VOIDZONE — END-TO-END POSTGRESQL PRODUCTION READINESS & PRIVATE BETA REPORT

**Document ID:** `VOIDZONE-PROD-BETA-FINAL-001`  
**Date:** 2026-10-16  
**Auditor:** Antigravity (Advanced Agentic Pair Programmer)  
**Target Platform:** VoidZone Private Beta (3–5 concurrent users, single API instance)  
**Target Database:** Neon Managed PostgreSQL 17.11 + pgvector 0.8.0 (AWS Asia Pacific, Singapore / `ap-southeast-1`)  
**Project Identifier:** `voidzone-production-asia`  
**Repository:** `F:\AI-Memory-Platform`  
**Working Branch:** `Shrey`  
**Base Commit (HEAD):** `dc7109411406787548c4ca2a27a4116ea2d831d7`  
**Safety Protocol:** Strict Read-Only Database Protocol (Zero remote/local database connections, zero SQL executions against live engines, zero git state modifications).

---

## 1. Executive Verdict

### **VERDICT: READY FOR BETA DEPLOYMENT AFTER HUMAN APPROVAL**

The VoidZone backend application and PostgreSQL 17 schema scripts have been verified through deep source code inspection, architecture tracing, and 677 passing offline tests across three software stacks (.NET, Python, Node).

* **Proven Code Readiness:** The two confirmed production-blocking defects—PostgreSQL unique constraint violation handling ([DB-001](file:///f:/AI-Memory-Platform/reports/VOIDZONE_POSTGRESQL_PRODUCTION_READINESS_AUDIT.md#L390)) and timestamp type consistency in usage metering ([DB-003](file:///f:/AI-Memory-Platform/reports/VOIDZONE_POSTGRESQL_PRODUCTION_READINESS_AUDIT.md#L394))—have been resolved with minimal, encapsulated, and fully validated implementations.
* **Dual Database Agnosticism:** SQL Server functionality, exception handling contracts, and backward compatibility remain 100% intact.
* **Testing Reality:** **No live PostgreSQL integration test has been performed.** All verification was conducted strictly offline using unit tests, in-memory providers, and mock layers in compliance with the absolute safety rules. Live behavior against Neon must be verified during the human-approved deployment preflight.

---

## 2. Initial vs. Final Repository State

### Initial Repository State
* **Commit:** `dc7109411406787548c4ca2a27a4116ea2d831d7` (`feat(phase6): finalize Kairo V1 hardening and release readiness`)
* **Working Tree:** Clean tracked state with existing audit report `reports/VOIDZONE_POSTGRESQL_PRODUCTION_READINESS_AUDIT.md`.
* **Benchmark File Hash (`docs/phase6/benchmark/benchmark_results_v1.json`):** `572d39cc2fe5b3823eb92d5bd7d284f6657b17b8` (matches `HEAD` exactly).

### Final Repository State
* **Tracked Files Modified (4):**
  1. [`backend/Kairo.Infrastructure/Kairo.Infrastructure.csproj`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Kairo.Infrastructure.csproj): Added `<InternalsVisibleTo Include="Kairo.Tests" />`.
  2. [`backend/Kairo.Infrastructure/Persistence/EfTransactionCoordinator.cs`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/EfTransactionCoordinator.cs): Added `PostgresException` (SQLSTATE `23505`) detection, visibility set to `internal static`.
  3. [`backend/Kairo.Infrastructure/Repositories/AuthenticationIdentityRepository.cs`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Repositories/AuthenticationIdentityRepository.cs): Added `PostgresException` (SQLSTATE `23505`) detection, visibility set to `internal static`.
  4. [`infrastructure/phase5_usage_schema_postgresql.sql`](file:///f:/AI-Memory-Platform/infrastructure/phase5_usage_schema_postgresql.sql): Aligned `OccurredAt` and `UpdatedAt` from `TIMESTAMP(3)` to `TIMESTAMPTZ(3)`.
* **New Untracked Files (2):**
  1. [`backend/Kairo.Tests/PostgreSqlUniqueConstraintHandlingUnitTests.cs`](file:///f:/AI-Memory-Platform/backend/Kairo.Tests/PostgreSqlUniqueConstraintHandlingUnitTests.cs): 11 offline regression unit tests.
  2. [`reports/VOIDZONE_PRIVATE_BETA_READINESS_FINAL.md`](file:///f:/AI-Memory-Platform/reports/VOIDZONE_PRIVATE_BETA_READINESS_FINAL.md): This report.
* **Benchmark File Integrity:** `docs/phase6/benchmark/benchmark_results_v1.json` remains **byte-for-byte identical to HEAD** (Blob Hash: `572d39cc2fe5b3823eb92d5bd7d284f6657b17b8`).
* **Git Hygiene:** Nothing staged, nothing committed, no history altered, zero whitespace errors (`git diff --check` exited with code 0).

---

## 3. Findings Register: Verification & Beta Classification

Every finding from the initial audit report was re-verified against current source code:

| Finding ID | Title | Verified Severity | Beta Classification | Source Evidence | Verdict & Analysis |
|---|---|:---:|:---:|---|---|
| **DB-001** | Unique-constraint handling on PostgreSQL throws 500 instead of 409 | **HIGH** | **Fixed in Beta Code** | [`AuthenticationIdentityRepository.cs:L96`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Repositories/AuthenticationIdentityRepository.cs#L96), [`EfTransactionCoordinator.cs:L66`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/EfTransactionCoordinator.cs#L66) | **Confirmed Defect.** Previously checked only `SqlException`. Npgsql throws `PostgresException` with `SqlState == "23505"`. Fixed to check both; unit tested end-to-end. |
| **DB-003** | `UsageLedger.OccurredAt` and `ProjectQuotas.UpdatedAt` use `TIMESTAMP(3)` | **MEDIUM** | **Fixed in Schema Script** | [`phase5_usage_schema_postgresql.sql:L16, L48`](file:///f:/AI-Memory-Platform/infrastructure/phase5_usage_schema_postgresql.sql#L16) | **Confirmed Schema Discrepancy.** Baseline uses `TIMESTAMPTZ`. `DateTime.UtcNow` in C# produces UTC. Script updated to `TIMESTAMPTZ(3)` prior to initial database run. |
| **CFG-001** | Database provider defaults to `SqlServer` when omitted | **CRITICAL** | **Operational Prerequisite** | [`ProviderConfigurationValidator.cs:L32-36`](file:///f:/AI-Memory-Platform/backend/Kairo.API/Configuration/ProviderConfigurationValidator.cs#L32-L36) | **Confirmed Behavior.** Mandatory hosting env variable `Providers__DatabaseProvider=PostgreSql` required to avoid boot failure. |
| **CFG-002** | PostgreSQL connection string empty by default | **CRITICAL** | **Operational Prerequisite** | [`ProviderConfigurationValidator.cs:L67-78`](file:///f:/AI-Memory-Platform/backend/Kairo.API/Configuration/ProviderConfigurationValidator.cs#L67-L78) | **Confirmed Behavior.** Mandatory env variable `ConnectionStrings__KairoPostgres` required with SSL mode enabled. |
| **CFG-003** | Mistral API keys required for startup | **CRITICAL** | **Operational Prerequisite** | [`ProviderConfigurationValidator.cs:L95, L117`](file:///f:/AI-Memory-Platform/backend/Kairo.API/Configuration/ProviderConfigurationValidator.cs#L95) | **Confirmed Behavior.** Mandatory env variables `Mistral__ApiKey` and `MistralEmbedding__ApiKey` required. |
| **CFG-004** | JWT signing key missing or < 32 characters | **CRITICAL** | **Operational Prerequisite** | [`TokenService.cs:L275-288`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Security/TokenService.cs#L275) | **Confirmed Behavior.** Mandatory env variable `Kairo__Jwt__SigningKey` (>= 32 chars) required. |
| **CFG-005** | CORS allowed origins empty | **HIGH** | **Operational Prerequisite** | [`Program.cs:L238-256`](file:///f:/AI-Memory-Platform/backend/Kairo.API/Program.cs#L238) | **Confirmed Behavior.** Mandatory env variable `Kairo__Cors__AllowedOrigins__0` required to allow frontend requests. |
| **DB-002** | `sysutcdatetime()` defaults in `KairoDbContext` | **MEDIUM** | **Acceptable for Beta** | [`KairoDbContext.cs:L151`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/KairoDbContext.cs#L151) | **Confirmed Limitation.** If EF `EnsureCreated()` or migrations were run, DDL would fail. However, runtime code supplies explicit C# timestamps, and schema is created via SQL scripts. |
| **OPS-001** | Missing `EnableRetryOnFailure()` on Npgsql | **MEDIUM** | **Acceptable for Beta (Intentional)** | [`DatabaseServiceExtensions.cs:L29-35`](file:///f:/AI-Memory-Platform/backend/Kairo.API/Configuration/DatabaseServiceExtensions.cs#L29-L35) | **Confirmed Architectural Conflict.** Enabling `EnableRetryOnFailure` would crash [`TokenService.cs:L133`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Security/TokenService.cs#L133) and [`EntityRepository.cs:L43`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Repositories/EntityRepository.cs#L43) because they use manual transactions without execution strategy. Kept disabled for beta. |
| **DB-004** | In-memory candidate loading + dynamic `TEXT::vector` cast | **MEDIUM** | **Acceptable for Beta** | [`MemoryRepository.cs:L728-738`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Repositories/MemoryRepository.cs#L728-L738) | **Confirmed Design.** Works cleanly for 3–5 users. Future improvement for large-scale production is native `vector(1024)` column with HNSW index. |
| **OPS-002** | In-memory quota semaphore & non-atomic job claiming | **LOW** | **Acceptable for Beta** | [`QuotaEnforcementService.cs:L27`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Services/QuotaEnforcementService.cs#L27), [`IngestionJobRepository.cs:L84`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Repositories/IngestionJobRepository.cs#L84) | **Confirmed Limitation.** Safe for single API instance. Multi-instance scaling will require Redis and `FOR UPDATE SKIP LOCKED`. |
| **DEP-001** | Docker build context must be repository root | **HIGH** | **Operational Prerequisite** | [`Dockerfile:L10-21`](file:///f:/AI-Memory-Platform/Dockerfile#L10-L21) | **Confirmed.** Dockerfile copies `backend/` and needs build context `.`. |
| **DEP-002** | `global.json` SDK version pinning in container | **MEDIUM** | **Confirmed Operational Risk** | [`backend/global.json:L4`](file:///f:/AI-Memory-Platform/backend/global.json#L4) | **Confirmed.** Pins `10.0.400` with `latestFeature`. Docker build image must contain SDK 10.0.4xx or rollForward must be verified. |
| **DEP-003** | `/health` endpoint does not ping database | **LOW** | **Future Improvement** | [`Program.cs:L130, L372`](file:///f:/AI-Memory-Platform/backend/Kairo.API/Program.cs#L130) | **Confirmed.** Liveness check passes even if database is offline. Readiness probe with DB ping recommended post-beta. |
| **SCR-001** | `kairo_dev` permission grant block in baseline script | **LOW** | **Informational** | [`kairo_schema_postgresql_baseline.sql:L468`](file:///f:/AI-Memory-Platform/infrastructure/kairo_schema_postgresql_baseline.sql#L468) | **Harmless.** Guarded by `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kairo_dev')`. Safely evaluates to false on Neon. |
| **SCR-002** | `phase4a_schema_postgresql.sql` is an upgrade migration | **MEDIUM** | **Operational Rule** | [`phase4a_schema_postgresql.sql:L16-37`](file:///f:/AI-Memory-Platform/infrastructure/phase4a_schema_postgresql.sql#L16) | **Skip on Fresh Database.** Baseline already creates `MemoryIngestionJobs` with BIGINT IDENTITY. Running phase4a on fresh DB is redundant and unsafe. |

---

## 4. Fixes Implemented & Rationale

### 1. PostgreSQL Unique-Constraint Violation Handling (DB-001)
* **Problem:** In both `AuthenticationIdentityRepository` and `EfTransactionCoordinator`, unique constraint detection only inspected `ex.InnerException is SqlException sqlEx` checking error numbers `2601` and `2627`. On PostgreSQL, Npgsql throws `Npgsql.PostgresException` with `SqlState == "23505"`. This caused registration conflicts and identity insert races to throw an unhandled `DbUpdateException`, triggering the global exception handler and returning HTTP 500 instead of HTTP 409 Conflict.
* **Correction Applied:**
  - Added `using Npgsql;`
  - Added `PostgresErrorUniqueViolation = PostgresErrorCodes.UniqueViolation;` (`"23505"`).
  - Updated `IsUniqueConstraintViolation(DbUpdateException ex)` to check `pgEx.SqlState == PostgresErrorUniqueViolation`.
  - Encapsulated both methods as `internal static` and added `<InternalsVisibleTo Include="Kairo.Tests" />` in `backend/Kairo.Infrastructure/Kairo.Infrastructure.csproj`.
* **Preservation of Existing Contracts:**
  - SQL Server error numbers `2601` and `2627` continue to be recognized identically.
  - Non-unique errors (foreign keys, table missing, syntax errors) return `false` and propagate unchanged.
  - Call chain verified: `EfTransactionCoordinator` throws `UniqueConstraintViolationException` $\rightarrow$ `AccountService.RegisterAsync` translates to `DuplicateEmailException` $\rightarrow$ `AuthController.Register` maps to `ConflictObjectResult` (HTTP 409).
  - Password migration fallback verified: `AccountService.VerifyPasswordAndMigrateIfNecessaryAsync` catches `UniqueConstraintViolationException` and swallows it so concurrent migrations permit login.

### 2. Timestamp Type Consistency in Usage Schema (DB-003)
* **Problem:** `infrastructure/kairo_schema_postgresql_baseline.sql` defines all 19 baseline tables using `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`. However, `infrastructure/phase5_usage_schema_postgresql.sql` defined `UsageLedger.OccurredAt` and `ProjectQuotas.UpdatedAt` as `TIMESTAMP(3)` (without time zone) and used `(NOW() AT TIME ZONE 'UTC')`.
* **Correction Applied:**
  - Changed `UsageLedger.OccurredAt` from `TIMESTAMP(3)` to `TIMESTAMPTZ(3) NOT NULL`.
  - Changed `ProjectQuotas.UpdatedAt` from `TIMESTAMP(3)` to `TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`.
* **Rationale:**
  - Application code (`UsageMeterService.cs:L76`, `QuotaEnforcementService.cs:L71`) explicitly uses `DateTime.UtcNow` (`DateTimeKind.Utc`).
  - Npgsql 10.x natively maps `DateTime` with `Kind=Utc` to PostgreSQL `TIMESTAMPTZ`.
  - Comparing `TIMESTAMPTZ` against UTC parameters in `QuotaEnforcementService` avoids implicit session-timezone coercions that could cause an 8-hour calculation skew on AWS Singapore (UTC+8).
  - The Neon database has not yet been initialized; making this correction now eliminates future schema migrations.

---

## 5. Architectural Deep-Dive: Why `EnableRetryOnFailure` was Deferred

The audit identified `OPS-001` recommending `npgsqlOptions.EnableRetryOnFailure()` to guard against Neon serverless wake-up latency.

**Investigation Finding:**
A full-codebase inspection revealed that three critical production code paths call `_dbContext.Database.BeginTransactionAsync()` directly:
1. [`backend/Kairo.Infrastructure/Security/TokenService.cs:L133`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Security/TokenService.cs#L133) (JWT refresh token rotation)
2. [`backend/Kairo.Infrastructure/Repositories/EntityRepository.cs:L43`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Repositories/EntityRepository.cs#L43) (Entity creation and graph upsert)
3. [`backend/Kairo.Infrastructure/Repositories/EntityRepository.cs:L282`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Repositories/EntityRepository.cs#L282) (Relationship evidence deletion)

In EF Core, enabling `EnableRetryOnFailure()` activates `NpgsqlRetryingExecutionStrategy`. When a retrying execution strategy is active, calling `BeginTransactionAsync` without wrapping the block in `CreateExecutionStrategy().ExecuteAsync()` throws:
```text
System.InvalidOperationException: The configured execution strategy 'NpgsqlRetryingExecutionStrategy'
does not support user-initiated transactions. Use the execution strategy returned by
'DbContext.Database.CreateExecutionStrategy()' to execute all the operations in the transaction as a retrying unit.
```
**Conclusion:** Enabling `EnableRetryOnFailure()` without refactoring `TokenService` and `EntityRepository` would cause runtime crashes during login/refresh token operations and entity extraction. For the 3–5 user private beta, keeping `EnableRetryOnFailure` disabled and relying on Neon's TCP keep-alive is significantly safer.

---

## 6. Offline Test & Validation Results

All tests executed were 100% offline with zero database connections:

| Suite / Command | Scope | Result | Passed | Failed | Skipped | Total | Duration |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `dotnet build -c Release backend\Kairo.slnx` | Full .NET 10 Solution | **SUCCESS** | N/A | 0 err | 0 warn | 6 projects | 3.73s |
| `dotnet test --filter "FullyQualifiedName~PostgreSqlUniqueConstraintHandlingUnitTests"` | PostgreSQL unique-constraint regression | **SUCCESS** | **11** | **0** | **0** | **11** | 0.19s |
| `dotnet test --filter "FullyQualifiedName~Phase58UsageMeteringUnitTests\|FullyQualifiedName~Phase58RemediationRegressionTests"` | Usage & quota unit tests | **SUCCESS** | **41** | **0** | **0** | **41** | 2.00s |
| `dotnet test --filter "FullyQualifiedName~BaselineSqlFile_Exists_AndDefinesAll19EntitiesAndVectorExtension"` | Source-only baseline schema test | **SUCCESS** | **1** | **0** | **0** | **1** | 0.04s |
| `dotnet test -c Release --filter "<offline-filtered-suite>"` | Full filtered offline .NET suite | **SUCCESS** | **390** | **0** | **8** | **398** | 2.00s |
| `npm test` (in `sdks/node`) | Node.js SDK test suite | **SUCCESS** | **131** | **0** | **0** | **131** | 0.31s |
| `python -m pytest sdks/python/tests` | Python SDK test suite | **SUCCESS** | **145** | **0** | **8** | **153** | 36.14s |

**Total passing tests across stacks:** **677 passed, 0 failed.**

*Note on Benchmark Test Exclusion:*  
`Phase6BenchmarkEvaluationTests.Benchmark_ExecuteEndToEndRetrievalEvaluation_MeetsQualityThresholds` unconditionally writes evaluation metrics to `docs/phase6/benchmark/benchmark_results_v1.json` on execution. To strictly enforce Safety Rule 8 ("Do not modify benchmark_results_v1.json"), this single test was excluded from the automated offline run, preserving the benchmark file's byte-for-byte identity with `HEAD`.

---

## 7. PostgreSQL Schema Alignment Assessment

### Table Inventory (21 Tables Total)

#### From `infrastructure/kairo_schema_postgresql_baseline.sql` (Tables 1–19):
1. `Users` — Primary user identity table, email uniqueness constraint (`UQ_Users_Email`).
2. `Projects` — Tenant workspace boundary, FK to `Users`.
3. `UserMemorySettings` — 1:1 user configuration table.
4. `MemorySettingHistory` — Historical audit trail of setting updates.
5. `AuthenticationIdentities` — External & password auth credentials (`UQ_AuthenticationIdentities_Provider_Subject`).
6. `RefreshTokens` — JWT refresh token storage with rotation support.
7. `ApiKeys` — SHA-256 hashed API keys (`KeyHash`).
8. `Chats` — Conversational session metadata.
9. `Messages` — Chat message records linked to `Chats`.
10. `MemoryScopes` — Actor/project partition boundaries.
11. `Memories` — Core memory table with soft-delete (`IsActive`) and temporal metadata.
12. `MemoryEmbeddings` — Vector data stored as `TEXT`, filtered and cast to `::vector(1024)`.
13. `MemoryVersions` — Append-only audit snapshots of memory evolution.
14. `MemoryCategories` — Normalised memory categorization join table.
15. `Entities` — Extracted knowledge graph entities.
16. `MemoryEntities` — Many-to-many join linking memories and entities.
17. `EntityRelationships` — Knowledge graph edges with confidence scoring.
18. `RelationshipEvidence` — Supporting memory evidence for graph edges.
19. `MemoryIngestionJobs` — Asynchronous background queue with BIGINT IDENTITY `JobId`.

#### From `infrastructure/phase5_usage_schema_postgresql.sql` (Tables 20–21):
20. `UsageLedger` — Append-only operational meter ledger (`OccurredAt TIMESTAMPTZ(3)`).
21. `ProjectQuotas` — Per-project rate limits and capacity thresholds (`UpdatedAt TIMESTAMPTZ(3)`).

All 21 tables strictly match EF Core entity definitions in `Kairo.Infrastructure.Persistence.Entities`.

---

## 8. Proposed Fresh-Database Script Order & Preflight Checklist

### Script Execution Order
```bash
# -----------------------------------------------------------------------------
# STEP 1: Baseline Schema (Creates extension 'vector' + 19 application tables)
# -----------------------------------------------------------------------------
psql "$NEON_DATABASE_URL" -f infrastructure/kairo_schema_postgresql_baseline.sql

# -----------------------------------------------------------------------------
# STEP 2: Usage Metering Schema (Creates UsageLedger and ProjectQuotas)
# -----------------------------------------------------------------------------
psql "$NEON_DATABASE_URL" -f infrastructure/phase5_usage_schema_postgresql.sql

# DO NOT RUN: infrastructure/phase4a_schema_postgresql.sql
# (phase4a is an upgrade script for legacy UUID databases and must be skipped).
```

### Preflight Checklist (For Human Operator)
1. [ ] Confirm connection string points to `voidzone-production-asia` on Neon.
2. [ ] Verify Neon database is completely empty:
   ```sql
   SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
   -- Must return 0 before running Step 1.
   ```
3. [ ] Verify `pgvector` extension exists in database:
   ```sql
   SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
   -- Expected: vector | 0.8.0
   ```
4. [ ] Execute Step 1 (`kairo_schema_postgresql_baseline.sql`).
5. [ ] Execute Step 2 (`phase5_usage_schema_postgresql.sql`).
6. [ ] Verify post-execution table count:
   ```sql
   SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
   -- Must return exactly 21 tables.
   ```
7. [ ] Confirm no orphaned migration tables (`__EFMigrationsHistory` should not exist).

---

## 9. Environment Variables Specification (Production Hosting)

Configure these keys in the production hosting dashboard (e.g. Render / AWS / Cloud Run). **No values are included here in accordance with safety rules:**

### Mandatory Variables (Required for API Boot)
* `Providers__DatabaseProvider` — Set to `PostgreSql` (avoids SQL Server default).
* `ConnectionStrings__KairoPostgres` — Full Neon connection string with `sslmode=require`.
* `Mistral__ApiKey` — API key for Mistral chat completions.
* `MistralEmbedding__ApiKey` — API key for Mistral embeddings (`mistral-embed`, 1024-dim).
* `Kairo__Jwt__SigningKey` — Secret signing string (must be at least 32 characters long).
* `Kairo__Cors__AllowedOrigins__0` — URL of the deployed VoidZone frontend.

### Recommended Tuning Variables
* `ASPNETCORE_ENVIRONMENT` — `Production`
* `ASPNETCORE_URLS` — `http://+:8080`
* `Mistral__Model` — `mistral-small-latest`
* `MistralEmbedding__Model` — `mistral-embed`
* `Reranker__Enabled` — `true`

---

## 10. Post-Deployment Smoke Test & Verification Procedure

Once deployed and schema is initialized, execute the following smoke test workflow:

1. **Health Probe:** Request `GET /health` $\rightarrow$ Expect `HTTP 200 OK` (`"Healthy"`).
2. **Registration:** Request `POST /api/auth/register` with test user $\rightarrow$ Expect `HTTP 200/201`.
3. **Duplicate Conflict Handling:** Re-submit identical registration $\rightarrow$ Expect `HTTP 409 Conflict` (verifies DB-001 fix on live Neon).
4. **Login:** Request `POST /api/auth/login` $\rightarrow$ Expect JWT access and refresh tokens.
5. **API Key Generation:** Request `POST /api/keys` with JWT $\rightarrow$ Verify API key returned.
6. **Memory Ingestion:** Request `POST /api/memories` using API key $\rightarrow$ Verify memory created, embedding generated, and entry logged in `UsageLedger`.
7. **Semantic Search:** Request `POST /api/memories/search` with query text $\rightarrow$ Verify pgvector cosine similarity ranking returns expected memory.
8. **Tenant Isolation:** Create second user; verify user B cannot search, retrieve, or update memories created by user A.
9. **Quota Enforcement:** Submit request exceeding configured per-minute limit $\rightarrow$ Verify `HTTP 429 Too Many Requests`.

---

## 11. Actions Requiring Human Approval Before Execution

The pair programming agent has completed all permissible offline analysis, fixes, and tests. The following actions strictly require human approval:

1. **Approval of Schema DDL:** Review and approve the execution of `kairo_schema_postgresql_baseline.sql` and `phase5_usage_schema_postgresql.sql` against the Neon production database.
2. **Hosting Environment Secrets Input:** Supply actual secrets (Neon connection string, Mistral keys, JWT signing key) into the hosting environment.
3. **Triggering Deployment:** Trigger the Docker build and container launch on the hosting provider.
4. **Git Staging & Commit:** Review `git diff` and authorize committing the changes on branch `Shrey`.
