import { Kairo } from "./client";
import { KairoValidationError } from "./exceptions";
import {
    _DuplicateResult,
    _MemoryListResponse,
    CreateMemoryRequest,
    CreateMemoryResult,
    DeleteMemoryResult,
    IngestRequest,
    IngestResponse,
    Memory,
    MemoryMessage,
    MemorySearchRequest,
    MemorySearchResponse,
    UpdateMemoryRequest,
} from "./models";

/**
 * Provides all Kairo memory operations.
 *
 * Access via `kairo.memories` on a {@link Kairo} instance.
 * Do not instantiate this class directly.
 *
 * @example
 * ```typescript
 * const kairo = new Kairo({ apiKey: process.env.KAIRO_API_KEY! });
 *
 * // Create
 * const result = await kairo.memories.create({
 *     content: "User prefers dark mode",
 *     memoryType: "Preference",
 *     actorId: "user-123",
 * });
 *
 * // Search
 * const results = await kairo.memories.search({
 *     query: "What UI theme does the user prefer?",
 *     actorId: "user-123",
 * });
 * ```
 */
export class MemoryResource {
    private readonly _client: Kairo;

    constructor(client: Kairo) {
        this._client = client;
    }

    // ── Create ────────────────────────────────────────────────────────────────

    /**
     * Create a new memory for the authenticated user.
     *
     * Calls `POST /api/v1/memories`.
     *
     * The backend automatically detects exact and semantic duplicates.
     * When a duplicate is found, no new record is created. Check
     * `result.isDuplicate` to distinguish the two cases.
     *
     * @param request - Memory content and type.
     * @returns A {@link CreateMemoryResult}.
     *
     * @throws {KairoValidationError} If content is empty or memoryType is invalid.
     * @throws {KairoAuthenticationError} If the API key is invalid.
     *
     * @example
     * ```typescript
     * const result = await kairo.memories.create({
     *     content: "User works in Python and prefers type hints",
     *     memoryType: "Fact",
     *     actorId: "user-123",
     * });
     * if (!result.isDuplicate) {
     *     console.log("Stored memory", result.memory!.memoryId);
     * }
     * ```
     */
    async create(request: CreateMemoryRequest): Promise<CreateMemoryResult> {
        if (!request.content || request.content.trim() === "") {
            throw new KairoValidationError("content must not be empty.", 400);
        }
        if (!request.actorId || request.actorId.trim() === "") {
            throw new KairoValidationError("actorId must not be empty.", 400);
        }

        // The backend accepts the JSON field name 'memoryType' and 'actorId' (camelCase).
        const data = await this._client.request<Memory | _DuplicateResult>(
            "POST",
            "/api/v1/memories",
            {
                content: request.content,
                memoryType: request.memoryType,
                actorId: request.actorId,
            }
        );

        // Backend returns HTTP 200 with { isDuplicate: true, reason: "..." }
        // for duplicates, and HTTP 201 with a MemoryResponse for new records.
        if (
            data &&
            typeof data === "object" &&
            "isDuplicate" in data &&
            (data as _DuplicateResult).isDuplicate === true
        ) {
            const dup = data as _DuplicateResult;
            return {
                memory: null,
                isDuplicate: true,
                duplicateReason: dup.reason ?? null,
            };
        }

        return {
            memory: data as Memory,
            isDuplicate: false,
            duplicateReason: null,
        };
    }

    // ── Get ───────────────────────────────────────────────────────────────────

    /**
     * Retrieve a single memory by ID.
     *
     * Calls `GET /api/v1/memories/{memoryId}`.
     *
     * @param memoryId - The integer ID of the memory.
     * @returns A {@link Memory}.
     *
     * @throws {KairoValidationError} If memoryId is not a positive integer.
     * @throws {KairoNotFoundError} If the memory does not exist or does not
     *   belong to the authenticated user.
     *
     * @example
     * ```typescript
     * const memory = await kairo.memories.get(17);
     * console.log(memory.content);
     * ```
     */
    async get(memoryId: number): Promise<Memory> {
        if (!Number.isInteger(memoryId) || memoryId <= 0) {
            throw new KairoValidationError(
                "memoryId must be a positive integer."
            );
        }
        return this._client.request<Memory>(
            "GET",
            `/api/v1/memories/${memoryId}`
        );
    }

    // ── List ──────────────────────────────────────────────────────────────────

    /**
     * List all active memories for the authenticated user.
     *
     * Calls `GET /api/v1/memories`.
     *
     * Results are returned newest-first.
     *
     * @returns An array of {@link Memory} objects.
     *
     * @example
     * ```typescript
     * const memories = await kairo.memories.list();
     * for (const m of memories) {
     *     console.log(`[${m.memoryId}] ${m.content}`);
     * }
     * ```
     */
    async list(): Promise<Memory[]> {
        const data = await this._client.request<_MemoryListResponse>(
            "GET",
            "/api/v1/memories"
        );
        return data?.memories ?? [];
    }

    // ── Update ────────────────────────────────────────────────────────────────

    /**
     * Update the content and type of an existing memory.
     *
     * Calls `PUT /api/v1/memories/{memoryId}`.
     *
     * The backend archives the previous version and regenerates the
     * semantic embedding for the updated content.
     *
     * @param memoryId - The ID of the memory to update.
     * @param request - Updated content and type.
     * @returns The updated {@link Memory}.
     *
     * @throws {KairoValidationError} If memoryId or content are invalid.
     * @throws {KairoNotFoundError} If the memory does not exist or does not
     *   belong to the authenticated user.
     *
     * @example
     * ```typescript
     * const updated = await kairo.memories.update(17, {
     *     content: "User strongly prefers dark mode",
     *     memoryType: "Preference",
     * });
     * ```
     */
    async update(
        memoryId: number,
        request: UpdateMemoryRequest
    ): Promise<Memory> {
        if (!Number.isInteger(memoryId) || memoryId <= 0) {
            throw new KairoValidationError(
                "memoryId must be a positive integer."
            );
        }
        if (!request.content || request.content.trim() === "") {
            throw new KairoValidationError("content must not be empty.");
        }
        return this._client.request<Memory>(
            "PUT",
            `/api/v1/memories/${memoryId}`,
            {
                content: request.content,
                memoryType: request.memoryType,
            }
        );
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    /**
     * Deactivate (soft-delete) a memory.
     *
     * Calls `DELETE /api/v1/memories/{memoryId}`.
     *
     * The memory record is preserved in the Kairo database. It is marked
     * inactive and will no longer appear in list or search results.
     *
     * @param memoryId - The ID of the memory to deactivate.
     * @returns A {@link DeleteMemoryResult}.
     *
     * @throws {KairoValidationError} If memoryId is not a positive integer.
     * @throws {KairoNotFoundError} If the memory does not exist or does not
     *   belong to the authenticated user.
     *
     * @example
     * ```typescript
     * const result = await kairo.memories.delete(17);
     * console.log(result.message);
     * ```
     */
    async delete(memoryId: number): Promise<DeleteMemoryResult> {
        if (!Number.isInteger(memoryId) || memoryId <= 0) {
            throw new KairoValidationError(
                "memoryId must be a positive integer."
            );
        }
        return this._client.request<DeleteMemoryResult>(
            "DELETE",
            `/api/v1/memories/${memoryId}`
        );
    }

    // ── Search ────────────────────────────────────────────────────────────────

    /**
     * Search memories semantically.
     *
     * Calls `POST /api/v1/memories/search`.
     *
     * The Kairo backend generates an embedding for the query, computes
     * cosine similarity against all stored memories, and applies
     * relevance evaluation to return the most contextually relevant results.
     *
     * @param request - Search query and optional topK count.
     * @returns A {@link MemorySearchResponse}.
     *
     * @throws {KairoValidationError} If query is empty or topK is out of range.
     *
     * @example
     * ```typescript
     * const results = await kairo.memories.search({
     *     query: "What are Kairo's goals?",
     *     actorId: "user-123",
     *     topK: 5,
     * });
     * for (const m of results.memories) {
     *     console.log(`[${m.similarity.toFixed(4)}] ${m.content}`);
     * }
     * ```
     */
    async search(request: MemorySearchRequest): Promise<MemorySearchResponse> {
        if (!request.query || request.query.trim() === "") {
            throw new KairoValidationError("query must not be empty.", 400);
        }
        if (!request.actorId || request.actorId.trim() === "") {
            throw new KairoValidationError("actorId must not be empty.", 400);
        }
        if (request.actorId.trim().length > 128) {
            throw new KairoValidationError("actorId must not exceed 128 characters.", 400);
        }

        const topK = request.topK ?? 5;

        if (!Number.isInteger(topK) || topK < 1 || topK > 100) {
            throw new KairoValidationError(
                "topK must be an integer between 1 and 100.",
                400
            );
        }

        return this._client.request<MemorySearchResponse>(
            "POST",
            "/api/v1/memories/search",
            {
                query: request.query,
                actorId: request.actorId,
                topK,
            }
        );
    }

    // ── Ingest ────────────────────────────────────────────────────────────────

    /**
     * Ingest a conversation and extract durable memories with automatic consolidation.
     *
     * Calls `POST /api/v1/memories/ingest`.
     *
     * The Kairo backend extracts salient knowledge from the conversation,
     * evaluates candidate memories against existing memories within the actor's
     * scope, and applies the appropriate operation: Add, Update, Merge, or NoAction.
     *
     * The SDK does **not** perform extraction, consolidation, or embedding locally.
     * All intelligence remains server-side.
     *
     * @param request - Actor ID and conversation messages.
     * @returns An {@link IngestResponse} with per-candidate results.
     *
     * @throws {KairoValidationError} If actorId or messages are empty or malformed.
     * @throws {KairoAuthenticationError} If the API key is invalid.
     *
     * @example
     * ```typescript
     * const result = await kairo.memories.ingest({
     *     actorId: "user-123",
     *     messages: [
     *         { role: "user", content: "I prefer PostgreSQL for backend applications." },
     *     ],
     * });
     *
     * for (const mem of result.memories) {
     *     console.log(`[${mem.action}] ${mem.content}`);
     * }
     * ```
     */
    async ingest(request: IngestRequest): Promise<IngestResponse> {
        if (!request.actorId || request.actorId.trim() === "") {
            throw new KairoValidationError("actorId must not be empty.", 400);
        }
        if (request.actorId.trim().length > 128) {
            throw new KairoValidationError("actorId must not exceed 128 characters.", 400);
        }
        if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
            throw new KairoValidationError("messages must be a non-empty array.", 400);
        }

        // Validate each message
        for (let i = 0; i < request.messages.length; i++) {
            const msg = request.messages[i];
            if (!msg.role || typeof msg.role !== "string" || msg.role.trim() === "") {
                throw new KairoValidationError(
                    `Message at index ${i} is missing a valid 'role'.`,
                    400
                );
            }
            if (!msg.content || typeof msg.content !== "string" || msg.content.trim() === "") {
                throw new KairoValidationError(
                    `Message at index ${i} is missing a valid 'content'.`,
                    400
                );
            }
        }

        const sanitizedMessages: MemoryMessage[] = request.messages.map((msg) => ({
            role: msg.role.trim(),
            content: msg.content.trim(),
        }));

        const data = await this._client.request<IngestResponse>(
            "POST",
            "/api/v1/memories/ingest",
            {
                actorId: request.actorId.trim(),
                messages: sanitizedMessages,
            }
        );

        // Normalise: guarantee the shape even if backend returns partial data
        return {
            processed: data?.processed ?? false,
            extractedCount: data?.extractedCount ?? 0,
            memories: data?.memories ?? [],
        };
    }
}
