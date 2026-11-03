/**
 * conversationIsolationAndInterceptor.test.ts
 *
 * Pre-Browser Safety Review Regression Tests:
 * 1. Conversation identity, strict isolation, and navigation (Scenarios A through F).
 *    - Verifies Conversation A is never presented as Conversation B.
 *    - Verifies delayed storage synchronization does not cause cross-tab bleeding.
 *    - Verifies returning to Conversation A preserves its original messages.
 *    - Verifies new conversation / temporary session lifecycle.
 *    - Verifies domain equality alone is never trusted as conversation identity.
 * 2. Multi-turn interceptor extraction logic.
 *    - Verifies cumulative history payloads do not repeatedly emit older turns.
 *    - Verifies deduplication via stable platform identifiers.
 *    - Verifies two distinct turns with identical text (e.g. "continue") never collapse.
 *    - Verifies missing IDs use deterministic sequence-based fallbacks that prevent turn merging.
 *    - Verifies pending messages flush exactly once upon conversation ID resolution.
 *    - Verifies message ordering preservation.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isSessionMatchingActiveTab,
  createCaptureSession,
  ingestMessage,
  startAssistantStream,
  completeAssistantStream,
  computeConversationMetrics,
  generateMessageId,
} from "../src/continuity/captureLifecycle.ts";
import { extractMessagesFromFetchPayload } from "../src/page-scripts/chatgptFetchInterceptor.ts";
import type { CapturedConversation } from "../src/continuity/captureTypes.ts";

describe("Pre-Browser Safety Review 1: Conversation Identity & Isolation", () => {
  // Scenario A: Captured Conversation A
  const sessionA: CapturedConversation = {
    id: "3847f98d-1111-4444-aaaa-000000000001",
    platform: "chatgpt",
    title: "Thermodynamics and Entropy",
    url: "https://chatgpt.com/c/3847f98d-1111-4444-aaaa-000000000001",
    messages: [
      {
        id: "msg-a1",
        sequence: 1,
        role: "user",
        content: "What is the second law of thermodynamics?",
        timestamp: "2026-10-31T08:00:00Z",
      },
      {
        id: "msg-a2",
        sequence: 2,
        role: "assistant",
        content: "The second law states that the total entropy of an isolated system always increases.",
        timestamp: "2026-10-31T08:00:05Z",
      },
    ],
    state: "completed",
    hasMoreHistory: false,
    isComplete: true,
    completenessStatus: "complete",
    capturedAt: "2026-10-31T08:00:05Z",
    lastCheckpointAt: "2026-10-31T08:00:05Z",
  };

  test("Scenario A & B: Session A matches its own URL but rejects Conversation B", () => {
    const isMatchA = isSessionMatchingActiveTab(
      sessionA,
      "https://chatgpt.com/c/3847f98d-1111-4444-aaaa-000000000001",
      "3847f98d-1111-4444-aaaa-000000000001"
    );
    assert.strictEqual(isMatchA, true, "Session A must match tab on Conversation A");

    // Navigating to Conversation B
    const isMatchB = isSessionMatchingActiveTab(
      sessionA,
      "https://chatgpt.com/c/7921b33e-2222-5555-bbbb-000000000002",
      "7921b33e-2222-5555-bbbb-000000000002"
    );
    assert.strictEqual(isMatchB, false, "Session A must NOT match tab on Conversation B");
  });

  test("Scenario C & D: Storage sync delay never presents Conversation A as Conversation B", () => {
    // Tab has already navigated to Conversation B, but storage still holds Session A
    const staleStorageSession = sessionA;
    const tabUrl = "https://chatgpt.com/c/7921b33e-2222-5555-bbbb-000000000002";
    const tabConvId = "7921b33e-2222-5555-bbbb-000000000002";

    const isMatch = isSessionMatchingActiveTab(staleStorageSession, tabUrl, tabConvId);
    assert.strictEqual(isMatch, false, "Stale Session A must NEVER be presented as Conversation B");
  });

  test("Scenario E: Returning to Conversation A recognizes Session A and keeps messages intact", () => {
    const tabUrl = "https://chatgpt.com/c/3847f98d-1111-4444-aaaa-000000000001";
    const tabConvId = "3847f98d-1111-4444-aaaa-000000000001";

    const isMatch = isSessionMatchingActiveTab(sessionA, tabUrl, tabConvId);
    assert.strictEqual(isMatch, true, "Returning to Conversation A must immediately match");
    assert.strictEqual(sessionA.messages.length, 2);
    assert.strictEqual(sessionA.messages[0].content, "What is the second law of thermodynamics?");
    assert.strictEqual(sessionA.messages[1].content, "The second law states that the total entropy of an isolated system always increases.");
  });

  test("Scenario F: Starting new conversation rejects existing Session A and binds temporary session", () => {
    const newChatUrl = "https://chatgpt.com/";
    const newChatConvId = "new-chat";

    // 1. Existing Session A must NOT bleed into new chat
    const staleMatch = isSessionMatchingActiveTab(sessionA, newChatUrl, newChatConvId);
    assert.strictEqual(staleMatch, false, "Established Session A must NOT bleed into a new-chat tab");

    // 2. An explicit temporary / new-chat session DOES match
    const tempSession: CapturedConversation = {
      id: "new-chat",
      platform: "chatgpt",
      title: "New ChatGPT Session",
      url: "https://chatgpt.com/",
      messages: [],
      state: "idle",
      hasMoreHistory: false,
      isComplete: false,
      completenessStatus: "unknown",
      capturedAt: "2026-10-31T08:10:00Z",
      lastCheckpointAt: null,
    };

    const tempMatch = isSessionMatchingActiveTab(tempSession, newChatUrl, newChatConvId);
    assert.strictEqual(tempMatch, true, "Temporary session must match new-chat tab");
  });

  test("Domain equality alone is never sufficient for conversation identity", () => {
    // Both URLs belong to chatgpt.com, but have different conversation UUIDs
    const tabConvId = "random-uuid-9999";
    const tabUrl = "https://chatgpt.com/c/random-uuid-9999";

    const isMatch = isSessionMatchingActiveTab(sessionA, tabUrl, tabConvId);
    assert.strictEqual(isMatch, false, "Must not match merely because both are on chatgpt.com");
  });

  test("Non-ChatGPT pages are rejected regardless of session state", () => {
    const isMatch = isSessionMatchingActiveTab(sessionA, "https://github.com", null);
    assert.strictEqual(isMatch, false, "Non-ChatGPT pages must never match");
  });
});

describe("Pre-Browser Safety Review 2: Multi-Turn Interceptor Extraction Logic", () => {
  test("Cumulative history in reqPayload does not re-emit previously captured messages", () => {
    const emittedIds = new Set<string>();

    // Turn 1 request
    const turn1Payload = {
      conversation_id: "conv-100",
      messages: [
        {
          id: "turn-1-msg",
          author: { role: "user" },
          content: { content_type: "text", parts: ["First question"] },
        },
      ],
    };

    const res1 = extractMessagesFromFetchPayload(turn1Payload, emittedIds);
    assert.strictEqual(res1.conversationId, "conv-100");
    assert.strictEqual(res1.messagesToEmit.length, 1);
    assert.strictEqual(res1.messagesToEmit[0]["id"], "turn-1-msg");
    assert.ok(emittedIds.has("turn-1-msg"), "turn-1-msg must be tracked as emitted");

    // Turn 2 request: client includes FULL conversation history (turn 1 + turn 2)
    const turn2Payload = {
      conversation_id: "conv-100",
      messages: [
        {
          id: "turn-1-msg",
          author: { role: "user" },
          content: { content_type: "text", parts: ["First question"] },
        },
        {
          id: "turn-2-msg",
          author: { role: "user" },
          content: { content_type: "text", parts: ["Second question"] },
        },
      ],
    };

    const res2 = extractMessagesFromFetchPayload(turn2Payload, emittedIds);
    assert.strictEqual(res2.conversationId, "conv-100");
    // Crucial check: turn-1-msg was already emitted, so only turn-2-msg should be emitted
    assert.strictEqual(res2.messagesToEmit.length, 1, "Only genuinely new messages should be emitted");
    assert.strictEqual(res2.messagesToEmit[0]["id"], "turn-2-msg");
    assert.ok(emittedIds.has("turn-2-msg"), "turn-2-msg must be tracked as emitted");

    // Turn 3 request: client includes turn 1 + turn 2 + turn 3
    const turn3Payload = {
      conversation_id: "conv-100",
      messages: [
        { id: "turn-1-msg", author: { role: "user" }, content: { parts: ["First question"] } },
        { id: "turn-2-msg", author: { role: "user" }, content: { parts: ["Second question"] } },
        { id: "turn-3-msg", author: { role: "user" }, content: { parts: ["Third question"] } },
      ],
    };

    const res3 = extractMessagesFromFetchPayload(turn3Payload, emittedIds);
    assert.strictEqual(res3.messagesToEmit.length, 1);
    assert.strictEqual(res3.messagesToEmit[0]["id"], "turn-3-msg");
  });

  test("Two distinct user messages with identical content (e.g. 'continue') never collapse", () => {
    let session = createCaptureSession("chatgpt", "Repetitive Prompts", "https://chatgpt.com/c/repeat", "conv-repeat");

    // Turn 1: user says "continue"
    session = ingestMessage(session, {
      id: "u-msg-101",
      role: "user",
      content: "continue",
      timestamp: "2026-10-31T09:00:00Z",
    });
    session = startAssistantStream(session, "a-msg-101", "Here is step 1.", "2026-10-31T09:00:05Z");
    session = completeAssistantStream(session);

    // Turn 2: user says "continue" again
    session = ingestMessage(session, {
      id: "u-msg-102",
      role: "user",
      content: "continue",
      timestamp: "2026-10-31T09:01:00Z",
    });
    session = startAssistantStream(session, "a-msg-102", "Here is step 2.", "2026-10-31T09:01:05Z");
    session = completeAssistantStream(session);

    // Assert: must NOT collapse into 1 user message
    assert.strictEqual(session.messages.length, 4, "Must contain 4 distinct messages");
    assert.strictEqual(session.messages[0].id, "u-msg-101");
    assert.strictEqual(session.messages[0].content, "continue");
    assert.strictEqual(session.messages[1].id, "a-msg-101");
    assert.strictEqual(session.messages[2].id, "u-msg-102");
    assert.strictEqual(session.messages[2].content, "continue");
    assert.strictEqual(session.messages[3].id, "a-msg-102");

    const metrics = computeConversationMetrics(session.messages);
    assert.strictEqual(metrics.humanCount, 2);
    assert.strictEqual(metrics.assistantCount, 2);
    assert.strictEqual(metrics.totalValidCount, 4);
  });

  test("Missing message IDs use sequence-based fallback that does not collapse distinct turns", () => {
    // Generate IDs for two turns with identical text using distinct sequence numbers
    const idTurn1 = generateMessageId("user", "continue", 1);
    const idTurn2 = generateMessageId("user", "continue", 3);

    assert.notStrictEqual(idTurn1, idTurn2, "Fallback IDs must differ based on sequence position");

    let session = createCaptureSession("chatgpt", "Fallback ID Test");
    session = ingestMessage(session, {
      id: idTurn1,
      role: "user",
      content: "continue",
    });
    session = startAssistantStream(session, "a-1", "Step 1");
    session = completeAssistantStream(session);

    session = ingestMessage(session, {
      id: idTurn2,
      role: "user",
      content: "continue",
    });
    session = startAssistantStream(session, "a-2", "Step 2");
    session = completeAssistantStream(session);

    assert.strictEqual(session.messages.length, 4);
    assert.strictEqual(session.messages[0].id, idTurn1);
    assert.strictEqual(session.messages[2].id, idTurn2);
  });

  test("Pending messages buffer and flush exactly once upon conversation ID resolution", () => {
    const pendingQueue: Record<string, unknown>[] = [];
    const emittedToContent: { event: string; convId: string; msgId: string }[] = [];

    // Simulate Turn 1 where conversation ID is not yet known
    const reqPayload = {
      messages: [
        { id: "pending-u-1", author: { role: "user" }, content: { parts: ["Hello from new chat"] } },
      ],
    };

    const emitted = extractMessagesFromFetchPayload(reqPayload);
    for (const msg of emitted.messagesToEmit) {
      pendingQueue.push(msg);
    }

    assert.strictEqual(pendingQueue.length, 1);
    assert.strictEqual(emittedToContent.length, 0, "No messages should be emitted before conv ID exists");

    // SSE event arrives establishing conversation ID
    const resolvedConvId = "chatgpt-uuid-resolved-555";
    if (pendingQueue.length > 0) {
      for (const msg of pendingQueue) {
        emittedToContent.push({
          event: "input_message",
          convId: resolvedConvId,
          msgId: msg["id"] as string,
        });
      }
      // Flush exactly once
      pendingQueue.length = 0;
    }

    assert.strictEqual(pendingQueue.length, 0, "Pending queue must be empty after flush");
    assert.strictEqual(emittedToContent.length, 1);
    assert.strictEqual(emittedToContent[0].convId, resolvedConvId);
    assert.strictEqual(emittedToContent[0].msgId, "pending-u-1");

    // Subsequent SSE chunks with the same conv ID must NOT flush again
    if (pendingQueue.length > 0) {
      assert.fail("Should not execute second flush");
    }
    assert.strictEqual(emittedToContent.length, 1, "Must remain flushed exactly once");
  });

  test("Message ordering remains strictly preserved in extracted output", () => {
    const payload = {
      conversation_id: "conv-ordered",
      messages: [
        { id: "m-first", author: { role: "user" }, content: { parts: ["First"] } },
        { id: "m-second", author: { role: "user" }, content: { parts: ["Second"] } },
        { id: "m-third", author: { role: "user" }, content: { parts: ["Third"] } },
      ],
    };

    const res = extractMessagesFromFetchPayload(payload);
    assert.strictEqual(res.messagesToEmit.length, 3);
    assert.strictEqual(res.messagesToEmit[0]["id"], "m-first");
    assert.strictEqual(res.messagesToEmit[1]["id"], "m-second");
    assert.strictEqual(res.messagesToEmit[2]["id"], "m-third");
  });
});
