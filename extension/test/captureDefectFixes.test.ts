import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createCaptureSession,
  startCapture,
  ingestMessage,
  startAssistantStream,
  appendAssistantChunk,
  completeAssistantStream,
  interruptStream,
  completeCapture,
} from "../src/continuity/captureLifecycle.ts";
import {
  createArchiveFromCapturedConversation,
  serializeArchive,
  parseAndValidateArchive,
} from "../src/continuity/archiveLifecycle.ts";
import {
  saveConversation,
  getConversations,
  serializeStorageOperation,
} from "../src/storage/conversationStorage.ts";
import type { Conversation } from "../src/connectors/types.ts";

// ---------------------------------------------------------------------------
// Mock chrome.storage.local for Node.js test environment
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

// ---------------------------------------------------------------------------
// TASK 1: SSE Stream-Completion Signaling & Idempotence
// ---------------------------------------------------------------------------
describe("Task 1 — SSE Completion Signaling, Reader Termination & Idempotence", () => {
  test("explicit completion event transitions lifecycle out of response_in_progress", () => {
    let session = createCaptureSession("chatgpt", "Test", null, "conv-1");
    session = startCapture(session);
    session = ingestMessage(session, { role: "user", content: "Hello" });
    session = startAssistantStream(session, "asst-1", "Hello there");

    assert.strictEqual(session.state, "response_in_progress");
    assert.strictEqual(session.messages[1].isInProgress, true);

    // Simulate explicit completion event arriving
    session = completeAssistantStream(session);

    assert.strictEqual(session.state, "checkpoint_available");
    assert.strictEqual(session.messages[1].isInProgress, false);
    assert.strictEqual(session.messages[1].content, "Hello there");
  });

  test("[DONE] without prior completion event transitions lifecycle out of response_in_progress", () => {
    let session = createCaptureSession("chatgpt", "Test", null, "conv-2");
    session = startCapture(session);
    session = ingestMessage(session, { role: "user", content: "Prompt" });
    session = startAssistantStream(session, "asst-2", "Streamed chunk 1 ");
    session = appendAssistantChunk(session, "Streamed chunk 2");

    assert.strictEqual(session.state, "response_in_progress");

    // [DONE] received by interceptor triggers completeAssistantStream
    session = completeAssistantStream(session);

    assert.strictEqual(session.state, "checkpoint_available");
    assert.strictEqual(session.messages[1].isInProgress, false);
    assert.strictEqual(
      session.messages[1].content,
      "Streamed chunk 1 Streamed chunk 2"
    );
  });

  test("duplicate completion signals are idempotent and do not duplicate messages", () => {
    let session = createCaptureSession("chatgpt", "Test", null, "conv-3");
    session = startCapture(session);
    session = ingestMessage(session, { role: "user", content: "Prompt" });
    session = startAssistantStream(session, "asst-3", "Single reply");

    // First completion (e.g. from explicit event)
    session = completeAssistantStream(session);
    assert.strictEqual(session.state, "checkpoint_available");
    assert.strictEqual(session.messages.length, 2);

    // Second completion (e.g. from [DONE] or reader termination)
    const secondCompletion = completeAssistantStream(session);
    assert.strictEqual(secondCompletion.state, "checkpoint_available");
    assert.strictEqual(secondCompletion.messages.length, 2);
    assert.strictEqual(secondCompletion.messages[1].content, "Single reply");
  });

  test("stream reader error or abort transitions lifecycle to interrupted, NOT completed", () => {
    let session = createCaptureSession("chatgpt", "Test", null, "conv-4");
    session = startCapture(session);
    session = ingestMessage(session, { role: "user", content: "Prompt" });
    session = startAssistantStream(session, "asst-4", "Partial response before error...");

    assert.strictEqual(session.state, "response_in_progress");

    // Interceptor catches stream error / network drop
    session = interruptStream(session, "Network connection terminated prematurely");

    assert.strictEqual(session.state, "interrupted");
    assert.strictEqual(session.isComplete, false);
    assert.strictEqual(session.error, "Network connection terminated prematurely");
    // Partial content must be preserved
    assert.strictEqual(session.messages.length, 2);
    assert.strictEqual(session.messages[1].content, "Partial response before error...");
    assert.strictEqual(session.messages[1].isInProgress, false);
  });

  test("end of assistant stream does NOT mark full conversation history complete", () => {
    let session = createCaptureSession("chatgpt", "Test", null, "conv-5");
    session = startCapture(session);
    session = ingestMessage(session, { role: "user", content: "Prompt" });
    session = startAssistantStream(session, "asst-5", "Response");
    session = completeAssistantStream(session);

    // Stream finished, but whole history is NOT confirmed complete
    assert.strictEqual(session.state, "checkpoint_available");
    assert.strictEqual(session.isComplete, false);
  });
});

// ---------------------------------------------------------------------------
// TASK 2: Storage Serialization & Lost Updates Prevention
// ---------------------------------------------------------------------------
describe("Task 2 — Storage Concurrency & Queue Resilience", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("concurrent saveConversation calls are serialized and all updates survive", async () => {
    const conv1: Conversation = {
      id: "conv-shared",
      platform: "chatgpt",
      capturedAt: new Date().toISOString(),
      messages: [{ id: "m1", role: "user", content: "First message" }],
    };

    const conv1Update: Conversation = {
      id: "conv-shared",
      platform: "chatgpt",
      capturedAt: new Date().toISOString(),
      messages: [
        { id: "m1", role: "user", content: "First message" },
        { id: "m2", role: "assistant", content: "Second message" },
      ],
    };

    const conv2: Conversation = {
      id: "conv-other",
      platform: "chatgpt",
      capturedAt: new Date().toISOString(),
      messages: [{ id: "other-m1", role: "user", content: "Other conversation" }],
    };

    // Fire 3 saves concurrently without awaiting individually
    const [res1, res2, res3] = await Promise.all([
      saveConversation(conv1),
      saveConversation(conv2),
      saveConversation(conv1Update),
    ]);

    assert.ok(res1);
    assert.ok(res2);
    assert.ok(res3);

    const stored = await getConversations();

    // Both distinct conversations must exist
    assert.strictEqual(stored.length, 2);

    const shared = stored.find((c) => c.id === "conv-shared");
    assert.ok(shared);
    // The update must not have been overwritten by a stale snapshot
    assert.strictEqual(shared.messages.length, 2);
    assert.strictEqual(shared.messages[1].content, "Second message");

    const other = stored.find((c) => c.id === "conv-other");
    assert.ok(other);
    assert.strictEqual(other.messages.length, 1);
  });

  test("storage failure does not permanently poison the serialization queue", async () => {
    let callCount = 0;

    // Operation 1 fails
    const failingOp = serializeStorageOperation(async () => {
      callCount++;
      throw new Error("Simulated disk error");
    });

    // Operation 2 should still run after operation 1 rejects
    const succeedingOp = serializeStorageOperation(async () => {
      callCount++;
      return "success-after-failure";
    });

    await assert.rejects(failingOp, { message: "Simulated disk error" });
    const result2 = await succeedingOp;

    assert.strictEqual(callCount, 2);
    assert.strictEqual(result2, "success-after-failure");
  });
});

// ---------------------------------------------------------------------------
// TASK 3: Conservative Evidence-Based Completeness
// ---------------------------------------------------------------------------
describe("Task 3 — Conservative Evidence-Based Completeness", () => {
  test("conversation opened before capture started is conservatively treated as partial", async () => {
    // Only live turns captured, no /messages history call ever occurred
    let session = createCaptureSession("chatgpt", "Pre-existing Tab");
    session = startCapture(session);
    session = ingestMessage(session, { role: "user", content: "Mid-conversation prompt" });
    session = startAssistantStream(session, "a-mid", "Mid-conversation reply");
    session = completeAssistantStream(session);

    assert.strictEqual(session.isComplete, false);

    const archive = await createArchiveFromCapturedConversation(session);
    assert.strictEqual(archive.completeness.status, "partial");
    assert.strictEqual(archive.completeness.sourceConfirmed, false);
    assert.ok(
      archive.voidzone.instructions.transferPrompt.includes(
        "COMPLETENESS WARNING: PARTIAL"
      )
    );
  });

  test("new conversation with live exchange only is partial (unbounded history)", async () => {
    let session = createCaptureSession("chatgpt", "New Chat");
    session = ingestMessage(session, { role: "user", content: "Hi" });
    session = ingestMessage(session, { role: "assistant", content: "Hello" });

    // No explicit history verification options passed
    session = completeCapture(session);

    assert.strictEqual(session.isComplete, false);

    const archive = await createArchiveFromCapturedConversation(session);
    assert.strictEqual(archive.completeness.status, "partial");
  });

  test("missing or malformed pagination metadata results in partial completeness", async () => {
    let session = createCaptureSession("chatgpt", "Malformed Meta Chat");
    session = ingestMessage(session, { role: "user", content: "Msg" });

    // Missing hasPreviousPage or hasNextPage
    session = completeCapture(session, {
      hasMoreHistory: false,
      // hasPreviousPage omitted / undefined
      hasNextPage: false,
    });

    assert.strictEqual(session.isComplete, false);

    const archive = await createArchiveFromCapturedConversation(session);
    assert.strictEqual(archive.completeness.status, "partial");
  });

  test("subset history response (hasPreviousPage === true) is strictly partial", async () => {
    let session = createCaptureSession("chatgpt", "Subset Chat");
    session = ingestMessage(session, { role: "user", content: "Msg 28" });
    session = ingestMessage(session, { role: "assistant", content: "Reply 28" });

    // More older messages exist on server
    session = completeCapture(session, {
      hasPreviousPage: true,
      hasNextPage: false,
    });

    assert.strictEqual(session.isComplete, false);
    assert.strictEqual(session.hasMoreHistory, true);

    const archive = await createArchiveFromCapturedConversation(session);
    assert.strictEqual(archive.completeness.status, "partial");
    assert.strictEqual(archive.completeness.sourceConfirmed, false);
    assert.ok(
      archive.completeness.reason.includes("Older conversation messages remain")
    );
    assert.ok(
      archive.voidzone.instructions.transferPrompt.includes(
        "COMPLETENESS WARNING: PARTIAL"
      )
    );
  });

  test("subset history response (hasNextPage === true) is strictly partial", async () => {
    let session = createCaptureSession("chatgpt", "Subset Chat Top Page");
    session = ingestMessage(session, { role: "user", content: "Msg 1" });

    // Beginning was reached, but newer messages exist that weren't captured
    session = completeCapture(session, {
      hasPreviousPage: false,
      hasNextPage: true,
    });

    assert.strictEqual(session.isComplete, false);
    assert.strictEqual(session.hasMoreHistory, true);

    const archive = await createArchiveFromCapturedConversation(session);
    assert.strictEqual(archive.completeness.status, "partial");
  });

  test("genuinely complete history response (both hasPreviousPage and hasNextPage false) is complete", async () => {
    let session = createCaptureSession("chatgpt", "Full Verified Chat");
    session = ingestMessage(session, { role: "user", content: "Turn 1" });
    session = ingestMessage(session, { role: "assistant", content: "Turn 2" });

    // Both boundaries verified by pagination contract
    session = completeCapture(session, {
      hasPreviousPage: false,
      hasNextPage: false,
      hasMoreHistory: false,
    });

    assert.strictEqual(session.isComplete, true);
    assert.strictEqual(session.hasMoreHistory, false);

    const archive = await createArchiveFromCapturedConversation(session);
    assert.strictEqual(archive.completeness.status, "complete");
    assert.strictEqual(archive.completeness.sourceConfirmed, true);
    assert.ok(
      !archive.voidzone.instructions.transferPrompt.includes(
        "COMPLETENESS WARNING"
      )
    );

    // Round-trip verification
    const json = serializeArchive(archive);
    const parsed = await parseAndValidateArchive(json);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.integrityVerified, true);
  });

  test("interrupted assistant response produces partial archive with warning", async () => {
    let session = createCaptureSession("chatgpt", "Interrupted Chat");
    session = ingestMessage(session, { role: "user", content: "Question" });
    session = startAssistantStream(session, "a1", "Half answer...");
    session = interruptStream(session, "Tab closed");

    const archive = await createArchiveFromCapturedConversation(session);
    assert.strictEqual(archive.completeness.status, "partial");
    assert.strictEqual(archive.completeness.sourceConfirmed, false);
    assert.ok(archive.completeness.reason.includes("interrupted"));
    assert.ok(
      archive.voidzone.instructions.transferPrompt.includes(
        "COMPLETENESS WARNING: PARTIAL"
      )
    );
  });
});
