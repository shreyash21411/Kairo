import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkLiveness,
  extractMemory,
  generateContinuity,
} from "../src/services/voidzoneBackendClient.ts";
import { VoidzoneApiError } from "../src/services/voidzoneTypes.ts";

// Save original fetch
const originalFetch = globalThis.fetch;

describe("voidzoneBackendClient — Dedicated Meta Backend HTTP Client", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("checkLiveness returns success when GET /health/live returns 200", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return new Response("Healthy", { status: 200, statusText: "OK" });
    }) as typeof fetch;

    const res = await checkLiveness("http://localhost:5171");

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(capturedUrl, "http://localhost:5171/health/live");
  });

  test("checkLiveness returns failure when backend is unreachable", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const res = await checkLiveness("http://localhost:5171");

    assert.strictEqual(res.success, false);
    assert.match(res.message, /ECONNREFUSED/);
  });

  test("extractMemory sends correct headers and body to /api/voidzone/memory/extract", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";

    const mockResponseData = {
      userId: 42,
      projectId: 99,
      result: {
        decisions: ["Use PostgreSQL"],
        requirements: ["pgvector enabled"],
        constraints: ["net10.0 runtime"],
        goals: ["Vector retrieval"],
        technicalContext: ".NET 10, C#",
        pendingTasks: ["Deploy schema"],
        projectFacts: ["Port 5432"],
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        extractedAt: "2026-11-04T00:00:00Z",
      },
    };

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedMethod = init?.method ?? "";
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = (init?.body as string) ?? "";
      return new Response(JSON.stringify(mockResponseData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const res = await extractMemory(
      {
        rawTranscript: "HUMAN: Let's use postgres\nASSISTANT: Agreed",
        messages: [{ role: "user", content: "Let's use postgres" }],
      },
      { backendBaseUrl: "http://localhost:5171", kairoApiKey: "kro_test_key_12345" }
    );

    assert.strictEqual(capturedUrl, "http://localhost:5171/api/voidzone/memory/extract");
    assert.strictEqual(capturedMethod, "POST");
    assert.strictEqual(capturedHeaders["Authorization"], "Bearer kro_test_key_12345");
    assert.strictEqual(capturedHeaders["Content-Type"], "application/json");

    const parsedBody = JSON.parse(capturedBody);
    assert.strictEqual(parsedBody.rawTranscript, "HUMAN: Let's use postgres\nASSISTANT: Agreed");
    assert.strictEqual(parsedBody.messages.length, 1);

    assert.strictEqual(res.userId, 42);
    assert.strictEqual(res.projectId, 99);
    assert.strictEqual(res.result.decisions.length, 1);
    assert.strictEqual(res.result.decisions[0], "Use PostgreSQL");
    assert.strictEqual(res.result.tokenUsage.totalTokens, 150);
  });

  test("generateContinuity sends correct request and parses response", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    const mockResponseData = {
      userId: 1,
      projectId: 2,
      result: {
        projectName: "VOIDZONE",
        currentObjective: "Bridge continuity",
        importantDecisions: ["Keep schema 1.0"],
        constraints: ["Do not mutate capture boundary"],
        completedWork: ["Created backend client"],
        outstandingTasks: ["Wire UI components"],
        blockers: ["None"],
        recommendedNextAction: "Add settings modal",
        technicalContext: "TypeScript, React",
        tokenUsage: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
        generatedAt: "2026-11-04T00:00:00Z",
      },
    };

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedBody = (init?.body as string) ?? "";
      return new Response(JSON.stringify(mockResponseData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const res = await generateContinuity(
      {
        rawTranscript: "HUMAN: session transcript",
        platform: "chatgpt",
        title: "Session Title",
      },
      { backendBaseUrl: "http://localhost:5171", kairoApiKey: "test_key" }
    );

    assert.strictEqual(capturedUrl, "http://localhost:5171/api/voidzone/continuity/generate");
    const parsedBody = JSON.parse(capturedBody);
    assert.strictEqual(parsedBody.platform, "chatgpt");
    assert.strictEqual(parsedBody.title, "Session Title");

    assert.strictEqual(res.result.projectName, "VOIDZONE");
    assert.strictEqual(res.result.currentObjective, "Bridge continuity");
    assert.strictEqual(res.result.importantDecisions.length, 1);
  });

  test("extractMemory throws 400 when rawTranscript is empty without network call", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("", { status: 200 });
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await extractMemory({ rawTranscript: "   " });
      },
      (err: unknown) => {
        assert.ok(err instanceof VoidzoneApiError);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.errorCode, "raw_transcript_required");
        return true;
      }
    );

    assert.strictEqual(called, false);
  });

  test("extractMemory maps HTTP 503 to meta_ai_disabled error", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "meta_ai_disabled" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await extractMemory(
          { rawTranscript: "valid transcript" },
          { backendBaseUrl: "http://localhost:5171" }
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof VoidzoneApiError);
        assert.strictEqual(err.statusCode, 503);
        assert.strictEqual(err.errorCode, "meta_ai_disabled");
        assert.match(err.message, /Meta AI integration is disabled on the backend/);
        return true;
      }
    );
  });

  test("extractMemory maps HTTP 401 to unauthorized error", async () => {
    globalThis.fetch = (async () => {
      return new Response("", { status: 401 });
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await extractMemory(
          { rawTranscript: "valid transcript" },
          { backendBaseUrl: "http://localhost:5171" }
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof VoidzoneApiError);
        assert.strictEqual(err.statusCode, 401);
        assert.strictEqual(err.errorCode, "unauthorized");
        assert.match(err.message, /Authentication failed/);
        return true;
      }
    );
  });

  test("extractMemory maps HTTP 413 to input_too_large error with token metadata", async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: "input_too_large",
          estimatedTokens: 9200,
          maxTokens: 8000,
          message: "Input too large",
        }),
        {
          status: 413,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await extractMemory(
          { rawTranscript: "huge transcript" },
          { backendBaseUrl: "http://localhost:5171" }
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof VoidzoneApiError);
        assert.strictEqual(err.statusCode, 413);
        assert.strictEqual(err.errorCode, "input_too_large");
        assert.strictEqual(err.estimatedTokens, 9200);
        assert.strictEqual(err.maxTokens, 8000);
        return true;
      }
    );
  });

  test("extractMemory maps HTTP 429 to meta_ai_rate_limited error", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "meta_ai_rate_limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await extractMemory(
          { rawTranscript: "transcript" },
          { backendBaseUrl: "http://localhost:5171" }
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof VoidzoneApiError);
        assert.strictEqual(err.statusCode, 429);
        assert.strictEqual(err.errorCode, "meta_ai_rate_limited");
        return true;
      }
    );
  });

  test("kairoApiKey never appears in VoidzoneApiError message or stack", async () => {
    const secretApiKey = "kro_live_SUPER_SECRET_TOKEN_DO_NOT_LEAK";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "meta_ai_error" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await extractMemory(
        { rawTranscript: "valid transcript" },
        { backendBaseUrl: "http://localhost:5171", kairoApiKey: secretApiKey }
      );
      assert.fail("Expected extractMemory to throw");
    } catch (err: unknown) {
      assert.ok(err instanceof VoidzoneApiError);
      assert.doesNotMatch((err as Error).message, new RegExp(secretApiKey));
      if ((err as Error).stack) {
        assert.doesNotMatch((err as Error).stack!, new RegExp(secretApiKey));
      }
    }
  });
});
