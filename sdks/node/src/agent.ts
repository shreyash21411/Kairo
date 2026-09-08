import { Kairo } from "./client";
import {
    CreateMemoryResult,
    DeleteMemoryResult,
    Memory,
    MemorySearchResponse,
    MemoryType,
} from "./models";

/**
 * Thin agent-facing memory abstraction built on the Kairo SDK.
 *
 * Wraps {@link Kairo}.memories with semantics suited to an AI agent:
 *
 * - {@link remember} — persist durable information
 * - {@link recall}   — retrieve semantically relevant memories
 * - {@link update}   — correct an existing memory
 * - {@link forget}   — deactivate a memory
 *
 * All operations delegate directly to the existing Kairo REST API
 * through the frozen SDK. No memory logic is implemented here.
 *
 * ## Architecture
 *
 * ```
 * Agent
 *   |
 *   +-- KairoAgentMemory
 *         |
 *         v
 *   kairo.memories.*       (existing frozen SDK)
 *         |
 *         v
 *   Kairo REST API
 *         |
 *         v
 *   Memory Engine / SQL / Embeddings / Mistral
 * ```
 *
 * ## Responsibility boundaries
 *
 * **Kairo is responsible for:**
 * - Persisting memory
 * - Detecting duplicates
 * - Generating embeddings
 * - Semantic retrieval
 * - Memory versioning and lifecycle
 *
 * **The agent/developer remains responsible for:**
 * - Deciding what information is worth remembering
 * - Deciding when to recall context
 * - Constructing LLM prompts
 * - Generating responses
 * - Agent reasoning
 *
 * Kairo does not run the agent loop. Kairo does not call the LLM.
 *
 * @example
 * ```typescript
 * import { Kairo } from "@kairo/sdk";
 * import { KairoAgentMemory } from "@kairo/sdk/agent";
 *
 * const kairo = new Kairo({ apiKey: process.env.KAIRO_API_KEY! });
 * const memory = new KairoAgentMemory(kairo);
 *
 * // 1. Before calling the LLM — recall relevant context
 * const context = await memory.recall({
 *     query: "What are the user's coding preferences?",
 *     topK: 5,
 * });
 * for (const m of context.memories) {
 *     console.log(`[${m.similarity.toFixed(4)}] ${m.content}`);
 * }
 *
 * // 2. After the LLM response — store durable information
 * const result = await memory.remember({
 *     content: "User strictly requires type hints in all Python code",
 *     memoryType: "Preference",
 * });
 *
 * // 3. Correct an existing memory
 * await memory.update(result.memory!.memoryId, {
 *     content: "User strictly requires type hints and docstrings",
 *     memoryType: "Preference",
 * });
 *
 * // 4. Deactivate a memory that is no longer relevant
 * await memory.forget(result.memory!.memoryId);
 * ```
 */
export class KairoAgentMemory {
    private readonly _client: Kairo;

    /**
     * @param client An authenticated {@link Kairo} SDK client.
     */
    constructor(client: Kairo) {
        this._client = client;
    }

    // ── remember ──────────────────────────────────────────────────────────────

    /**
     * Store durable information as a Kairo memory.
     *
     * Delegates to `POST /api/v1/memories`.
     *
     * The backend automatically detects exact and semantic duplicates.
     * When a duplicate is detected, no new record is created. Check
     * `result.isDuplicate` to distinguish the two cases.
     *
     * The agent is responsible for deciding *what* to remember.
     * Kairo handles persistence, duplicate detection, and embedding.
     *
     * @param request - Memory content and type.
     * @returns A {@link CreateMemoryResult}.
     *
     * @example
     * ```typescript
     * const result = await memory.remember({
     *     content: "User prefers concise technical answers",
     *     memoryType: "Preference",
     * });
     * if (!result.isDuplicate) {
     *     console.log("Stored memory:", result.memory!.memoryId);
     * }
     * ```
     */
    async remember(request: {
        content: string;
        memoryType: MemoryType;
    }): Promise<CreateMemoryResult> {
        return this._client.memories.create({
            content: request.content,
            memoryType: request.memoryType,
        });
    }

    // ── recall ────────────────────────────────────────────────────────────────

    /**
     * Retrieve semantically relevant memories for a given query.
     *
     * Delegates to `POST /api/v1/memories/search`.
     *
     * The backend generates an embedding for the query, computes cosine
     * similarity against all stored memories, and applies relevance
     * evaluation to return the most contextually appropriate results.
     *
     * The agent is responsible for incorporating the recalled context
     * into its LLM prompt. Kairo does not construct or send prompts.
     *
     * @param request - Query string and optional topK limit.
     * @returns A {@link MemorySearchResponse}.
     *
     * @example
     * ```typescript
     * const context = await memory.recall({
     *     query: "What programming languages does the user work with?",
     *     topK: 3,
     * });
     * for (const m of context.memories) {
     *     console.log(`[${m.similarity.toFixed(4)}] ${m.content}`);
     * }
     * ```
     */
    async recall(request: {
        query: string;
        topK?: number;
    }): Promise<MemorySearchResponse> {
        return this._client.memories.search({
            query: request.query,
            topK: request.topK,
        });
    }

    // ── update ────────────────────────────────────────────────────────────────

    /**
     * Correct or refine an existing memory.
     *
     * Delegates to `PUT /api/v1/memories/{memoryId}`.
     *
     * The backend archives the previous version and regenerates the
     * semantic embedding for the updated content.
     *
     * @param memoryId - The ID of the memory to update.
     * @param request  - Updated content and type.
     * @returns The updated {@link Memory}.
     *
     * @example
     * ```typescript
     * const updated = await memory.update(42, {
     *     content: "User strictly requires type hints in Python",
     *     memoryType: "Preference",
     * });
     * ```
     */
    async update(
        memoryId: number,
        request: {
            content: string;
            memoryType: MemoryType;
        }
    ): Promise<Memory> {
        return this._client.memories.update(memoryId, {
            content: request.content,
            memoryType: request.memoryType,
        });
    }

    // ── forget ────────────────────────────────────────────────────────────────

    /**
     * Deactivate a memory that is no longer accurate or relevant.
     *
     * Delegates to `DELETE /api/v1/memories/{memoryId}`.
     *
     * The memory record is preserved in the Kairo database. It is marked
     * inactive and will no longer appear in recall results. This reflects
     * the soft-deletion behaviour of the Kairo backend.
     *
     * @param memoryId - The ID of the memory to deactivate.
     * @returns A {@link DeleteMemoryResult}.
     *
     * @example
     * ```typescript
     * const result = await memory.forget(42);
     * console.log(result.message);
     * ```
     */
    async forget(memoryId: number): Promise<DeleteMemoryResult> {
        return this._client.memories.delete(memoryId);
    }

    toString(): string {
        return `KairoAgentMemory(${this._client.toString()})`;
    }
}
