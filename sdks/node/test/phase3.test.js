/**
 * Phase 3 Node.js SDK Contract & Unit Tests.
 *
 * Tests cover:
 * - Create memory with expiresAt, ttl, category, categories
 * - Update memory with expiresAt, ttl, category, categories
 * - Search with category and categories filter
 * - Batch Create memories (payload, endpoint, size limits, response mapping)
 * - Batch Update memories (payload, endpoint, size limits, response mapping)
 * - Batch Delete memories (payload, endpoint, size limits, response mapping)
 * - Memory & RetrievedMemory Phase 3 response field parsing (expiresAt, categories)
 * - Backward compatibility: requests omitting Phase 3 fields do not include them in payload
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    Kairo,
    KairoValidationError,
} = require("../dist/index.js");

// ── P3-1: Create with category and categories ─────────────────────────────────

test("P3-1: create() sends category and categories when provided", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                memoryId: 301,
                userId: 1,
                content: capturedBody.content,
                memoryType: capturedBody.memoryType,
                isActive: true,
                createdAt: "2026-10-08T10:00:00Z",
                updatedAt: "2026-10-08T10:00:00Z",
                category: capturedBody.category,
                categories: capturedBody.categories,
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "test-api-key" });
        const res = await client.memories.create({
            content: "User loves dark mode",
            memoryType: "Preference",
            actorId: "actor-1",
            category: "ui-preference",
            categories: ["ui-preference", "frontend"],
        });

        assert.equal(capturedBody.category, "ui-preference");
        assert.deepEqual(capturedBody.categories, ["ui-preference", "frontend"]);
        assert.equal(res.isDuplicate, false);
        assert.equal(res.memory.memoryId, 301);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P3-2: Create with expiresAt and ttl ───────────────────────────────────────

test("P3-2: create() sends expiresAt and ttl when provided", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                memoryId: 302,
                userId: 1,
                content: capturedBody.content,
                memoryType: capturedBody.memoryType,
                isActive: true,
                createdAt: "2026-10-08T10:00:00Z",
                updatedAt: "2026-10-08T10:00:00Z",
                expiresAt: "2026-10-15T10:00:00Z",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "test-api-key" });
        const res = await client.memories.create({
            content: "Temporary session token info",
            memoryType: "Context",
            actorId: "actor-1",
            expiresAt: "2026-10-15T10:00:00Z",
            ttl: 3600,
        });

        assert.equal(capturedBody.expiresAt, "2026-10-15T10:00:00Z");
        assert.equal(capturedBody.ttl, 3600);
        assert.equal(res.memory.expiresAt, "2026-10-15T10:00:00Z");
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P3-3: Update with Phase 3 fields ──────────────────────────────────────────

test("P3-3: update() sends expiresAt, ttl, category, and categories", async () => {
    let capturedBody = null;
    let capturedUrl = null;
    let capturedMethod = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedUrl = url;
        capturedMethod = options.method;
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                memoryId: 42,
                userId: 1,
                content: capturedBody.content,
                memoryType: capturedBody.memoryType,
                isActive: true,
                createdAt: "2026-10-08T10:00:00Z",
                updatedAt: "2026-10-08T11:00:00Z",
                expiresAt: capturedBody.expiresAt,
                categories: capturedBody.categories,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "test-api-key" });
        const res = await client.memories.update(42, {
            content: "Updated content",
            memoryType: "Fact",
            category: "profile",
            categories: ["profile", "identity"],
            expiresAt: "2026-12-31T23:59:59Z",
            ttl: 86400,
        });

        assert.equal(capturedMethod, "PUT");
        assert.ok(capturedUrl.endsWith("/api/v1/memories/42"));
        assert.equal(capturedBody.category, "profile");
        assert.deepEqual(capturedBody.categories, ["profile", "identity"]);
        assert.equal(capturedBody.expiresAt, "2026-12-31T23:59:59Z");
        assert.equal(capturedBody.ttl, 86400);
        assert.equal(res.expiresAt, "2026-12-31T23:59:59Z");
        assert.deepEqual(res.categories, ["profile", "identity"]);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P3-4: Search with category and categories filter ─────────────────────────

test("P3-4: search() sends category and categories filter", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                query: capturedBody.query,
                count: 1,
                memories: [
                    {
                        memoryId: 10,
                        content: "User profile fact",
                        memoryType: "Fact",
                        similarity: 0.92,
                        expiresAt: null,
                        categories: ["profile"],
                    },
                ],
                relations: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "test-api-key" });
        const res = await client.memories.search({
            query: "profile",
            actorId: "actor-1",
            category: "profile",
            categories: ["profile", "settings"],
        });

        assert.equal(capturedBody.category, "profile");
        assert.deepEqual(capturedBody.categories, ["profile", "settings"]);
        assert.equal(res.count, 1);
        assert.deepEqual(res.memories[0].categories, ["profile"]);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P3-5: Batch Create memories ───────────────────────────────────────────────

test("P3-5: batchCreate() calls POST /api/v1/memories/batch with valid payload", async () => {
    let capturedBody = null;
    let capturedUrl = null;
    let capturedMethod = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedUrl = url;
        capturedMethod = options.method;
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                success: true,
                createdCount: 2,
                memories: [
                    {
                        memoryId: 501,
                        userId: 1,
                        content: "Mem 1",
                        memoryType: "Fact",
                        isActive: true,
                        createdAt: "2026-10-08T10:00:00Z",
                        updatedAt: "2026-10-08T10:00:00Z",
                    },
                    {
                        memoryId: 502,
                        userId: 1,
                        content: "Mem 2",
                        memoryType: "Goal",
                        isActive: true,
                        createdAt: "2026-10-08T10:00:00Z",
                        updatedAt: "2026-10-08T10:00:00Z",
                    },
                ],
                errors: [],
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "test-api-key" });
        const res = await client.memories.batchCreate({
            memories: [
                { content: "Mem 1", memoryType: "Fact", actorId: "act-1", categories: ["cat1"] },
                { content: "Mem 2", memoryType: "Goal", actorId: "act-1", ttl: 3600 },
            ],
        });

        assert.equal(capturedMethod, "POST");
        assert.ok(capturedUrl.endsWith("/api/v1/memories/batch"));
        assert.equal(capturedBody.memories.length, 2);
        assert.equal(res.success, true);
        assert.equal(res.createdCount, 2);
        assert.equal(res.memories.length, 2);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P3-6: Batch Create validation errors ─────────────────────────────────────

test("P3-6: batchCreate() rejects empty memories or batch size > 100", async () => {
    const client = new Kairo({ apiKey: "test-api-key" });

    await assert.rejects(
        () => client.memories.batchCreate({ memories: [] }),
        (err) => err instanceof KairoValidationError && err.statusCode === 400
    );

    const over100 = Array.from({ length: 101 }, (_, i) => ({
        content: `Memory ${i}`,
        memoryType: "Fact",
    }));

    await assert.rejects(
        () => client.memories.batchCreate({ memories: over100 }),
        (err) => err instanceof KairoValidationError && err.message.includes("Batch size cannot exceed 100")
    );
});

// ── P3-7: Batch Update memories ───────────────────────────────────────────────

test("P3-7: batchUpdate() calls PUT /api/v1/memories/batch", async () => {
    let capturedBody = null;
    let capturedUrl = null;
    let capturedMethod = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedUrl = url;
        capturedMethod = options.method;
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                success: true,
                updatedCount: 1,
                memories: [
                    {
                        memoryId: 501,
                        userId: 1,
                        content: "Updated Mem 1",
                        memoryType: "Fact",
                        isActive: true,
                        createdAt: "2026-10-08T10:00:00Z",
                        updatedAt: "2026-10-08T11:00:00Z",
                    },
                ],
                errors: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "test-api-key" });
        const res = await client.memories.batchUpdate({
            memories: [
                { memoryId: 501, content: "Updated Mem 1", categories: ["updated-cat"] },
            ],
        });

        assert.equal(capturedMethod, "PUT");
        assert.ok(capturedUrl.endsWith("/api/v1/memories/batch"));
        assert.equal(capturedBody.memories[0].memoryId, 501);
        assert.equal(res.success, true);
        assert.equal(res.updatedCount, 1);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P3-8: Batch Delete memories ───────────────────────────────────────────────

test("P3-8: batchDelete() calls DELETE /api/v1/memories/batch", async () => {
    let capturedBody = null;
    let capturedUrl = null;
    let capturedMethod = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedUrl = url;
        capturedMethod = options.method;
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                success: true,
                deletedCount: 2,
                deletedIds: [501, 502],
                errors: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "test-api-key" });
        const res = await client.memories.batchDelete({
            memoryIds: [501, 502],
        });

        assert.equal(capturedMethod, "DELETE");
        assert.ok(capturedUrl.endsWith("/api/v1/memories/batch"));
        assert.deepEqual(capturedBody.memoryIds, [501, 502]);
        assert.equal(res.success, true);
        assert.deepEqual(res.deletedIds, [501, 502]);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P3-9: Backward compatibility ──────────────────────────────────────────────

test("P3-9: create() and search() omit Phase 3 fields when not provided", async () => {
    let capturedCreateBody = null;
    let capturedSearchBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        if (url.includes("/search")) {
            capturedSearchBody = JSON.parse(options.body);
            return new Response(
                JSON.stringify({ query: "q", count: 0, memories: [], relations: [] }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        } else {
            capturedCreateBody = JSON.parse(options.body);
            return new Response(
                JSON.stringify({
                    memoryId: 1,
                    userId: 1,
                    content: capturedCreateBody.content,
                    memoryType: "Fact",
                    isActive: true,
                    createdAt: "2026-10-08T10:00:00Z",
                    updatedAt: "2026-10-08T10:00:00Z",
                }),
                { status: 201, headers: { "Content-Type": "application/json" } }
            );
        }
    };

    try {
        const client = new Kairo({ apiKey: "test-api-key" });
        await client.memories.create({
            content: "Vanilla memory",
            memoryType: "Fact",
            actorId: "act-1",
        });

        assert.equal("expiresAt" in capturedCreateBody, false);
        assert.equal("ttl" in capturedCreateBody, false);
        assert.equal("category" in capturedCreateBody, false);
        assert.equal("categories" in capturedCreateBody, false);

        await client.memories.search({
            query: "Vanilla query",
            actorId: "act-1",
        });

        assert.equal("category" in capturedSearchBody, false);
        assert.equal("categories" in capturedSearchBody, false);
    } finally {
        global.fetch = originalFetch;
    }
});
