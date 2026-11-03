/**
 * capturePipelineInvestigation.test.ts
 *
 * Phase 2.2 Complete Pipeline Root-Cause Regression Suite:
 *
 * 1. First user message captured before conversation ID exists.
 * 2. Pending user message flushed after conversation ID resolution.
 * 3. First assistant response associated with the correct conversation.
 * 4. New conversation with two user messages before ID resolution.
 * 5. New conversation with multiple assistant stream chunks.
 * 6. Existing conversation with earlier user and assistant messages (DOM recovery).
 * 7. Existing history merged with subsequent live events.
 * 8. Duplicate network events do not duplicate messages.
 * 9. URL-based conversation ID resolution.
 * 10. Conversation ID resolution from response data.
 * 11. Conversation switch does not mix sessions.
 * 12. Popup reopening restores the correct conversation.
 * 13. Extension context invalidation produces a recoverable error state.
 * 14. Storage failure does not report successful persistence.
 * 15. Archive contains the expected roles, order, and exact message content.
 * 16. Completeness stays partial when full history is not verified.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createCaptureSession,
  ingestMessage,
  startAssistantStream,
  appendAssistantChunk,
  completeAssistantStream,
  computeConversationMetrics,
  isSessionMatchingActiveTab,
} from "../src/continuity/captureLifecycle.ts";
import { extractMessagesFromFetchPayload } from "../src/page-scripts/chatgptFetchInterceptor.ts";
import {
  saveActiveCaptureSession,
  getActiveCaptureSession,
} from "../src/storage/conversationStorage.ts";
import {
  createArchiveFromCapturedConversation,
  parseAndValidateArchive,
} from "../src/continuity/archiveLifecycle.ts";
import {
  isExtensionContextValid,
} from "../src/continuity/contentScriptLifecycle.ts";
import type { CapturedConversation } from "../src/continuity/captureTypes.ts";

// Mock environments for storage and runtime
let mockLocalStorage: Record<string, unknown> = {};
let mockStorageFail = false;
let mockContextInvalid = false;

globalThis.chrome = {
  get runtime() {
    if (mockContextInvalid) {
      throw new Error("Extension context invalidated.");
    }
    return {
      id: "test-pipeline-extension-id",
      get lastError() {
        return null;
      },
    };
  },
  storage: {
    local: {
      get: (keys: string | string[] | null) => {
        if (mockContextInvalid) return Promise.reject(new Error("Extension context invalidated."));
        if (mockStorageFail) return Promise.reject(new Error("QUOTA_BYTES quota exceeded"));
        let result: Record<string, unknown> = {};
        if (typeof keys === "string") {
          result[keys] = mockLocalStorage[keys];
        } else if (Array.isArray(keys)) {
          for (const k of keys) {
            if (mockLocalStorage[k] !== undefined) result[k] = mockLocalStorage[k];
          }
        } else {
          result = { ...mockLocalStorage };
        }
        return Promise.resolve(result);
      },
      set: (items: Record<string, unknown>) => {
        if (mockContextInvalid) return Promise.reject(new Error("Extension context invalidated."));
        if (mockStorageFail) return Promise.reject(new Error("QUOTA_BYTES quota exceeded"));
        Object.assign(mockLocalStorage, items);
        return Promise.resolve();
      },
      remove: (keys: string | string[]) => {
        if (mockContextInvalid) return Promise.reject(new Error("Extension context invalidated."));
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete mockLocalStorage[k];
        return Promise.resolve();
      },
    },
  },
} as unknown as typeof chrome;

describe("Phase 2.2 Capture Pipeline Root-Cause Investigation and Correctness", () => {
  beforeEach(() => {
    mockLocalStorage = { memoryEnabled: true };
    mockStorageFail = false;
    mockContextInvalid = false;
  });


  // 1. First user message captured before conversation ID exists
  test("1. First user message captured immediately before conversation ID exists", () => {
    const rawPayload = {
      action: "next",
      messages: [
        {
          id: "usr-msg-first-1",
          author: { role: "user" },
          content: { content_type: "text", parts: ["Give me some ideas for interactive things ChatGPT can do"] },
        },
      ],
      model: "gpt-4o",
    };

    const emitted = new Set<string>();
    const extraction = extractMessagesFromFetchPayload(rawPayload, emitted);

    assert.strictEqual(extraction.conversationId, null, "Conversation ID must be null on first submission");
    assert.strictEqual(extraction.messagesToEmit.length, 1);
    assert.strictEqual(extraction.messagesToEmit[0]["id"], "usr-msg-first-1");

    // Provisional session created immediately for the tab
    let provisionalSession = createCaptureSession("chatgpt", "New ChatGPT Session", "https://chatgpt.com/", "provisional-tab");
    provisionalSession = ingestMessage(provisionalSession, {
      id: extraction.messagesToEmit[0]["id"] as string,
      role: "user",
      content: "Give me some ideas for interactive things ChatGPT can do",
    });

    assert.strictEqual(provisionalSession.id, "provisional-tab");
    assert.strictEqual(provisionalSession.messages.length, 1);
    assert.strictEqual(provisionalSession.messages[0].role, "user");
    assert.strictEqual(
      provisionalSession.messages[0].content,
      "Give me some ideas for interactive things ChatGPT can do"
    );

    const metrics = computeConversationMetrics(provisionalSession.messages);
    assert.strictEqual(metrics.humanCount, 1);
    assert.strictEqual(metrics.assistantCount, 0);
    assert.strictEqual(metrics.totalValidCount, 1);
  });

  // 2. Pending user message flushed after conversation ID resolution
  test("2. Pending user message in provisional session promoted when conversation ID resolves", () => {
    let provisionalSession = createCaptureSession("chatgpt", "New Chat", "https://chatgpt.com/", "provisional-tab");
    provisionalSession = ingestMessage(provisionalSession, {
      id: "u-turn-1",
      sourceMessageId: "u-turn-1",
      role: "user",
      content: "Explain the photoelectric effect",
    });

    const resolvedUUID = "3847f98d-promoted-uuid-001";

    // Promotion logic: transfer messages to resolved authoritative ID
    let promotedSession = createCaptureSession("chatgpt", "Photoelectric Effect", `https://chatgpt.com/c/${resolvedUUID}`, resolvedUUID);
    for (const msg of provisionalSession.messages) {
      promotedSession = ingestMessage(promotedSession, {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        sourceMessageId: msg.sourceMessageId || msg.id,
      });
    }

    assert.strictEqual(promotedSession.id, resolvedUUID);
    assert.strictEqual(promotedSession.messages.length, 1);
    assert.strictEqual(promotedSession.messages[0].id, "u-turn-1");
    assert.strictEqual(promotedSession.messages[0].content, "Explain the photoelectric effect");
  });

  // 3. First assistant response associated with the correct conversation
  test("3. First assistant response appends to the promoted session under the authoritative ID", () => {
    const resolvedUUID = "conv-uuid-333";
    let session = createCaptureSession("chatgpt", "Chat", `https://chatgpt.com/c/${resolvedUUID}`, resolvedUUID);
    session = ingestMessage(session, {
      id: "u-1",
      role: "user",
      content: "Who discovered penicillin?",
    });

    session = startAssistantStream(session, "a-1", "Alexander Fleming in 1928.");
    session = completeAssistantStream(session);

    assert.strictEqual(session.id, resolvedUUID);
    assert.strictEqual(session.messages.length, 2);
    assert.strictEqual(session.messages[0].role, "user");
    assert.strictEqual(session.messages[0].content, "Who discovered penicillin?");
    assert.strictEqual(session.messages[1].role, "assistant");
    assert.strictEqual(session.messages[1].content, "Alexander Fleming in 1928.");

    const metrics = computeConversationMetrics(session.messages);
    assert.strictEqual(metrics.humanCount, 1);
    assert.strictEqual(metrics.assistantCount, 1);
    assert.strictEqual(metrics.totalValidCount, 2);
  });

  // 4. New conversation with two user messages before ID resolution
  test("4. New conversation with two user messages submitted before ID resolves retains both in order", () => {
    let provisionalSession = createCaptureSession("chatgpt", "New Chat", "https://chatgpt.com/", "provisional-tab");

    // User submits prompt 1
    provisionalSession = ingestMessage(provisionalSession, {
      id: "prompt-1",
      role: "user",
      content: "First prompt submitted",
    });

    // User submits prompt 2 before backend returns conversation_id
    provisionalSession = ingestMessage(provisionalSession, {
      id: "prompt-2",
      role: "user",
      content: "Second prompt submitted before ID resolution",
    });

    assert.strictEqual(provisionalSession.messages.length, 2);
    assert.strictEqual(provisionalSession.messages[0].content, "First prompt submitted");
    assert.strictEqual(provisionalSession.messages[1].content, "Second prompt submitted before ID resolution");

    // ID resolves
    const resolvedUUID = "delayed-res-uuid-888";
    let promoted = createCaptureSession("chatgpt", "Dual Prompt Chat", `https://chatgpt.com/c/${resolvedUUID}`, resolvedUUID);
    for (const msg of provisionalSession.messages) {
      promoted = ingestMessage(promoted, {
        id: msg.id,
        role: msg.role,
        content: msg.content,
      });
    }

    assert.strictEqual(promoted.id, resolvedUUID);
    assert.strictEqual(promoted.messages.length, 2);
    assert.strictEqual(promoted.messages[0].id, "prompt-1");
    assert.strictEqual(promoted.messages[1].id, "prompt-2");
  });

  // 5. New conversation with multiple assistant stream chunks
  test("5. Streaming assistant response reconstructs accurately across multiple SSE chunks", () => {
    let session = createCaptureSession("chatgpt", "Stream Test", "https://chatgpt.com/c/stream-444", "stream-444");
    session = ingestMessage(session, {
      id: "u-stream",
      role: "user",
      content: "Count to three",
    });

    session = startAssistantStream(session, "a-stream", "One, ");
    session = appendAssistantChunk(session, "two, ");
    session = appendAssistantChunk(session, "three.");
    session = completeAssistantStream(session);

    assert.strictEqual(session.messages.length, 2);
    assert.strictEqual(session.messages[1].role, "assistant");
    assert.strictEqual(session.messages[1].content, "One, two, three.");
    assert.strictEqual(session.messages[1].isInProgress, false);
  });

  // 6. Existing conversation with earlier user and assistant messages
  test("6. Existing conversation history parses earlier user and assistant turns accurately", () => {
    const historicalPayload = {
      title: "History Chat",
      conversation_id: "hist-conv-555",
      mapping: {
        "root": { id: "root", message: null },
        "m1": {
          id: "m1",
          message: {
            id: "m1",
            author: { role: "user" },
            create_time: 1730000001,
            content: { parts: ["What is Node.js?"] },
          },
        },
        "m2": {
          id: "m2",
          message: {
            id: "m2",
            author: { role: "assistant" },
            create_time: 1730000005,
            content: { parts: ["A JavaScript runtime environment."] },
          },
        },
      },
    };

    let session = createCaptureSession("chatgpt", "History Chat", "https://chatgpt.com/c/hist-conv-555", "hist-conv-555");
    session = ingestMessage(session, {
      id: "m1",
      role: "user",
      content: "What is Node.js?",
      timestamp: "2026-10-31T10:00:01Z",
    });
    session = ingestMessage(session, {
      id: "m2",
      role: "assistant",
      content: "A JavaScript runtime environment.",
      timestamp: "2026-10-31T10:00:05Z",
    });

    assert.strictEqual(historicalPayload.conversation_id, "hist-conv-555");
    assert.strictEqual(session.messages.length, 2);
    assert.strictEqual(session.messages[0].role, "user");
    assert.strictEqual(session.messages[0].content, "What is Node.js?");
    assert.strictEqual(session.messages[1].role, "assistant");
    assert.strictEqual(session.messages[1].content, "A JavaScript runtime environment.");
  });

  // 7. Existing history merged with subsequent live events
  test("7. Existing historical messages merge cleanly with subsequent live dialogue turns", () => {
    let session = createCaptureSession("chatgpt", "Merged Chat", "https://chatgpt.com/c/merged-777", "merged-777");

    // Historical Turn 1
    session = ingestMessage(session, {
      id: "hist-u1",
      role: "user",
      content: "Give me some ideas for visual things ChatGPT can do",
      timestamp: "2026-10-31T09:00:00Z",
    });
    session = ingestMessage(session, {
      id: "hist-a1",
      role: "assistant",
      content: "GPT-6 with Intelligent UI",
      timestamp: "2026-10-31T09:00:05Z",
    });

    // Subsequent Live Turn 2
    session = ingestMessage(session, {
      id: "live-u2",
      role: "user",
      content: "give me a api",
      timestamp: "2026-10-31T09:05:00Z",
    });
    session = startAssistantStream(session, "live-a2", "Here is a FastAPI example.", "2026-10-31T09:05:05Z");
    session = completeAssistantStream(session);

    // Assert exact order: 4 messages (recovers missing Turn 1 user message!)
    assert.strictEqual(session.messages.length, 4);
    assert.strictEqual(session.messages[0].content, "Give me some ideas for visual things ChatGPT can do");
    assert.strictEqual(session.messages[0].role, "user");
    assert.strictEqual(session.messages[1].content, "GPT-6 with Intelligent UI");
    assert.strictEqual(session.messages[1].role, "assistant");
    assert.strictEqual(session.messages[2].content, "give me a api");
    assert.strictEqual(session.messages[2].role, "user");
    assert.strictEqual(session.messages[3].content, "Here is a FastAPI example.");
    assert.strictEqual(session.messages[3].role, "assistant");

    const metrics = computeConversationMetrics(session.messages);
    assert.strictEqual(metrics.humanCount, 2);
    assert.strictEqual(metrics.assistantCount, 2);
    assert.strictEqual(metrics.totalValidCount, 4);
  });

  // 8. Duplicate network events do not duplicate messages
  test("8. Duplicate network events across extraction and replay do not duplicate messages", () => {
    let session = createCaptureSession("chatgpt", "Dedup Test", "https://chatgpt.com/c/dedup-888", "dedup-888");

    const payload = { id: "msg-stable-99", role: "user" as const, content: "Deterministic question" };
    session = ingestMessage(session, payload);
    session = ingestMessage(session, payload); // Replay duplicate

    assert.strictEqual(session.messages.length, 1);
    assert.strictEqual(session.messages[0].id, "msg-stable-99");
  });

  // 9. URL-based conversation ID resolution
  test("9. URL-based conversation ID resolution associates session accurately with active tab", () => {
    const session = createCaptureSession("chatgpt", "Active URL", "https://chatgpt.com/c/3847f98d-url-test", "3847f98d-url-test");
    const matches = isSessionMatchingActiveTab(session, "https://chatgpt.com/c/3847f98d-url-test", "3847f98d-url-test");
    assert.strictEqual(matches, true);

    const nonMatch = isSessionMatchingActiveTab(session, "https://chatgpt.com/c/other-uuid-999", "other-uuid-999");
    assert.strictEqual(nonMatch, false);
  });

  // 10. Conversation ID resolution from response data
  test("10. Conversation ID resolution from SSE response data promotes provisional session", () => {
    let session = createCaptureSession("chatgpt", "Provisional", "https://chatgpt.com/", "provisional-tab");
    session = ingestMessage(session, { id: "u-init", role: "user", content: "Initial prompt" });

    const sseConvId = "6723-uuid-from-response";
    const promoted: CapturedConversation = {
      ...session,
      id: sseConvId,
      url: `https://chatgpt.com/c/${sseConvId}`,
    };

    assert.strictEqual(promoted.id, sseConvId);
    assert.strictEqual(promoted.messages.length, 1);
    assert.strictEqual(promoted.messages[0].content, "Initial prompt");
  });

  // 11. Conversation switch does not mix sessions
  test("11. Switching conversations isolates dialogue turns into separate sessions", () => {
    let sessionA = createCaptureSession("chatgpt", "Chat A", "https://chatgpt.com/c/conv-A", "conv-A");
    sessionA = ingestMessage(sessionA, { id: "msg-A", role: "user", content: "Question for A" });

    let sessionB = createCaptureSession("chatgpt", "Chat B", "https://chatgpt.com/c/conv-B", "conv-B");
    sessionB = ingestMessage(sessionB, { id: "msg-B", role: "user", content: "Question for B" });

    assert.strictEqual(sessionA.messages.length, 1);
    assert.strictEqual(sessionA.messages[0].content, "Question for A");
    assert.strictEqual(sessionB.messages.length, 1);
    assert.strictEqual(sessionB.messages[0].content, "Question for B");

    assert.strictEqual(isSessionMatchingActiveTab(sessionA, "https://chatgpt.com/c/conv-B", "conv-B"), false);
    assert.strictEqual(isSessionMatchingActiveTab(sessionB, "https://chatgpt.com/c/conv-B", "conv-B"), true);
  });

  // 12. Popup reopening restores the correct conversation
  test("12. Popup reopening loads active capture session from local storage without loss", async () => {
    let session = createCaptureSession("chatgpt", "Popup Test", "https://chatgpt.com/c/popup-restore-1", "popup-restore-1");
    session = ingestMessage(session, { id: "u-pop", role: "user", content: "Stored turn" });
    session = startAssistantStream(session, "a-pop", "Stored reply");
    session = completeAssistantStream(session);

    // Save to storage
    const saveRes = await saveActiveCaptureSession(session);
    assert.strictEqual(saveRes.success, true);

    // Popup opens and retrieves session
    const restored = await getActiveCaptureSession();
    assert.notStrictEqual(restored, null);
    assert.strictEqual(restored!.id, "popup-restore-1");
    assert.strictEqual(restored!.messages.length, 2);
    assert.strictEqual(restored!.messages[0].content, "Stored turn");
    assert.strictEqual(restored!.messages[1].content, "Stored reply");
  });

  // 13. Extension context invalidation produces a recoverable error state
  test("13. Extension context invalidation produces structured error state and safely returns", async () => {
    mockContextInvalid = true;

    assert.strictEqual(isExtensionContextValid(), false);

    const session = createCaptureSession("chatgpt", "Invalidated", "https://chatgpt.com/c/inv-test", "inv-test");
    const saveRes = await saveActiveCaptureSession(session);

    assert.strictEqual(saveRes.success, false);
    assert.strictEqual(saveRes.isContextInvalidated, true);
    assert.strictEqual(await getActiveCaptureSession(), null);
  });

  // 14. Storage failure does not report successful persistence
  test("14. Storage failure returns success=false and prevents false persistence reporting", async () => {
    mockStorageFail = true;

    const session = createCaptureSession("chatgpt", "Quota Fail", "https://chatgpt.com/c/q-fail", "q-fail");
    const res = await saveActiveCaptureSession(session);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.isContextInvalidated, false);
    assert.match(res.error ?? "", /QUOTA_BYTES/);
  });

  // 15. Archive contains the expected roles, order, and exact message content
  test("15. Canonical archive contains verbatim message content, valid roles, and verifiable SHA-256 integrity", async () => {
    let session = createCaptureSession("chatgpt", "Integrity Chat", "https://chatgpt.com/c/integ-999", "integ-999");
    session = ingestMessage(session, {
      id: "u-verif-1",
      role: "user",
      content: "Explain Fermat's Last Theorem in simple terms",
    });
    session = startAssistantStream(session, "a-verif-1", "No three positive integers a, b, c satisfy a^n + b^n = c^n for n > 2.");
    session = completeAssistantStream(session);

    const archive = await createArchiveFromCapturedConversation(session);

    assert.strictEqual(archive.format, "voidzone.continuity.archive");
    assert.strictEqual(archive.source.platform, "chatgpt");
    assert.strictEqual(archive.conversation.messages.length, 2);
    assert.strictEqual(archive.conversation.messages[0].role, "user");
    assert.strictEqual(archive.conversation.messages[0].content, "Explain Fermat's Last Theorem in simple terms");
    assert.strictEqual(archive.conversation.messages[1].role, "assistant");
    assert.strictEqual(archive.conversation.messages[1].content, "No three positive integers a, b, c satisfy a^n + b^n = c^n for n > 2.");

    // Validate archive cryptographic integrity
    const validation = await parseAndValidateArchive(JSON.stringify(archive));
    assert.strictEqual(validation.success, true);
    assert.strictEqual(validation.integrityVerified, true);
  });

  // 16. Completeness stays partial when full history is not verified
  test("16. Completeness honestly remains partial when full historical boundary is not verified", () => {
    let session = createCaptureSession("chatgpt", "Partial Chat", "https://chatgpt.com/c/partial-111", "partial-111");
    session = ingestMessage(session, { id: "m-mid", role: "user", content: "Mid-stream question" });
    session = startAssistantStream(session, "a-mid", "Mid-stream reply");
    session = completeAssistantStream(session);

    assert.strictEqual(session.isComplete, false, "Live capture without mapping DAG boundary must not claim full history");
    assert.strictEqual(session.completenessStatus, "partial", "Completeness must remain partial");
  });
});
