# VOIDZONE V1 — Master End-to-End Acceptance Report

**Date**: 2026-10-23  
**Branch**: `Shrey`  
**HEAD Commit**: `e362ba0` (`feat(api,tests): add live HTTP acceptance test suite and ambient tenant context binding for background ingestion`)  
**Target Environment**: Windows 11 / .NET 10 (`net10.0`) / PostgreSQL 17.4 (`pgvector 0.8.7`) on `127.0.0.1:5433`  
**Verification Host**: `KairoWebApplicationFactory` (Full ASP.NET Core pipeline + Real PostgreSQL + Deterministic Provider Fakes)  

---

## 1. Executive Summary

This report documents the end-to-end acceptance verification of **VOIDZONE V1**, spanning API startup, authentication, authorization, project isolation, multi-tenancy, synchronous and asynchronous memory ingestion, semantic/hybrid retrieval, restart recovery, resilience, and cleanup.

Verification was performed in **two distinct, separately executed test runs** described below. No single `dotnet test` invocation produced a combined result across both runs. Results from each run must not be aggregated.

All nine primary end-to-end acceptance scenarios (Run B) were executed against a real local PostgreSQL test instance (`kairo_fresh_init_test`). All tests achieved **PASS** status. Production database (`kairo_dev`) remained completely isolated and untouched throughout.

---

### Verification Run A — Unit & Integration Baseline

**Date**: 2026-10-22  
**Invocation**: `dotnet test --configuration Release` (full `Kairo.Tests.csproj`)  
**Host**: Direct class instantiation and mock harnesses — no `TestServer`, no live HTTP  
**Evidence**: `backend/Kairo.Tests/TestResults/full_run.trx` — historical machine-generated output, excluded from version control by `.gitignore` and not committed.

| Category | Count | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Total Tests** | **529** | | Full unit and integration suite |
| **Passed** | **518** | **PASS** | |
| **Failed** | **0** | **PASS** | |
| **Skipped** | **11** | **SKIPPED** | 8 consolidation tests (Phase 1 ADD-only mode) + 3 env-flagged integration tests |
| **Execution Duration** | **~7.3 s** | | |

---

### Verification Run B — VOIDZONE V1 Master Live HTTP Acceptance

**Date**: 2026-10-23  
**Invocation**: `dotnet test backend/Kairo.Tests/Kairo.Tests.csproj --filter "FullyQualifiedName~VoidzoneV1LiveHttpAcceptanceTests"`  
**Host**: `KairoWebApplicationFactory` — full ASP.NET Core `TestServer` + real PostgreSQL + deterministic provider fakes  
**Recorded output**:
```
Passed!  - Failed: 0, Passed: 9, Skipped: 0, Total: 9, Duration: 10 s - Kairo.Tests.dll (net10.0)
```

| Category | Count | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Total Tests** | **9** | | 9 master live HTTP acceptance scenarios |
| **Passed** | **9** | **PASS** | All scenarios; zero failures |
| **Failed** | **0** | **PASS** | |
| **Skipped** | **0** | | |
| **Execution Duration** | **~10 s** | | |

---

## 2. Environment & Database Safety Verification

### Non-Negotiable Safety Invariant Audit

| Invariant | Requirement | Observed Verification | Status |
| :--- | :--- | :--- | :--- |
| **1. Cloud Isolation** | No connection to Neon, production, or cloud DBs | All connection strings resolved strictly to `127.0.0.1:5433`. Zero cloud egress. | **PASS** |
| **2. `kairo_dev` Safety** | Never mutate `kairo_dev` | Baseline before tests: Users = 6, Memories = 6.<br>Count after tests: Users = 6, Memories = 6. | **PASS** |
| **3. Dedicated Test DB** | Run only on dedicated test database | Tests executed against `kairo_fresh_init_test`. Cleaned up to 0 rows. | **PASS** |
| **4. Secret Hygiene** | Zero credential or secret leakage | Verified in test responses and exception logs: zero connection strings, passwords, or keys exposed. | **PASS** |
| **5. Repository State** | No unrequested pushes or deploys | Commit A (`e362ba0`) was subsequently merged to `origin/Shrey` as part of the approved verification workflow. No Neon, Render, or production deployments were executed. One unstaged change remains: `docs/phase6/benchmark/benchmark_results_v1.json` (timestamp and in-process latency diff from benchmark re-run; retained without staging per pre-commit audit decision). | **PASS** |

---

## 3. Detailed Acceptance Scenario Matrix

| Scenario ID | Description | HTTP Method & Route | Expected Outcome | Observed Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SCENARIO-01** | Health and readiness probes | `GET /health`<br>`GET /health/live`<br>`GET /health/ready` | HTTP 200 OK with `Healthy` status | All 3 probes returned 200 OK with status `Healthy` | **PASS** |
| **SCENARIO-02A** | User account registration | `POST /api/auth/register` | HTTP 201 Created with `RegisterResult` (UserId, Email) | Returned 201 Created; user ID generated via PostgreSQL identity | **PASS** |
| **SCENARIO-02B** | Duplicate user registration | `POST /api/auth/register` | HTTP 409 Conflict | Returned 409 Conflict with duplicate email rejection message | **PASS** |
| **SCENARIO-02C** | Login with invalid credentials | `POST /api/auth/login` | HTTP 401 Unauthorized | Returned 401 Unauthorized | **PASS** |
| **SCENARIO-02D** | Login with valid credentials | `POST /api/auth/login` | HTTP 200 OK with JWT AccessToken & RefreshToken | Returned 200 OK with valid JWT and cryptographic refresh token | **PASS** |
| **SCENARIO-02E** | Current user identity inspection | `GET /api/auth/me` | HTTP 200 OK with `AccountMeResult` | Returned 200 OK matching authenticated user ID and email | **PASS** |
| **SCENARIO-02F** | Refresh token rotation | `POST /api/auth/refresh` | HTTP 200 OK with newly rotated token pair | Returned 200 OK; new access token successfully authenticated `GET /api/auth/me` | **PASS** |
| **SCENARIO-03A** | Project creation & listing | `POST /api/v1/projects`<br>`GET /api/auth/me` | HTTP 200 OK; projects isolated per owner | User A only sees Project A; User B only sees Project B | **PASS** |
| **SCENARIO-03B** | API key generation | `POST /api/v1/api-keys` | HTTP 200 OK with `kairo_live_` prefixed secret key | Returned 200 OK; secret key hash stored securely in `ApiKeys` table | **PASS** |
| **SCENARIO-03C** | Cross-project API key attack | `POST /api/v1/api-keys` (User A for Project B) | HTTP 401 Unauthorized (ownership validation) | Request rejected with 401; cross-tenant key creation prevented | **PASS** |
| **SCENARIO-04A** | Synchronous memory creation | `POST /api/v1/memories` | HTTP 201 Created with `MemoryResponse` | Returned 201 Created; MemoryId > 0, attributed to Project scope | **PASS** |
| **SCENARIO-04B** | Memory readback by ID | `GET /api/v1/memories/{id}` | HTTP 200 OK with identical content | Returned 200 OK with exact content, memory type, and metadata | **PASS** |
| **SCENARIO-04C** | Idempotency / duplicate check | `POST /api/v1/memories` (identical content) | HTTP 200 OK with `MemoryDuplicateResult` (`IsDuplicate = true`) | Returned 200 OK with `isDuplicate: true`; duplicate memory omitted | **PASS** |
| **SCENARIO-05A** | Cross-project memory read attack | `GET /api/v1/memories/{MemoryB_Id}` (Key A) | HTTP 404 NotFound | Returned 404 NotFound (fails closed, zero information leakage) | **PASS** |
| **SCENARIO-05B** | Cross-project memory search attack | `POST /api/v1/memories/search` (Key A for B content) | HTTP 200 OK with Project B memory omitted | Project A search returned 0 leaks of Project B memories | **PASS** |
| **SCENARIO-05C** | Cross-project memory update attack | `PUT /api/v1/memories/{MemoryB_Id}` (Key A) | HTTP 404 NotFound | Returned 404 NotFound; foreign memory unmodified | **PASS** |
| **SCENARIO-05D** | Cross-project memory delete attack | `DELETE /api/v1/memories/{MemoryB_Id}` (Key A) | HTTP 404 NotFound | Returned 404 NotFound; foreign memory untouched | **PASS** |
| **SCENARIO-06** | Hybrid & semantic retrieval | `POST /api/v1/memories/search` (`Hybrid = true`) | HTTP 200 OK with relevant candidate ranked top | Target memory returned as top rank with cosine similarity match | **PASS** |
| **SCENARIO-07A** | Asynchronous memory ingestion | `POST /api/v1/memories?mode=async` | HTTP 202 Accepted with `AsyncJobAcceptedResponse` | Returned 202 Accepted; JobId queued in `MemoryIngestionJobs` table | **PASS** |
| **SCENARIO-07B** | Background worker job execution | Polling `GET /api/v1/memories/jobs/{id}` | Status transitions: `Pending` -> `Processing` -> `Completed` | Worker claimed job via `FOR UPDATE SKIP LOCKED`, generated embedding, and updated status to `Completed` within 4s | **PASS** |
| **SCENARIO-07C** | Searchability of async memory | `POST /api/v1/memories/search` | HTTP 200 OK; background memory discovered | Memory created via background worker discovered by search query | **PASS** |
| **SCENARIO-08** | Host restart & recovery | Reboot `KairoWebApplicationFactory` | Memory persists across distinct host processes | Memory created on Host 1 read and searched on Host 2 with 200 OK | **PASS** |
| **SCENARIO-09A** | Missing auth credentials | `POST /api/v1/memories` (no auth header) | HTTP 401 Unauthorized | Returned 401 Unauthorized | **PASS** |
| **SCENARIO-09B** | Invalid API key token | `POST /api/v1/memories` (invalid bearer) | HTTP 401 Unauthorized | Returned 401 Unauthorized | **PASS** |
| **SCENARIO-09C** | Malformed input validation | `POST /api/v1/memories` (empty content) | HTTP 400 BadRequest | Returned 400 BadRequest with descriptive validation message | **PASS** |
| **SCENARIO-09D** | Secret leak audit on error responses | Response body inspection | Zero connection strings, passwords, or internal details | Verified clean; no sensitive data leaked | **PASS** |

---

## 4. Enumeration of Skipped Tests (Run A)

The following 11 tests were skipped in Verification Run A and did not execute in Run B either. All skips are intentional and documented:

| Skipped Test | Reason / Category | Release-Critical Impact? |
| :--- | :--- | :--- |
| `MemoryIngestionUnitTests.Test6_MergeContentIdentical_NoVersionCreated` | Automatic consolidation disabled in Phase 1 ADD-only mode | None (intentional architectural design) |
| `MemoryIngestionUnitTests.Test5_ConsolidationMerge_ExistingMemoryUpdated` | Automatic consolidation disabled in Phase 1 ADD-only mode | None (intentional architectural design) |
| `Phase3MemoryIntelligenceUnitTests.Test5_EvaluatorReturnsNoAction_NoNewMemoryCreated` | Automatic consolidation disabled in Phase 1 ADD-only mode | None (intentional architectural design) |
| `Phase3MemoryIntelligenceUnitTests.Test2_ContradictoryPreference_UpdatesExistingMemory` | Automatic consolidation disabled in Phase 1 ADD-only mode | None (intentional architectural design) |
| `Phase3MemoryIntelligenceUnitTests.Test9_SequentialUpdates_VersionsChainedAndLatestPersisted` | Automatic consolidation disabled in Phase 1 ADD-only mode | None (intentional architectural design) |
| `Phase3MemoryIntelligenceUnitTests.Test1_EvolvingFact_UpdatesExistingMemoryAndCreatesVersion` | Automatic consolidation disabled in Phase 1 ADD-only mode | None (intentional architectural design) |
| `Phase3MemoryIntelligenceUnitTests.Test7_MergeWhenContentIdentical_NoVersionCreated` | Automatic consolidation disabled in Phase 1 ADD-only mode | None (intentional architectural design) |
| `Phase3MemoryIntelligenceUnitTests.Test6_EvaluatorReturnsMerge_UpdatesCanonicalAndCreatesMergeVersion` | Automatic consolidation disabled in Phase 1 ADD-only mode | None (intentional architectural design) |
| `ProductionHardeningVerificationTests.DatabaseHealthCheck_WhenDatabaseIsReachable_ReturnsHealthy` | Skipped when `KAIRO_TEST_POSTGRES_CONNECTION_STRING` is not explicitly exported | None (covered by live HTTP Scenario 1 `/health/ready`) |
| `IngestionWorkerReliabilityTests.MultipleWorkers_CannotClaimSameActiveJob_Concurrently_PostgreSql` | Skipped when `KAIRO_TEST_POSTGRES_CONNECTION_STRING` is not explicitly exported | None (covered by live HTTP Scenario 7 async job claiming) |
| `ProductionHardeningVerificationTests.IngestionJobRepository_PostgreSql_CompetingWorkersCannotClaimSameJob` | Skipped when `KAIRO_TEST_POSTGRES_CONNECTION_STRING` is not explicitly exported | None (covered by live HTTP Scenario 7 async job claiming) |

---

## 5. Defect Discovery & Remediation During Verification

During the execution of the master test suite, two subtle integration defects were identified and resolved:

1. **`MemoryIngestionWorker` Ambient Tenant Context Binding**:
   - *Issue*: In background hosted services, requests do not flow through ASP.NET Core HTTP authentication handlers, leaving `ApiKeyContext` unpopulated (`ProjectId = 0`). Consequently, `MemoryRepository` invoked its fail-closed isolation filter (`GetEffectiveProjectId`), concluding that the job lacked an authorized project and returning `null`, which caused the worker to mark valid jobs as `Cancelled`.
   - *Fix*: In `backend/Kairo.API/Services/MemoryIngestionWorker.cs`, populated the scoped `ApiKeyContext` with the job's captured tenant identity (`job.UserId`, `job.ProjectId`) before calling `ProcessJobWithLeaseRenewalAsync`.
   - *Result*: Asynchronous background processing now seamlessly respects tenant isolation and completes with full embedding generation and pgvector persistence.

2. **Cascade Cleanup Order in Acceptance Harness**:
   - *Issue*: The acceptance test harness cleanup script attempted to delete from `ApiKeys` by `UserId`, whereas `ApiKeys` references `Projects(ProjectId)`.
   - *Fix*: Corrected the cascading query in `VoidzoneV1LiveHttpAcceptanceTests.cs` to delete `ApiKeys` via `ProjectId IN (SELECT ProjectId FROM Projects WHERE UserId IN (...))`.
   - *Result*: Post-test cleanup completes cleanly, leaving `kairo_fresh_init_test` with zero orphaned rows.

---

## 6. Real-Provider vs. Fake-Provider Profile

> **Important limitation**: Verification Run B used **deterministic fake implementations** for all AI provider interfaces. No network calls were made to Mistral or any external AI service during these tests. The acceptance suite does **not** establish verified end-to-end integration with the real Mistral LLM or embedding APIs. Real-provider integration remains a pre-production requirement and must be validated separately in a staging environment configured with live credentials.

| Component | Test Profile | Rationale |
| :--- | :--- | :--- |
| **HTTP Routing & Pipeline** | **Real** (`TestServer`) | Full ASP.NET Core middleware, authorization, routing, and controller execution |
| **Database Engine** | **Real** (`PostgreSQL 17.4 + pgvector 0.8.7`) | Real tables, SQL migrations, foreign keys, identity columns, and concurrency locks |
| **Background Service** | **Real** (`MemoryIngestionWorker`) | Real hosted background worker running concurrent claim loops and lease renewals |
| **LLM Provider** | **Deterministic Fake** (`FakeLlmProvider`) | Zero network latency, deterministic JSON responses; Mistral APIs not contacted |
| **Embedding Provider** | **Deterministic Fake** (`FakeEmbeddingProvider`) | Normalized 4-D mathematical vectors derived from text hash; Mistral embedding API not contacted |
| **Rerank Provider** | **Deterministic Fake** (`FakeRerankProvider`) | Deterministic descending score distribution |
| **Entity Extraction** | **Deterministic Fake** (`FakeEntityExtractionService`) | Returns empty entity list deterministically |
| **Memory Extractor** | **Deterministic Fake** (`FakeMemoryExtractor`) | Returns a single fixed extracted memory |
| **Relevance Evaluator** | **Deterministic Fake** (`FakeMemoryRelevanceEvaluator`) | Passes candidates through unchanged |
| **Consolidation Evaluator** | **Deterministic Fake** (`FakeMemoryConsolidationEvaluator`) | Always returns `ConsolidationAction.Add` |

---

## 7. Remaining Blockers & Next Action

- **Branch State**: `Shrey` is in sync with `origin/Shrey` at HEAD `e362ba0`. One unstaged working-tree change remains: `docs/phase6/benchmark/benchmark_results_v1.json` (timestamp and in-process latency diff from benchmark re-run; retained without staging per pre-commit audit decision).
- **Real-Provider Integration**: Valid Mistral API keys (`Mistral:ApiKey` and `MistralEmbedding:ApiKey`) must be configured in a staging environment and verified end-to-end before production deployment. `ProviderConfigurationValidator` will reject startup without valid key values.
- **Neon Staging**: Schema parity has been audited; application connectivity smoke tests against Neon staging remain gated on explicit authorization (see Section 2, Invariant 5).
- **Consolidation Mode**: 8 consolidation-related tests are currently skipped (Phase 1 ADD-only mode). These must be re-enabled and pass before automatic memory consolidation is activated.
