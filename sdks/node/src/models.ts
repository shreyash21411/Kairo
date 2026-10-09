/**
 * Kairo SDK typed models.
 *
 * These types mirror the Kairo REST API response contracts exactly.
 * Field names match the backend JSON (camelCase) so no transformation
 * is required when deserialising responses.
 */

// ── Memory type ───────────────────────────────────────────────────────────────

/**
 * Supported memory classification values.
 * The backend is the authoritative source of validation.
 */
export type MemoryType =
    | "Preference"
    | "Fact"
    | "Goal"
    | "Context"
    | "Skill"
    | "Relationship"
    | "Other";

// ── Response models ───────────────────────────────────────────────────────────

/**
 * A memory stored in Kairo.
 *
 * Returned by create(), get(), list(), and update().
 */
export interface Memory {
    /** Unique memory identifier. */
    memoryId: number;
    /** ID of the authenticated user who owns this memory. */
    userId: number;
    /** Memory content text. */
    content: string;
    /** Memory classification. */
    memoryType: string | null;
    /** Whether the memory is active. Soft-deleted memories have isActive=false. */
    isActive: boolean;
    /** ISO 8601 creation timestamp. */
    createdAt: string;
    /** ISO 8601 last-updated timestamp. */
    updatedAt: string;
    /** Phase 2: ISO 8601 event or fact occurrence timestamp. Null when not set. */
    occurredAt?: string | null;
    /** Phase 2: Arbitrary application-defined metadata JSON string. Null when not set. */
    metadata?: string | null;
    /** Phase 3: ISO 8601 expiration timestamp. Null when memory does not expire. */
    expiresAt?: string | null;
    /** Phase 3: List of category tags associated with this memory. */
    categories?: string[];
}

/**
 * A memory returned from a semantic or hybrid search, ranked by similarity score.
 */
export interface RetrievedMemory {
    memoryId: number;
    content: string;
    memoryType: string | null;
    /** Cosine similarity score in the range [0, 1]. Higher is more relevant. */
    similarity: number;
    /** Phase 2: ISO 8601 event or fact occurrence timestamp. Null when not set. */
    occurredAt?: string | null;
    /** Phase 2: Arbitrary application-defined metadata JSON string. Null when not set. */
    metadata?: string | null;
    /** Phase 3: ISO 8601 expiration timestamp. Null when memory does not expire. */
    expiresAt?: string | null;
    /** Phase 3: List of category tags associated with this memory. */
    categories?: string[];
}

// ── Phase 2: Graph Relations ──────────────────────────────────────────────────

/**
 * Phase 2: A directed relationship between two named entities in the knowledge graph.
 *
 * Returned in MemorySearchResponse.relations when hybrid search is used.
 */
export interface GraphRelation {
    /** Display name of the source entity. */
    source: string;
    /** Relationship type / predicate (e.g. "works_at", "located_in"). */
    relationship: string;
    /** Display name of the target entity. */
    target: string;
    /** Confidence score in the range [0, 1]. */
    confidence: number;
}

/**
 * Response from a semantic or hybrid memory search.
 */
export interface MemorySearchResponse {
    /** The original query string. */
    query: string;
    /** Number of relevant memories found. */
    count: number;
    /** Relevant memories, ordered by descending similarity. */
    memories: RetrievedMemory[];
    /**
     * Phase 2: Scoped knowledge graph relationships connecting entities
     * found in the query. Empty when hybrid search was not requested or
     * no relationships exist for the extracted entities.
     */
    relations: GraphRelation[];
}

/**
 * Result of a memory deletion (soft-deactivation) request.
 *
 * The memory record is preserved in the database and marked inactive.
 * It will no longer appear in list or search results.
 */
export interface DeleteMemoryResult {
    memoryId: number;
    message: string;
}

/**
 * Result of a memory creation request.
 *
 * The backend automatically detects exact and semantic duplicates.
 * When a duplicate is detected, no new record is created.
 *
 * - If `isDuplicate` is `false`, `memory` holds the newly created Memory.
 * - If `isDuplicate` is `true`, `memory` is `null` and `duplicateReason`
 *   explains why the content was not stored.
 *
 * @example
 * ```typescript
 * const result = await kairo.memories.create({
 *     content: "User prefers dark mode",
 *     memoryType: "Preference",
 *     actorId: "user-123",
 * });
 *
 * if (result.isDuplicate) {
 *     console.log("Duplicate:", result.duplicateReason);
 * } else {
 *     console.log("Created:", result.memory!.memoryId);
 * }
 * ```
 */
export interface CreateMemoryResult {
    memory: Memory | null;
    isDuplicate: boolean;
    duplicateReason: string | null;
}

// ── Request models ────────────────────────────────────────────────────────────

// ── Phase 1: Multi-dimensional Memory Scope ──────────────────────────────────

/**
 * Multi-dimensional memory scope for Phase 1+ scoping.
 */
export interface MemoryScopeKey {
    /** Application-level actor identifier (V1 legacy). */
    actorId?: string;
    /** Application-level user identifier. */
    userId?: string;
    /** Application-level agent identifier. */
    agentId?: string;
    /** Conversation session identifier. */
    sessionId?: string;
    /** Execution run identifier. */
    runId?: string;
}

// ── Phase 2: Temporal Filters ─────────────────────────────────────────────────

/**
 * Phase 2: Temporal filtering constraints for memory retrieval.
 *
 * Supports absolute UTC timestamp boundaries and relative-time convenience windows.
 * All boundary comparisons are inclusive. UTC is assumed for all timestamps.
 *
 * Relative windows (lastHours, lastDays, lastWeeks) apply to the CreatedAt column.
 * When multiple relative constraints are provided, the most restrictive (latest) bound is used.
 *
 * @example
 * ```typescript
 * // Search memories created in the last 7 days
 * const results = await kairo.memories.search({
 *     query: "recent preferences",
 *     actorId: "user-123",
 *     hybrid: true,
 *     temporal: { lastDays: 7 },
 * });
 * ```
 */
export interface MemoryTemporalFilter {
    /** Include memories created at or after this UTC timestamp. */
    createdAtFrom?: string;
    /** Include memories created at or before this UTC timestamp. */
    createdAtTo?: string;
    /** Include memories updated at or after this UTC timestamp. */
    updatedAtFrom?: string;
    /** Include memories updated at or before this UTC timestamp. */
    updatedAtTo?: string;
    /** Include memories whose occurredAt is at or after this UTC timestamp. */
    occurredAtFrom?: string;
    /** Include memories whose occurredAt is at or before this UTC timestamp. */
    occurredAtTo?: string;
    /** Include memories created within the last N hours. */
    lastHours?: number;
    /** Include memories created within the last N days. */
    lastDays?: number;
    /** Include memories created within the last N weeks. */
    lastWeeks?: number;
}

// ── Phase 2: Metadata Filters ─────────────────────────────────────────────────

/**
 * Phase 2: A structured metadata filter condition with an explicit operator.
 *
 * Supported operators:
 * - `"eq"` (default): exact match (case-insensitive)
 * - `"ne"`: not equal
 * - `"in"`: value contained in the provided list (use `inValues`)
 */
export interface MetadataFilterCondition {
    /** Metadata JSON property key. */
    key: string;
    /** Comparison operator: "eq", "ne", or "in". Defaults to "eq". */
    operator: "eq" | "ne" | "in";
    /** Value for "eq" or "ne" comparisons. */
    value?: string;
    /** Values for "in" membership comparisons. */
    inValues?: string[];
}

/** Request body for creating a new memory. */
export interface CreateMemoryRequest {
    /** Memory content text. Maximum 10,000 characters. */
    content: string;
    /** Memory classification. */
    memoryType: MemoryType;
    /** Application-level actor identifier for memory scoping. */
    actorId?: string;
    /** Multi-dimensional memory scope key (Phase 1+). */
    scope?: MemoryScopeKey;
    /**
     * Phase 2: ISO 8601 event or fact occurrence timestamp.
     * Represents when the fact or event described in the memory occurred,
     * as opposed to when the memory was created in Kairo.
     */
    occurredAt?: string;
    /**
     * Phase 2: Arbitrary application-defined metadata dictionary.
     * The serialized JSON must not exceed 8,192 characters.
     */
    metadata?: Record<string, unknown>;
    /** Phase 3: ISO 8601 expiration timestamp. */
    expiresAt?: string;
    /** Phase 3: Time-to-live in seconds. Converted to expiresAt = createdAt + ttl on backend. */
    ttl?: number;
    /** Phase 3: Extensible category tag (convenience single category). */
    category?: string;
    /** Phase 3: Extensible category tags for this memory. */
    categories?: string[];
}

/** Request body for updating an existing memory. */
export interface UpdateMemoryRequest {
    /** Updated memory content text. Maximum 10,000 characters. */
    content: string;
    /** Updated memory classification. */
    memoryType: MemoryType;
    /**
     * Phase 2: Updated ISO 8601 event or fact occurrence timestamp.
     * Pass null to clear a previously set occurrence time.
     */
    occurredAt?: string | null;
    /**
     * Phase 2: Updated arbitrary application-defined metadata dictionary.
     * The serialized JSON must not exceed 8,192 characters.
     * Pass null to clear existing metadata.
     */
    metadata?: Record<string, unknown> | null;
    /** Phase 3: Updated ISO 8601 expiration timestamp. Pass null to remove expiration. */
    expiresAt?: string | null;
    /** Phase 3: Updated time-to-live in seconds. */
    ttl?: number | null;
    /** Phase 3: Updated extensible category tag (convenience single category). */
    category?: string | null;
    /** Phase 3: Updated category tags. Pass empty array or null to clear categories. */
    categories?: string[] | null;
}

/** Request parameters for a semantic or hybrid memory search. */
export interface MemorySearchRequest {
    /** Natural-language search query. */
    query: string;
    /** Application-level actor identifier for memory scoping. */
    actorId?: string;
    /** Multi-dimensional memory scope key (Phase 1+). */
    scope?: MemoryScopeKey;
    /** Maximum number of memories to return. Range: 1–100. Defaults to 5. */
    topK?: number;
    /** When true, uses hybrid retrieval (semantic + keyword + entity). */
    hybrid?: boolean;
    /**
     * Phase 2: Temporal filter constraints.
     * Only used when hybrid is true.
     */
    temporal?: MemoryTemporalFilter;
    /**
     * Phase 2: Key-value metadata equality filter (shorthand).
     * Each key-value pair maps to an "eq" condition.
     * For more complex operators use structuredFilters.
     */
    metadataFilters?: Record<string, string>;
    /**
     * Phase 2: Structured metadata filter conditions with explicit operators.
     * Conditions are combined with AND semantics.
     * Takes precedence over metadataFilters when both are supplied.
     */
    structuredFilters?: MetadataFilterCondition[];
    /**
     * Phase 2: When true, applies recency-aware relevance score boosting.
     * Formula: 0.85 × base_score + 0.15 × exp(-0.05 × age_in_days).
     * Default is false. V1 search behavior is unchanged when not set.
     */
    recencyBoost?: boolean;
    /**
     * Phase 2: Depth of graph relationship traversal in results (1 or 2).
     * Default is 1. Maximum is 2. Only used when hybrid is true.
     */
    graphDepth?: number;
    /** Phase 3: Single category filter. */
    category?: string;
    /** Phase 3: Extensible category filters (IN condition). */
    categories?: string[];
}

// ── Phase 3: Batch Operations ─────────────────────────────────────────────────

export interface BatchCreateMemoryItem {
    content: string;
    memoryType?: MemoryType;
    actorId?: string;
    scope?: MemoryScopeKey;
    occurredAt?: string;
    metadata?: Record<string, unknown>;
    expiresAt?: string;
    ttl?: number;
    category?: string;
    categories?: string[];
}

export interface BatchCreateMemoriesRequest {
    memories: BatchCreateMemoryItem[];
}

export interface BatchOperationError {
    memoryId?: number | null;
    index?: number | null;
    message: string;
}

export interface BatchCreateResponse {
    success: boolean;
    createdCount: number;
    memories: Memory[];
    errors: BatchOperationError[];
}

export interface BatchUpdateMemoryItem {
    memoryId: number;
    content?: string;
    memoryType?: MemoryType;
    occurredAt?: string | null;
    metadata?: Record<string, unknown> | null;
    expiresAt?: string | null;
    ttl?: number | null;
    category?: string | null;
    categories?: string[] | null;
}

export interface BatchUpdateMemoriesRequest {
    memories: BatchUpdateMemoryItem[];
}

export interface BatchUpdateResponse {
    success: boolean;
    updatedCount: number;
    memories: Memory[];
    errors: BatchOperationError[];
}

export interface BatchDeleteMemoriesRequest {
    memoryIds: number[];
}

export interface BatchDeleteResponse {
    success: boolean;
    deletedCount: number;
    deletedIds: number[];
    errors: BatchOperationError[];
}

// ── Phase 4: Conversational Ingestion ─────────────────────────────────────────

/**
 * A single message within a conversation submitted for memory ingestion.
 */
export interface MemoryMessage {
    /**
     * The role of the speaker.
     * Accepted values: "user", "assistant", "system".
     */
    role: string;
    /** The text content of the message. */
    content: string;
}

/**
 * Request body for conversational memory ingestion.
 * POST /api/v1/memories/ingest
 */
export interface IngestRequest {
    /** Application-level actor identifier for memory scoping. */
    actorId?: string;
    /** Multi-dimensional memory scope key (Phase 1+). */
    scope?: MemoryScopeKey;
    /** Conversation messages to analyze. Must contain at least one message. */
    messages: MemoryMessage[];
}

/**
 * The action taken by Kairo for a single extracted memory candidate.
 *
 * - "Add": A new memory was created.
 * - "Update": An existing memory was superseded or replaced.
 * - "Merge": An existing memory was enriched with complementary context.
 * - "NoAction": The content was a duplicate or non-salient; no change was made.
 */
export type IngestionAction = "Add" | "Update" | "Merge" | "NoAction";

/**
 * The result for a single memory candidate processed during ingestion.
 */
export interface IngestionMemoryResult {
    /** The consolidation operation performed. */
    action: IngestionAction;
    /** The ID of the affected memory. Null for NoAction. */
    memoryId: number | null;
    /** The persisted or canonical memory content. */
    content: string;
    /** Optional explanation for the action (especially for Merge and Update). */
    reason: string | null;
}

/**
 * Response from POST /api/v1/memories/ingest.
 *
 * @example
 * ```typescript
 * const result = await kairo.memories.ingest({
 *     actorId: "user-123",
 *     messages: [
 *         { role: "user", content: "I prefer PostgreSQL for backend applications." }
 *     ],
 * });
 *
 * for (const mem of result.memories) {
 *     console.log(`[${mem.action}] ${mem.content}`);
 * }
 * ```
 */
export interface IngestResponse {
    /** Whether the ingestion pipeline completed without fatal error. */
    processed: boolean;
    /** Number of candidates extracted from the conversation. */
    extractedCount: number;
    /** Per-candidate results. Empty when extraction found nothing worth remembering. */
    memories: IngestionMemoryResult[];
}

// ── Internal raw response shapes ──────────────────────────────────────────────
// These are used internally to deserialise backend responses and are not
// exported as part of the public API surface.

/** @internal */
export interface _MemoryListResponse {
    userId: number;
    count: number;
    memories: Memory[];
}

/** @internal */
export interface _DuplicateResult {
    isDuplicate: true;
    reason: string;
}
