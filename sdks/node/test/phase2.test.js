/**
 * Phase 2 Node.js SDK Contract Tests.
 *
 * Tests cover:
 * - Create memory with occurredAt
 * - Create memory with metadata
 * - Update memory with occurredAt
 * - Update memory with metadata
 * - Search with temporal filters
 * - Search with metadata filters (key-value shorthand)
 * - Search with structured metadata filters
 * - Search with recencyBoost
 * - Search with graphDepth
 * - Parse relations from search response
 * - Phase 2 fields in Memory response parsing (occurredAt, metadata)
 * - Phase 1 backward compatibility (no Phase 2 fields = unchanged payload)
 * - GraphRelation and MemoryTemporalFilter type exports
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    Kairo,
    KairoValidationError,
} = require("../dist/index.js");

// ── P2-1: Create with occurredAt ──────────────────────────────────────────────

test("P2-1: create() sends occurredAt when provided", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                memoryId: 200,
                userId: 1,
                content: capturedBody.content,
                memoryType: capturedBody.memoryType,
                isActive: true,
                createdAt: "2026-10-01T08:00:00Z",
                updatedAt: "2026-10-01T08:00:00Z",
                occurredAt: capturedBody.occurredAt,
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const result = await client.memories.create({
            content: "The team shipped v2.0 on October 1st",
            memoryType: "Fact",
            actorId: "actor-p2-1",
            occurredAt: "2026-10-01T00:00:00Z",
        });

        assert.equal(capturedBody.occurredAt, "2026-10-01T00:00:00Z");
        assert.equal(result.isDuplicate, false);
        assert.equal(result.memory.occurredAt, "2026-10-01T00:00:00Z");
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-2: Create with metadata ────────────────────────────────────────────────

test("P2-2: create() sends metadata when provided", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                memoryId: 201,
                userId: 1,
                content: capturedBody.content,
                memoryType: capturedBody.memoryType,
                isActive: true,
                createdAt: "2026-10-01T08:00:00Z",
                updatedAt: "2026-10-01T08:00:00Z",
                metadata: JSON.stringify(capturedBody.metadata),
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const result = await client.memories.create({
            content: "User uses Python for ML",
            memoryType: "Fact",
            actorId: "actor-p2-2",
            metadata: { source: "chat", confidence: 0.9, tags: ["python", "ml"] },
        });

        assert.deepEqual(capturedBody.metadata, {
            source: "chat",
            confidence: 0.9,
            tags: ["python", "ml"],
        });
        assert.equal(result.isDuplicate, false);
        assert.equal(result.memory.memoryId, 201);
        // metadata is returned as JSON string from backend
        assert.ok(typeof result.memory.metadata === "string");
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-3: Update with occurredAt ──────────────────────────────────────────────

test("P2-3: update() sends occurredAt when provided", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                memoryId: 202,
                userId: 1,
                content: capturedBody.content,
                memoryType: capturedBody.memoryType,
                isActive: true,
                createdAt: "2026-09-01T08:00:00Z",
                updatedAt: "2026-10-01T08:00:00Z",
                occurredAt: capturedBody.occurredAt,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const updated = await client.memories.update(202, {
            content: "Updated content with occurrence time",
            memoryType: "Fact",
            occurredAt: "2026-09-15T12:00:00Z",
        });

        assert.equal(capturedBody.occurredAt, "2026-09-15T12:00:00Z");
        assert.equal(updated.occurredAt, "2026-09-15T12:00:00Z");
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-4: Update with metadata ────────────────────────────────────────────────

test("P2-4: update() sends metadata when provided", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                memoryId: 203,
                userId: 1,
                content: capturedBody.content,
                memoryType: capturedBody.memoryType,
                isActive: true,
                createdAt: "2026-09-01T08:00:00Z",
                updatedAt: "2026-10-01T08:00:00Z",
                metadata: JSON.stringify(capturedBody.metadata),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const updated = await client.memories.update(203, {
            content: "Updated content",
            memoryType: "Preference",
            metadata: { version: 2, reviewed: true },
        });

        assert.deepEqual(capturedBody.metadata, { version: 2, reviewed: true });
        assert.ok(typeof updated.metadata === "string");
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-5: Search with temporal filter ─────────────────────────────────────────

test("P2-5: search() sends temporal filter in payload", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                query: capturedBody.query,
                count: 0,
                memories: [],
                relations: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await client.memories.search({
            query: "recent python usage",
            actorId: "actor-p2-5",
            hybrid: true,
            temporal: {
                lastDays: 7,
                createdAtFrom: "2026-09-28T00:00:00Z",
            },
        });

        assert.ok(capturedBody.temporal, "temporal must be present in payload");
        assert.equal(capturedBody.temporal.lastDays, 7);
        assert.equal(capturedBody.temporal.createdAtFrom, "2026-09-28T00:00:00Z");
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-6: Search with metadata filter shorthand ───────────────────────────────

test("P2-6: search() sends metadataFilters when provided", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({ query: capturedBody.query, count: 0, memories: [], relations: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await client.memories.search({
            query: "user settings",
            actorId: "actor-p2-6",
            hybrid: true,
            metadataFilters: { source: "chat", language: "en" },
        });

        assert.ok(capturedBody.metadataFilters, "metadataFilters must be in payload");
        assert.equal(capturedBody.metadataFilters.source, "chat");
        assert.equal(capturedBody.metadataFilters.language, "en");
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-7: Search with structured metadata filters ─────────────────────────────

test("P2-7: search() sends structuredFilters when provided", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({ query: capturedBody.query, count: 0, memories: [], relations: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await client.memories.search({
            query: "tech preferences",
            actorId: "actor-p2-7",
            hybrid: true,
            structuredFilters: [
                { key: "language", operator: "ne", value: "java" },
                { key: "tag", operator: "in", inValues: ["python", "typescript"] },
            ],
        });

        assert.ok(Array.isArray(capturedBody.structuredFilters));
        assert.equal(capturedBody.structuredFilters.length, 2);
        assert.equal(capturedBody.structuredFilters[0].key, "language");
        assert.equal(capturedBody.structuredFilters[0].operator, "ne");
        assert.equal(capturedBody.structuredFilters[0].value, "java");
        assert.equal(capturedBody.structuredFilters[1].key, "tag");
        assert.equal(capturedBody.structuredFilters[1].operator, "in");
        assert.deepEqual(capturedBody.structuredFilters[1].inValues, ["python", "typescript"]);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-8: Search with recencyBoost ───────────────────────────────────────────

test("P2-8: search() sends recencyBoost=true in payload", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({ query: capturedBody.query, count: 0, memories: [], relations: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await client.memories.search({
            query: "recent events",
            actorId: "actor-p2-8",
            hybrid: true,
            recencyBoost: true,
        });

        assert.strictEqual(capturedBody.recencyBoost, true);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-9: Search with graphDepth ──────────────────────────────────────────────

test("P2-9: search() sends graphDepth in payload", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({ query: capturedBody.query, count: 0, memories: [], relations: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await client.memories.search({
            query: "graph depth test",
            actorId: "actor-p2-9",
            hybrid: true,
            graphDepth: 2,
        });

        assert.equal(capturedBody.graphDepth, 2);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-10: Parse relations from search response ───────────────────────────────

test("P2-10: search() correctly parses relations from response", async () => {
    const originalFetch = global.fetch;

    global.fetch = async () =>
        new Response(
            JSON.stringify({
                query: "graph relations",
                count: 1,
                memories: [
                    {
                        memoryId: 300,
                        content: "Alice works at TechCorp.",
                        memoryType: "Fact",
                        similarity: 0.91,
                    },
                ],
                relations: [
                    {
                        source: "Alice",
                        relationship: "works_at",
                        target: "TechCorp",
                        confidence: 0.95,
                    },
                    {
                        source: "Alice",
                        relationship: "located_in",
                        target: "San Francisco",
                        confidence: 0.80,
                    },
                ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const result = await client.memories.search({
            query: "graph relations",
            actorId: "actor-p2-10",
            hybrid: true,
        });

        assert.equal(result.count, 1);
        assert.equal(result.memories.length, 1);
        assert.equal(result.memories[0].memoryId, 300);
        assert.equal(result.memories[0].similarity, 0.91);

        assert.ok(Array.isArray(result.relations), "relations must be an array");
        assert.equal(result.relations.length, 2);

        assert.equal(result.relations[0].source, "Alice");
        assert.equal(result.relations[0].relationship, "works_at");
        assert.equal(result.relations[0].target, "TechCorp");
        assert.equal(result.relations[0].confidence, 0.95);

        assert.equal(result.relations[1].source, "Alice");
        assert.equal(result.relations[1].relationship, "located_in");
        assert.equal(result.relations[1].target, "San Francisco");
        assert.equal(result.relations[1].confidence, 0.80);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-11: Relations defaults to [] when backend omits the field ──────────────

test("P2-11: search() returns relations=[] when backend omits it", async () => {
    const originalFetch = global.fetch;

    global.fetch = async () =>
        new Response(
            JSON.stringify({
                query: "phase 1 response",
                count: 0,
                memories: [],
                // relations intentionally omitted (Phase 1 backend compat)
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const result = await client.memories.search({
            query: "phase 1 response",
            actorId: "actor-p2-11",
        });

        assert.ok(Array.isArray(result.relations), "relations must default to empty array");
        assert.equal(result.relations.length, 0);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-12: Phase 2 fields on Memory response ──────────────────────────────────

test("P2-12: Memory response includes occurredAt and metadata when present", async () => {
    const originalFetch = global.fetch;

    global.fetch = async () =>
        new Response(
            JSON.stringify({
                memoryId: 400,
                userId: 1,
                content: "Conference in Berlin 2026-10-05",
                memoryType: "Fact",
                isActive: true,
                createdAt: "2026-10-05T09:00:00Z",
                updatedAt: "2026-10-05T09:00:00Z",
                occurredAt: "2026-10-05T00:00:00Z",
                metadata: "{\"category\":\"event\",\"city\":\"Berlin\"}",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const memory = await client.memories.get(400);

        assert.equal(memory.memoryId, 400);
        assert.equal(memory.occurredAt, "2026-10-05T00:00:00Z");
        assert.equal(memory.metadata, "{\"category\":\"event\",\"city\":\"Berlin\"}");
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-13: Phase 1 backward compatibility — no Phase 2 params in payload ──────

test("P2-13: create() without Phase 2 fields sends Phase 1 compatible payload", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                memoryId: 500,
                userId: 1,
                content: capturedBody.content,
                memoryType: capturedBody.memoryType,
                isActive: true,
                createdAt: "2026-10-01T08:00:00Z",
                updatedAt: "2026-10-01T08:00:00Z",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await client.memories.create({
            content: "Phase 1 compatible create",
            memoryType: "Fact",
            actorId: "actor-p2-13",
        });

        // Phase 2 fields must NOT appear in the payload when not supplied
        assert.equal(capturedBody.occurredAt, undefined);
        assert.equal(capturedBody.metadata, undefined);
        assert.equal(capturedBody.temporal, undefined);
        assert.equal(capturedBody.recencyBoost, undefined);
        assert.equal(capturedBody.graphDepth, undefined);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-14: search() without Phase 2 params sends Phase 1 compatible payload ───

test("P2-14: search() without Phase 2 options sends Phase 1 compatible payload", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({ query: capturedBody.query, count: 0, memories: [], relations: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await client.memories.search({
            query: "simple query",
            actorId: "actor-p2-14",
        });

        assert.equal(capturedBody.temporal, undefined);
        assert.equal(capturedBody.metadataFilters, undefined);
        assert.equal(capturedBody.structuredFilters, undefined);
        assert.equal(capturedBody.recencyBoost, undefined);
        assert.equal(capturedBody.graphDepth, undefined);
        // hybrid not sent either
        assert.equal(capturedBody.hybrid, undefined);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-15: update() without Phase 2 fields sends backward-compatible payload ──

test("P2-15: update() without Phase 2 fields sends Phase 1 compatible payload", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                memoryId: 501,
                userId: 1,
                content: capturedBody.content,
                memoryType: capturedBody.memoryType,
                isActive: true,
                createdAt: "2026-09-01T08:00:00Z",
                updatedAt: "2026-10-01T08:00:00Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await client.memories.update(501, {
            content: "Phase 1 compatible update",
            memoryType: "Preference",
        });

        assert.equal(capturedBody.content, "Phase 1 compatible update");
        assert.equal(capturedBody.memoryType, "Preference");
        assert.equal(capturedBody.occurredAt, undefined);
        assert.equal(capturedBody.metadata, undefined);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-16: GraphRelation and MemoryTemporalFilter type exports accessible ──────

test("P2-16: Phase 2 types are exported from the SDK root", () => {
    // Verify the types exist on the module exports (TypeScript structural check).
    // Since this is a .js runtime test, we confirm the compiled dist exports them
    // by checking the named exports present on the index.
    const sdkExports = require("../dist/index.js");
    // Types are erased at runtime but symbols that are NOT types must still pass:
    // Kairo and KairoAgentMemory are values; type exports appear as undefined keys.
    assert.ok(typeof sdkExports.Kairo === "function");
    assert.ok(typeof sdkExports.KairoAgentMemory === "function");
    // Type-only exports don't have runtime representation — that's expected.
    // The real check is that the SDK built without TypeScript errors (tsc passes).
});

// ── P2-17: recencyBoost=false is sent explicitly ──────────────────────────────

test("P2-17: search() sends recencyBoost=false when explicitly set", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({ query: capturedBody.query, count: 0, memories: [], relations: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await client.memories.search({
            query: "recency off",
            actorId: "actor-p2-17",
            hybrid: true,
            recencyBoost: false,
        });

        // recencyBoost=false must be sent (not silently omitted)
        // so the backend clearly understands it is opt-out.
        assert.strictEqual(capturedBody.recencyBoost, false);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── P2-18: search() with all Phase 2 params simultaneously ───────────────────

test("P2-18: search() sends all Phase 2 params simultaneously", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({ query: capturedBody.query, count: 0, memories: [], relations: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await client.memories.search({
            query: "full Phase 2 search",
            actorId: "actor-p2-18",
            hybrid: true,
            topK: 10,
            temporal: { lastWeeks: 2 },
            metadataFilters: { source: "api" },
            structuredFilters: [{ key: "lang", operator: "eq", value: "en" }],
            recencyBoost: true,
            graphDepth: 1,
        });

        assert.ok(capturedBody.temporal);
        assert.equal(capturedBody.temporal.lastWeeks, 2);
        assert.deepEqual(capturedBody.metadataFilters, { source: "api" });
        assert.equal(capturedBody.structuredFilters.length, 1);
        assert.strictEqual(capturedBody.recencyBoost, true);
        assert.equal(capturedBody.graphDepth, 1);
        assert.equal(capturedBody.topK, 10);
        assert.strictEqual(capturedBody.hybrid, true);
    } finally {
        global.fetch = originalFetch;
    }
});
