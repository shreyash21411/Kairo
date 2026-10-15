/**
 * @kairo/sdk — Official Kairo Node.js/TypeScript SDK
 *
 * @example
 * ```typescript
 * import { Kairo } from "@kairo/sdk";
 *
 * const kairo = new Kairo({ apiKey: process.env.KAIRO_API_KEY! });
 *
 * const result = await kairo.memories.create({
 *     content: "User prefers dark mode",
 *     memoryType: "Preference",
 *     actorId: "user-123",
 * });
 * ```
 */

// ── Client ────────────────────────────────────────────────────────────────────
export { Kairo, KairoClient } from "./client";
export type { KairoConfig } from "./client";

// ── Agent Integration ─────────────────────────────────────────────────────────
export { KairoAgentMemory } from "./agent";
export type { KairoAgentMemoryOptions } from "./agent";

// ── Exceptions ────────────────────────────────────────────────────────────────
export {
    KairoError,
    KairoValidationError,
    KairoAuthenticationError,
    KairoAuthorizationError,
    KairoNotFoundError,
    KairoConflictError,
    KairoRateLimitError,
    KairoServerError,
    KairoConnectionError,
} from "./exceptions";

// ── Models / types ────────────────────────────────────────────────────────────
export type {
    MemoryType,
    Memory,
    MemoryScopeKey,
    RetrievedMemory,
    MemorySearchResponse,
    CreateMemoryRequest,
    UpdateMemoryRequest,
    MemorySearchRequest,
    CreateMemoryResult,
    DeleteMemoryResult,
    // Phase 2: Temporal filtering
    MemoryTemporalFilter,
    // Phase 2: Metadata filtering
    MetadataFilterCondition,
    // Phase 2: Graph relations
    GraphRelation,
    // Phase 3: Batch operations & responses
    BatchCreateMemoryItem,
    BatchCreateMemoriesRequest,
    BatchOperationError,
    BatchCreateResponse,
    BatchUpdateMemoryItem,
    BatchUpdateMemoriesRequest,
    BatchUpdateResponse,
    BatchDeleteMemoriesRequest,
    BatchDeleteResponse,
    // Phase 4: Conversational Ingestion
    MemoryMessage,
    IngestRequest,
    IngestionAction,
    IngestionMemoryResult,
    IngestResponse,
    // Phase 6.3: History, Purge & Usage
    MemoryVersion,
    MemoryHistoryResponse,
    ActorPurgeResponse,
    UsageBreakdownEntry,
    ProjectUsageReport,
    GetUsageOptions,
} from "./models";

// ── Resources ─────────────────────────────────────────────────────────────────
export { MemoryResource } from "./memories";
export { UsageResource } from "./usage";

