# Kairo V1 — Phase 6.1: V1 Baseline & Mem0 Parity Gap Inventory

---

> [!IMPORTANT]
> **Repository:** `F:\AI-Memory-Platform` | **Branch:** `Shrey` | **Starting/Ending Baseline Commit:** `ed1e406`
> **Protected Databases:** `SonaliDB` (`10.30.73.176`) and `kairo_dev` were **NEVER accessed, modified, dropped, or migrated**.
> **Status:** Read-only inspection, verification, and regression test execution. No staging, no commit, no push.

---

## 1. Executive Summary

This deliverable provides the forensic capability audit, architectural mapping, and Mem0 parity gap inventory for Kairo V1 following the completion of Phase 5.8 remediation. Every capability, service, endpoint, repository, test suite, and SDK was inspected against active code in the repository.

**Core Baseline Findings:**
1. **Repository Health:** Solution builds with **0 errors, 0 warnings**. Vulnerability scan reports **0 vulnerable packages** across all solution projects. The .NET test suite has **423 passed, 8 skipped, 0 failed (431 total)**. Python SDK has **136 passed, 8 skipped (144 total)**. Node SDK has **122 passed, 0 failed (122 total)**.
2. **Mem0 Parity Position:** Kairo achieves high parity with Mem0 V1 core capabilities (memory CRUD, semantic search, hybrid keyword/vector fusion, actor scoping, temporal boundaries, custom metadata, categories, TTL expiration, batch operations, async ingestion, and model/provider abstraction). Kairo differentiates with native MCP server integration, append-only usage ledger, per-project rate limiting/quotas, and dual-provider support (SQL Server and PostgreSQL + pgvector).
3. **Mem0 Reference Specification Notice:** No internal frozen `mem0_specification.md` document exists in the repository. The baseline evaluation was conducted against the documented Mem0 OSS v0.1.x / v1.x API contract (`add`, `get`, `get_all`, `search`, `update`, `delete`, `delete_all`, `history`, graph memory, and scoping).
4. **Key Gaps & Limitations:**
   - *Multi-Instance Rate Limiting (P2):* In-flight quota synchronization uses process-local `SemaphoreSlim`; in multi-instance horizontally scaled deployments, concurrent burst window checks rely on committed database ledger aggregates.
   - *Memory History/Audit Log API (P2):* `MemoryVersions` entity exists and tracks version history in EF Core, but an explicit `GET /api/v1/memories/{id}/history` REST endpoint is not yet exposed.
   - *Graph Memory Engine (P2):* Kairo uses an entity-relationship schema in SQL Server/PostgreSQL; Mem0 supports external graph databases (Neo4j, AWS Neptune).
   - *Reset/Delete-All Verb (P3):* Mem0 provides `reset()`; Kairo requires project deletion or scoped `batch_delete`.

---

## 2. Comprehensive Repository Baseline Inventory

### 2.1 Domain & Application Architecture
- **Entities:**
  - [`Memories`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/Entities/Memories.cs): Core memory record with `MemoryId`, `UserId`, `ScopeId`, `Content`, `MemoryType`, `IsActive`, `CreatedAt`, `UpdatedAt`, `OccurredAt`, `ExpiresAt`.
  - [`MemoryScopes`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/Entities/MemoryScopes.cs): Multi-dimensional scope (`ScopeKey`, `ActorId`, `UserId`, `AgentId`, `SessionId`, `RunId`, `ProjectId`).
  - [`MemoryEmbeddings`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/Entities/MemoryEmbeddings.cs): Vector store holding model, dimensions, vector data (JSON string or PostgreSQL native `vector`).
  - [`MemoryCategories`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/Entities/MemoryCategory.cs): Normalized string categories.
  - [`MemoryMetadata`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/Entities/MemoryMetadata.cs): Key/Value/ValueType structured attributes.
  - [`MemoryVersions`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/Entities/MemoryVersion.cs): Append-only audit chain of memory mutations.
  - [`Entities`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/Entities/NamedEntity.cs) & [`EntityRelationships`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/Entities/EntityRelationship.cs): Relational knowledge graph.
  - [`MemoryIngestionJobs`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/Entities/MemoryIngestionJob.cs): Async background queue for dialogue ingestion.
  - [`UsageLedgerEntry`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/Entities/UsageLedgerEntry.cs): Append-only billable operation ledger.
  - [`ProjectQuota`](file:///f:/AI-Memory-Platform/backend/Kairo.Infrastructure/Persistence/Entities/ProjectQuota.cs): Per-project rate limits and capacity caps.
- **Application Services:**
  - `MemoryService`: Orchestrates memory CRUD, deduplication, scope resolution, batch operations, versioning.
  - `HybridRetrievalService`: Multi-channel retrieval (Semantic 70%, Keyword 20%, Entity 10%), recency weighting, LLM relevance evaluation, and Mistral LLM reranking.
  - `MemoryIngestionService`: Synchronous conversation ingestion with Mistral memory extraction and consolidation evaluator.
  - `MemoryJobService`: Asynchronous queueing and status polling for background ingestion.
  - `RerankerService`: Cross-encoder / LLM reranker with similarity preservation, candidate bounding, and deterministic tie-breaking.
  - `ScopeResolutionService`: Resolves and creates multi-dimensional memory scopes.
  - `ApiKeyService` & `AccountService`: Project, user, and API-key lifecycle management.

### 2.2 Infrastructure & Persistence
- **Dual-Provider Persistence:**
  - SQL Server (Default): LocalDB / Enterprise SQL Server, clustered indexes, JSON vector fallback.
  - PostgreSQL (`kairo-postgres` on `127.0.0.1:5433`): Native `pgvector` 0.8.7 extension with `<=>` cosine distance operator and HNSW/IVFFlat indexing.
- **Provider Abstractions:**
  - `IEmbeddingGenerator` & `IEmbeddingMetadataProvider`: Mistral 1024-dim embeddings.
  - `ILlmProvider`: Mistral chat completions for extraction and consolidation.
  - `IRerankProvider`: Mistral LLM reranker.

### 2.3 REST API, MCP & SDK Surface
- **REST Endpoints (`/api/v1`):**
  - `POST /api/v1/auth/register`, `POST /api/v1/auth/login`
  - `POST /api/v1/projects`, `GET /api/v1/projects`
  - `POST /api/v1/projects/{projectId}/keys`, `DELETE /api/v1/projects/{projectId}/keys/{keyId}`
  - `POST /api/v1/memories` (Create)
  - `GET /api/v1/memories/{id}` (Get)
  - `GET /api/v1/memories` (List)
  - `PUT /api/v1/memories/{id}` (Update)
  - `DELETE /api/v1/memories/{id}` (Delete)
  - `POST /api/v1/memories/search` (Hybrid Search)
  - `POST /api/v1/memories/batch` (Batch Create)
  - `DELETE /api/v1/memories/batch` (Batch Delete)
  - `POST /api/v1/memories/ingest` (Dialogue Ingestion, sync or async)
  - `GET /api/v1/memories/jobs/{jobId}` (Job Status)
  - `GET /api/v1/projects/{projectId}/usage` (Usage Reporting)
- **Model Context Protocol (MCP):**
  - Tools: `kairo_ping`, `remember`, `recall`, `update`, `forget`, `get_memory`, `remember_batch`, `forget_batch`, `ingest_dialogue`.
  - Security: All 9 tools enforce tenant isolation through `IApiKeyContext`; no client-controlled tenant IDs.
- **SDKs:**
  - Python SDK (`sdks/python`): 136 unit tests passing. Covers client, `KairoAgentMemory` adapter, typed models, error hierarchy.
  - Node SDK (`sdks/node`): 122 unit tests passing. Covers client, `KairoAgentMemory` adapter, typed models, error hierarchy.

---

## 3. Mem0 V1 Capability-Parity Matrix

| Capability | Mem0 Reference Requirement | Kairo Implementation | Existing Test Evidence | Execution Evidence | Status | Gap | Priority | Next Action |
|---|---|---|---|---|---|---|---|---|
| **Memory Add / Create** | `add(messages, user_id=...)` | `MemoryController.CreateMemory`, `MemoryService.CreateMemoryAsync`, MCP `remember` | `Phase1UnitTests`, `Phase58RemediationRegressionTests`, `test_contract.py` | Executed (All Pass) | **PASS** | None | - | No action |
| **Memory Get** | `get(memory_id)` | `MemoryController.GetMemory`, MCP `get_memory` | `Phase1UnitTests`, `Phase5McpBatchAndIngestUnitTests` | Executed (All Pass) | **PASS** | None | - | No action |
| **Memory List** | `get_all(user_id=...)` | `MemoryController.ListMemories` | `Phase1UnitTests`, `test_contract.py` | Executed (All Pass) | **PASS** | None | - | No action |
| **Memory Update** | `update(memory_id, data)` | `MemoryController.UpdateMemory`, MCP `update` | `Phase1UnitTests`, `Phase5McpExtendedAttributesUnitTests` | Executed (All Pass) | **PASS** | None | - | No action |
| **Memory Delete** | `delete(memory_id)` | `MemoryController.DeleteMemory`, MCP `forget` | `Phase1UnitTests`, `Phase58RemediationRegressionTests` | Executed (All Pass) | **PASS** | Soft delete only (data retained for audit) | P3 | Document retention policy |
| **Memory Reset / Delete All** | `delete_all(user_id=...)`, `reset()` | `BatchDeleteMemoriesAsync`, MCP `forget_batch` | `Phase5McpBatchAndIngestUnitTests` | Executed (All Pass) | **PARTIAL** | No dedicated single-verb `delete_all` endpoint without IDs | P2 | Implement `delete_all(actorId)` in Phase 6.3 |
| **Memory History** | `history(memory_id)` | `MemoryVersions` table exists in DB | `Phase3UnitTests` | Executed (DB only) | **PARTIAL** | REST/MCP endpoint `GET /memories/{id}/history` not exposed | P2 | Expose history endpoint in Phase 6.3 |
| **Semantic Vector Search** | `search(query)` cosine retrieval | `HybridRetrievalService`, `MemoryRepository` | `Phase2UnitTests`, `Phase4CVectorRetrievalIntegrationTests` | Executed (All Pass) | **PASS** | None | - | No action |
| **Keyword Search** | Verbatim keyword matching | `KeywordSearchRepository` | `Phase2UnitTests`, `Phase5BatchHydrationUnitTests` | Executed (All Pass) | **PASS** | None | - | No action |
| **Hybrid Search (Fusion)** | Hybrid vector + BM25 fusion | `HybridRetrievalService.RetrieveWithRelationsAsync` | `Phase2UnitTests`, `Phase5HybridVectorRetrievalUnitTests` | Executed (All Pass) | **PASS** | None | - | No action |
| **Reranking** | Cross-encoder / LLM reranking | `RerankerService`, `MistralLlmRerankProvider` | `Phase5RerankerUnitTests`, `Phase5RerankerResilienceAndQualityTests` | Executed (All Pass) | **PASS** | None | - | No action |
| **Custom Metadata** | Arbitrary key-value metadata | `MemoryMetadata` entity, REST `Metadata`, MCP `metadata` | `Phase5McpExtendedAttributesUnitTests`, `Phase2UnitTests` | Executed (All Pass) | **PASS** | None | - | No action |
| **Categories / Tags** | Category filtering and labeling | `MemoryCategories` entity, REST `Categories`, MCP `categories` | `Phase5McpExtendedAttributesUnitTests`, `Phase5McpRecallFiltersUnitTests` | Executed (All Pass) | **PASS** | None | - | No action |
| **Temporal Filtering & Expiration** | Time-based queries & TTL | `ExpiresAt`, `OccurredAt`, `MemoryTemporalFilter` | `Phase2UnitTests`, `Phase5McpRecallFiltersUnitTests` | Executed (All Pass) | **PASS** | None | - | No action |
| **Multi-Agent / Actor Scoping** | `user_id`, `agent_id`, `run_id` | `MemoryScopes` (`ActorId`, `UserId`, `AgentId`, `SessionId`, `RunId`) | `Phase1UnitTests`, `McpSecurityUnitTests` | Executed (All Pass) | **PASS** | None | - | No action |
| **Relational / Graph Memory** | Graph relations between entities | `Entities`, `EntityRelationships`, `MemoryEntities` | `Phase2UnitTests`, `Phase5HybridVectorRetrievalUnitTests` | Executed (All Pass) | **PARTIAL** | Relational schema in SQL/PG rather than dedicated graph DB | P2 | Document relational graph trade-off |
| **Dialogue Ingestion & Consolidation**| Extract & consolidate dialogue turns | `MemoryIngestionService`, `MistralMemoryExtractor` | `MemoryIngestionUnitTests`, `Phase4AIngestionUnitTests` | Executed (Unit/Mock) | **PASS** | Live LLM tests skipped in CI when API key unset | P3 | Maintain intentional skip in offline CI |
| **Batch Operations** | Add / delete batch of memories | `BatchCreateMemoriesAsync`, `BatchDeleteMemoriesAsync` | `Phase5McpBatchAndIngestUnitTests`, `Phase58RemediationRegressionTests` | Executed (All Pass) | **PASS** | Max batch size bounded to 100 | - | No action |
| **Rate Limiting & Quotas** | Multi-tenant usage limits | `QuotaEnforcementService`, `UsageLedgerEntry` | `Phase58RemediationRegressionTests` | Executed (All Pass) | **PASS** | Process-local in-flight locks in multi-instance | P2 | Document multi-instance architectural trade-off |
| **Native Vector DB (PostgreSQL)** | pgvector native extension | `KairoDbContext` pgvector mapping, PostgreSQL container | `Phase4CPostgreSqlRegistrationUnitTests`, `Phase5HybridVectorRetrievalUnitTests` | Executed (5 Physical Tests Pass) | **PASS** | None | - | No action |
| **SQL Server Compatibility** | Enterprise relational vector storage | `phase5_usage_schema_sqlserver.sql`, `KairoDbContext` | Physical LocalDB test executed in Phase 5.8 | Executed (Verified Live) | **PASS** | None | - | No action |

---

## 4. End-to-End Workflow Mapping & Verification

| # | End-to-End Workflow | Repository Implementation | Unit Test Evidence | Physical DB Evidence | SDK / MCP Evidence | Verification Status |
|---|---|---|---|---|---|---|
| **1** | Create Project | `ProjectController.CreateProject` -> `ProjectService` | `Phase1UnitTests` | Verified on LocalDB | REST API verified | **VERIFIED** |
| **2** | Create & Use API Key | `ApiKeyController.CreateApiKey` -> `ApiKeyService` | `Phase1UnitTests` | Verified on LocalDB | Tested in Python & Node SDKs | **VERIFIED** |
| **3** | Enter Memory (Normal User Flow) | `MemoryController.CreateMemory` -> `MemoryService` | `Phase1UnitTests` | Verified on PostgreSQL & SQL Server | Python `memories.create`, Node `memories.create`, MCP `remember` | **VERIFIED** |
| **4** | Confirm Persistence | `KairoDbContext.Memories.Add` -> `SaveChangesAsync` | `Phase1UnitTests` | Verified on PostgreSQL `kairo_vector_test` | Verified via subsequent get/list | **VERIFIED** |
| **5** | Retrieve Memory by ID | `MemoryController.GetMemory` | `Phase1UnitTests` | Verified on PostgreSQL container | Python `memories.get(id)`, Node `memories.get(id)`, MCP `get_memory` | **VERIFIED** |
| **6** | Search Semantic & Keyword | `MemoryController.SearchMemories` -> `HybridRetrievalService` | `Phase2UnitTests`, `Phase5HybridVectorRetrievalUnitTests` | Verified on PostgreSQL `kairo_vector_test` | Python `memories.search`, Node `memories.search`, MCP `recall` | **VERIFIED** |
| **7** | Update Memory | `MemoryController.UpdateMemory` -> `MemoryService` | `Phase1UnitTests` | Verified on LocalDB | Python `memories.update`, Node `memories.update`, MCP `update` | **VERIFIED** |
| **8** | Delete Memory (Deactivate) | `MemoryController.DeleteMemory` -> Soft Delete | `Phase1UnitTests` | Verified on LocalDB | Python `memories.delete`, Node `memories.delete`, MCP `forget` | **VERIFIED** |
| **9** | Multi-Project Isolation | `IApiKeyContext.ProjectId` enforced server-side | `Phase1UnitTests`, `Phase58RemediationRegressionTests` | Verified in Benchmark (0 Leakage) | `McpSecurityUnitTests` reflection audit | **VERIFIED** |
| **10**| Invalid / Revoked API Keys | `ApiKeyAuthenticationHandler` rejects invalid keys | `Phase1UnitTests` | Verified in unit test suite | Python & Node SDK authentication error mapping | **VERIFIED** |
| **11**| SDK & MCP Operation Parity | `sdks/python`, `sdks/node`, `Kairo.MCP` | 136 Python tests, 122 Node tests | Contract tests verify endpoint routing | All 9 MCP tools verified | **VERIFIED** |
| **12**| Usage Ledger & Quota Accounting| `QuotaEnforcementService` & `UsageMeterService` | `Phase58RemediationRegressionTests` (26 tests) | Verified on LocalDB `UsageLedger` | Tool-level and controller-level metering verified | **VERIFIED** |
| **13**| Persistence Across Restart | Container volume `kairo_postgres_data` | Verified on `kairo-postgres` after restart | Verified on `kairo-postgres` container | Verified data survives process stop | **VERIFIED** |

---

## 5. Prioritized Remediation Backlog

| Gap ID | Severity | Category | Description | Minimal Remediation | Risk / Impact |
|---|---|---|---|---|---|
| **GAP-01** | **P2** | API / Parity | `MemoryVersions` entity exists, but no `GET /api/v1/memories/{id}/history` endpoint is exposed | Add `GetMemoryHistory(long id)` in `MemoryController` querying `MemoryVersions` | Low risk; read-only query |
| **GAP-02** | **P2** | API / Parity | No single-verb `delete_all` endpoint to purge all memories for a given actor/scope | Add `DELETE /api/v1/memories?actorId={actorId}` calling batch soft delete | Low risk; reuses `BatchDeleteMemoriesAsync` |
| **GAP-03** | **P2** | Architecture | Process-local `SemaphoreSlim` in `QuotaEnforcementService` | Document multi-instance architectural trade-off or schedule distributed Redis provider for V2 | Near-strict in-flight window does not block V1 single-instance/staging |
| **GAP-04** | **P3** | SDK Parity | Python and Node SDKs lack dedicated wrapper methods for the new Phase 5.8 Usage Reporting endpoint | Add `client.usage.get_report(project_id, from_date, to_date)` | Low risk; additive SDK extension |

---

## 6. Assumptions & Unresolved Requirements

1. **Mem0 Reference Baseline:** In the absence of an internal reference document in `F:\AI-Memory-Platform`, Mem0 parity was evaluated against public Mem0 OSS v0.1.x / v1.x core specifications. If a specific private enterprise profile is intended, that specification must be provided.
2. **Offline CI vs Live LLM:** 8 Phase 3 consolidation tests require live Mistral API credentials and are intentionally skipped in offline CI. This is the established baseline behavior and does not represent a code defect.
3. **Graph Storage Architecture:** Kairo implements graph memory natively in relational SQL (Entities and EntityRelationships), which avoids external graph database infrastructure dependencies (Neo4j/Neptune). This is an intentional architectural decision for Kairo V1.
