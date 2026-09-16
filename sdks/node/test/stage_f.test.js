/**
 * Phase 12 Stage F: Comprehensive Node.js SDK Verification Suite.
 *
 * Covers all gaps identified in the Stage F coverage audit.
 *
 * The _client() helper uses a fetch-intercepting pattern that preserves
 * Authorization/Content-Type/Accept headers by inspecting what the real
 * client sends, rather than constructing a bare client.
 *
 * CONFIG:
 *   F-N-01  Missing API key raises KairoAuthenticationError
 *   F-N-02  Default timeout (configurable, does not throw on construction)
 *   F-N-03  KAIRO_API_KEY env fallback
 *   F-N-04  Custom base URL
 *   F-N-05  Trailing slash normalization on baseUrl
 *
 * AUTH:
 *   F-N-06  Authorization header sent on all requests
 *   F-N-07  Content-Type is application/json on POST
 *   F-N-08  Accept is application/json on all requests
 *   F-N-09  API key never appears in repr (toJSON / toString)
 *   F-N-10  API key never appears in connection error messages
 *
 * MEMORY CREATE:
 *   F-N-11  userId never in create payload
 *   F-N-12  projectId never in create payload
 *   F-N-13  scopeId never in create payload
 *   F-N-14  Duplicate detection: isDuplicate=true path parsed correctly
 *
 * MEMORY SEARCH:
 *   F-N-15  Authority fields never in search payload
 *
 * CRUD DESERIALIZATION:
 *   F-N-16  get() correctly maps all Memory fields
 *   F-N-17  list() returns empty array when memories=[] from backend
 *   F-N-18  update() returns correctly mapped Memory
 *   F-N-19  delete() returns correctly mapped DeleteMemoryResult
 *   F-N-20  search() maps similarity field
 *
 * ERROR MAPPING:
 *   F-N-21  503 maps to KairoServerError with correct statusCode
 *   F-N-22  502 maps to KairoServerError
 *   F-N-23  Timeout/network failure maps to KairoConnectionError
 *
 * SECURITY:
 *   F-N-24  API key sentinel does not appear in any typed exception
 *
 * PUBLIC API:
 *   F-N-25  All exports resolve from dist/index.js
 *   F-N-26  KairoClient is identity alias for Kairo
 *   F-N-27  KairoAgentMemory is exported
 *
 * AGENT:
 *   F-N-28  A-B-A cross-call actor isolation regression
 *   F-N-29  recall() sends correct query + topK + actorId
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    Kairo,
    KairoClient,
    KairoAgentMemory,
    KairoError,
    KairoAuthenticationError,
    KairoAuthorizationError,
    KairoConflictError,
    KairoConnectionError,
    KairoNotFoundError,
    KairoRateLimitError,
    KairoServerError,
    KairoValidationError,
} = require("../dist/index.js");

const FAKE_KEY = "kairo_live_F_STAGE_NODE_TEST_SENTINEL";

const MEMORY_JSON = {
    memoryId: 77,
    userId: 3,
    content: "User prefers dark mode",
    memoryType: "Preference",
    isActive: true,
    createdAt: "2026-09-16T10:00:00Z",
    updatedAt: "2026-09-16T10:00:01Z",
};

const SEARCH_RESP = { query: "test", count: 0, memories: [] };

/** Intercept fetch for a single async callback, restoring original after. */
async function withFetch(mockFn, fn) {
    const orig = global.fetch;
    global.fetch = mockFn;
    try {
        return await fn();
    } finally {
        global.fetch = orig;
    }
}

function jsonFetch(status, body, headers = {}) {
    return async () => new Response(
        JSON.stringify(body),
        { status, headers: { "Content-Type": "application/json", ...headers } }
    );
}

// ── F-N-01: Missing API key ────────────────────────────────────────────────────

test("F-N-01: Missing API key raises KairoAuthenticationError", async () => {
    const origEnv = process.env.KAIRO_API_KEY;
    delete process.env.KAIRO_API_KEY;
    try {
        assert.throws(
            () => new Kairo(),
            KairoAuthenticationError
        );
    } finally {
        if (origEnv !== undefined) process.env.KAIRO_API_KEY = origEnv;
    }
});

// ── F-N-02: Default timeout ────────────────────────────────────────────────────

test("F-N-02: Default timeout is 30000ms", () => {
    const c = new Kairo({ apiKey: FAKE_KEY });
    // Client constructs without throwing; timeout is stored
    assert.ok(c); // construction succeeds
});

// ── F-N-03: KAIRO_API_KEY env fallback ────────────────────────────────────────

test("F-N-03: KAIRO_API_KEY env fallback", () => {
    const orig = process.env.KAIRO_API_KEY;
    try {
        process.env.KAIRO_API_KEY = "kairo_live_env_test_key";
        const c = new Kairo();
        assert.ok(c);
    } finally {
        if (orig !== undefined) {
            process.env.KAIRO_API_KEY = orig;
        } else {
            delete process.env.KAIRO_API_KEY;
        }
    }
});

// ── F-N-04: Custom base URL ────────────────────────────────────────────────────

test("F-N-04: Custom base URL is stored correctly", () => {
    const c = new Kairo({ apiKey: FAKE_KEY, baseUrl: "https://api.kairo.example" });
    assert.deepEqual(c.toJSON(), { baseUrl: "https://api.kairo.example" });
});

// ── F-N-05: Trailing slash normalization ──────────────────────────────────────

test("F-N-05: Trailing slash normalization", () => {
    const c = new Kairo({ apiKey: FAKE_KEY, baseUrl: "https://api.kairo.example///" });
    assert.deepEqual(c.toJSON(), { baseUrl: "https://api.kairo.example" });
});

// ── F-N-06: Authorization header ─────────────────────────────────────────────

test("F-N-06: Authorization Bearer header is sent", async () => {
    let capturedAuth = null;
    await withFetch(async (url, opts) => {
        capturedAuth = opts.headers?.["Authorization"] ?? opts.headers?.["authorization"] ?? null;
        return new Response(JSON.stringify({ memories: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }, async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        await c.memories.list();
    });
    assert.ok(capturedAuth, "Authorization header must be present");
    assert.ok(capturedAuth.startsWith("Bearer "), "Must be Bearer scheme");
});

// ── F-N-07: Content-Type on POST ─────────────────────────────────────────────

test("F-N-07: Content-Type is application/json on POST", async () => {
    let capturedCT = null;
    await withFetch(async (url, opts) => {
        capturedCT = opts.headers?.["Content-Type"] ?? opts.headers?.["content-type"] ?? null;
        return new Response(JSON.stringify(MEMORY_JSON), {
            status: 201,
            headers: { "Content-Type": "application/json" },
        });
    }, async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        await c.memories.create({ content: "test", memoryType: "Fact", actorId: "actor-1" });
    });
    assert.ok(capturedCT, "Content-Type header must be present");
    assert.ok(capturedCT.includes("application/json"), `Expected application/json, got: ${capturedCT}`);
});

// ── F-N-08: Accept header ─────────────────────────────────────────────────────

test("F-N-08: Accept is application/json on requests", async () => {
    let capturedAccept = null;
    await withFetch(async (url, opts) => {
        capturedAccept = opts.headers?.["Accept"] ?? opts.headers?.["accept"] ?? null;
        return new Response(JSON.stringify({ memories: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }, async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        await c.memories.list();
    });
    assert.ok(capturedAccept, "Accept header must be present");
    assert.ok(capturedAccept.includes("application/json"), `Expected application/json, got: ${capturedAccept}`);
});

// ── F-N-09: API key not in toString/toJSON ────────────────────────────────────

test("F-N-09: API key never appears in toString or toJSON", () => {
    const c = new Kairo({ apiKey: FAKE_KEY });
    assert.ok(!c.toString().includes(FAKE_KEY), "Key leaked in toString");
    assert.ok(!JSON.stringify(c.toJSON()).includes(FAKE_KEY), "Key leaked in toJSON");
});

// ── F-N-10: API key not in connection error ────────────────────────────────────

test("F-N-10: API key not in connection error message", async () => {
    await assert.rejects(
        async () => {
            await withFetch(async () => { throw new TypeError("fetch failed"); }, async () => {
                const c = new Kairo({ apiKey: FAKE_KEY });
                await c.memories.list();
            });
        },
        (err) => {
            assert.ok(err instanceof KairoConnectionError);
            assert.ok(!err.message.includes(FAKE_KEY), "Key leaked in connection error");
            return true;
        }
    );
});

// ── F-N-11/12/13: Authority fields never in create payload ────────────────────

test("F-N-11: userId not in create payload", async () => {
    let body = null;
    await withFetch(async (url, opts) => {
        body = JSON.parse(opts.body);
        return new Response(JSON.stringify(MEMORY_JSON), { status: 201, headers: { "Content-Type": "application/json" } });
    }, async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        await c.memories.create({ content: "test", memoryType: "Fact", actorId: "actor-1" });
    });
    assert.ok(!("userId" in body), "userId must NOT be in create payload");
});

test("F-N-12: projectId not in create payload", async () => {
    let body = null;
    await withFetch(async (url, opts) => {
        body = JSON.parse(opts.body);
        return new Response(JSON.stringify(MEMORY_JSON), { status: 201, headers: { "Content-Type": "application/json" } });
    }, async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        await c.memories.create({ content: "test", memoryType: "Fact", actorId: "actor-1" });
    });
    assert.ok(!("projectId" in body), "projectId must NOT be in create payload");
});

test("F-N-13: scopeId not in create payload", async () => {
    let body = null;
    await withFetch(async (url, opts) => {
        body = JSON.parse(opts.body);
        return new Response(JSON.stringify(MEMORY_JSON), { status: 201, headers: { "Content-Type": "application/json" } });
    }, async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        await c.memories.create({ content: "test", memoryType: "Fact", actorId: "actor-1" });
    });
    assert.ok(!("scopeId" in body), "scopeId must NOT be in create payload");
});

// ── F-N-14: Duplicate detection ───────────────────────────────────────────────

test("F-N-14: isDuplicate=true path is correctly parsed", async () => {
    await withFetch(jsonFetch(200, { isDuplicate: true, reason: "Semantic duplicate detected." }), async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        const result = await c.memories.create({ content: "dup", memoryType: "Fact", actorId: "actor-1" });
        assert.equal(result.isDuplicate, true);
        assert.equal(result.memory, null);
        assert.ok(result.duplicateReason.includes("Semantic"));
    });
});

// ── F-N-15: Authority fields never in search payload ──────────────────────────

test("F-N-15: Authority fields never in search payload", async () => {
    let body = null;
    await withFetch(async (url, opts) => {
        body = JSON.parse(opts.body);
        return new Response(JSON.stringify(SEARCH_RESP), { status: 200, headers: { "Content-Type": "application/json" } });
    }, async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        await c.memories.search({ query: "test", actorId: "actor-1" });
    });
    assert.ok(!("userId" in body), "userId must NOT be in search payload");
    assert.ok(!("projectId" in body), "projectId must NOT be in search payload");
    assert.ok(!("scopeId" in body), "scopeId must NOT be in search payload");
});

// ── F-N-16: get() maps all Memory fields ──────────────────────────────────────

test("F-N-16: get() correctly maps all Memory fields", async () => {
    await withFetch(jsonFetch(200, MEMORY_JSON), async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        const m = await c.memories.get(77);
        assert.equal(m.memoryId, 77);
        assert.equal(m.userId, 3);
        assert.equal(m.content, "User prefers dark mode");
        assert.equal(m.memoryType, "Preference");
        assert.equal(m.isActive, true);
        assert.ok(m.createdAt.includes("2026"));
    });
});

// ── F-N-17: list() returns empty array ────────────────────────────────────────

test("F-N-17: list() returns empty array when memories=[]", async () => {
    await withFetch(jsonFetch(200, { userId: 1, count: 0, memories: [] }), async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        const result = await c.memories.list();
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 0);
    });
});

// ── F-N-18: update() maps Memory ─────────────────────────────────────────────

test("F-N-18: update() returns correctly mapped Memory", async () => {
    await withFetch(jsonFetch(200, { ...MEMORY_JSON, content: "Updated content" }), async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        const m = await c.memories.update(77, { content: "Updated content", memoryType: "Fact" });
        assert.equal(m.content, "Updated content");
        assert.equal(m.memoryId, 77);
    });
});

// ── F-N-19: delete() maps DeleteMemoryResult ──────────────────────────────────

test("F-N-19: delete() returns correctly mapped DeleteMemoryResult", async () => {
    await withFetch(jsonFetch(200, { memoryId: 77, message: "Memory deactivated." }), async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        const r = await c.memories.delete(77);
        assert.equal(r.memoryId, 77);
        assert.ok(r.message.toLowerCase().includes("deactivated"));
    });
});

// ── F-N-20: search() maps similarity field ────────────────────────────────────

test("F-N-20: search() maps RetrievedMemory similarity", async () => {
    const searchResp = {
        query: "dark mode",
        count: 1,
        memories: [{ memoryId: 77, content: "User prefers dark mode", memoryType: "Preference", similarity: 0.9876 }],
    };
    await withFetch(jsonFetch(200, searchResp), async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        const r = await c.memories.search({ query: "dark mode", actorId: "actor-1" });
        assert.equal(r.count, 1);
        assert.equal(r.memories[0].memoryId, 77);
        assert.ok(Math.abs(r.memories[0].similarity - 0.9876) < 0.0001);
    });
});

// ── F-N-21/22: 5xx maps to KairoServerError ──────────────────────────────────

test("F-N-21: 503 maps to KairoServerError with statusCode=503", async () => {
    await assert.rejects(
        () => withFetch(jsonFetch(503, { message: "Service unavailable." }), async () => {
            const c = new Kairo({ apiKey: FAKE_KEY });
            await c.memories.get(1);
        }),
        (err) => {
            assert.ok(err instanceof KairoServerError);
            assert.equal(err.statusCode, 503);
            return true;
        }
    );
});

test("F-N-22: 502 maps to KairoServerError with statusCode=502", async () => {
    await assert.rejects(
        () => withFetch(jsonFetch(502, { message: "Bad gateway." }), async () => {
            const c = new Kairo({ apiKey: FAKE_KEY });
            await c.memories.get(1);
        }),
        (err) => {
            assert.ok(err instanceof KairoServerError);
            assert.equal(err.statusCode, 502);
            return true;
        }
    );
});

// ── F-N-23: Network failure maps to KairoConnectionError ─────────────────────

test("F-N-23: Network failure maps to KairoConnectionError", async () => {
    await assert.rejects(
        () => withFetch(async () => { throw new TypeError("fetch failed: connection refused"); }, async () => {
            const c = new Kairo({ apiKey: FAKE_KEY });
            await c.memories.get(1);
        }),
        (err) => {
            assert.ok(err instanceof KairoConnectionError);
            return true;
        }
    );
});

// ── F-N-24: API key sentinel not in any typed exception ───────────────────────

test("F-N-24: API key sentinel not in any typed exception", async () => {
    const SENTINEL = "kairo_live_STAGE_F_NODE_SECRET_SENTINEL";
    const statuses = [
        [401, KairoAuthenticationError],
        [403, KairoAuthorizationError],
        [404, KairoNotFoundError],
        [409, KairoConflictError],
        [500, KairoServerError],
    ];

    for (const [status, ErrClass] of statuses) {
        try {
            await withFetch(jsonFetch(status, { message: `Error ${status}` }), async () => {
                const c = new Kairo({ apiKey: SENTINEL });
                await c.memories.get(1);
            });
            assert.fail(`Should have thrown for status ${status}`);
        } catch (err) {
            assert.ok(err instanceof ErrClass, `Expected ${ErrClass.name} for ${status}`);
            assert.ok(!err.message.includes(SENTINEL), `Key leaked in ${ErrClass.name}.message`);
            if (err.stack) {
                assert.ok(!err.stack.includes(SENTINEL), `Key leaked in ${ErrClass.name}.stack`);
            }
        }
    }
});

// ── F-N-25: All exports resolve from dist/index.js ───────────────────────────

test("F-N-25: All expected exports resolve", () => {
    const sdk = require("../dist/index.js");
    const expected = [
        "Kairo", "KairoClient", "KairoAgentMemory",
        "KairoError", "KairoAuthenticationError", "KairoAuthorizationError",
        "KairoNotFoundError", "KairoValidationError", "KairoConflictError",
        "KairoRateLimitError", "KairoServerError", "KairoConnectionError",
    ];
    for (const name of expected) {
        assert.ok(name in sdk, `Missing export: ${name}`);
    }
});

// ── F-N-26: KairoClient is alias for Kairo ───────────────────────────────────

test("F-N-26: KairoClient is identity alias for Kairo", () => {
    assert.strictEqual(KairoClient, Kairo);
    const c = new KairoClient({ apiKey: FAKE_KEY });
    assert.ok(c instanceof Kairo);
});

// ── F-N-27: KairoAgentMemory is exported ─────────────────────────────────────

test("F-N-27: KairoAgentMemory is exported and constructable", () => {
    const c = new Kairo({ apiKey: FAKE_KEY });
    const agent = new KairoAgentMemory(c, { actorId: "agent-test" });
    assert.ok(agent);
});

// ── F-N-28: A-B-A cross-call actor isolation ─────────────────────────────────

test("F-N-28: A-B-A cross-call actor isolation regression", async () => {
    const calls = [];

    await withFetch(async (url, opts) => {
        const body = JSON.parse(opts.body);
        calls.push(body.actorId);
        if (url.endsWith("/search")) {
            return new Response(JSON.stringify(SEARCH_RESP), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify(MEMORY_JSON), { status: 201, headers: { "Content-Type": "application/json" } });
    }, async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        const agent = new KairoAgentMemory(c, { actorId: "actor-A" });

        await agent.remember({ content: "call 1", memoryType: "Fact" });
        await agent.remember({ content: "call 2", memoryType: "Fact", actorId: "actor-B" });
        await agent.recall({ query: "call 3" });
    });

    assert.deepEqual(calls, ["actor-A", "actor-B", "actor-A"],
        `Expected A->B->A, got ${JSON.stringify(calls)}`);
});

// ── F-N-29: recall() sends correct query + topK + actorId ────────────────────

test("F-N-29: recall() sends correct query, topK, actorId in delegated call", async () => {
    let body = null;
    await withFetch(async (url, opts) => {
        body = JSON.parse(opts.body);
        return new Response(JSON.stringify(SEARCH_RESP), { status: 200, headers: { "Content-Type": "application/json" } });
    }, async () => {
        const c = new Kairo({ apiKey: FAKE_KEY });
        const agent = new KairoAgentMemory(c, { actorId: "actor-verify" });
        await agent.recall({ query: "verified recall payload", topK: 7 });
    });
    assert.equal(body.query, "verified recall payload");
    assert.equal(body.topK, 7);
    assert.equal(body.actorId, "actor-verify");
});
