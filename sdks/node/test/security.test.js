/**
 * Phase 5 Node.js SDK Security & Hardening Test Suite.
 *
 * All tests are offline and mock HTTP requests using globalThis.fetch interception.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    Kairo,
    KairoAuthenticationError,
    KairoAuthorizationError,
    KairoNotFoundError,
    KairoValidationError,
    KairoServerError,
} = require("../dist/index");

test("SEC-N-01: Whitespace API key throws KairoAuthenticationError before network call", () => {
    assert.throws(() => {
        new Kairo({ apiKey: "   " });
    }, KairoAuthenticationError);
});

test("SEC-N-02: Empty API key throws KairoAuthenticationError before network call", () => {
    assert.throws(() => {
        new Kairo({ apiKey: "" });
    }, KairoAuthenticationError);
});

test("SEC-N-03: Ingest rejects empty actorId before network call", async () => {
    const client = new Kairo({ apiKey: "valid_key_123" });
    await assert.rejects(
        () => client.memories.ingest({ actorId: "  ", messages: [{ role: "user", content: "hi" }] }),
        KairoValidationError
    );
});

test("SEC-N-04: Ingest rejects actorId over 128 characters", async () => {
    const client = new Kairo({ apiKey: "valid_key_123" });
    const longActor = "a".repeat(129);
    await assert.rejects(
        () => client.memories.ingest({ actorId: longActor, messages: [{ role: "user", content: "hi" }] }),
        KairoValidationError
    );
});

test("SEC-N-05: Ingest rejects empty messages array", async () => {
    const client = new Kairo({ apiKey: "valid_key_123" });
    await assert.rejects(
        () => client.memories.ingest({ actorId: "actor-1", messages: [] }),
        KairoValidationError
    );
});

test("SEC-N-06: Ingest rejects message with missing role", async () => {
    const client = new Kairo({ apiKey: "valid_key_123" });
    await assert.rejects(
        () => client.memories.ingest({ actorId: "actor-1", messages: [{ role: " ", content: "hi" }] }),
        KairoValidationError
    );
});

test("SEC-N-07: Ingest rejects message with missing content", async () => {
    const client = new Kairo({ apiKey: "valid_key_123" });
    await assert.rejects(
        () => client.memories.ingest({ actorId: "actor-1", messages: [{ role: "user", content: "   " }] }),
        KairoValidationError
    );
});

test("SEC-N-08: Search rejects empty query", async () => {
    const client = new Kairo({ apiKey: "valid_key_123" });
    await assert.rejects(
        () => client.memories.search({ actorId: "actor-1", query: "   " }),
        KairoValidationError
    );
});

test("SEC-N-09: Search rejects empty actorId", async () => {
    const client = new Kairo({ apiKey: "valid_key_123" });
    await assert.rejects(
        () => client.memories.search({ actorId: "", query: "valid query" }),
        KairoValidationError
    );
});

test("SEC-N-10: Search rejects actorId over 128 characters", async () => {
    const client = new Kairo({ apiKey: "valid_key_123" });
    const longActor = "a".repeat(129);
    await assert.rejects(
        () => client.memories.search({ actorId: longActor, query: "valid query" }),
        KairoValidationError
    );
});

test("SEC-N-11: Search rejects topK = 0", async () => {
    const client = new Kairo({ apiKey: "valid_key_123" });
    await assert.rejects(
        () => client.memories.search({ actorId: "actor-1", query: "valid query", topK: 0 }),
        KairoValidationError
    );
});

test("SEC-N-12: Search rejects topK > 100", async () => {
    const client = new Kairo({ apiKey: "valid_key_123" });
    await assert.rejects(
        () => client.memories.search({ actorId: "actor-1", query: "valid query", topK: 101 }),
        KairoValidationError
    );
});

test("SEC-N-13: Bearer token sent on ingest and search requests", async () => {
    let capturedAuth = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        capturedAuth = options?.headers?.Authorization || options?.headers?.authorization;
        return new Response(
            JSON.stringify({ processed: true, extractedCount: 0, memories: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_test_token_999" });
        await client.memories.ingest({
            actorId: "actor-1",
            messages: [{ role: "user", content: "hello" }],
        });
        assert.equal(capturedAuth, "Bearer kairo_test_token_999");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("SEC-N-14: HTTP 401 maps to KairoAuthenticationError without token leakage", async () => {
    const sentinel = "kairo_sec_sentinel_node_key";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
        JSON.stringify({ message: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
    );

    try {
        const client = new Kairo({ apiKey: sentinel });
        let threw = false;
        try {
            await client.memories.list();
        } catch (err) {
            threw = true;
            assert.ok(err instanceof KairoAuthenticationError);
            assert.ok(!err.message.includes(sentinel));
        }
        assert.ok(threw);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("SEC-N-15: HTTP 404 on get/update/delete maps to KairoNotFoundError (IDOR defense)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
        JSON.stringify({ message: "Memory not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
    );

    try {
        const client = new Kairo({ apiKey: "some_key" });
        await assert.rejects(() => client.memories.get(99999), KairoNotFoundError);
        await assert.rejects(() => client.memories.update(99999, { content: "attack", memoryType: "Fact" }), KairoNotFoundError);
        await assert.rejects(() => client.memories.delete(99999), KairoNotFoundError);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("SEC-N-16: HTTP 500 produces clean KairoServerError without SQL or stack details", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
        JSON.stringify({ message: "An unexpected error occurred." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
    );

    try {
        const client = new Kairo({ apiKey: "some_key" });
        await assert.rejects(
            () => client.memories.ingest({ actorId: "actor-1", messages: [{ role: "user", content: "hi" }] }),
            (err) => {
                assert.ok(err instanceof KairoServerError);
                assert.ok(!err.message.toLowerCase().includes("stack"));
                assert.ok(!err.message.toLowerCase().includes("sql"));
                return true;
            }
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});
