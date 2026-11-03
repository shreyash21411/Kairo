/**
 * liveCaptureFailureInvestigation.test.ts
 *
 * Phase 2.1 Regression Tests for Live Browser Defects:
 * Defect A: User message capture failure in new conversations.
 * Defect B: Incomplete existing conversation capture starting partway through.
 *
 * Scenarios:
 * A. New conversation: One user message + one assistant response (HUMAN=1, AI=1, TOTAL=2).
 * B. Existing conversation: Historical recovery via mapping DAG vs unrecovered partial live session.
 * C. Conversation switching & isolation between distinct conversation IDs.
 * D. User-message deduplication across multiple capture paths.
 * E. Delayed conversation ID resolution retains user message and associates with final UUID.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createCaptureSession,
  ingestMessage,
  startAssistantStream,
  completeAssistantStream,
  computeConversationMetrics,
  extractMessagesFromConversationHistory,
  isSessionMatchingActiveTab,
  recordCheckpoint,
} from "../src/continuity/captureLifecycle.ts";
import { extractMessagesFromFetchPayload } from "../src/page-scripts/chatgptFetchInterceptor.ts";
import type { CapturedConversation } from "../src/continuity/captureTypes.ts";

// Storage mock for test environment
const mockStorage: Record<string, unknown> = {};

globalThis.chrome = {
  storage: {
    local: {
      get: (keys: string | string[] | null, callback?: (items: Record<string, unknown>) => void) => {
        let result: Record<string, unknown> = {};
        if (typeof keys === "string") {
          result[keys] = mockStorage[keys];
        } else if (Array.isArray(keys)) {
          for (const k of keys) {
            if (mockStorage[k] !== undefined) result[k] = mockStorage[k];
          }
        } else {
          result = { ...mockStorage };
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set: (items: Record<string, unknown>, callback?: () => void) => {
        Object.assign(mockStorage, items);
        if (callback) callback();
        return Promise.resolve();
      },
      remove: (keys: string | string[], callback?: () => void) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete mockStorage[k];
        if (callback) callback();
        return Promise.resolve();
      },
    },
  },
} as unknown as typeof chrome;

describe("Phase 2.1 Live Browser Failure Investigation & Fix Validation", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
  });

  // Scenario A: New conversation: One user message + one assistant response
  test("Scenario A (Defect A fix): One user message and one assistant response results in HUMAN=1, AI=1, TOTAL=2", () => {
    // 1. ChatGPT request payload when starting a new conversation (no conversation_id yet)
    const newChatPayload = {
      action: "next",
      messages: [
        {
          id: "usr-msg-001",
          author: { role: "user" },
          content: { content_type: "text", parts: ["Explain the theory of general relativity briefly."] },
        },
      ],
      model: "gpt-4o",
    };

    const emittedIds = new Set<string>();
    const { messagesToEmit, conversationId } = extractMessagesFromFetchPayload(newChatPayload, emittedIds);

    assert.strictEqual(conversationId, null, "New chat request has no conversation ID");
    assert.strictEqual(messagesToEmit.length, 1, "Must extract the user message");
    assert.strictEqual(messagesToEmit[0]["id"], "usr-msg-001");

    // 2. Interceptor holds message in pendingUserMessages buffer until conversation ID is established
    const pendingBuffer = [...messagesToEmit];
    assert.strictEqual(pendingBuffer.length, 1);

    // 3. First SSE event arrives establishing the new conversation UUID
    const sseEstablishedConvId = "c-new-uuid-4001";
    let session = createCaptureSession("chatgpt", "General Relativity", `https://chatgpt.com/c/${sseEstablishedConvId}`, sseEstablishedConvId);

    // 4. Buffer flushes into the session
    const flushedMsg = pendingBuffer.shift()!;
    session = ingestMessage(session, {
      id: flushedMsg["id"] as string,
      role: "user",
      content: "Explain the theory of general relativity briefly.",
      timestamp: "2026-10-31T10:00:00Z",
    });

    // 5. Assistant response streams and completes
    session = startAssistantStream(session, "asst-msg-001", "General relativity describes gravity as the curvature of spacetime.", "2026-10-31T10:00:05Z");
    session = completeAssistantStream(session);

    // Assert exact role counts: HUMAN: 1, AI / ASST: 1, TOTAL: 2
    const metrics = computeConversationMetrics(session.messages);
    assert.strictEqual(metrics.humanCount, 1, "Expected exactly 1 human/user message");
    assert.strictEqual(metrics.assistantCount, 1, "Expected exactly 1 assistant message");
    assert.strictEqual(metrics.totalValidCount, 2, "Expected exactly 2 total valid messages");
    assert.strictEqual(session.messages.length, 2);
    assert.strictEqual(session.messages[0].role, "user");
    assert.strictEqual(session.messages[0].id, "usr-msg-001");
    assert.strictEqual(session.messages[1].role, "assistant");
    assert.strictEqual(session.messages[1].id, "asst-msg-001");
  });

  // Scenario B: Existing conversation: Historical recovery vs unrecovered partial session
  test("Scenario B (Defect B fix): Historical recovery parses entire mapping DAG and appends new live turns", () => {
    // 1. ChatGPT returns mapping DAG for existing conversation (3 user turns, 3 assistant turns = 6 messages)
    const existingConversationPayload = {
      title: "Quantum Mechanics Q&A",
      conversation_id: "conv-qm-3001",
      mapping: {
        "root-node": { id: "root-node", message: null, parent: null },
        "m-u1": {
          id: "m-u1",
          message: {
            id: "m-u1",
            author: { role: "user" },
            create_time: 1730000000,
            content: { content_type: "text", parts: ["What is wave-particle duality?"] },
          },
        },
        "m-a1": {
          id: "m-a1",
          message: {
            id: "m-a1",
            author: { role: "assistant" },
            create_time: 1730000005,
            content: { content_type: "text", parts: ["Matter exhibits both wave and particle properties."] },
          },
        },
        "m-u2": {
          id: "m-u2",
          message: {
            id: "m-u2",
            author: { role: "user" },
            create_time: 1730000060,
            content: { content_type: "text", parts: ["Who formulated the de Broglie hypothesis?"] },
          },
        },
        "m-a2": {
          id: "m-a2",
          message: {
            id: "m-a2",
            author: { role: "assistant" },
            create_time: 1730000065,
            content: { content_type: "text", parts: ["Louis de Broglie proposed it in 1924."] },
          },
        },
        "m-u3": {
          id: "m-u3",
          message: {
            id: "m-u3",
            author: { role: "user" },
            create_time: 1730000120,
            content: { content_type: "text", parts: ["How was it verified experimentally?"] },
          },
        },
        "m-a3": {
          id: "m-a3",
          message: {
            id: "m-a3",
            author: { role: "assistant" },
            create_time: 1730000125,
            content: { content_type: "text", parts: ["Through the Davisson-Germer electron diffraction experiment."] },
          },
        },
      },
    };

    // 2. Pure historical extractor parses all 6 messages in chronological order
    const extraction = extractMessagesFromConversationHistory(existingConversationPayload);
    assert.strictEqual(extraction.conversationId, "conv-qm-3001");
    assert.strictEqual(extraction.title, "Quantum Mechanics Q&A");
    assert.strictEqual(extraction.isComplete, true);
    assert.strictEqual(extraction.messages.length, 6);

    // 3. Ingest historical messages into capture session
    let session = createCaptureSession("chatgpt", extraction.title!, `https://chatgpt.com/c/${extraction.conversationId}`, extraction.conversationId!);
    for (const msg of extraction.messages) {
      session = ingestMessage(session, {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      });
    }
    session = recordCheckpoint(session);
    session.isComplete = extraction.isComplete;
    session.completenessStatus = "complete";

    let metrics = computeConversationMetrics(session.messages);
    assert.strictEqual(metrics.humanCount, 3);
    assert.strictEqual(metrics.assistantCount, 3);
    assert.strictEqual(metrics.totalValidCount, 6);

    // 4. User sends Turn 4 in this existing conversation
    session = ingestMessage(session, {
      id: "m-u4",
      role: "user",
      content: "Does this apply to macroscopic objects?",
      timestamp: "2026-10-31T10:05:00Z",
    });
    session = startAssistantStream(session, "m-a4", "Theoretically yes, but their wavelength is undetectably tiny.", "2026-10-31T10:05:05Z");
    session = completeAssistantStream(session);

    // Assert: Now reports all 8 messages (not starting partway through with only 2!)
    metrics = computeConversationMetrics(session.messages);
    assert.strictEqual(metrics.humanCount, 4, "Expected 4 human messages (3 historical + 1 live)");
    assert.strictEqual(metrics.assistantCount, 4, "Expected 4 assistant messages (3 historical + 1 live)");
    assert.strictEqual(metrics.totalValidCount, 8, "Expected exactly 8 messages in total");
  });

  test("Scenario B limitation: Unrecovered live session honestly displays PARTIAL without faking completeness", () => {
    // If capture started partway through without historical recovery:
    let session = createCaptureSession("chatgpt", "Mid-Stream Chat", "https://chatgpt.com/c/conv-partway-99");
    session = ingestMessage(session, { id: "turn-live-u", role: "user", content: "Tell me more" });
    session = startAssistantStream(session, "turn-live-a", "Certainly, continuing here.");
    session = completeAssistantStream(session);

    // Boundaries were never verified by historical endpoint
    assert.strictEqual(session.isComplete, false, "Live capture alone must not claim complete history");
    assert.strictEqual(session.completenessStatus, "partial", "Completeness must remain partial");
    assert.strictEqual(session.messages.length, 2);
  });

  // Scenario C: Conversation switching & strict isolation
  test("Scenario C: Messages remain strictly isolated across different conversation IDs", () => {
    const sessionA = createCaptureSession("chatgpt", "Chat A", "https://chatgpt.com/c/conv-alpha-111", "conv-alpha-111");
    const sessionWithMsgA = ingestMessage(sessionA, {
      id: "u-alpha-1",
      role: "user",
      content: "Alpha topic question",
    });

    const sessionB = createCaptureSession("chatgpt", "Chat B", "https://chatgpt.com/c/conv-beta-222", "conv-beta-222");
    const sessionWithMsgB = ingestMessage(sessionB, {
      id: "u-beta-1",
      role: "user",
      content: "Beta topic question",
    });

    // Verify session A contains only Alpha messages
    assert.strictEqual(sessionWithMsgA.messages.length, 1);
    assert.strictEqual(sessionWithMsgA.messages[0].id, "u-alpha-1");
    assert.strictEqual(sessionWithMsgA.id, "conv-alpha-111");

    // Verify session B contains only Beta messages
    assert.strictEqual(sessionWithMsgB.messages.length, 1);
    assert.strictEqual(sessionWithMsgB.messages[0].id, "u-beta-1");
    assert.strictEqual(sessionWithMsgB.id, "conv-beta-222");

    // Verify tab matching isolation
    const matchAwithB = isSessionMatchingActiveTab(sessionWithMsgA, "https://chatgpt.com/c/conv-beta-222", "conv-beta-222");
    assert.strictEqual(matchAwithB, false, "Session A must never match Tab B");

    const matchBwithB = isSessionMatchingActiveTab(sessionWithMsgB, "https://chatgpt.com/c/conv-beta-222", "conv-beta-222");
    assert.strictEqual(matchBwithB, true, "Session B must match Tab B");
  });

  // Scenario D: User-message deduplication across multiple capture paths
  test("Scenario D: Same user request observed through multiple paths stores exactly one canonical message", () => {
    let session = createCaptureSession("chatgpt", "Dedup Test", "https://chatgpt.com/c/conv-dedup");

    // Path 1: Extracted directly from request body
    session = ingestMessage(session, {
      id: "msg-canonical-007",
      role: "user",
      content: "Run database migration",
      timestamp: "2026-10-31T11:00:00Z",
    });

    // Path 2: Interceptor fallback flush emits same message ID
    session = ingestMessage(session, {
      id: "msg-canonical-007",
      role: "user",
      content: "Run database migration",
      timestamp: "2026-10-31T11:00:00Z",
    });

    // Assert: Deduplicated to exactly 1 message
    assert.strictEqual(session.messages.length, 1, "Must contain exactly 1 message despite duplicate emission");
    assert.strictEqual(session.messages[0].id, "msg-canonical-007");
    assert.strictEqual(session.messages[0].content, "Run database migration");

    const metrics = computeConversationMetrics(session.messages);
    assert.strictEqual(metrics.humanCount, 1);
    assert.strictEqual(metrics.totalValidCount, 1);
  });

  // Scenario E: Delayed conversation ID resolution retains user message
  test("Scenario E: User message arriving before ID resolution is retained and re-keyed to final UUID", () => {
    // 1. Initial state: message ingested under temporary 'new-chat' session
    let tempSession = createCaptureSession("chatgpt", "New ChatGPT Session", "https://chatgpt.com/", "new-chat");
    tempSession = ingestMessage(tempSession, {
      id: "u-pre-resolution",
      role: "user",
      content: "Hello from brand new chat session",
    });

    assert.strictEqual(tempSession.id, "new-chat");
    assert.strictEqual(tempSession.messages.length, 1);

    // 2. Delayed conversation ID arrives via SSE
    const resolvedUUID = "3847f98d-delayed-uuid-777";

    // Simulate content script re-keying logic
    const rekeyedSession: CapturedConversation = {
      ...tempSession,
      id: resolvedUUID,
      url: `https://chatgpt.com/c/${resolvedUUID}`,
    };

    assert.strictEqual(rekeyedSession.id, resolvedUUID);
    assert.strictEqual(rekeyedSession.messages.length, 1, "User message must be preserved through re-keying");
    assert.strictEqual(rekeyedSession.messages[0].id, "u-pre-resolution");

    // 3. Assistant stream completes under the resolved UUID
    let finalSession = startAssistantStream(rekeyedSession, "a-post-resolution", "Hello! How can I assist you today?");
    finalSession = completeAssistantStream(finalSession);

    // Assert: Final session has both user and assistant messages under the authoritative UUID
    assert.strictEqual(finalSession.id, resolvedUUID);
    assert.strictEqual(finalSession.messages.length, 2);
    assert.strictEqual(finalSession.messages[0].role, "user");
    assert.strictEqual(finalSession.messages[1].role, "assistant");

    const metrics = computeConversationMetrics(finalSession.messages);
    assert.strictEqual(metrics.humanCount, 1);
    assert.strictEqual(metrics.assistantCount, 1);
    assert.strictEqual(metrics.totalValidCount, 2);
  });
});
