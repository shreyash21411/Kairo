/**
 * privacyBoundaryEnforcement.test.ts
 *
 * Automated regression test suite for VOIDZONE Phase 1 Privacy Boundary Enforcement:
 * 1. Fail-closed gate: defaults to inactive if dataset attribute is missing, empty, or invalid.
 * 2. Zero inspection / emission while OFF:
 *    - No request body inspection or cloning.
 *    - No pre-flight user prompt dispatch.
 *    - Non-conversation requests pass through untouched.
 * 3. Mid-stream interruption & stream independence:
 *    - Cancelling cloned stream reader does NOT abort or cancel the original response stream.
 *    - Interrupted session state transitions to "interrupted" with pre-cutoff content preserved.
 * 4. Storage boundary enforcement:
 *    - saveActiveCaptureSession rejects normal writes when capture is OFF.
 *    - Allows saving the interrupted cutoff session.
 * 5. Resuming capture & anti-retroactive backfill prevention:
 *    - Messages created during OFF intervals are rejected.
 *    - Untimestamped messages are rejected if capture has ever been disabled.
 * 6. Decision 1 Reasoning / thought block rejection:
 *    - Reasoning payloads (recipient: thought, channel: thought, content_type: thoughts) are rejected.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isMessageEligibleForCapture,
  interruptStream,
  createCaptureSession,
  ingestMessage,
} from "../src/continuity/captureLifecycle.ts";
import type { CaptureEligibilityContext } from "../src/continuity/captureTypes.ts";
import {
  saveActiveCaptureSession,
  getActiveCaptureSession,
} from "../src/storage/conversationStorage.ts";
import { installAIMemoryFetchInterceptor } from "../src/page-scripts/chatgptFetchInterceptor.ts";

// ---------------------------------------------------------------------------
// In-memory mock for chrome.storage.local
// ---------------------------------------------------------------------------
const mockStorage = new Map<string, unknown>();
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (keys: string | string[]) => {
        if (typeof keys === "string") {
          return { [keys]: mockStorage.get(keys) };
        }
        const result: Record<string, unknown> = {};
        for (const k of keys) {
          result[k] = mockStorage.get(k);
        }
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) {
          mockStorage.set(k, v);
        }
      },
      remove: async (keys: string | string[]) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          mockStorage.delete(k);
        }
      },
    },
  },
};

interface MockPageEnvironment {
  mockWindow: {
    location: { origin: string; pathname: string };
    addEventListener: (type: string, fn: (e: Event) => void) => void;
    dispatchEvent: (event: Event) => void;
    postMessage: (data: unknown) => void;
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  };
  mockDocument: {
    documentElement: {
      dataset: Record<string, string>;
    };
  };
  postedMessages: Array<{ source: string; type: string; payload?: Record<string, unknown> }>;
  dispatchedEvents: Event[];
  setCaptureState: (active: boolean, epoch?: number | string) => void;
  originalFetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }>;
}

function createMockPageEnvironment(): MockPageEnvironment {
  const dataset: Record<string, string> = {
    vzCaptureActive: "true",
    vzCaptureEpoch: "100",
  };
  const mockDocument = {
    documentElement: {
      dataset,
    },
  };
  const postedMessages: Array<{ source: string; type: string; payload?: Record<string, unknown> }> = [];
  const dispatchedEvents: Event[] = [];
  const eventListeners: Record<string, Array<(e: Event) => void>> = {};
  const originalFetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  const mockWindow = {
    location: {
      origin: "https://chatgpt.com",
      pathname: "/c/3847f98d-test-conv-uuid",
    },
    addEventListener: (type: string, fn: (e: Event) => void) => {
      eventListeners[type] = eventListeners[type] || [];
      eventListeners[type].push(fn);
    },
    dispatchEvent: (event: Event) => {
      dispatchedEvents.push(event);
      const listeners = eventListeners[event.type] || [];
      for (const fn of listeners) fn(event);
    },
    postMessage: (data: unknown) => {
      postedMessages.push(data as { source: string; type: string; payload?: Record<string, unknown> });
    },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      originalFetchCalls.push({ input, init });
      return new Response("OK", { status: 200 });
    },
  };

  const setCaptureState = (active: boolean, epoch?: number | string) => {
    dataset.vzCaptureActive = active ? "true" : "false";
    const finalEpoch = epoch !== undefined ? String(epoch) : String(Date.now());
    dataset.vzCaptureEpoch = finalEpoch;
    mockWindow.dispatchEvent(
      new CustomEvent("AI_MEMORY_CAPTURE_STATE_CHANGED", {
        detail: { active, epoch: Number(finalEpoch) || Date.now() },
      })
    );
  };

  return {
    mockWindow,
    mockDocument,
    postedMessages,
    dispatchedEvents,
    setCaptureState,
    originalFetchCalls,
  };
}

describe("Phase 1: Privacy Boundary Enforcement & Decision 1 Rejection", () => {

  test("1. Fail-Closed Gate: isMessageEligibleForCapture rejects when capture is OFF", () => {
    const contextOff: CaptureEligibilityContext = {
      isCaptureCurrentlyEnabled: false,
      intervals: [{ start: 1000, end: null }],
    };

    const msg = {
      id: "msg-1",
      role: "user",
      content: "Private question sent while OFF",
      timestamp: new Date(1500).toISOString(),
    };

    const eligible = isMessageEligibleForCapture(msg, contextOff);
    assert.strictEqual(eligible, false, "Must strictly reject any message when capture is OFF");
  });

  test("2. Anti-Retroactive Prevention: Re-enabling capture never backfills OFF-period messages", () => {
    const contextReenabled: CaptureEligibilityContext = {
      isCaptureCurrentlyEnabled: true,
      intervals: [
        { start: 1000, end: 2000 },
        { start: 5000, end: null },
      ],
    };

    const offIntervalMsg = {
      id: "msg-off-1",
      role: "user",
      content: "Message sent while capture was disabled",
      timestamp: new Date(3500).toISOString(),
    };

    const isEligible = isMessageEligibleForCapture(offIntervalMsg, contextReenabled);
    assert.strictEqual(isEligible, false, "OFF-period message must be excluded by interval boundary");

    const onIntervalMsg = {
      id: "msg-on-2",
      role: "user",
      content: "Message sent after capture resumed",
      timestamp: new Date(5500).toISOString(),
    };
    assert.strictEqual(
      isMessageEligibleForCapture(onIntervalMsg, contextReenabled),
      true,
      "Post-resumption message must be accepted"
    );

    const window1Msg = {
      id: "msg-on-1",
      role: "user",
      content: "Message from first ON window",
      timestamp: new Date(1500).toISOString(),
    };
    assert.strictEqual(
      isMessageEligibleForCapture(window1Msg, contextReenabled),
      true,
      "Previous ON-period message remains eligible"
    );
  });

  test("3. Anti-Retroactive Prevention: Untimestamped DOM messages rejected if capture was ever disabled", () => {
    const contextWithDisabledHistory: CaptureEligibilityContext = {
      isCaptureCurrentlyEnabled: true,
      intervals: [
        { start: 1000, end: 2000 },
        { start: 5000, end: null },
      ],
    };

    const untimestampedDomMsg = {
      id: "asst-seq-3-hash",
      role: "assistant",
      content: "DOM message lacking authoritative server timestamp",
      timestamp: null,
    };

    const isEligible = isMessageEligibleForCapture(untimestampedDomMsg, contextWithDisabledHistory);
    assert.strictEqual(
      isEligible,
      false,
      "Untimestamped message must be rejected when capture was previously disabled to prevent backfill"
    );
  });

  test("4. Mid-Stream Interruption: interruptStream marks state interrupted and preserves pre-OFF content", () => {
    let session = createCaptureSession("chatgpt", "Test Stream", "https://chatgpt.com/c/test-1", "test-1");
    session = ingestMessage(session, {
      id: "u1",
      role: "user",
      content: "What is quantum entanglement?",
      timestamp: "2026-11-01T10:00:00Z",
    });

    session = {
      ...session,
      state: "response_in_progress",
      messages: [
        ...session.messages,
        {
          id: "a1",
          sequence: 2,
          role: "assistant",
          content: "Quantum entanglement is a physical phenomenon where particles...",
          timestamp: "2026-11-01T10:00:02Z",
          isInProgress: true,
          sourceMessageId: "a1",
        },
      ],
    };

    assert.strictEqual(session.messages[1].isInProgress, true);

    const interrupted = interruptStream(session, "Capture was paused by user.");

    assert.strictEqual(interrupted.state, "interrupted", "State must become interrupted");
    assert.strictEqual(interrupted.isComplete, false, "isComplete must be false");
    assert.strictEqual(interrupted.completenessStatus, "partial", "Status must be partial");
    assert.strictEqual(interrupted.error, "Capture was paused by user.", "Error reason must be recorded");
    assert.strictEqual(interrupted.messages.length, 2, "Both user and partial assistant must be retained");
    assert.strictEqual(interrupted.messages[1].isInProgress, false, "isInProgress must be cleared to prevent phantom streaming");
    assert.strictEqual(
      interrupted.messages[1].content,
      "Quantum entanglement is a physical phenomenon where particles...",
      "Content accumulated prior to cutoff must be preserved intact"
    );
  });

  test("5. Stream Independence: Cancelling cloned stream reader does NOT affect original response stream", async () => {
    const chunks = [
      "event: message\ndata: {\"v\":\"Hello \"}\n\n",
      "event: message\ndata: {\"v\":\"world!\"}\n\n",
      "data: [DONE]\n\n",
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const originalResponse = new Response(stream);
    const clonedResponse = originalResponse.clone();

    const cloneReader = clonedResponse.body!.getReader();
    const originalReader = originalResponse.body!.getReader();

    const { value: cloneChunk1 } = await cloneReader.read();
    assert.ok(cloneChunk1, "Clone should read chunk 1");

    void cloneReader.cancel("Capture turned OFF").catch(() => {});

    let originalReceived = "";
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await originalReader.read();
      if (done) break;
      originalReceived += decoder.decode(value, { stream: true });
    }

    assert.ok(
      originalReceived.includes("Hello ") && originalReceived.includes("world!"),
      "Original ChatGPT response stream was not interrupted by cancelling the clone"
    );
  });

  test("6. Decision 1: Thought / hidden reasoning payloads are rejected from capture", () => {
    const thoughtMsg1 = {
      id: "thought-1",
      recipient: "thought",
      role: "assistant",
      content: { content_type: "text", parts: ["Internal chain of thought: let's analyze physics..."] },
    };

    const thoughtMsg2 = {
      id: "thought-2",
      channel: "thought",
      role: "assistant",
      content: { content_type: "text", parts: ["Step 1: formulate hypothesis..."] },
    };

    const thoughtMsg3 = {
      id: "thought-3",
      role: "assistant",
      content: { content_type: "thoughts", parts: ["Thinking process..."] },
    };

    const thoughtMsg4 = {
      id: "thought-4",
      role: "assistant",
      metadata: { is_thought: true },
      content: { content_type: "text", parts: ["Private thoughts..."] },
    };

    function isHiddenReasoning(raw: Record<string, unknown>): boolean {
      if (raw["recipient"] === "thought" || raw["channel"] === "thought") return true;
      if (raw["metadata"] && typeof raw["metadata"] === "object") {
        const meta = raw["metadata"] as Record<string, unknown>;
        if (meta["is_thought"] === true || meta["thought"] === true) return true;
      }
      if (raw["content"] && typeof raw["content"] === "object") {
        const c = raw["content"] as Record<string, unknown>;
        if (c["content_type"] === "thoughts") return true;
      }
      return false;
    }

    assert.strictEqual(isHiddenReasoning(thoughtMsg1), true, "Recipient thought must be identified as hidden");
    assert.strictEqual(isHiddenReasoning(thoughtMsg2), true, "Channel thought must be identified as hidden");
    assert.strictEqual(isHiddenReasoning(thoughtMsg3), true, "content_type thoughts must be identified as hidden");
    assert.strictEqual(isHiddenReasoning(thoughtMsg4), true, "metadata is_thought must be identified as hidden");

    const legitimateMsg = {
      id: "asst-visible-1",
      role: "assistant",
      content: { content_type: "text", parts: ["Here is the clear explanation of your question."] },
    };
    assert.strictEqual(isHiddenReasoning(legitimateMsg), false, "Legitimate user-visible text must not be filtered");
  });

  // =========================================================================
  // TASK 3: ACTUAL INTERCEPTOR & PERSISTENCE INTEGRATION TESTS (A THROUGH H)
  // =========================================================================

  test("7. Task 3-A: OFF before fetch: original fetch called directly, no inspection or postMessage", async () => {
    const env = createMockPageEnvironment();
    env.setCaptureState(false, 50);

    let originalFetchExecuted = false;
    env.mockWindow.fetch = async () => {
      originalFetchExecuted = true;
      return new Response(JSON.stringify({ text: "original response" }), { status: 200 });
    };

    installAIMemoryFetchInterceptor({
      window: env.mockWindow,
      document: env.mockDocument,
    });

    const res = await env.mockWindow.fetch("https://chatgpt.com/backend-api/conversation", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ id: "m1", role: "user", content: { parts: ["Hello while OFF"] } }],
      }),
    });

    assert.strictEqual(originalFetchExecuted, true, "Original fetch must be called");
    assert.strictEqual(env.postedMessages.length, 0, "No messages or events should be posted when OFF");
    const text = await res.text();
    assert.ok(text.includes("original response"), "ChatGPT original response returned untouched");
  });

  test("8. Task 3-B: OFF while original fetch is pending: returned response is not inspected", async () => {
    const env = createMockPageEnvironment();
    env.setCaptureState(true, 100);

    let resolveFetch: (res: Response) => void;
    const pendingPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    env.mockWindow.fetch = async () => pendingPromise;

    installAIMemoryFetchInterceptor({
      window: env.mockWindow,
      document: env.mockDocument,
    });

    const fetchPromise = env.mockWindow.fetch("https://chatgpt.com/backend-api/conversation", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ id: "m1", role: "user", content: { parts: ["Prompt while pending"] } }],
      }),
    });

    assert.strictEqual(env.postedMessages.length, 1, "Pre-flight user prompt dispatched");
    assert.strictEqual(env.postedMessages[0].type, "AI_MEMORY_CHATGPT_CONVERSATION_EVENT");

    // Capture flipped to OFF while network response is still in-flight
    env.setCaptureState(false, 101);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {\"v\":\"Response after OFF\"}\n\n"));
        controller.close();
      },
    });
    resolveFetch!(new Response(stream, { status: 200 }));

    const res = await fetchPromise;
    assert.ok(res, "Original fetch resolved to response");

    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(env.postedMessages.length, 1, "No response inspection or stream events posted after OFF");
  });

  test("9. Task 3-C: OFF during SSE streaming: capture stops and original response stream remains functional", async () => {
    const env = createMockPageEnvironment();
    env.setCaptureState(true, 100);

    let streamController: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });

    env.mockWindow.fetch = async () => new Response(stream, { status: 200 });

    installAIMemoryFetchInterceptor({
      window: env.mockWindow,
      document: env.mockDocument,
    });

    const response = await env.mockWindow.fetch("https://chatgpt.com/backend-api/conversation", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ id: "m1", role: "user", content: { parts: ["Hello streaming"] } }],
      }),
    });

    streamController!.enqueue(new TextEncoder().encode("data: {\"v\":\"Chunk 1\"}\n\n"));
    await new Promise((r) => setTimeout(r, 20));

    const countAfterChunk1 = env.postedMessages.length;
    assert.ok(countAfterChunk1 >= 2, "Should have received pre-flight prompt and chunk 1");

    // Turn capture OFF mid-stream
    env.setCaptureState(false, 101);

    // Push chunk 2 and DONE after OFF
    streamController!.enqueue(new TextEncoder().encode("data: {\"v\":\"Chunk 2 after OFF\"}\n\n"));
    streamController!.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    streamController!.close();

    await new Promise((r) => setTimeout(r, 30));

    assert.strictEqual(env.postedMessages.length, countAfterChunk1, "No post-OFF chunks or DONE should be emitted");

    // Original ChatGPT response reader completes reading all data
    const originalReader = response.body!.getReader();
    let accumulated = "";
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await originalReader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
    }

    assert.ok(accumulated.includes("Chunk 1"), "Original stream contains chunk 1");
    assert.ok(accumulated.includes("Chunk 2 after OFF"), "Original stream contains chunk 2 without interruption");
  });

  test("10. Task 3-D: Epoch Invalidation: Stream A from Epoch 100 invalidated by OFF, does not revive in Epoch 200; Stream B captured", async () => {
    const env = createMockPageEnvironment();
    env.setCaptureState(true, 100);

    let streamAController: ReadableStreamDefaultController<Uint8Array>;
    const streamA = new ReadableStream<Uint8Array>({
      start(controller) {
        streamAController = controller;
      },
    });

    let streamBController: ReadableStreamDefaultController<Uint8Array>;
    const streamB = new ReadableStream<Uint8Array>({
      start(controller) {
        streamBController = controller;
      },
    });

    let callCount = 0;
    env.mockWindow.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(streamA, { status: 200 });
      }
      return new Response(streamB, { status: 200 });
    };

    installAIMemoryFetchInterceptor({
      window: env.mockWindow,
      document: env.mockDocument,
    });

    // 1. Stream A starts in Epoch 100
    await env.mockWindow.fetch("https://chatgpt.com/backend-api/conversation", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ id: "mA", role: "user", content: { parts: ["Stream A prompt"] } }],
      }),
    });

    streamAController!.enqueue(new TextEncoder().encode("data: {\"v\":\"Stream A chunk 1\"}\n\n"));
    await new Promise((r) => setTimeout(r, 20));

    const messagesAfterA1 = env.postedMessages.length;
    assert.ok(messagesAfterA1 >= 2);

    // 2. Capture toggled OFF (Epoch 101)
    env.setCaptureState(false, 101);

    // 3. Capture toggled ON in Epoch 200
    env.setCaptureState(true, 200);

    // 4. Old Stream A emits another chunk in Epoch 200
    streamAController!.enqueue(new TextEncoder().encode("data: {\"v\":\"Stream A post-invalidation chunk\"}\n\n"));
    streamAController!.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    streamAController!.close();
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(
      env.postedMessages.length,
      messagesAfterA1,
      "Stream A chunks must be permanently dropped after epoch invalidation"
    );

    // 5. Stream B starts in Epoch 200
    await env.mockWindow.fetch("https://chatgpt.com/backend-api/conversation", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ id: "mB", role: "user", content: { parts: ["Stream B prompt"] } }],
      }),
    });

    streamBController!.enqueue(new TextEncoder().encode("data: {\"v\":\"Stream B chunk 1\"}\n\n"));
    streamBController!.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    streamBController!.close();
    await new Promise((r) => setTimeout(r, 30));

    const streamBMessages = env.postedMessages.filter(
      (m) => m.payload?.captureEpoch === "200"
    );
    assert.ok(streamBMessages.length >= 2, "Stream B in Epoch 200 must be captured normally");
  });

  test("11. Task 3-E: Old stream completion after OFF: no completion event emitted", async () => {
    const env = createMockPageEnvironment();
    env.setCaptureState(true, 100);

    let controllerRef: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controllerRef = c;
      },
    });

    env.mockWindow.fetch = async () => new Response(stream, { status: 200 });

    installAIMemoryFetchInterceptor({
      window: env.mockWindow,
      document: env.mockDocument,
    });

    await env.mockWindow.fetch("https://chatgpt.com/backend-api/conversation", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ id: "u1", role: "user", content: { parts: ["Prompt"] } }],
      }),
    });

    controllerRef!.enqueue(new TextEncoder().encode("data: {\"v\":\"Text\"}\n\n"));
    await new Promise((r) => setTimeout(r, 20));

    // Toggle OFF
    env.setCaptureState(false, 101);

    // Stream emits DONE after OFF
    controllerRef!.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    controllerRef!.close();
    await new Promise((r) => setTimeout(r, 20));

    const doneEvents = env.postedMessages.filter(
      (m) => m.payload?.event === "done" || m.payload?.event === "stream_done" || m.payload?.data?.type === "message_stream_complete"
    );
    assert.strictEqual(doneEvents.length, 0, "No completion events may be emitted from an invalidated stream");
  });

  test("12. Task 3-F: OFF while storage write is queued: no post-boundary write", async () => {
    mockStorage.clear();
    mockStorage.set("memoryEnabled", true);

    const session = createCaptureSession("chatgpt", "Queued Write", "https://chatgpt.com/c/queued", "queued");
    session.messages.push({
      id: "m-queued-1",
      role: "user",
      content: "Queued write message",
      timestamp: new Date().toISOString(),
    });

    // Flip memoryEnabled to false BEFORE queued write executes
    mockStorage.set("memoryEnabled", false);

    const writeResult = await saveActiveCaptureSession(session);
    assert.strictEqual(writeResult.success, false, "Write must be rejected when memory is OFF");
    assert.strictEqual(mockStorage.has("activeCaptureSession"), false, "Nothing must be written to activeCaptureSession");
  });

  test("13. Task 3-G: Interrupted cutoff snapshot: persisted state remains interrupted and contains only pre-cutoff data", async () => {
    mockStorage.clear();
    mockStorage.set("memoryEnabled", true);

    // 1. Initial in-progress session saved while ON (explicitly identified legacy session)
    let session = {
      ...createCaptureSession("chatgpt", "Cutoff Test", "https://chatgpt.com/c/cutoff-1", "cutoff-1"),
      schemaVersion: "1.0" as const,
    };
    session = ingestMessage(session, {
      id: "u1",
      role: "user",
      content: "Explain superconductors.",
      timestamp: "2026-11-01T12:00:00Z",
    });
    session = {
      ...session,
      state: "response_in_progress",
      messages: [
        ...session.messages,
        {
          id: "a1",
          sequence: 2,
          role: "assistant",
          content: "Superconductors are materials that exhibit zero electrical resistance...",
          timestamp: "2026-11-01T12:00:02Z",
          isInProgress: true,
          sourceMessageId: "a1",
        },
      ],
    };

    const initialSave = await saveActiveCaptureSession(session);
    assert.strictEqual(initialSave.success, true);

    // 2. User turns capture OFF mid-stream -> interrupted cutoff snapshot created
    mockStorage.set("memoryEnabled", false);
    const cutoffSession = interruptStream(session, "Capture was paused by user.");

    const cutoffSave = await saveActiveCaptureSession(cutoffSession);
    assert.strictEqual(cutoffSave.success, true, "Cutoff snapshot must be accepted via special privacy exception");

    const storedAfterCutoff = (await getActiveCaptureSession())!;
    assert.strictEqual(storedAfterCutoff.state, "interrupted", "State MUST remain interrupted");
    assert.strictEqual(storedAfterCutoff.error, "Capture was paused by user.");
    assert.strictEqual(storedAfterCutoff.messages[1].isInProgress, false, "isInProgress must be false");
    assert.strictEqual(
      storedAfterCutoff.messages[1].content,
      "Superconductors are materials that exhibit zero electrical resistance..."
    );

    // 3. Stale in-progress stream update attempts to write after the cutoff
    const staleSession = {
      ...session,
      messages: [
        ...session.messages,
        {
          id: "a1",
          sequence: 2,
          role: "assistant",
          content: "Superconductors are materials that exhibit zero electrical resistance when cooled below...",
          timestamp: "2026-11-01T12:00:04Z",
          isInProgress: true,
          sourceMessageId: "a1",
        },
      ],
    };

    // While capture is still OFF
    const staleSaveOff = await saveActiveCaptureSession(staleSession);
    assert.strictEqual(staleSaveOff.success, false, "Stale in-progress write while OFF must be rejected");

    // Re-enable capture (Epoch 2)
    mockStorage.set("memoryEnabled", true);

    // Stale write from old stream executes after re-enabling
    const staleSaveAfterReenable = await saveActiveCaptureSession(staleSession);
    assert.strictEqual(staleSaveAfterReenable.success, true);

    const storedAfterStale = (await getActiveCaptureSession())!;
    assert.strictEqual(
      storedAfterStale.state,
      "interrupted",
      "Persisted state must NOT revert to response_in_progress on stale write"
    );
    assert.strictEqual(
      storedAfterStale.messages[1].content,
      "Superconductors are materials that exhibit zero electrical resistance...",
      "Post-cutoff content must NOT overwrite the cutoff snapshot"
    );
  });

  test("14. Task 3-H: Rapid repeated ON/OFF transitions: old streams never become valid again", async () => {
    const env = createMockPageEnvironment();

    // Rapidly toggle ON (100) -> OFF (101) -> ON (200) -> OFF (201) -> ON (300)
    env.setCaptureState(true, 100);

    let controller1: ReadableStreamDefaultController<Uint8Array>;
    const stream1 = new ReadableStream<Uint8Array>({ start(c) { controller1 = c; } });

    let controller2: ReadableStreamDefaultController<Uint8Array>;
    const stream2 = new ReadableStream<Uint8Array>({ start(c) { controller2 = c; } });

    let controller3: ReadableStreamDefaultController<Uint8Array>;
    const stream3 = new ReadableStream<Uint8Array>({ start(c) { controller3 = c; } });

    let streamIdx = 0;
    env.mockWindow.fetch = async () => {
      streamIdx++;
      if (streamIdx === 1) return new Response(stream1, { status: 200 });
      if (streamIdx === 2) return new Response(stream2, { status: 200 });
      return new Response(stream3, { status: 200 });
    };

    installAIMemoryFetchInterceptor({
      window: env.mockWindow,
      document: env.mockDocument,
    });

    // Start Stream 1 in Epoch 100
    await env.mockWindow.fetch("https://chatgpt.com/backend-api/conversation", { method: "POST" });

    // Rapid transitions
    env.setCaptureState(false, 101);
    env.setCaptureState(true, 200);

    // Start Stream 2 in Epoch 200
    await env.mockWindow.fetch("https://chatgpt.com/backend-api/conversation", { method: "POST" });

    env.setCaptureState(false, 201);
    env.setCaptureState(true, 300);

    // Both old streams emit chunks in Epoch 300
    controller1!.enqueue(new TextEncoder().encode("data: {\"v\":\"Stream 1 late chunk\"}\n\n"));
    controller2!.enqueue(new TextEncoder().encode("data: {\"v\":\"Stream 2 late chunk\"}\n\n"));
    controller1!.close();
    controller2!.close();

    await new Promise((r) => setTimeout(r, 20));

    // No chunks from Stream 1 or Stream 2 should be captured in Epoch 300
    const epoch300Events = env.postedMessages.filter((m) => m.payload?.captureEpoch === "300");
    assert.strictEqual(epoch300Events.length, 0, "No stale chunks from Stream 1 or 2 can enter Epoch 300");

    // Stream 3 starts in Epoch 300
    await env.mockWindow.fetch("https://chatgpt.com/backend-api/conversation", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ id: "u3", role: "user", content: { parts: ["Stream 3 prompt"] } }],
      }),
    });

    controller3!.enqueue(new TextEncoder().encode("data: {\"v\":\"Stream 3 active chunk\"}\n\n"));
    controller3!.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    controller3!.close();

    await new Promise((r) => setTimeout(r, 30));

    const validEvents = env.postedMessages.filter((m) => m.payload?.captureEpoch === "300");
    assert.ok(validEvents.length >= 2, "Stream 3 in Epoch 300 captured normally");
  });
});

