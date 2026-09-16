/**
 * Node.js Agent Integration Test Suite -- Phase 12 Stage E.
 *
 * Covers all 12 required agent integration behaviors (Node tests 13-24).
 * All tests are deterministic, offline, and use mocked global.fetch.
 * Zero live backend or SQL Server requirements.
 *
 * Tests:
 * 13. Constructor default actor is used by remember
 * 14. Constructor default actor is used by recall
 * 15. Per-call remember actor override
 * 16. Per-call recall actor override
 * 17. Override does not mutate default actor
 * 18. Missing actor fails before network call
 * 19. Empty actor fails before network call
 * 20. Remember delegates to client.memories.create
 * 21. Recall delegates to client.memories.search
 * 22. SDK errors propagate unchanged (typed)
 * 23. actorId appears correctly in delegated call
 * 24. No authority fields are introduced
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    Kairo,
    KairoAgentMemory,
    KairoAuthenticationError,
    KairoConflictError,
    KairoRateLimitError,
    KairoValidationError,
} = require("../dist/index.js");

// ── Shared fixtures ───────────────────────────────────────────────────────────

const MEMORY_RESP = {
    memoryId: 100,
    userId: 1,
    content: "test content",
    memoryType: "Fact",
    isActive: true,
    createdAt: "2026-09-16T12:00:00Z",
    updatedAt: "2026-09-16T12:00:00Z",
};

const SEARCH_RESP = { query: "test", count: 0, memories: [] };

function makeCreateFetch(captured) {
    return async (url, options) => {
        const body = JSON.parse(options.body);
        captured.lastBody = body;
        captured.lastMethod = options.method;
        captured.lastUrl = url;
        return new Response(
            JSON.stringify({ ...MEMORY_RESP, content: body.content || "x" }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    };
}

function makeSearchFetch(captured) {
    return async (url, options) => {
        const body = JSON.parse(options.body);
        captured.lastBody = body;
        captured.lastMethod = options.method;
        captured.lastUrl = url;
        return new Response(
            JSON.stringify(SEARCH_RESP),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };
}

function withFetch(mockFetch, fn) {
    const orig = global.fetch;
    global.fetch = mockFetch;
    return Promise.resolve(fn()).finally(() => { global.fetch = orig; });
}

// ── Test 13: Constructor default actor is used by remember ────────────────────

test("13: Constructor default actor is used by remember", async () => {
    const captured = {};
    await withFetch(makeCreateFetch(captured), async () => {
        const client = new Kairo({ apiKey: "kairo_live_test_agent" });
        const agent = new KairoAgentMemory(client, { actorId: "default-actor-A" });
        await agent.remember({ content: "Remembering with default actor", memoryType: "Fact" });
        assert.equal(captured.lastBody.actorId, "default-actor-A");
    });
});

// ── Test 14: Constructor default actor is used by recall ─────────────────────

test("14: Constructor default actor is used by recall", async () => {
    const captured = {};
    await withFetch(makeSearchFetch(captured), async () => {
        const client = new Kairo({ apiKey: "kairo_live_test_agent" });
        const agent = new KairoAgentMemory(client, { actorId: "default-actor-B" });
        await agent.recall({ query: "What does the user prefer?" });
        assert.equal(captured.lastBody.actorId, "default-actor-B");
    });
});

// ── Test 15: Per-call remember actor override ─────────────────────────────────

test("15: Per-call remember actor override", async () => {
    const captured = {};
    await withFetch(makeCreateFetch(captured), async () => {
        const client = new Kairo({ apiKey: "kairo_live_test_agent" });
        const agent = new KairoAgentMemory(client, { actorId: "default-actor-C" });
        await agent.remember({
            content: "Overriding the actor",
            memoryType: "Preference",
            actorId: "override-actor-X",
        });
        assert.equal(captured.lastBody.actorId, "override-actor-X");
    });
});

// ── Test 16: Per-call recall actor override ───────────────────────────────────

test("16: Per-call recall actor override", async () => {
    const captured = {};
    await withFetch(makeSearchFetch(captured), async () => {
        const client = new Kairo({ apiKey: "kairo_live_test_agent" });
        const agent = new KairoAgentMemory(client, { actorId: "default-actor-D" });
        await agent.recall({ query: "override search", actorId: "override-actor-Y" });
        assert.equal(captured.lastBody.actorId, "override-actor-Y");
    });
});

// ── Test 17: Override does not mutate default actor ───────────────────────────

test("17: Override does not mutate default actor", async () => {
    // Actor isolation cross-call:
    //   call 1 -> default-actor-E   (no override)
    //   call 2 -> override-actor-Z  (override)
    //   call 3 -> default-actor-E   (no override -- must NOT bleed from call 2)
    const calls = [];

    const orig = global.fetch;
    global.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body.actorId);
        if (url.endsWith("/search")) {
            return new Response(JSON.stringify(SEARCH_RESP), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        return new Response(
            JSON.stringify({ ...MEMORY_RESP, content: body.content || "x" }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test_agent" });
        const agent = new KairoAgentMemory(client, { actorId: "default-actor-E" });

        await agent.remember({ content: "Call 1 content", memoryType: "Fact" });
        await agent.remember({ content: "Call 2 content", memoryType: "Fact", actorId: "override-actor-Z" });
        await agent.recall({ query: "Call 3 query" });

        assert.equal(calls[0], "default-actor-E", "call 1 should use default actor");
        assert.equal(calls[1], "override-actor-Z", "call 2 should use override actor");
        assert.equal(calls[2], "default-actor-E", "call 3 must use default actor, not call-2 override");
    } finally {
        global.fetch = orig;
    }
});

// ── Test 18: Missing actor fails before network call ─────────────────────────

test("18: Missing actor fails before network call", async () => {
    let networkCalls = 0;
    const orig = global.fetch;
    global.fetch = async () => {
        networkCalls++;
        return new Response(JSON.stringify(MEMORY_RESP), {
            status: 201,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test_agent" });
        const agent = new KairoAgentMemory(client); // No default actor

        await assert.rejects(
            () => agent.remember({ content: "no actor here", memoryType: "Fact" }),
            (err) => {
                assert.ok(err instanceof KairoValidationError);
                assert.match(err.message, /actorId is required/);
                return true;
            }
        );
        assert.equal(networkCalls, 0, "network must NOT be called when actor is missing (remember)");

        await assert.rejects(
            () => agent.recall({ query: "no actor query" }),
            (err) => {
                assert.ok(err instanceof KairoValidationError);
                return true;
            }
        );
        assert.equal(networkCalls, 0, "network must NOT be called when actor is missing (recall)");
    } finally {
        global.fetch = orig;
    }
});

// ── Test 19: Empty actor fails before network call ────────────────────────────

test("19: Empty actor fails before network call", async () => {
    let networkCalls = 0;
    const orig = global.fetch;
    global.fetch = async () => {
        networkCalls++;
        return new Response(JSON.stringify(MEMORY_RESP), {
            status: 201,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test_agent" });

        // Empty string default actor
        const agentEmpty = new KairoAgentMemory(client, { actorId: "" });
        await assert.rejects(
            () => agentEmpty.remember({ content: "test", memoryType: "Fact" }),
            KairoValidationError
        );
        assert.equal(networkCalls, 0);

        // Whitespace-only default actor
        const agentWs = new KairoAgentMemory(client, { actorId: "   " });
        await assert.rejects(
            () => agentWs.remember({ content: "test", memoryType: "Fact" }),
            KairoValidationError
        );
        assert.equal(networkCalls, 0);

        // Whitespace-only per-call override
        const agentNoDefault = new KairoAgentMemory(client);
        await assert.rejects(
            () => agentNoDefault.remember({ content: "test", memoryType: "Fact", actorId: "  " }),
            KairoValidationError
        );
        assert.equal(networkCalls, 0);
    } finally {
        global.fetch = orig;
    }
});

// ── Test 20: Remember delegates to client.memories.create ────────────────────

test("20: Remember delegates to client.memories.create", async () => {
    const captured = {};
    await withFetch(makeCreateFetch(captured), async () => {
        const client = new Kairo({ apiKey: "kairo_live_test_agent" });
        const agent = new KairoAgentMemory(client, { actorId: "actor-spy-1" });

        const result = await agent.remember({ content: "Spy on create", memoryType: "Goal" });

        assert.equal(captured.lastMethod, "POST");
        assert.ok(captured.lastUrl.endsWith("/api/v1/memories"));
        assert.ok("isDuplicate" in result);
        assert.ok("memory" in result);
    });
});

// ── Test 21: Recall delegates to client.memories.search ──────────────────────

test("21: Recall delegates to client.memories.search", async () => {
    const captured = {};
    await withFetch(makeSearchFetch(captured), async () => {
        const client = new Kairo({ apiKey: "kairo_live_test_agent" });
        const agent = new KairoAgentMemory(client, { actorId: "actor-spy-2" });

        const result = await agent.recall({ query: "spy on search", topK: 3 });

        assert.equal(captured.lastMethod, "POST");
        assert.ok(captured.lastUrl.endsWith("/api/v1/memories/search"));
        assert.equal(captured.lastBody.query, "spy on search");
        assert.equal(captured.lastBody.topK, 3);
        assert.ok(Array.isArray(result.memories));
    });
});

// ── Test 22: SDK errors propagate unchanged (typed) ───────────────────────────

test("22: SDK errors propagate unchanged (typed)", async () => {
    // HTTP 401 -> KairoAuthenticationError
    const orig = global.fetch;

    global.fetch = async () =>
        new Response(JSON.stringify({ message: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });

    try {
        const agent = new KairoAgentMemory(
            new Kairo({ apiKey: "kairo_live_test_agent" }),
            { actorId: "actor-err-1" }
        );
        await assert.rejects(
            () => agent.remember({ content: "Will fail 401", memoryType: "Fact" }),
            KairoAuthenticationError
        );
    } finally {
        global.fetch = orig;
    }

    // HTTP 409 -> KairoConflictError
    global.fetch = async () =>
        new Response(JSON.stringify({ message: "Conflict" }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
        });

    try {
        const agent = new KairoAgentMemory(
            new Kairo({ apiKey: "kairo_live_test_agent" }),
            { actorId: "actor-err-2" }
        );
        await assert.rejects(
            () => agent.remember({ content: "Will fail 409", memoryType: "Fact" }),
            KairoConflictError
        );
    } finally {
        global.fetch = orig;
    }

    // HTTP 429 -> KairoRateLimitError with retryAfter
    global.fetch = async () =>
        new Response(JSON.stringify({ message: "Rate limited" }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Retry-After": "60" },
        });

    try {
        const agent = new KairoAgentMemory(
            new Kairo({ apiKey: "kairo_live_test_agent" }),
            { actorId: "actor-err-3" }
        );
        await assert.rejects(
            () => agent.remember({ content: "Will fail 429", memoryType: "Fact" }),
            (err) => {
                assert.ok(err instanceof KairoRateLimitError);
                assert.equal(err.retryAfter, 60);
                return true;
            }
        );
    } finally {
        global.fetch = orig;
    }
});

// ── Test 23: actorId appears correctly in delegated call ─────────────────────

test("23: actorId appears correctly in delegated call", async () => {
    const captured = {};
    await withFetch(makeCreateFetch(captured), async () => {
        const client = new Kairo({ apiKey: "kairo_live_test_agent" });
        const agent = new KairoAgentMemory(client, { actorId: "exact-actor-99" });

        await agent.remember({ content: "Precision check", memoryType: "Skill" });

        assert.equal(captured.lastBody.actorId, "exact-actor-99");
        assert.equal(captured.lastBody.content, "Precision check");
        assert.equal(captured.lastBody.memoryType, "Skill");
    });
});

// ── Test 24: No authority fields are introduced ───────────────────────────────

test("24: No authority fields are introduced", async () => {
    const captured = {};

    const multiFetch = async (url, options) => {
        const body = JSON.parse(options.body);
        captured.body = body;
        if (url.endsWith("/search")) {
            return new Response(JSON.stringify(SEARCH_RESP), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        return new Response(
            JSON.stringify({ ...MEMORY_RESP, content: body.content || "x" }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    };

    await withFetch(multiFetch, async () => {
        const client = new Kairo({ apiKey: "kairo_live_test_agent" });
        const agent = new KairoAgentMemory(client, { actorId: "authority-check-actor" });

        await agent.remember({ content: "Authority check remember", memoryType: "Fact" });
        const rememberBody = captured.body;
        assert.ok(!("userId" in rememberBody), "userId must NOT appear in remember payload");
        assert.ok(!("projectId" in rememberBody), "projectId must NOT appear in remember payload");
        assert.ok(!("scopeId" in rememberBody), "scopeId must NOT appear in remember payload");

        await agent.recall({ query: "Authority check recall" });
        const recallBody = captured.body;
        assert.ok(!("userId" in recallBody), "userId must NOT appear in recall payload");
        assert.ok(!("projectId" in recallBody), "projectId must NOT appear in recall payload");
        assert.ok(!("scopeId" in recallBody), "scopeId must NOT appear in recall payload");
    });
});
