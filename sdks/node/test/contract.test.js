/**
 * Comprehensive Node.js / TypeScript SDK Contract Test Suite — Phase 12 Stage D.
 *
 * All tests are deterministic, offline, and use mocked global.fetch.
 * Zero live backend or SQL Server requirements.
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

// ── 1-7: Configuration & Initialization ────────────────────────────────────────

test("01: Explicit API key configuration", () => {
    const client = new Kairo({ apiKey: "kairo_live_explicit_123" });
    assert.ok(client);
    assert.ok(!client.toString().includes("kairo_live_explicit_123"));
});

test("02: KAIRO_API_KEY fallback", () => {
    const oldEnv = process.env.KAIRO_API_KEY;
    try {
        process.env.KAIRO_API_KEY = "kairo_live_env_456";
        const client = new Kairo();
        assert.ok(client);
    } finally {
        if (oldEnv !== undefined) {
            process.env.KAIRO_API_KEY = oldEnv;
        } else {
            delete process.env.KAIRO_API_KEY;
        }
    }
});

test("03: Explicit API key takes precedence over environment", () => {
    const oldEnv = process.env.KAIRO_API_KEY;
    try {
        process.env.KAIRO_API_KEY = "kairo_live_env_ignored";
        const client = new Kairo({ apiKey: "kairo_live_explicit_wins" });
        assert.ok(client);
    } finally {
        if (oldEnv !== undefined) {
            process.env.KAIRO_API_KEY = oldEnv;
        } else {
            delete process.env.KAIRO_API_KEY;
        }
    }
});

test("04: Default base URL is http://localhost:5171", () => {
    const client = new Kairo({ apiKey: "kairo_live_test" });
    assert.deepEqual(client.toJSON(), { baseUrl: "http://localhost:5171" });
    assert.match(client.toString(), /http:\/\/localhost:5171/);
});

test("05: Custom base URL override", () => {
    const client = new Kairo({
        apiKey: "kairo_live_test",
        baseUrl: "https://api.kairo.ai",
    });
    assert.deepEqual(client.toJSON(), { baseUrl: "https://api.kairo.ai" });
});

test("06: Trailing slash normalization", () => {
    const client = new Kairo({
        apiKey: "kairo_live_test",
        baseUrl: "https://api.kairo.ai///",
    });
    assert.deepEqual(client.toJSON(), { baseUrl: "https://api.kairo.ai" });
});

test("07: Timeout configuration", () => {
    const client = new Kairo({
        apiKey: "kairo_live_test",
        timeout: 45000,
    });
    assert.ok(client);
});

// ── 8: Authorization Header ───────────────────────────────────────────────────

test("08: Authorization Bearer header is sent on requests", async () => {
    let capturedHeaders = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedHeaders = options.headers;
        return new Response(JSON.stringify({ userId: 1, count: 0, memories: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_secret_key_888" });
        await client.memories.list();
        assert.equal(capturedHeaders.Authorization, "Bearer kairo_live_secret_key_888");
        assert.equal(capturedHeaders.Accept, "application/json");
    } finally {
        global.fetch = originalFetch;
    }
});

// ── 9-10: Create Memory & Payload Serialization ───────────────────────────────

test("09: Create memory requires actorId", async () => {
    const client = new Kairo({ apiKey: "kairo_live_test" });
    await assert.rejects(
        async () =>
            client.memories.create({
                content: "No actor provided",
                memoryType: "Fact",
                actorId: "",
            }),
        (err) => {
            assert.ok(err instanceof KairoValidationError);
            assert.equal(err.statusCode, 400);
            assert.match(err.message, /actorId must not be empty/);
            return true;
        }
    );
});

test("10: Create payload serialization without security authority fields", async () => {
    let captured = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        captured = {
            url,
            method: options.method,
            body: JSON.parse(options.body),
        };
        return new Response(
            JSON.stringify({
                memoryId: 101,
                userId: 1,
                content: captured.body.content,
                memoryType: captured.body.memoryType,
                isActive: true,
                createdAt: "2026-09-16T12:00:00Z",
                updatedAt: "2026-09-16T12:00:00Z",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const res = await client.memories.create({
            content: "User prefers strict typing",
            memoryType: "Fact",
            actorId: "actor-dev-01",
        });

        assert.equal(captured.method, "POST");
        assert.ok(captured.url.endsWith("/api/v1/memories"));
        assert.deepEqual(captured.body, {
            content: "User prefers strict typing",
            memoryType: "Fact",
            actorId: "actor-dev-01",
        });
        assert.equal(captured.body.userId, undefined);
        assert.equal(captured.body.projectId, undefined);
        assert.equal(captured.body.scopeId, undefined);

        assert.equal(res.isDuplicate, false);
        assert.equal(res.memory.memoryId, 101);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── 11-12: Search Memory & Payload Serialization ──────────────────────────────

test("11: Search memory requires actorId", async () => {
    const client = new Kairo({ apiKey: "kairo_live_test" });
    await assert.rejects(
        async () =>
            client.memories.search({
                query: "database choices",
                actorId: "",
            }),
        (err) => {
            assert.ok(err instanceof KairoValidationError);
            assert.equal(err.statusCode, 400);
            assert.match(err.message, /actorId must not be empty/);
            return true;
        }
    );
});

test("12: Search payload serialization", async () => {
    let captured = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        captured = {
            url,
            method: options.method,
            body: JSON.parse(options.body),
        };
        return new Response(
            JSON.stringify({
                query: captured.body.query,
                count: 1,
                memories: [
                    {
                        memoryId: 101,
                        content: "Prefers Postgres",
                        memoryType: "Preference",
                        similarity: 0.97,
                    },
                ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const res = await client.memories.search({
            query: "database preferences",
            actorId: "actor-test-12",
            topK: 7,
        });

        assert.equal(captured.method, "POST");
        assert.ok(captured.url.endsWith("/api/v1/memories/search"));
        assert.deepEqual(captured.body, {
            query: "database preferences",
            actorId: "actor-test-12",
            topK: 7,
        });
        assert.equal(res.count, 1);
        assert.equal(res.memories[0].memoryId, 101);
        assert.equal(res.memories[0].similarity, 0.97);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── 13-16: Get, List, Update, Delete CRUD ──────────────────────────────────────

test("13: Get memory by ID", async () => {
    let capturedUrl = null;
    const originalFetch = global.fetch;

    global.fetch = async (url) => {
        capturedUrl = url;
        return new Response(
            JSON.stringify({
                memoryId: 42,
                userId: 1,
                content: "A retrieved memory",
                memoryType: "Fact",
                isActive: true,
                createdAt: "2026-09-16T12:00:00Z",
                updatedAt: "2026-09-16T12:00:00Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const memory = await client.memories.get(42);
        assert.ok(capturedUrl.endsWith("/api/v1/memories/42"));
        assert.equal(memory.memoryId, 42);
        assert.equal(memory.content, "A retrieved memory");
    } finally {
        global.fetch = originalFetch;
    }
});

test("14: List memories", async () => {
    let capturedUrl = null;
    let capturedMethod = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedUrl = url;
        capturedMethod = options.method;
        return new Response(
            JSON.stringify({
                userId: 1,
                count: 2,
                memories: [
                    {
                        memoryId: 1,
                        userId: 1,
                        content: "Memory 1",
                        memoryType: "Fact",
                        isActive: true,
                        createdAt: "2026-09-16T12:00:00Z",
                        updatedAt: "2026-09-16T12:00:00Z",
                    },
                    {
                        memoryId: 2,
                        userId: 1,
                        content: "Memory 2",
                        memoryType: "Preference",
                        isActive: true,
                        createdAt: "2026-09-16T12:00:00Z",
                        updatedAt: "2026-09-16T12:00:00Z",
                    },
                ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const list = await client.memories.list();
        assert.equal(capturedMethod, "GET");
        assert.ok(capturedUrl.endsWith("/api/v1/memories"));
        assert.equal(list.length, 2);
        assert.equal(list[0].memoryId, 1);
        assert.equal(list[1].memoryId, 2);
    } finally {
        global.fetch = originalFetch;
    }
});

test("15: Update memory", async () => {
    let captured = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        captured = {
            url,
            method: options.method,
            body: JSON.parse(options.body),
        };
        return new Response(
            JSON.stringify({
                memoryId: 16,
                userId: 1,
                content: captured.body.content,
                memoryType: captured.body.memoryType,
                isActive: true,
                createdAt: "2026-09-16T12:00:00Z",
                updatedAt: "2026-09-16T12:05:00Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const updated = await client.memories.update(16, {
            content: "User strongly prefers dark mode",
            memoryType: "Preference",
        });

        assert.equal(captured.method, "PUT");
        assert.ok(captured.url.endsWith("/api/v1/memories/16"));
        assert.deepEqual(captured.body, {
            content: "User strongly prefers dark mode",
            memoryType: "Preference",
        });
        assert.equal(updated.memoryId, 16);
        assert.equal(updated.content, "User strongly prefers dark mode");
    } finally {
        global.fetch = originalFetch;
    }
});

test("16: Delete memory (soft deletion)", async () => {
    let captured = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        captured = { url, method: options.method };
        return new Response(
            JSON.stringify({
                memoryId: 16,
                message: "Memory deactivated. The record is preserved in the database.",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const res = await client.memories.delete(16);
        assert.equal(captured.method, "DELETE");
        assert.ok(captured.url.endsWith("/api/v1/memories/16"));
        assert.equal(res.memoryId, 16);
        assert.match(res.message, /deactivated/);
    } finally {
        global.fetch = originalFetch;
    }
});

// ── 17-24: Error Mapping & Status Codes ────────────────────────────────────────

test("17: HTTP 400 maps to KairoValidationError", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
        new Response(JSON.stringify({ message: "ActorId is required." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await assert.rejects(
            async () => client.memories.get(1),
            (err) => {
                assert.ok(err instanceof KairoValidationError);
                assert.equal(err.statusCode, 400);
                assert.match(err.message, /ActorId is required/);
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test("18: HTTP 401 maps to KairoAuthenticationError", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
        new Response(JSON.stringify({ message: "Invalid API key." }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await assert.rejects(
            async () => client.memories.get(1),
            (err) => {
                assert.ok(err instanceof KairoAuthenticationError);
                assert.equal(err.statusCode, 401);
                assert.match(err.message, /Invalid API key/);
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test("19: HTTP 403 maps to KairoAuthorizationError", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
        new Response(JSON.stringify({ message: "Forbidden." }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
        });

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await assert.rejects(
            async () => client.memories.get(1),
            (err) => {
                assert.ok(err instanceof KairoAuthorizationError);
                assert.equal(err.statusCode, 403);
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test("20: HTTP 404 maps to KairoNotFoundError", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
        new Response(JSON.stringify({ message: "Memory not found." }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        });

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await assert.rejects(
            async () => client.memories.get(999),
            (err) => {
                assert.ok(err instanceof KairoNotFoundError);
                assert.equal(err.statusCode, 404);
                assert.match(err.message, /Memory not found/);
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test("21: HTTP 409 maps to KairoConflictError", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
        new Response(JSON.stringify({ message: "Resource conflict." }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
        });

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await assert.rejects(
            async () => client.memories.get(1),
            (err) => {
                assert.ok(err instanceof KairoConflictError);
                assert.equal(err.statusCode, 409);
                assert.match(err.message, /Resource conflict/);
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test("22: HTTP 429 maps to KairoRateLimitError", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
        new Response(JSON.stringify({ message: "Rate limit exceeded." }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
        });

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await assert.rejects(
            async () => client.memories.get(1),
            (err) => {
                assert.ok(err instanceof KairoRateLimitError);
                assert.equal(err.statusCode, 429);
                assert.equal(err.retryAfter, undefined);
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test("23: Retry-After parsing on 429", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
        new Response(JSON.stringify({ message: "Too many requests" }), {
            status: 429,
            headers: {
                "Content-Type": "application/json",
                "Retry-After": "120",
            },
        });

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await assert.rejects(
            async () => client.memories.get(1),
            (err) => {
                assert.ok(err instanceof KairoRateLimitError);
                assert.equal(err.statusCode, 429);
                assert.equal(err.retryAfter, 120);
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test("24: HTTP 500 maps to KairoServerError", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
        new Response(JSON.stringify({ message: "Internal server error." }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await assert.rejects(
            async () => client.memories.get(1),
            (err) => {
                assert.ok(err instanceof KairoServerError);
                assert.equal(err.statusCode, 500);
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
    }
});

// ── 25: Network Failure Mapping ───────────────────────────────────────────────

test("25: Network failure maps to KairoConnectionError", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
        throw new TypeError("fetch failed: ECONNREFUSED");
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        await assert.rejects(
            async () => client.memories.get(1),
            (err) => {
                assert.ok(err instanceof KairoConnectionError);
                assert.match(err.message, /Network error/);
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
    }
});

// ── 26: API Key Security in Exceptions and Serializations ─────────────────────

test("26: API key never appears in exceptions or object representations", async () => {
    const secretKey = "kairo_live_super_secret_node_key";
    const originalFetch = global.fetch;
    global.fetch = async () =>
        new Response(JSON.stringify({ message: "Unauthorized." }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });

    try {
        const client = new Kairo({ apiKey: secretKey });

        // String and JSON serialization checks
        assert.ok(!client.toString().includes(secretKey));
        assert.ok(!JSON.stringify(client).includes(secretKey));

        // Exception check
        await assert.rejects(
            async () => client.memories.get(1),
            (err) => {
                assert.ok(!err.message.includes(secretKey));
                assert.ok(!String(err).includes(secretKey));
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
    }
});

// ── 27: KairoClient Alias Compatibility ───────────────────────────────────────

test("27: KairoClient alias compatibility", () => {
    assert.equal(KairoClient, Kairo);
    const client = new KairoClient({ apiKey: "kairo_live_alias_test" });
    assert.ok(client instanceof Kairo);
});

// ── 28-31: Agent Integration Contract ─────────────────────────────────────────

test("28: Agent default actor scoping", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                memoryId: 88,
                userId: 1,
                content: capturedBody.content,
                memoryType: capturedBody.memoryType,
                isActive: true,
                createdAt: "2026-09-16T12:00:00Z",
                updatedAt: "2026-09-16T12:00:00Z",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const agent = new KairoAgentMemory(client, { actorId: "agent-default-actor" });

        await agent.remember({
            content: "Remembering default actor",
            memoryType: "Fact",
        });

        assert.equal(capturedBody.actorId, "agent-default-actor");
    } finally {
        global.fetch = originalFetch;
    }
});

test("29: Agent per-call actor override", async () => {
    let capturedBody = null;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return new Response(
            JSON.stringify({
                memoryId: 89,
                userId: 1,
                content: capturedBody.content,
                memoryType: capturedBody.memoryType,
                isActive: true,
                createdAt: "2026-09-16T12:00:00Z",
                updatedAt: "2026-09-16T12:00:00Z",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const agent = new KairoAgentMemory(client, { actorId: "agent-default-actor" });

        await agent.remember({
            content: "Remembering override actor",
            memoryType: "Fact",
            actorId: "actor-specific-override",
        });

        assert.equal(capturedBody.actorId, "actor-specific-override");
    } finally {
        global.fetch = originalFetch;
    }
});

test("30: Missing actor validation", async () => {
    const client = new Kairo({ apiKey: "kairo_live_test" });
    const agent = new KairoAgentMemory(client); // No default actor

    await assert.rejects(
        async () =>
            agent.remember({
                content: "Missing actor",
                memoryType: "Fact",
            }),
        (err) => {
            assert.ok(err instanceof KairoValidationError);
            assert.match(err.message, /actorId is required/);
            return true;
        }
    );

    await assert.rejects(
        async () =>
            agent.recall({
                query: "Missing actor query",
            }),
        (err) => {
            assert.ok(err instanceof KairoValidationError);
            assert.match(err.message, /actorId is required/);
            return true;
        }
    );
});

test("31: Agent delegation to REST routes", async () => {
    const calledEndpoints = [];
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
        calledEndpoints.push({ method: options.method, url });
        if (url.endsWith("/api/v1/memories/search")) {
            return new Response(
                JSON.stringify({ query: "test", count: 0, memories: [] }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }
        if (url.endsWith("/api/v1/memories/42") && options.method === "PUT") {
            return new Response(
                JSON.stringify({
                    memoryId: 42,
                    userId: 1,
                    content: "Updated",
                    memoryType: "Goal",
                    isActive: true,
                    createdAt: "2026-09-16T12:00:00Z",
                    updatedAt: "2026-09-16T12:05:00Z",
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }
        if (url.endsWith("/api/v1/memories/42") && options.method === "DELETE") {
            return new Response(
                JSON.stringify({ memoryId: 42, message: "Deactivated." }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }
        return new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
    };

    try {
        const client = new Kairo({ apiKey: "kairo_live_test" });
        const agent = new KairoAgentMemory(client, { actorId: "agent-actor" });

        // recall delegates to POST /api/v1/memories/search
        await agent.recall({ query: "test query" });
        assert.equal(calledEndpoints.at(-1).method, "POST");
        assert.ok(calledEndpoints.at(-1).url.endsWith("/api/v1/memories/search"));

        // update delegates to PUT /api/v1/memories/42
        await agent.update(42, { content: "Updated", memoryType: "Goal" });
        assert.equal(calledEndpoints.at(-1).method, "PUT");
        assert.ok(calledEndpoints.at(-1).url.endsWith("/api/v1/memories/42"));

        // forget delegates to DELETE /api/v1/memories/42
        await agent.forget(42);
        assert.equal(calledEndpoints.at(-1).method, "DELETE");
        assert.ok(calledEndpoints.at(-1).url.endsWith("/api/v1/memories/42"));
    } finally {
        global.fetch = originalFetch;
    }
});

// ── Phase 4: Conversational Ingestion Contract Tests ──────────────────────────

test("F-N-30: ingest() sends POST to /api/v1/memories/ingest", async () => {
    const originalFetch = global.fetch;
    try {
        const payload = { processed: true, extractedCount: 1, memories: [] };
        global.fetch = async () =>
            new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });

        const client = new Kairo({ apiKey: "kairo_test_key" });
        const result = await client.memories.ingest({
            actorId: "actor-1",
            messages: [{ role: "user", content: "I enjoy hiking on weekends." }],
        });

        assert.ok(result.processed);
        assert.equal(result.extractedCount, 1);
    } finally {
        global.fetch = originalFetch;
    }
});

test("F-N-31: ingest() sends correct JSON body", async () => {
    const originalFetch = global.fetch;
    let capturedBody;
    try {
        const payload = { processed: true, extractedCount: 0, memories: [] };
        global.fetch = async (url, opts) => {
            capturedBody = JSON.parse(opts.body);
            return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
        };

        const client = new Kairo({ apiKey: "kairo_test_key" });
        await client.memories.ingest({
            actorId: "actor-99",
            messages: [
                { role: "user", content: "I use Rust for systems programming." },
                { role: "assistant", content: "Noted." },
            ],
        });

        assert.equal(capturedBody.actorId, "actor-99");
        assert.equal(capturedBody.messages.length, 2);
        assert.equal(capturedBody.messages[0].role, "user");
        assert.equal(capturedBody.messages[0].content, "I use Rust for systems programming.");
        assert.equal(capturedBody.messages[1].role, "assistant");
    } finally {
        global.fetch = originalFetch;
    }
});

test("F-N-32: ingest() maps IngestionMemoryResult fields", async () => {
    const originalFetch = global.fetch;
    try {
        const payload = {
            processed: true,
            extractedCount: 2,
            memories: [
                { action: "Add", memoryId: 101, content: "User likes hiking.", reason: null },
                { action: "NoAction", memoryId: null, content: "User likes water.", reason: "Duplicate" },
            ],
        };
        global.fetch = async () =>
            new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });

        const client = new Kairo({ apiKey: "kairo_test_key" });
        const result = await client.memories.ingest({
            actorId: "actor-2",
            messages: [{ role: "user", content: "I love hiking and water sports." }],
        });

        assert.equal(result.processed, true);
        assert.equal(result.extractedCount, 2);
        assert.equal(result.memories.length, 2);
        assert.equal(result.memories[0].action, "Add");
        assert.equal(result.memories[0].memoryId, 101);
        assert.equal(result.memories[0].content, "User likes hiking.");
        assert.equal(result.memories[0].reason, null);
        assert.equal(result.memories[1].action, "NoAction");
        assert.equal(result.memories[1].memoryId, null);
        assert.equal(result.memories[1].reason, "Duplicate");
    } finally {
        global.fetch = originalFetch;
    }
});

test("F-N-33: ingest() throws KairoValidationError for empty actorId", async () => {
    const client = new Kairo({ apiKey: "kairo_test_key" });
    await assert.rejects(
        () => client.memories.ingest({
            actorId: "",
            messages: [{ role: "user", content: "Test." }],
        }),
        KairoValidationError
    );
});

test("F-N-34: ingest() throws KairoValidationError for empty messages array", async () => {
    const client = new Kairo({ apiKey: "kairo_test_key" });
    await assert.rejects(
        () => client.memories.ingest({ actorId: "actor-x", messages: [] }),
        KairoValidationError
    );
});

test("F-N-35: ingest() throws KairoValidationError for message with empty role", async () => {
    const client = new Kairo({ apiKey: "kairo_test_key" });
    await assert.rejects(
        () => client.memories.ingest({
            actorId: "actor-x",
            messages: [{ role: "", content: "Some content." }],
        }),
        KairoValidationError
    );
});

test("F-N-36: ingest() throws KairoValidationError for message with empty content", async () => {
    const client = new Kairo({ apiKey: "kairo_test_key" });
    await assert.rejects(
        () => client.memories.ingest({
            actorId: "actor-x",
            messages: [{ role: "user", content: "" }],
        }),
        KairoValidationError
    );
});

