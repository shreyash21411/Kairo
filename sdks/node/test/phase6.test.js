/**
 * Comprehensive Node SDK Contract Test Suite for Phase 6.3 hardening.
 * Tests GAP-01 (history), GAP-02 (actor purge), and GAP-04 (usage reporting).
 * All tests run offline using mocked global.fetch.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    Kairo,
    KairoValidationError,
    KairoAuthorizationError,
    KairoNotFoundError,
} = require("../dist/index.js");

// ── Usage Reporting Tests (GAP-04) ───────────────────────────────────────────

test("Usage: get project usage successfully parses report", async () => {
    let capturedUrl = "";
    let capturedHeaders = {};

    global.fetch = async (url, options) => {
        capturedUrl = String(url);
        capturedHeaders = options.headers;
        return {
            status: 200,
            text: async () => JSON.stringify({
                projectId: 10,
                fromUtc: "2026-09-15T00:00:00Z",
                toUtc: "2026-10-15T00:00:00Z",
                totalOperations: 45,
                totalUnits: 60,
                totalTokensUsed: 1200,
                byOperation: [
                    { label: "MemoryCreate", operationCount: 20, unitCount: 20 },
                    { label: "MemoryRecall", operationCount: 25, unitCount: 40 },
                ],
                byOutcome: [
                    { label: "Success", operationCount: 45, unitCount: 60 },
                ],
            }),
        };
    };

    const client = new Kairo({ apiKey: "kairo_live_test_key" });
    const report = await client.usage.get(10, {
        from: "2026-09-15T00:00:00Z",
        to: "2026-10-15T00:00:00Z",
    });

    assert.ok(capturedUrl.includes("/api/v1/projects/10/usage"));
    assert.ok(capturedUrl.includes("from=2026-09-15T00%3A00%3A00Z"));
    assert.ok(capturedUrl.includes("to=2026-10-15T00%3A00%3A00Z"));
    assert.equal(capturedHeaders.Authorization, "Bearer kairo_live_test_key");

    assert.equal(report.projectId, 10);
    assert.equal(report.totalOperations, 45);
    assert.equal(report.totalUnits, 60);
    assert.equal(report.totalTokensUsed, 1200);
    assert.equal(report.byOperation.length, 2);
    assert.equal(report.byOperation[0].label, "MemoryCreate");
    assert.equal(report.byOutcome.length, 1);
});

test("Usage: accepts Date objects for from and to options", async () => {
    let capturedUrl = "";

    global.fetch = async (url) => {
        capturedUrl = String(url);
        return {
            status: 200,
            text: async () => JSON.stringify({
                projectId: 5,
                fromUtc: "2026-10-01T00:00:00.000Z",
                toUtc: "2026-10-15T00:00:00.000Z",
                totalOperations: 0,
                totalUnits: 0,
                totalTokensUsed: null,
                byOperation: [],
                byOutcome: [],
            }),
        };
    };

    const client = new Kairo({ apiKey: "kairo_live_test_key" });
    const fromDate = new Date("2026-10-01T00:00:00.000Z");
    const toDate = new Date("2026-10-15T00:00:00.000Z");

    const report = await client.usage.get(5, { from: fromDate, to: toDate });
    assert.equal(report.projectId, 5);
    assert.ok(capturedUrl.includes("from=2026-10-01T00%3A00%3A00.000Z"));
    assert.ok(capturedUrl.includes("to=2026-10-15T00%3A00%3A00.000Z"));
});

test("Usage: validates positive integer projectId", async () => {
    const client = new Kairo({ apiKey: "kairo_live_test_key" });

    await assert.rejects(
        async () => await client.usage.get(0),
        KairoValidationError
    );
    await assert.rejects(
        async () => await client.usage.get(-1),
        KairoValidationError
    );
    await assert.rejects(
        async () => await client.usage.get(1.5),
        KairoValidationError
    );
});

test("Usage: handles 403 Forbidden properly", async () => {
    global.fetch = async () => ({
        status: 403,
        text: async () => JSON.stringify({ message: "Forbidden" }),
    });

    const client = new Kairo({ apiKey: "kairo_live_test_key" });
    await assert.rejects(
        async () => await client.usage.get(999),
        KairoAuthorizationError
    );
});

// ── Memory History Tests (GAP-01) ────────────────────────────────────────────

test("Memories: history retrieves version records successfully", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    global.fetch = async (url, options) => {
        capturedUrl = String(url);
        capturedMethod = options.method;
        return {
            status: 200,
            text: async () => JSON.stringify({
                memoryId: 201,
                count: 2,
                versions: [
                    {
                        memoryVersionId: 10,
                        memoryId: 201,
                        content: "Updated user preference",
                        operation: "ApiUpdate",
                        createdAt: "2026-10-15T11:00:00Z",
                    },
                    {
                        memoryVersionId: 9,
                        memoryId: 201,
                        content: "Initial user preference",
                        operation: "ApiCreate",
                        createdAt: "2026-10-15T10:00:00Z",
                    },
                ],
            }),
        };
    };

    const client = new Kairo({ apiKey: "kairo_live_test_key" });
    const history = await client.memories.history(201);

    assert.equal(capturedMethod, "GET");
    assert.ok(capturedUrl.endsWith("/api/v1/memories/201/history"));
    assert.equal(history.memoryId, 201);
    assert.equal(history.count, 2);
    assert.equal(history.versions.length, 2);
    assert.equal(history.versions[0].memoryVersionId, 10);
    assert.equal(history.versions[0].operation, "ApiUpdate");
});

test("Memories: history validates memoryId", async () => {
    const client = new Kairo({ apiKey: "kairo_live_test_key" });

    await assert.rejects(
        async () => await client.memories.history(0),
        KairoValidationError
    );
    await assert.rejects(
        async () => await client.memories.history(-5),
        KairoValidationError
    );
});

test("Memories: history propagates 404 NotFound", async () => {
    global.fetch = async () => ({
        status: 404,
        text: async () => JSON.stringify({ message: "Memory 999 not found" }),
    });

    const client = new Kairo({ apiKey: "kairo_live_test_key" });
    await assert.rejects(
        async () => await client.memories.history(999),
        KairoNotFoundError
    );
});

// ── Actor Purge Tests (GAP-02) ───────────────────────────────────────────────

test("Memories: purge deletes actor memories successfully", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    global.fetch = async (url, options) => {
        capturedUrl = String(url);
        capturedMethod = options.method;
        return {
            status: 200,
            text: async () => JSON.stringify({
                actorId: "bob",
                deletedCount: 4,
                deletedMemoryIds: [50, 51, 52, 53],
                message: "Successfully purged 4 memories for actor 'bob'.",
            }),
        };
    };

    const client = new Kairo({ apiKey: "kairo_live_test_key" });
    const result = await client.memories.purge("bob");

    assert.equal(capturedMethod, "DELETE");
    assert.ok(capturedUrl.includes("/api/v1/memories?actorId=bob"));
    assert.equal(result.actorId, "bob");
    assert.equal(result.deletedCount, 4);
    assert.deepEqual(result.deletedMemoryIds, [50, 51, 52, 53]);
});

test("Memories: purge validates actorId", async () => {
    const client = new Kairo({ apiKey: "kairo_live_test_key" });

    await assert.rejects(
        async () => await client.memories.purge(""),
        KairoValidationError
    );
    await assert.rejects(
        async () => await client.memories.purge("   "),
        KairoValidationError
    );
    await assert.rejects(
        async () => await client.memories.purge("x".repeat(129)),
        KairoValidationError
    );
});
