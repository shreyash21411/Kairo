# Phase 6.5 — Mem0 Parity and Final V1 Acceptance Report

**Repository:** `F:\AI-Memory-Platform`
**Branch:** `Shrey`
**HEAD:** `42222da`
**Audit date:** 2026-10-15

---

## 1. Mem0 Comparison Baseline

### 1.1 Target A — Mem0 OSS memory-engine capability parity

| Baseline attribute | Value |
|---|---|
| Repository | `mem0ai/mem0` (public GitHub) |
| Relevant OSS version | v1.x public API surface (mem0ai OSS package) |
| Documentation URL | https://docs.mem0.ai (OSS section) |
| Comparison date | 2026-10-15 |
| Scope | Mem0 OSS client library and self-hosted memory backend |
| Core OSS methods | `add`, `search`, `update`, `delete`, `get`, `get_all`, `history` |
| Excluded from comparison | Mem0 Platform cloud features: cross-user sharing, Teams, SSO, multi-region, hosted vector DB |

**Disclosure:** The Mem0 OSS package does not pin a specific minor version in the project specification. This comparison is against the documented public OSS API surface as of the comparison date. Hosted Mem0 Platform capabilities are explicitly excluded and do not count for or against parity.

### 1.2 Target B — Mem0 Platform-style project isolation

Independently assessed in [`kairo_v1_release_readiness_and_api_key_isolation.md`](file:///f:/AI-Memory-Platform/docs/phase6/kairo_v1_release_readiness_and_api_key_isolation.md). Summary: **PASS** — project scope enforced at SQL JOIN level, not merely in application code.

---

## 2. Complete Mem0 OSS Parity Matrix

### A. Memory Lifecycle

| Capability | Mem0 OSS baseline | Kairo implementation | Evidence | Test type | Status | Gap |
|---|---|---|---|---|---|---|
| Create/store memory | `mem.add(messages, user_id)` | `POST /api/v1/memories` + SDK `memories.create()` | Phase1, Phase2, SDK tests | Unit + Mock | PASS | |
| Retrieve single memory | `mem.get(memory_id)` | `GET /api/v1/memories/{id}` + SDK `memories.get()` | Phase1, SDK tests | Unit + Mock | PASS | |
| List all memories for user | `mem.get_all(user_id)` | `GET /api/v1/memories` + SDK `memories.list()` | Phase1, SDK tests | Unit + Mock | PASS | |
| Search memories (semantic) | `mem.search(query, user_id)` | `POST /api/v1/memories/search` + SDK `memories.search()` | Phase1, Phase2, Phase5 tests | Unit + Mock | PASS | Kairo uses Mistral embedding (NOT VERIFIED live without API key) |
| Update memory | `mem.update(memory_id, data)` | `PUT /api/v1/memories/{id}` + SDK `memories.update()` | Phase1, Phase2 tests | Unit + Mock | PASS | |
| Delete one memory | `mem.delete(memory_id)` | `DELETE /api/v1/memories/{id}` + SDK `memories.delete()` | Phase1, SDK tests | Unit + Mock | PASS | Kairo uses **soft delete** (row preserved for audit); Mem0 OSS hard-deletes by default |
| Delete all for user/actor | `mem.delete_all(user_id)` | `DELETE /api/v1/memories?actorId={actorId}` | Phase6 hardening tests | Unit + Mock | PASS | Kairo uses actorId-scoped purge; semantic equivalent |
| History/version retrieval | `mem.history(memory_id)` | `GET /api/v1/memories/{id}/history` | Phase6 hardening tests | Unit + Mock | PASS | |
| Duplicate memory detection | Mem0 returns existing if duplicate | Kairo deduplicates (exact + semantic) and returns status | Phase2, Phase3 tests | Unit | PASS | |
| Invalid/empty inputs | Raises exception / error | HTTP 400 + exception with message | All phase tests | Unit | PASS | |
| Batch create | Not in Mem0 OSS | `POST /api/v1/memories/batch` | Phase3 tests | Unit | PASS (Kairo-specific) | |
| Batch update | Not in Mem0 OSS | `PUT /api/v1/memories/batch` | Phase3 tests | Unit | PASS (Kairo-specific) | |
| Batch delete | Not in Mem0 OSS | `DELETE /api/v1/memories/batch` | Phase3 tests | Unit | PASS (Kairo-specific) | |
| Memory expiration (TTL) | Not in Mem0 OSS | `ExpiresAt` / `Ttl` on create/update | Phase3 tests | Unit | PASS (Kairo-specific) | |

### B. Retrieval and Intelligence

| Capability | Mem0 baseline | Kairo | Evidence | Test type | Status | Gap |
|---|---|---|---|---|---|---|
| Semantic retrieval (embedding cosine) | Yes — OpenAI embeddings | `MemoryRetrievalService` cosine similarity | Phase1/2/5 tests | Unit/Mock | PASS | Kairo uses Mistral; live semantic quality NOT VERIFIED without API key |
| Keyword/BM25 retrieval | Not default in Mem0 OSS | `KeywordSearchRepository` — BM25 scoring | Phase5 tests | Unit/Mock | PASS (Kairo-specific) | |
| Hybrid retrieval + score fusion | Not in Mem0 OSS | `HybridRetrievalService` (semantic + keyword + BM25 fusion) | Phase5 tests | Unit/Mock | PASS (Kairo-specific) | |
| Metadata filtering | Not explicit in Mem0 OSS core | `MetadataFilters` + `StructuredFilters` | Phase2 tests | Unit/Mock | PASS (Kairo-specific) | |
| Category filtering | Not in Mem0 OSS | Category/Categories filter | Phase3 tests | Unit/Mock | PASS (Kairo-specific) | |
| Temporal bounds | Not in Mem0 OSS | `TemporalFilter` (before/after/window) | Phase2 tests | Unit/Mock | PASS (Kairo-specific) | |
| Recency boost | Not in Mem0 OSS | `RecencyBoost` flag in search request | Phase2 tests | Unit/Mock | PASS (Kairo-specific) | |
| Entity/relationship retrieval | Mem0 has graph memory (v1.x OSS) | Entity extraction + `EntityRelationship` graph | Phase5 tests | Unit/Mock | PASS | |
| Reranking (relevance re-scoring) | Not explicit in Mem0 OSS | `IMemoryRelevanceEvaluator` Mistral reranker | Phase5 tests | Unit/Mock | PASS (Kairo-specific) | Reranker mocked; live Mistral reranking NOT VERIFIED |
| Inactive/expired record exclusion | Basic in Mem0 OSS | `IsActive AND ExpiresAt > now` in all queries | All phase tests | Unit | PASS | |
| Live semantic retrieval quality | Measured in hosted Mem0 benchmarks | Fixture benchmark: NDCG@3=1.0, MRR=0.867 | Phase6BenchmarkEvaluationTests | Controlled fixture only | PARTIAL | Fixture uses synthetic candidates derived from golden grades — not an unbiased live measurement. See §4 |

### C. Ingestion

| Capability | Mem0 baseline | Kairo | Evidence | Test type | Status | Gap |
|---|---|---|---|---|---|---|
| Conversation/dialogue ingestion | `mem.add(messages, user_id)` — extracts facts from dialogue | `POST /api/v1/memories/ingest` — Mistral-based extraction + consolidation | Phase2 tests | Unit/Mock | PASS | Live LLM extraction NOT VERIFIED without API key |
| Synchronous ingestion | Yes | Default `mode=sync` | Phase2 tests | Unit/Mock | PASS | |
| Async ingestion + job lifecycle | Not in Mem0 OSS | `POST /api/v1/memories?mode=async` + job polling | Phase4A tests | Unit/Mock | PASS (Kairo-specific) | |
| Batch ingestion | Not explicit in Mem0 OSS | Via batch create endpoint | Phase3 tests | Unit | PASS (Kairo-specific) | |
| Background worker processing | Not in Mem0 OSS | `MemoryIngestionWorker` hosted service | Phase4A tests | Unit/Mock | PASS (Kairo-specific) | Live worker NOT VERIFIED |
| Error and retry behavior | Basic error in Mem0 | `ArgumentException→400`, pipeline error→500, job retry with `MaxAttempts` | All phase tests | Unit | PASS | |
| Actor/scope binding on ingestion | `user_id` / `agent_id` params | `actorId` → scope resolution → `ScopeId` stamped on memory | Phase2, Phase4A tests | Unit/Mock | PASS | |

### D. API and SDKs

| Capability | Mem0 baseline | Kairo | Evidence | Test type | Status | Gap |
|---|---|---|---|---|---|---|
| REST API | Yes | Full REST API (10+ endpoints) | All phase tests | Unit | PASS | |
| Authentication via API key | API key passed in config or header | `Authorization: Bearer <api-key>` | Phase1 tests | Unit/Mock | PASS | |
| Project management API | Mem0 OSS: minimal | `POST/GET/DELETE /api/v1/projects` (JWT-authenticated) | ProjectController code review | Code review | PASS | |
| API-key lifecycle API | Mem0 OSS: not explicit | `POST/GET/DELETE /api/v1/api-keys` (JWT-authenticated) | ApiKeyController code review | Code review | PASS | |
| Python SDK | Yes (`pip install mem0ai`) | Full Python SDK (`kairo/`) | 145 tests | Mock SDK | PASS | Not published to PyPI |
| Node/TypeScript SDK | Not in Mem0 OSS | Full TypeScript SDK (`sdks/node/`) | 131 tests | Mock SDK | PASS (Kairo-specific) | Not published to npm |
| Serialization and error mapping | Yes | Typed exception hierarchy + HTTP status mapping | SDK tests | Mock | PASS | |
| Usage reporting API | Not in Mem0 OSS | `GET /api/v1/projects/{id}/usage` + Python `usage.get_report()` + Node `usage.get()` | Phase5/6 tests | Unit/Mock | PASS (Kairo-specific) | |
| Pagination on list/history | Not explicit in Mem0 OSS | **Not implemented** — returns full result set | — | — | PARTIAL | No pagination; acceptable for V1 data volumes; V2 backlog |
| SDK project-scope override prevention | N/A in Mem0 OSS | SDK passes API-key; server enforces scope; no client override | SDK tests + `McpSecurityUnitTests` | Mock | PASS | |
| Live SDK→API round-trip | Yes (against hosted Mem0) | NOT VERIFIED — no running Kairo API in this environment | — | — | NOT VERIFIED | Requires live Kairo API + Mistral key |

### E. Storage and Security

| Capability | Mem0 baseline | Kairo | Evidence | Test type | Status | Gap |
|---|---|---|---|---|---|---|
| SQL Server support | No (Mem0 uses Qdrant/Chroma) | Yes — EF Core + SQL Server | Phase1-5 tests | EF In-Memory | PASS | |
| PostgreSQL + pgvector | No (separate vector DB) | Yes — EF Core PostgreSQL + pgvector extension | Phase4C, Phase5 tests | EF In-Memory + prior live PG | PASS | Live PG NOT RE-VERIFIED this audit cycle |
| Project isolation | `project_id` param in OSS | `ApiKey.ProjectId` → `ApiKeyContext.ProjectId` → `Scope.ProjectId` SQL JOIN | Full test suite | Unit + EF In-Memory | PASS | |
| Actor/user isolation | `user_id`/`agent_id` params | `actorId` → `MemoryScope(projectId, actorId)` | All phase tests | Unit | PASS | |
| Tenant isolation | Not explicit in Mem0 OSS | Project is isolation boundary; cross-project access denied at SQL | All phase tests | Unit | PASS | |
| Soft delete with history | Hard delete in Mem0 OSS | Soft delete (`IsActive=false`) + version archival before deactivation | Phase1/6 tests | Unit | PASS | Kairo stronger: full audit trail |
| Cross-project API-key enforcement | Not tested in Mem0 OSS | SQL JOIN enforcement verified; full test coverage | Phase6HardeningUnitTests, McpSecurityUnitTests, Phase3UnitTests | Unit + Mock | PASS | Live HTTP test NOT PERFORMED |
| API-key hash security | N/A in Mem0 OSS | SHA-256, never stored raw, never returned after creation | ApiKeyService code review | Code review | PASS | |

### F. MCP and Integrations

| Capability | Mem0 baseline | Kairo | Evidence | Test type | Status | Gap |
|---|---|---|---|---|---|---|
| `kairo_ping` (health) | Not in Mem0 | Yes — returns authenticated user ID | McpSecurityUnitTests | Unit | PASS (Kairo-specific) | |
| `remember` (create memory) | Not in Mem0 MCP | Yes — delegates to `IMemoryService.CreateMemoryAsync` | McpSecurityUnitTests, Phase5McpBatchAndIngestUnitTests | Unit/Mock | PASS | |
| `recall` (search memories) | Not in Mem0 MCP | Yes — delegates to `IMemoryService.SearchMemoriesAsync` | McpSecurityUnitTests, Phase5McpRecallFiltersUnitTests | Unit/Mock | PASS | |
| `update` (update memory) | Not in Mem0 MCP | Yes — delegates to `IMemoryService.UpdateMemoryAsync` | McpSecurityUnitTests | Unit/Mock | PASS | |
| `forget` (delete memory) | Not in Mem0 MCP | Yes — delegates to `IMemoryService.DeleteMemoryAsync` | McpSecurityUnitTests | Unit/Mock | PASS | |
| MCP tool argument validation | N/A | Yes — empty actorId, content, memoryType validated | McpSecurityUnitTests | Unit | PASS | |
| MCP project scope isolation | N/A | No tool accepts `projectId`/`userId` params; enforced by reflection test | `McpSecurityUnitTests.ProjectIsolation_ToolNeverAcceptsProjectId_EnforcedByContext` | Unit | PASS | |
| MCP auth via API key | N/A | `KairoApiKeyAuthenticationHandler` + `RequireAuthorization()` | McpSecurityUnitTests | Unit/Mock | PASS | |
| Live MCP invocation | N/A | NOT VERIFIED — requires running server + MCP client | — | — | NOT VERIFIED | |

### G. Operations

| Capability | Mem0 baseline | Kairo | Evidence | Test type | Status | Gap |
|---|---|---|---|---|---|---|
| Usage ledger | Not in Mem0 OSS | `UsageLedgerEntry` table + `IUsageMeterService` | Phase5/6 tests | Unit | PASS (Kairo-specific) | |
| Project usage reporting | Not in Mem0 OSS | `GET /api/v1/projects/{id}/usage` | Phase5/6 tests | Unit/Mock | PASS (Kairo-specific) | |
| Quota enforcement | Not in Mem0 OSS | `QuotaEnforcementService` — per-project memory create/search limits | Phase5 tests | Unit | PARTIAL | **Known limitation**: `SemaphoreSlim` is process-local; not effective across multiple API instances |
| Rate limiting (auth endpoints) | Not in Mem0 OSS | `FixedWindowRateLimiter` on auth endpoints (10 req/min/IP) | Program.cs code review | Code review | PASS | |
| Sensitive data in logs | N/A | No credentials, API keys, or memory content found in log calls | Code review | Static | PASS | |
| Health/readiness endpoint | Not in Mem0 OSS | **Not implemented** | — | — | NOT VERIFIED | Not in V1 scope |
| Provider selection (SQL Server / PG) | N/A | `ProviderConfigurationValidator.Validate` at startup | Phase4C tests | Unit | PASS | |

### H. Kairo-Specific Capabilities (No Mem0 OSS Equivalent)

| Feature | Description | Status |
|---|---|---|
| MCP server | Full ASP.NET Core MCP server with 5 tools (ping, remember, recall, update, forget) | Implemented |
| Hybrid retrieval | Semantic + keyword + BM25 score fusion with graph entity relationships | Implemented |
| Usage metering | Per-operation usage ledger with outcome tracking | Implemented |
| Quota enforcement | Per-project quota checks (process-local; single-instance only) | Implemented |
| Async ingestion | Background job queue (`MemoryIngestionWorker`) for non-blocking extraction | Implemented |
| Batch operations | Atomic batch create/update/delete (up to 100 items) | Implemented |
| Advanced metadata | Temporal filters, structured metadata conditions, recency boost | Implemented |
| Memory expiration (TTL) | ExpiresAt / Ttl on any memory | Implemented |
| Soft-delete audit trail | All mutations versioned before deactivation | Implemented |
| Actor-level bulk purge | `DELETE /api/v1/memories?actorId={actorId}` with per-memory version archival | Implemented |
| Node/TypeScript SDK | Full TypeScript SDK (Mem0 OSS has Python only) | Implemented |
| Project/API-key management REST API | Create, list, revoke projects and API keys via JWT-authenticated endpoints | Implemented |
| Memory history API | `GET /api/v1/memories/{id}/history` — versioned history | Implemented |

---

## 3. API-Key Project Isolation — Parity Assessment

**Target B assessment (Mem0 Platform-style project isolation):**

| Property | Required | Kairo status | Evidence |
|---|---|---|---|
| Each project has ≥1 API keys associated | Yes | Yes — `ApiKeys.ProjectId` FK | DB schema + ApiKeyRepository |
| Key authorized only for its project | Yes | Yes — `ApiKeyContext.ProjectId` server-set from DB record | Code review + unit tests |
| Project identity from server-side key context | Yes | Yes — from `ApiKey.ProjectId` via DB lookup, never from request | Code review |
| Caller cannot override key's project | Yes | Yes — `IApiKeyContext` private properties, set by handler | Code review + McpSecurityUnitTests |
| Key creation requires project ownership | Yes | Yes — `ProjectBelongsToUserAsync` check | ApiKeyService unit tests |
| Listing keys requires ownership | Yes | Yes | ApiKeyService.GetByProjectAsync |
| Revocation requires ownership | Yes | Yes — `ProjectBelongsToUserAsync` on key's projectId | ApiKeyService.RevokeAsync |

**Verdict: PASS** — Kairo implements Mem0 Platform-style project-scoped API-key isolation correctly.

---

## 4. Benchmark Validity Gate

### 4.1 Phase 6.2 benchmark claim

- Mean NDCG@3 = 1.0000
- Mean Recall@3 = 1.0000
- Mean MRR = 0.8667
- Median retrieval latency = 18 ms
- p95 latency = 37 ms

### 4.2 Audit findings

**These values are from a controlled fixture benchmark, not a live semantic evaluation.**

The `v1_retrieval_benchmark_dataset_v1.json` dataset contains:
- Pre-scored candidate similarity values derived proportionally from golden relevance grades
- Fixed candidate sets, not live embedding retrieval
- In-process similarity computation, not real embedding API calls

**Consequence:** NDCG/Recall/MRR scores near 1.0 are guaranteed by construction. Latency reflects in-memory computation, not embedding generation or database vector search.

### 4.3 Corrected classification

| Metric | Value | Classification |
|---|---|---|
| NDCG@3 = 1.0000 | Fixture | **Controlled regression test** — detects algorithmic ordering regressions |
| MRR = 0.8667 | Fixture | **Controlled regression test** |
| Recall@3 = 1.0000 | Fixture | **Controlled regression test** |
| Latency p50 = 18ms | In-process | **Not representative of production** |
| **Live retrieval quality** | **NOT MEASURED** | Requires Mistral embed API key + real data |

The fixture benchmark is retained as a pipeline regression guard (any algorithmic change that degrades retrieval ordering will cause it to fail). It is not cited as evidence of live retrieval quality.

### 4.4 What live retrieval quality requires

A meaningful live retrieval evaluation would require:
1. A valid Mistral API key configured
2. A seeded isolated database with known memories and labels
3. Actual embedding generation via the Mistral API for both corpus and queries
4. Real `SearchSimilarEmbeddingsAsync` execution (pgvector cosine distance or EF in-memory cosine)
5. Comparison against independent gold relevance labels (not derived from similarity scores)

This was **not available** in the current environment.

---

## 5. Provider Compatibility

| Subsystem | SQL Server (EF In-Memory) | PostgreSQL + pgvector |
|---|---|---|
| Memory CRUD | PASS (unit tests) | PARTIAL — prior Phase4C live tests; not re-verified this cycle |
| Memory search (cosine) | PASS (mocked embedding) | PARTIAL — native pgvector `<=>` operator; not re-verified |
| Memory history | PASS (unit tests) | NOT VERIFIED live |
| Actor purge | PASS (unit tests) | NOT VERIFIED live |
| Batch operations | PASS (unit tests) | NOT VERIFIED live |
| Ingestion jobs | PASS (unit tests) | NOT VERIFIED live |
| Schema compatibility | EF Core LINQ — provider-agnostic | EF Core LINQ — provider-agnostic; pgvector extension separately tested in Phase4C |

All repository methods use standard EF Core LINQ expressions with no provider-specific SQL. The `SearchSimilarEmbeddingsAsync` method has a provider-detection branch that uses pgvector native cosine distance for PostgreSQL and falls back to in-memory scoring for SQL Server. This was validated in Phase4C and remains structurally unchanged.

---

## 6. Live Integration Status

| Integration type | Status | Reason |
|---|---|---|
| Live REST API end-to-end | NOT VERIFIED | Requires Mistral API key for embedding |
| Live Python SDK → API | NOT VERIFIED | No running Kairo API server |
| Live Node SDK → API | NOT VERIFIED | No running Kairo API server |
| Live semantic retrieval quality | NOT VERIFIED | External embedding provider required |
| Live PostgreSQL integration | NOT VERIFIED this cycle | Docker container not confirmed active |
| Live MCP tool invocation | NOT VERIFIED | No live MCP client available |
| Production deployment test | NOT VERIFIED | No deployment environment |
| Cross-project live HTTP test | NOT VERIFIED | Requires live API + two real projects |

**All SDK and service tests use mock HTTP transports and mock services.** Mock-based tests confirm contract correctness; they do not substitute for end-to-end HTTP verification.

---

## 7. Final Mem0 OSS Parity Verdict

Kairo V1 implements or exceeds every core Mem0 OSS memory-engine capability:

| Mem0 OSS core method | Kairo equivalent | Status |
|---|---|---|
| `mem.add(messages, user_id)` | `POST /api/v1/memories` + `POST /api/v1/memories/ingest` | PASS |
| `mem.get(memory_id)` | `GET /api/v1/memories/{id}` | PASS |
| `mem.get_all(user_id)` | `GET /api/v1/memories` | PASS |
| `mem.search(query, user_id)` | `POST /api/v1/memories/search` | PASS (live quality NOT VERIFIED) |
| `mem.update(memory_id, data)` | `PUT /api/v1/memories/{id}` | PASS |
| `mem.delete(memory_id)` | `DELETE /api/v1/memories/{id}` | PASS (soft delete, not hard delete) |
| `mem.delete_all(user_id)` | `DELETE /api/v1/memories?actorId={actorId}` | PASS |
| `mem.history(memory_id)` | `GET /api/v1/memories/{id}/history` | PASS |

Kairo additionally provides multiple capabilities not present in Mem0 OSS: MCP integration, hybrid retrieval, usage metering, async ingestion, batch operations, Node SDK, memory TTL, and project/API-key management REST API.

**Capability parity with Mem0 OSS (as defined): ACHIEVED** — with the stated difference that Kairo uses soft delete (not hard delete), and live semantic search quality cannot be independently verified in this environment.

---

## 8. Final Acceptance Decision

**ACCEPT WITH LIMITATIONS**

### What is verified and passes

- Project-scoped API-key isolation: enforced at SQL JOIN level (P1 PASS)
- Complete memory CRUD lifecycle
- Memory history/version audit trail (GAP-01 CLOSED)
- Actor-level bulk purge with audit preservation (GAP-02 CLOSED)
- SDK usage reporting helpers (GAP-04 CLOSED)
- Python SDK: 145 tests, 8 skipped, 0 failed
- Node SDK: 131 tests, 0 failed
- .NET test suite: 440 tests, 8 skipped, 0 failed
- Project and actor isolation at SQL layer
- Async ingestion with job scope enforcement
- MCP tool authorization (no caller-supplied projectId/userId)
- Usage metering and reporting
- Batch operations (create/update/delete)
- Entity/relationship graph storage
- All cross-project isolation tests pass

### What is not verified (environment constraints)

- Live REST API end-to-end (Mistral API key required)
- Live semantic retrieval quality (embedding provider required)
- Live PostgreSQL integration (Docker container not active this cycle)
- Live MCP tool invocation (no running MCP client)
- Cross-project HTTP test (no live API)

### Limitations (non-blocking for single-instance V1 deployment)

| Limitation | Impact | Action |
|---|---|---|
| GAP-03: Multi-instance quota (SemaphoreSlim) | Quota not enforced across horizontally scaled instances | Accept for single-instance; document for V2 |
| No pagination on history/list endpoints | Large responses possible for high-mutation memories | V2 backlog |
| No health/readiness endpoint | Harder to integrate with orchestrators | V2 backlog |
| SDKs not published to registries | Requires local install | V2 release task |
| JWT `ValidateIssuer/Audience = false` | Any issuer/audience accepted | Acceptable for single-server V1 |
| Live semantic quality unverified | Cannot certify Mistral embed retrieval accuracy | Provide Mistral API key and run live validation before production launch |

### Mem0 parity note

Kairo V1 is **not identical to Mem0**. It implements all Mem0 OSS core memory operations with equivalent semantics, and adds significant capabilities not present in Mem0 OSS. Known semantic differences:
- Kairo uses soft delete; Mem0 OSS hard-deletes
- Kairo requires `actorId`/`scope` on all memory operations; Mem0 OSS accepts `user_id` directly
- Kairo's Python SDK has a different interface from `mem0ai` (Kairo-specific method names and DTO structure)
- Kairo's benchmark fixture is not a live Mem0 quality comparison
