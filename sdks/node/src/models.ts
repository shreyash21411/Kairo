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
}

/**
 * A memory returned from a semantic search, ranked by similarity score.
 */
export interface RetrievedMemory {
    memoryId: number;
    content: string;
    memoryType: string | null;
    /** Cosine similarity score in the range [0, 1]. Higher is more relevant. */
    similarity: number;
}

/**
 * Response from a semantic memory search.
 */
export interface MemorySearchResponse {
    /** The original query string. */
    query: string;
    /** Number of relevant memories found. */
    count: number;
    /** Relevant memories, ordered by descending similarity. */
    memories: RetrievedMemory[];
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
}

/** Request body for updating an existing memory. */
export interface UpdateMemoryRequest {
    /** Updated memory content text. Maximum 10,000 characters. */
    content: string;
    /** Updated memory classification. */
    memoryType: MemoryType;
}

/** Request parameters for a semantic memory search. */
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
