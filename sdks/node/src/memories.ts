import { Kairo } from "./client";
import { KairoValidationError } from "./exceptions";
import {
    _DuplicateResult,
    _MemoryListResponse,
    BatchCreateMemoriesRequest,
    BatchCreateResponse,
    BatchUpdateMemoriesRequest,
    BatchUpdateResponse,
    BatchDeleteMemoriesRequest,
    BatchDeleteResponse,
    CreateMemoryRequest,
    CreateMemoryResult,
    DeleteMemoryResult,
    GraphRelation,
    IngestRequest,
    IngestResponse,
    Memory,
    MemoryMessage,
    MemorySearchRequest,
    MemorySearchResponse,
    MetadataFilterCondition,
    MemoryTemporalFilter,
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
        if (request.actorId !== undefined) {
            if (request.actorId.trim() === "") {
                throw new KairoValidationError("actorId must not be empty.", 400);
            }
        } else if (!request.scope) {
            throw new KairoValidationError("actorId or scope must be provided.", 400);
        }

        const payload: Record<string, unknown> = {
            content: request.content,
            memoryType: request.memoryType,
        };
        if (request.actorId) {
            payload.actorId = request.actorId;
        }
        if (request.scope) {
            payload.scope = request.scope;
        }
        // Phase 2 fields — only included when explicitly provided.
        if (request.occurredAt !== undefined && request.occurredAt !== null) {
            payload.occurredAt = request.occurredAt;
        }
        if (request.metadata !== undefined && request.metadata !== null) {
            payload.metadata = request.metadata;
        }
        // Phase 3 fields
        if (request.expiresAt !== undefined && request.expiresAt !== null) {
            payload.expiresAt = request.expiresAt;
        }
        if (request.ttl !== undefined && request.ttl !== null) {
            payload.ttl = request.ttl;
        }
        if (request.category !== undefined && request.category !== null) {
            payload.category = request.category;
        }
        if (request.categories !== undefined && request.categories !== null) {
            payload.categories = request.categories;
        }

        // The backend accepts the JSON field name 'memoryType' and 'actorId' (camelCase).
        const data = await this._client.request<Memory | _DuplicateResult>(
            "POST",
            "/api/v1/memories",
            payload
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
        const updatePayload: Record<string, unknown> = {
            content: request.content,
            memoryType: request.memoryType,
        };
        // Phase 2 fields — only included when explicitly provided.
        // Pass null to explicitly clear occurredAt or metadata on the server.
        if (request.occurredAt !== undefined) {
            updatePayload.occurredAt = request.occurredAt;
        }
        if (request.metadata !== undefined) {
            updatePayload.metadata = request.metadata;
        }
        // Phase 3 fields
        if (request.expiresAt !== undefined) {
            updatePayload.expiresAt = request.expiresAt;
        }
        if (request.ttl !== undefined) {
            updatePayload.ttl = request.ttl;
        }
        if (request.category !== undefined) {
            updatePayload.category = request.category;
        }
        if (request.categories !== undefined) {
            updatePayload.categories = request.categories;
        }

        return this._client.request<Memory>(
            "PUT",
            `/api/v1/memories/${memoryId}`,
            updatePayload
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
        if (request.actorId !== undefined) {
            if (request.actorId.trim() === "") {
                throw new KairoValidationError("actorId must not be empty.", 400);
            }
            if (request.actorId.trim().length > 128) {
                throw new KairoValidationError("actorId must not exceed 128 characters.", 400);
            }
        } else if (!request.scope) {
            throw new KairoValidationError("actorId or scope must be provided.", 400);
        }

        const topK = request.topK ?? 5;

        if (!Number.isInteger(topK) || topK < 1 || topK > 100) {
            throw new KairoValidationError(
                "topK must be an integer between 1 and 100.",
                400
            );
        }

        const payload: Record<string, unknown> = {
            query: request.query,
            topK,
        };
        if (request.actorId) {
            payload.actorId = request.actorId;
        }
        if (request.scope) {
            payload.scope = request.scope;
        }
        if (request.hybrid !== undefined) {
            payload.hybrid = request.hybrid;
        }
        // Phase 2 optional parameters — only sent when explicitly provided.
        if (request.temporal !== undefined && request.temporal !== null) {
            payload.temporal = request.temporal;
        }
        if (request.metadataFilters !== undefined && request.metadataFilters !== null) {
            payload.metadataFilters = request.metadataFilters;
        }
        if (request.structuredFilters !== undefined && request.structuredFilters !== null) {
            payload.structuredFilters = request.structuredFilters;
        }
        if (request.recencyBoost !== undefined) {
            payload.recencyBoost = request.recencyBoost;
        }
        if (request.graphDepth !== undefined && request.graphDepth !== null) {
            payload.graphDepth = request.graphDepth;
        }
        // Phase 3 category filters
        if (request.category !== undefined && request.category !== null) {
            payload.category = request.category;
        }
        if (request.categories !== undefined && request.categories !== null) {
            payload.categories = request.categories;
        }

        const raw = await this._client.request<MemorySearchResponse>(
            "POST",
            "/api/v1/memories/search",
            payload
        );

        // Normalise: guarantee relations is always an array even if backend omits it.
        return {
            query: raw?.query ?? request.query,
            count: raw?.count ?? 0,
            memories: raw?.memories ?? [],
            relations: (raw as any)?.relations ?? [],
        };
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
        if (request.actorId !== undefined) {
            if (request.actorId.trim() === "") {
                throw new KairoValidationError("actorId must not be empty.", 400);
            }
            if (request.actorId.trim().length > 128) {
                throw new KairoValidationError("actorId must not exceed 128 characters.", 400);
            }
        } else if (!request.scope) {
            throw new KairoValidationError("actorId or scope must be provided.", 400);
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

        const payload: Record<string, unknown> = {
            messages: sanitizedMessages,
        };
        if (request.actorId) {
            payload.actorId = request.actorId.trim();
        }
        if (request.scope) {
            payload.scope = request.scope;
        }

        const data = await this._client.request<IngestResponse>(
            "POST",
            "/api/v1/memories/ingest",
            payload
        );

        // Normalise: guarantee the shape even if backend returns partial data
        return {
            processed: data?.processed ?? false,
            extractedCount: data?.extractedCount ?? 0,
            memories: data?.memories ?? [],
        };
    }

    // ── Phase 3: Batch Operations ─────────────────────────────────────────────

    /**
     * Create multiple memories atomically in a single request.
     * Calls `POST /api/v1/memories/batch`.
     */
    async batchCreate(request: BatchCreateMemoriesRequest): Promise<BatchCreateResponse> {
        if (!request || !Array.isArray(request.memories)) {
            throw new KairoValidationError("memories array must be provided.", 400);
        }
        if (request.memories.length === 0) {
            throw new KairoValidationError("memories array must not be empty.", 400);
        }
        if (request.memories.length > 100) {
            throw new KairoValidationError("Batch size cannot exceed 100.", 400);
        }

        return this._client.request<BatchCreateResponse>(
            "POST",
            "/api/v1/memories/batch",
            request
        );
    }

    /**
     * Update multiple memories in a single request.
     * Calls `PUT /api/v1/memories/batch`.
     */
    async batchUpdate(request: BatchUpdateMemoriesRequest): Promise<BatchUpdateResponse> {
        if (!request || !Array.isArray(request.memories)) {
            throw new KairoValidationError("memories array must be provided.", 400);
        }
        if (request.memories.length === 0) {
            throw new KairoValidationError("memories array must not be empty.", 400);
        }
        if (request.memories.length > 100) {
            throw new KairoValidationError("Batch size cannot exceed 100.", 400);
        }

        return this._client.request<BatchUpdateResponse>(
            "PUT",
            "/api/v1/memories/batch",
            request
        );
    }

    /**
     * Soft-delete multiple memories in a single request.
     * Calls `DELETE /api/v1/memories/batch`.
     */
    async batchDelete(request: BatchDeleteMemoriesRequest): Promise<BatchDeleteResponse> {
        if (!request || !Array.isArray(request.memoryIds)) {
            throw new KairoValidationError("memoryIds array must be provided.", 400);
        }
        if (request.memoryIds.length === 0) {
            throw new KairoValidationError("memoryIds array must not be empty.", 400);
        }
        if (request.memoryIds.length > 100) {
            throw new KairoValidationError("Batch size cannot exceed 100.", 400);
        }

        return this._client.request<BatchDeleteResponse>(
            "DELETE",
            "/api/v1/memories/batch",
            request
        );
    }
}
