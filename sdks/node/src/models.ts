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

/** Request body for creating a new memory. */
export interface CreateMemoryRequest {
    /** Memory content text. Maximum 10,000 characters. */
    content: string;
    /** Memory classification. */
    memoryType: MemoryType;
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
    /** Maximum number of memories to return. Range: 1–100. Defaults to 5. */
    topK?: number;
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
