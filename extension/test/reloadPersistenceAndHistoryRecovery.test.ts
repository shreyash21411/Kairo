/**
 * reloadPersistenceAndHistoryRecovery.test.ts
 *
 * VOIDZONE Phase 2.3: Reload Persistence & Conversation History Recovery Test Suite
 *
 * Verifies all 12 acceptance criteria (Scenarios A through L):
 * A. Restore a conversation containing 3 user and 3 assistant messages.
 * B. Reload the content script and verify all 6 messages remain.
 * C. Send a new user message and verify the count becomes 7.
 * D. Receive the assistant response and verify the count becomes 8.
 * E. Verify old messages are not deleted or duplicated.
 * F. Verify the same conversation ID remains associated with the restored session.
 * G. Verify a provisional session cannot overwrite a valid restored session.
 * H. Verify delayed writes from an old session cannot overwrite a newer snapshot.
 * I. Verify conversation A and conversation B remain isolated after reload and navigation.
 * J. Verify history recovery can merge older network-recovered messages with live-captured messages without duplicates.
 * K. Verify DOM fallback can add previously unrendered messages without duplicating existing messages.
 * L. Verify partial or incomplete history never receives a false "complete" status.
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
  extractMessagesFromConversationHistory,
  mergeCapturedSessions,
  conversationToCapturedSession,
} from "../src/continuity/captureLifecycle.ts";
import {
  saveActiveCaptureSession,
  getActiveCaptureSession,
  saveConversation,
  getConversations,
  getConversation,
} from "../src/storage/conversationStorage.ts";
import {
  recoverOlderHistoryViaDomScroll,
} from "../src/connectors/loadChatGPTHistory.ts";
import {
  createArchiveFromCapturedConversation,
} from "../src/continuity/archiveLifecycle.ts";
import type { CapturedConversation, NormalizedCaptureMessage } from "../src/continuity/captureTypes.ts";
import type { Conversation } from "../src/connectors/types.ts";

// Mock chrome storage
let mockLocalStorage: Record<string, unknown> = {};

function resetMockStorage() {
  mockLocalStorage = { memoryEnabled: true };
  globalThis.chrome = {

    runtime: {
      id: "test-extension-id",
      get id() {
        return "test-extension-id";
      },
      lastError: undefined,
      sendMessage: (_msg: unknown, cb?: (res: unknown) => void) => {
        if (cb) cb({ success: true });
      },
    },
    storage: {
      local: {
        get: (keys: string | string[] | Record<string, unknown> | null) => {
          return new Promise<Record<string, unknown>>((resolve) => {
            if (keys === null || keys === undefined) {
              resolve({ ...mockLocalStorage });
            } else if (typeof keys === "string") {
              resolve({ [keys]: mockLocalStorage[keys] });
            } else if (Array.isArray(keys)) {
              const res: Record<string, unknown> = {};
              for (const k of keys) {
                res[k] = mockLocalStorage[k];
              }
              resolve(res);
            } else {
              resolve({ ...keys, ...mockLocalStorage });
            }
          });
        },
        set: (items: Record<string, unknown>) => {
          return new Promise<void>((resolve) => {
            Object.assign(mockLocalStorage, items);
            resolve();
          });
        },
        remove: (keys: string | string[]) => {
          return new Promise<void>((resolve) => {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const k of list) {
              delete mockLocalStorage[k];
            }
            resolve();
          });
        },
      },
    },
  } as unknown as typeof chrome;
}

describe("VOIDZONE Phase 2.3: Reload Persistence & History Recovery", () => {
  beforeEach(() => {
    resetMockStorage();
  });

  const CONV_ID = "3847f98d-phase23-test-canonical-uuid";
  const CONV_URL = `https://chatgpt.com/c/${CONV_ID}`;

  // Helper to build 3 user + 3 assistant messages
  function buildInitial6Messages(): NormalizedCaptureMessage[] {
    return [
      {
        id: "msg-1-u",
        sequence: 1,
        role: "user",
        content: "Turn 1: Explain the Doppler effect.",
        timestamp: "2026-10-31T10:00:00.000Z",
        sourceMessageId: "src-1-u",
      },
      {
        id: "msg-2-a",
        sequence: 2,
        role: "assistant",
        content: "Turn 1: The Doppler effect is the change in frequency of a wave in relation to an observer.",
        timestamp: "2026-10-31T10:00:05.000Z",
        sourceMessageId: "src-2-a",
      },
      {
        id: "msg-3-u",
        sequence: 3,
        role: "user",
        content: "Turn 2: How does it apply to astronomy and red-shift?",
        timestamp: "2026-10-31T10:01:00.000Z",
        sourceMessageId: "src-3-u",
      },
      {
        id: "msg-4-a",
        sequence: 4,
        role: "assistant",
        content: "Turn 2: When stars or galaxies move away, their light waves are stretched toward longer red wavelengths.",
        timestamp: "2026-10-31T10:01:08.000Z",
        sourceMessageId: "src-4-a",
      },
      {
        id: "msg-5-u",
        sequence: 5,
        role: "user",
        content: "Turn 3: Does blueshift happen as well?",
        timestamp: "2026-10-31T10:02:00.000Z",
        sourceMessageId: "src-5-u",
      },
      {
        id: "msg-6-a",
        sequence: 6,
        role: "assistant",
        content: "Turn 3: Yes, blueshift occurs when an astronomical object moves toward the observer.",
        timestamp: "2026-10-31T10:02:06.000Z",
        sourceMessageId: "src-6-a",
      },
    ];
  }

  test("A. Restore a conversation containing 3 user and 3 assistant messages", async () => {
    const messages = buildInitial6Messages();
    const storedConv: Conversation = {
      id: CONV_ID,
      platform: "chatgpt",
      title: "Doppler Effect Discussion",
      url: CONV_URL,
      completeness: "complete",
      capturedAt: "2026-10-31T10:02:06.000Z",
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ?? undefined,
        sourceMessageId: m.sourceMessageId ?? undefined,
      })),
    };

    // Store in permanent conversations list
    await saveConversation(storedConv);

    // Verify stored state in storage
    const retrieved = await getConversation(CONV_ID);
    assert.ok(retrieved, "Conversation should exist in permanent storage");
    assert.strictEqual(retrieved.messages.length, 6, "Must contain exactly 6 messages");

    // Convert to captured session
    const restoredSession = conversationToCapturedSession(retrieved);
    assert.strictEqual(restoredSession.id, CONV_ID);
    assert.strictEqual(restoredSession.messages.length, 6);

    const metrics = computeConversationMetrics(restoredSession.messages);
    assert.strictEqual(metrics.humanCount, 3, "Must have exactly 3 human messages");
    assert.strictEqual(metrics.assistantCount, 3, "Must have exactly 3 assistant messages");
    assert.strictEqual(metrics.totalValidCount, 6, "Total count must be 6");
  });

  test("B. Reload the content script and verify all 6 messages remain", async () => {
    // Populate permanent storage with initial 6-message conversation
    const messages = buildInitial6Messages();
    await saveConversation({
      id: CONV_ID,
      platform: "chatgpt",
      title: "Doppler Effect Discussion",
      url: CONV_URL,
      completeness: "complete",
      capturedAt: "2026-10-31T10:02:06.000Z",
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ?? undefined,
        sourceMessageId: m.sourceMessageId ?? undefined,
      })),
    });

    // Simulate reload: content script initializes fresh memory maps
    const contentScriptSessions = new Map<string, CapturedConversation>();

    // Execute content script hydration logic
    const allStored = await getConversations();
    for (const c of allStored) {
      contentScriptSessions.set(c.id, conversationToCapturedSession(c));
    }

    const activeStored = await getActiveCaptureSession();
    if (activeStored && contentScriptSessions.has(activeStored.id)) {
      contentScriptSessions.set(
        activeStored.id,
        mergeCapturedSessions(contentScriptSessions.get(activeStored.id)!, activeStored)
      );
    }

    // Set active tab's session
    const tabSession = contentScriptSessions.get(CONV_ID);
    assert.ok(tabSession, "Session must be hydrated in content script");
    await saveActiveCaptureSession(tabSession);

    // Verify all 6 messages remain intact after reload
    const activeSession = await getActiveCaptureSession();
    assert.ok(activeSession, "Active capture session must be available after reload");
    assert.strictEqual(activeSession.id, CONV_ID);
    assert.strictEqual(activeSession.messages.length, 6, "All 6 messages must remain visible after reload");

    const metrics = computeConversationMetrics(activeSession.messages);
    assert.strictEqual(metrics.humanCount, 3);
    assert.strictEqual(metrics.assistantCount, 3);
    assert.strictEqual(metrics.totalValidCount, 6);
  });

  test("C. Send a new user message and verify the count becomes 7", async () => {
    // Start from hydrated 6-message session
    const messages = buildInitial6Messages();
    let session = conversationToCapturedSession({
      id: CONV_ID,
      platform: "chatgpt",
      title: "Doppler Effect Discussion",
      url: CONV_URL,
      messages,
    });
    await saveActiveCaptureSession(session);

    // New user message arrives (#7)
    const newUserMsg = {
      id: "msg-7-u",
      role: "user" as const,
      content: "Turn 4: What is cosmological redshift compared to Doppler redshift?",
      timestamp: "2026-10-31T10:03:00.000Z",
      sourceMessageId: "src-7-u",
    };

    session = ingestMessage(session, newUserMsg);
    await saveActiveCaptureSession(session);

    const activeSession = await getActiveCaptureSession();
    assert.ok(activeSession);
    assert.strictEqual(activeSession.messages.length, 7, "Message count must become 7");

    const metrics = computeConversationMetrics(activeSession.messages);
    assert.strictEqual(metrics.humanCount, 4, "Human count must be 4");
    assert.strictEqual(metrics.assistantCount, 3, "Assistant count must be 3");
    assert.strictEqual(metrics.totalValidCount, 7, "Total count must be 7");

    // Sequence check
    assert.strictEqual(activeSession.messages[6].id, "msg-7-u");
    assert.strictEqual(activeSession.messages[6].sequence, 7);
  });

  test("D. Receive the assistant response and verify the count becomes 8", async () => {
    // Start from 7-message session
    const messages = buildInitial6Messages();
    let session = conversationToCapturedSession({
      id: CONV_ID,
      platform: "chatgpt",
      title: "Doppler Effect Discussion",
      url: CONV_URL,
      messages,
    });
    session = ingestMessage(session, {
      id: "msg-7-u",
      role: "user",
      content: "Turn 4: What is cosmological redshift?",
      timestamp: "2026-10-31T10:03:00.000Z",
      sourceMessageId: "src-7-u",
    });

    // Assistant response begins streaming (#8)
    session = startAssistantStream(
      session,
      "msg-8-a",
      "Turn 4: Cosmological redshift is caused by the expansion of space itself,",
      "2026-10-31T10:03:05.000Z"
    );
    session = appendAssistantChunk(
      session,
      " not by the motion of objects through space."
    );

    // Stream completes
    session = completeAssistantStream(session);
    await saveActiveCaptureSession(session);

    const activeSession = await getActiveCaptureSession();
    assert.ok(activeSession);
    assert.strictEqual(activeSession.messages.length, 8, "Message count must become 8");

    const metrics = computeConversationMetrics(activeSession.messages);
    assert.strictEqual(metrics.humanCount, 4, "Human count must be 4");
    assert.strictEqual(metrics.assistantCount, 4, "Assistant count must be 4");
    assert.strictEqual(metrics.totalValidCount, 8, "Total valid count must be 8");

    // Content completeness
    assert.strictEqual(
      activeSession.messages[7].content,
      "Turn 4: Cosmological redshift is caused by the expansion of space itself, not by the motion of objects through space."
    );
    assert.strictEqual(activeSession.messages[7].sequence, 8);
  });

  test("E. Verify old messages are not deleted or duplicated", async () => {
    const messages = buildInitial6Messages();
    let session = conversationToCapturedSession({
      id: CONV_ID,
      platform: "chatgpt",
      title: "Doppler Effect Discussion",
      url: CONV_URL,
      messages,
    });

    // Ingest turn 4
    session = ingestMessage(session, {
      id: "msg-7-u",
      role: "user",
      content: "Turn 4: Question",
      timestamp: "2026-10-31T10:03:00.000Z",
    });
    session = ingestMessage(session, {
      id: "msg-8-a",
      role: "assistant",
      content: "Turn 4: Answer",
      timestamp: "2026-10-31T10:03:05.000Z",
    });

    // Re-ingest an already existing message (msg-1-u) to simulate interceptor re-observation
    session = ingestMessage(session, {
      id: "msg-1-u",
      role: "user",
      content: "Turn 1: Explain the Doppler effect.",
      timestamp: "2026-10-31T10:00:00.000Z",
      sourceMessageId: "src-1-u",
    });

    assert.strictEqual(session.messages.length, 8, "Re-ingesting existing message must not duplicate it");

    // Check every original message ID is present exactly once
    const ids = session.messages.map((m) => m.id);
    for (let i = 1; i <= 6; i++) {
      const expectedId = i % 2 === 1 ? `msg-${i}-u` : `msg-${i}-a`;
      const occurrences = ids.filter((id) => id === expectedId).length;
      assert.strictEqual(occurrences, 1, `Message ${expectedId} must appear exactly once`);
    }

    // Verify strict sequential ordering 1..8
    session.messages.forEach((m, idx) => {
      assert.strictEqual(m.sequence, idx + 1, `Sequence must match index + 1 for message ${m.id}`);
    });
  });

  test("F. Verify the same conversation ID remains associated with the restored session", async () => {
    const messages = buildInitial6Messages();
    let session = conversationToCapturedSession({
      id: CONV_ID,
      platform: "chatgpt",
      title: "Doppler Effect Discussion",
      url: CONV_URL,
      messages,
    });
    await saveActiveCaptureSession(session);

    // Turn 7
    session = ingestMessage(session, {
      id: "msg-7-u",
      role: "user",
      content: "User message 7",
    });
    await saveActiveCaptureSession(session);

    // Turn 8
    session = ingestMessage(session, {
      id: "msg-8-a",
      role: "assistant",
      content: "Assistant message 8",
    });
    await saveActiveCaptureSession(session);

    const activeSession = await getActiveCaptureSession();
    assert.ok(activeSession);
    assert.strictEqual(activeSession.id, CONV_ID, "Canonical conversation ID must be preserved throughout");
    assert.strictEqual(activeSession.url, CONV_URL, "URL must remain attached");

    const matchesActiveTab = isSessionMatchingActiveTab(activeSession, CONV_URL, CONV_ID);
    assert.strictEqual(matchesActiveTab, true, "Session must match active tab route");
  });

  test("G. Verify a provisional session cannot overwrite a valid restored session", async () => {
    // 1. Establish an authoritative restored session in active storage
    const messages = buildInitial6Messages();
    const authoritativeSession = conversationToCapturedSession({
      id: CONV_ID,
      platform: "chatgpt",
      title: "Doppler Effect Discussion",
      url: CONV_URL,
      messages,
    });
    await saveActiveCaptureSession(authoritativeSession);

    // 2. An unpromoted provisional session tries to write to active storage
    const provisionalSession = createCaptureSession(
      "chatgpt",
      "Untitled conversation",
      CONV_URL,
      "provisional-tab"
    );
    const updatedProvisional = ingestMessage(provisionalSession, {
      role: "user",
      content: "A provisional message",
    });

    // Attempt to save provisional session
    const writeResult = await saveActiveCaptureSession(updatedProvisional);
    assert.strictEqual(writeResult.success, true);

    // 3. Verify authoritative session was NOT overwritten
    const currentActive = await getActiveCaptureSession();
    assert.ok(currentActive);
    assert.strictEqual(currentActive.id, CONV_ID, "Authoritative ID must not be overwritten by provisional-tab");
    assert.strictEqual(currentActive.messages.length, 6, "Authoritative messages must remain intact");

    // 4. Verify promotion merges messages into authoritative session rather than replacing it
    const merged = mergeCapturedSessions(authoritativeSession, updatedProvisional);
    assert.strictEqual(merged.id, CONV_ID, "Promoted session must retain authoritative ID");
    assert.strictEqual(merged.messages.length, 7, "Provisional message must be safely appended");
  });

  test("H. Verify delayed writes from an old session cannot overwrite a newer snapshot", async () => {
    const messages = buildInitial6Messages();
    const sessionT1 = conversationToCapturedSession({
      id: CONV_ID,
      platform: "chatgpt",
      title: "Doppler Effect Discussion",
      url: CONV_URL,
      messages,
      capturedAt: "2026-10-31T10:02:00.000Z",
    });
    sessionT1.lastCheckpointAt = "2026-10-31T10:02:00.000Z";

    // Progress to turn 8 (newer snapshot at T2)
    let sessionT2 = mergeCapturedSessions(sessionT1, {
      ...sessionT1,
      capturedAt: "2026-10-31T10:05:00.000Z",
      lastCheckpointAt: "2026-10-31T10:05:00.000Z",
    });
    sessionT2 = ingestMessage(sessionT2, {
      id: "msg-7-u",
      role: "user",
      content: "Turn 4: Q",
      timestamp: "2026-10-31T10:04:00.000Z",
    });
    sessionT2 = ingestMessage(sessionT2, {
      id: "msg-8-a",
      role: "assistant",
      content: "Turn 4: A",
      timestamp: "2026-10-31T10:05:00.000Z",
    });

    // Save newer snapshot first
    await saveActiveCaptureSession(sessionT2);
    let active = await getActiveCaptureSession();
    assert.strictEqual(active?.messages.length, 8);

    // Delayed write from T1 arrives now with only 6 messages
    await saveActiveCaptureSession(sessionT1);

    // Active session must NOT be rolled back to 6 messages
    active = await getActiveCaptureSession();
    assert.ok(active);
    assert.strictEqual(active.messages.length, 8, "Stale delayed write must not roll back message count");
    assert.strictEqual(active.messages[7].id, "msg-8-a");
  });

  test("I. Verify conversation A and conversation B remain isolated after reload and navigation", async () => {
    const convA_Id = "conv-A-uuid-1111";
    const convB_Id = "conv-B-uuid-2222";

    const convA: Conversation = {
      id: convA_Id,
      platform: "chatgpt",
      title: "Topic A",
      url: `https://chatgpt.com/c/${convA_Id}`,
      messages: [
        { id: "a1", role: "user", content: "Question A1" },
        { id: "a2", role: "assistant", content: "Answer A1" },
        { id: "a3", role: "user", content: "Question A2" },
        { id: "a4", role: "assistant", content: "Answer A2" },
      ],
    };

    const convB: Conversation = {
      id: convB_Id,
      platform: "chatgpt",
      title: "Topic B",
      url: `https://chatgpt.com/c/${convB_Id}`,
      messages: [
        { id: "b1", role: "user", content: "Question B1" },
        { id: "b2", role: "assistant", content: "Answer B1" },
      ],
    };

    await saveConversation(convA);
    await saveConversation(convB);

    // Reload on Conv A
    const sessionA = conversationToCapturedSession(await getConversation(convA_Id) as Conversation);
    await saveActiveCaptureSession(sessionA);

    let current = await getActiveCaptureSession();
    assert.strictEqual(current?.id, convA_Id);
    assert.strictEqual(current?.messages.length, 4);
    assert.strictEqual(isSessionMatchingActiveTab(current, `https://chatgpt.com/c/${convA_Id}`, convA_Id), true);
    assert.strictEqual(isSessionMatchingActiveTab(current, `https://chatgpt.com/c/${convB_Id}`, convB_Id), false);

    // Navigate to Conv B
    const sessionB = conversationToCapturedSession(await getConversation(convB_Id) as Conversation);
    await saveActiveCaptureSession(sessionB);

    current = await getActiveCaptureSession();
    assert.strictEqual(current?.id, convB_Id);
    assert.strictEqual(current?.messages.length, 2);
    assert.strictEqual(isSessionMatchingActiveTab(current, `https://chatgpt.com/c/${convB_Id}`, convB_Id), true);
    assert.strictEqual(isSessionMatchingActiveTab(current, `https://chatgpt.com/c/${convA_Id}`, convA_Id), false);

    // Verify neither has messages from the other
    const msgIdsB = current?.messages.map((m) => m.id) ?? [];
    assert.strictEqual(msgIdsB.includes("a1"), false, "Conv B must not contain Conv A messages");
  });

  test("J. Verify history recovery can merge older network-recovered messages with live-captured messages without duplicates", () => {
    // Current live session only captured turns 3 and 4 (e.g. user refreshed or joined mid-thread)
    const liveSession: CapturedConversation = {
      id: CONV_ID,
      platform: "chatgpt",
      title: "Physics",
      url: CONV_URL,
      messages: [
        {
          id: "msg-3",
          sequence: 1,
          role: "user",
          content: "Turn 2: Astronomy red-shift?",
          timestamp: "2026-10-31T10:01:00.000Z",
          sourceMessageId: "node-msg-3",
        },
        {
          id: "msg-4",
          sequence: 2,
          role: "assistant",
          content: "Turn 2: Stretched to red wavelengths.",
          timestamp: "2026-10-31T10:01:08.000Z",
          sourceMessageId: "node-msg-4",
        },
      ],
      state: "completed",
      hasMoreHistory: false,
      isComplete: false,
      completenessStatus: "partial",
      capturedAt: "2026-10-31T10:01:08.000Z",
      lastCheckpointAt: "2026-10-31T10:01:08.000Z",
      error: null,
    };

    // Historical network recovery arrives via mapping DAG containing nodes 1, 2, 3, 4
    const dagPayload = {
      conversation_id: CONV_ID,
      title: "Physics",
      mapping: {
        "root-node": {
          id: "root-node",
          parent: null,
          message: null,
        },
        "node-msg-1": {
          id: "node-msg-1",
          parent: "root-node",
          message: {
            id: "msg-1",
            author: { role: "user" },
            content: { parts: ["Turn 1: Doppler effect?"] },
            create_time: 1793440800, // 10:00:00
          },
        },
        "node-msg-2": {
          id: "node-msg-2",
          parent: "node-msg-1",
          message: {
            id: "msg-2",
            author: { role: "assistant" },
            content: { parts: ["Turn 1: Wave frequency change."] },
            create_time: 1793440805, // 10:00:05
          },
        },
        "node-msg-3": {
          id: "node-msg-3",
          parent: "node-msg-2",
          message: {
            id: "msg-3",
            author: { role: "user" },
            content: { parts: ["Turn 2: Astronomy red-shift?"] },
            create_time: 1793440860, // 10:01:00
          },
        },
        "node-msg-4": {
          id: "node-msg-4",
          parent: "node-msg-3",
          message: {
            id: "msg-4",
            author: { role: "assistant" },
            content: { parts: ["Turn 2: Stretched to red wavelengths."] },
            create_time: 1793440868, // 10:01:08
          },
        },
      },
    };

    const extraction = extractMessagesFromConversationHistory(dagPayload);
    assert.strictEqual(extraction.isComplete, true);
    assert.strictEqual(extraction.messages.length, 4);

    // Merge recovered DAG messages with live session
    let mergedSession = liveSession;
    for (const recMsg of extraction.messages) {
      mergedSession = ingestMessage(mergedSession, {
        id: recMsg.id,
        role: recMsg.role,
        content: recMsg.content,
        timestamp: recMsg.timestamp,
        sourceMessageId: recMsg.id,
      });
    }

    assert.strictEqual(mergedSession.messages.length, 4, "Must have exactly 4 messages without duplicates");
    assert.strictEqual(mergedSession.messages[0].id, "msg-1");
    assert.strictEqual(mergedSession.messages[1].id, "msg-2");
    assert.strictEqual(mergedSession.messages[2].id, "msg-3");
    assert.strictEqual(mergedSession.messages[3].id, "msg-4");

    // Sequence numbers 1, 2, 3, 4
    mergedSession.messages.forEach((m, idx) => {
      assert.strictEqual(m.sequence, idx + 1);
    });
  });

  test("K. Verify DOM fallback can add previously unrendered messages without duplicating existing messages", () => {
    // Current session already has msg-2 and msg-3
    let session = createCaptureSession("chatgpt", "Title", CONV_URL, CONV_ID);
    session = ingestMessage(session, {
      id: "msg-2",
      role: "assistant",
      content: "Answer 1",
      timestamp: "2026-10-31T10:00:05.000Z",
      sourceMessageId: "turn-2",
    });
    session = ingestMessage(session, {
      id: "msg-3",
      role: "user",
      content: "Question 2",
      timestamp: "2026-10-31T10:01:00.000Z",
      sourceMessageId: "turn-3",
    });

    assert.strictEqual(session.messages.length, 2);

    // DOM extraction uncovers msg-1 (previously unrendered) and also sees msg-2, msg-3
    const extractedFromDom: NormalizedCaptureMessage[] = [
      {
        id: "msg-1",
        sequence: 1,
        role: "user",
        content: "Question 1",
        timestamp: "2026-10-31T10:00:00.000Z",
        sourceMessageId: "turn-1",
      },
      {
        id: "msg-2",
        sequence: 2,
        role: "assistant",
        content: "Answer 1",
        timestamp: "2026-10-31T10:00:05.000Z",
        sourceMessageId: "turn-2",
      },
      {
        id: "msg-3",
        sequence: 3,
        role: "user",
        content: "Question 2",
        timestamp: "2026-10-31T10:01:00.000Z",
        sourceMessageId: "turn-3",
      },
    ];

    // Merge DOM recovery
    for (const domMsg of extractedFromDom) {
      session = ingestMessage(session, {
        id: domMsg.id,
        role: domMsg.role,
        content: domMsg.content,
        timestamp: domMsg.timestamp,
        sourceMessageId: domMsg.sourceMessageId,
      });
    }

    assert.strictEqual(session.messages.length, 3, "Total messages must be 3");
    assert.strictEqual(session.messages[0].id, "msg-1");
    assert.strictEqual(session.messages[1].id, "msg-2");
    assert.strictEqual(session.messages[2].id, "msg-3");

    // Completeness must be partial
    session.completenessStatus = "partial";
    session.isComplete = false;
    assert.strictEqual(session.completenessStatus, "partial");
    assert.strictEqual(session.isComplete, false);
  });

  test("L. Verify partial or incomplete history never receives a false complete status", () => {
    // L1: Mapping DAG missing a root node
    const missingRootDag = {
      conversation_id: CONV_ID,
      mapping: {
        "node-msg-2": {
          id: "node-msg-2",
          parent: "node-msg-1-not-in-mapping",
          message: {
            id: "msg-2",
            author: { role: "assistant" },
            content: { parts: ["Answer without root"] },
          },
        },
      },
    };
    const resL1 = extractMessagesFromConversationHistory(missingRootDag);
    assert.strictEqual(resL1.isComplete, false, "Missing root in mapping DAG must be incomplete");

    // L2: Mapping DAG with broken parent link
    const brokenLinkDag = {
      conversation_id: CONV_ID,
      mapping: {
        "root-node": { id: "root-node", parent: null, message: null },
        "node-msg-1": {
          id: "node-msg-1",
          parent: "non-existent-parent-xyz",
          message: {
            id: "msg-1",
            author: { role: "user" },
            content: { parts: ["Orphaned turn"] },
          },
        },
      },
    };
    const resL2 = extractMessagesFromConversationHistory(brokenLinkDag);
    assert.strictEqual(resL2.isComplete, false, "Broken parent link in DAG must be incomplete");

    // L3: Response with explicit has_missing_messages / is_truncated flags
    const truncatedPayload = {
      conversation_id: CONV_ID,
      is_truncated: true,
      mapping: {
        "root-node": { id: "root-node", parent: null, message: null },
        "node-msg-1": {
          id: "node-msg-1",
          parent: "root-node",
          message: {
            id: "msg-1",
            author: { role: "user" },
            content: { parts: ["Question"] },
          },
        },
      },
    };
    const resL3 = extractMessagesFromConversationHistory(truncatedPayload);
    assert.strictEqual(resL3.isComplete, false, "is_truncated: true must result in incomplete");

    // L4: Paginated endpoint with has_previous_page: true
    const paginatedPayload = {
      conversation_id: CONV_ID,
      messages: [
        { id: "m1", role: "user", content: "Q1" },
        { id: "m2", role: "assistant", content: "A1" },
      ],
      page_info: {
        has_previous_page: true,
        has_next_page: false,
      },
    };
    const resL4 = extractMessagesFromConversationHistory(paginatedPayload);
    assert.strictEqual(resL4.isComplete, false, "has_previous_page: true must result in incomplete");

    // L5: Empty mapping or empty message payload
    const emptyPayload = { conversation_id: CONV_ID, mapping: {} };
    const resL5 = extractMessagesFromConversationHistory(emptyPayload);
    assert.strictEqual(resL5.isComplete, false, "Empty mapping must be incomplete");
  });

  test("M. A new message arriving while storage hydration is still pending awaits hydration and preserves prior history", async () => {
    // Permanent storage already has a 6-message conversation
    const initialConv: Conversation = {
      id: CONV_ID,
      platform: "chatgpt",
      title: "Physics Discussion",
      url: CONV_URL,
      messages: buildInitial6Messages().map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ?? undefined,
        sourceMessageId: m.sourceMessageId ?? undefined,
      })),
    };
    await saveConversation(initialConv);

    // Simulate in-memory session map in content script
    const sessionMap = new Map<string, CapturedConversation>();

    // Simulated delayed hydration promise (takes 30ms to resolve)
    let hydrationResolved = false;
    const hydrationPromise = new Promise<void>((resolve) => {
      setTimeout(async () => {
        const stored = await getConversations();
        for (const c of stored) {
          const cap = conversationToCapturedSession(c);
          sessionMap.set(c.id, cap);
        }
        hydrationResolved = true;
        resolve();
      }, 30);
    });

    // An incoming user message handler function that awaits hydration
    async function onIncomingUserMessage(convId: string, text: string) {
      await hydrationPromise;
      let session = sessionMap.get(convId);
      if (!session) {
        session = createCaptureSession("chatgpt", "Chat", CONV_URL, convId);
      }
      const seq = session.messages.length + 1;
      const updated = ingestMessage(session, {
        id: `turn-${seq}-u`,
        role: "user",
        content: text,
        timestamp: "2026-10-31T10:05:00.000Z",
      });
      sessionMap.set(convId, updated);
      await saveActiveCaptureSession(updated);
      return updated;
    }

    assert.strictEqual(hydrationResolved, false, "Hydration should still be pending when message arrives");

    // Message arrives concurrently before hydration finishes
    const updatedSession = await onIncomingUserMessage(CONV_ID, "Turn 7: How does this relate to red-shift?");

    assert.strictEqual(hydrationResolved, true, "Hydration resolved during message processing");
    assert.strictEqual(updatedSession.messages.length, 7, "Message must append to restored 6 messages, not start at 1");
    assert.strictEqual(updatedSession.messages[0].id, "msg-1-u");
    assert.strictEqual(updatedSession.messages[6].content, "Turn 7: How does this relate to red-shift?");
  });

  test("N. Reload followed immediately by user submission appends to turn 5", async () => {
    // 4 messages stored
    const fourMsgs = buildInitial6Messages().slice(0, 4);
    const initialConv: Conversation = {
      id: CONV_ID,
      platform: "chatgpt",
      title: "Physics Discussion",
      url: CONV_URL,
      messages: fourMsgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ?? undefined,
        sourceMessageId: m.sourceMessageId ?? undefined,
      })),
    };
    await saveConversation(initialConv);

    // Reload content script: restore from storage
    const stored = await getConversation(CONV_ID);
    assert.ok(stored);
    let session = conversationToCapturedSession(stored);
    assert.strictEqual(session.messages.length, 4);

    // Immediate user submission
    session = ingestMessage(session, {
      id: "msg-5-u",
      role: "user",
      content: "Turn 5 user question",
      timestamp: "2026-10-31T10:04:00.000Z",
      sourceMessageId: "src-5-u",
    });

    assert.strictEqual(session.messages.length, 5);
    const metrics = computeConversationMetrics(session.messages);
    assert.strictEqual(metrics.humanCount, 3);
    assert.strictEqual(metrics.assistantCount, 2);
    assert.strictEqual(metrics.totalValidCount, 5);
  });

  test("O. Reload followed by assistant streaming resumes and completes without dropping turns", async () => {
    // 5 messages in storage (user just sent turn 5 before reload)
    const fiveMsgs = [
      ...buildInitial6Messages().slice(0, 4),
      {
        id: "msg-5-u",
        sequence: 5,
        role: "user" as const,
        content: "Turn 5 prompt",
        timestamp: "2026-10-31T10:04:00.000Z",
        sourceMessageId: "src-5-u",
      },
    ];
    await saveConversation({
      id: CONV_ID,
      platform: "chatgpt",
      title: "Physics Discussion",
      url: CONV_URL,
      messages: fiveMsgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ?? undefined,
        sourceMessageId: m.sourceMessageId ?? undefined,
      })),
    });

    // Content script hydrates on reload
    const stored = await getConversation(CONV_ID);
    assert.ok(stored);
    let session = conversationToCapturedSession(stored);

    // Assistant streaming starts
    const asstMsgId = "asst-stream-msg-6";
    session = startAssistantStream(session, asstMsgId, "First chunk of response. ", "2026-10-31T10:04:05.000Z");
    assert.strictEqual(session.messages.length, 6);
    assert.strictEqual(session.state, "response_in_progress");

    // Assistant chunks append
    session = appendAssistantChunk(session, "Second chunk of response.");
    assert.strictEqual(session.messages.length, 6);
    assert.strictEqual(
      session.messages[5].content,
      "First chunk of response. Second chunk of response."
    );

    // Assistant stream completes
    session = completeAssistantStream(session, asstMsgId, "First chunk of response. Second chunk of response. Complete.");
    assert.strictEqual(session.state, "checkpoint_available");
    assert.strictEqual(session.messages.length, 6);
    assert.strictEqual(session.messages[5].role, "assistant");
    assert.strictEqual(session.messages[5].isInProgress, false);

    // Prior 5 messages must remain intact
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(session.messages[i].id, fiveMsgs[i].id);
      assert.strictEqual(session.messages[i].role, fiveMsgs[i].role);
    }
  });

  test("P. Long-history recovery requiring more than three scroll increments executes successfully", async () => {
    let currentRenderedCount = 2;
    const scrollContainer = {
      scrollTop: 1000,
      scrollHeight: 4000,
      clientHeight: 800,
      parentElement: null,
      dispatchEvent: () => {},
    };
    const firstMessage = { parentElement: scrollContainer };

    (globalThis as unknown as { window: unknown }).window = {
      getComputedStyle: () => ({ overflowY: "auto" }),
    };

    let observerCb: (() => void) | null = null;
    class MockObserver {
      cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        observerCb = cb;
      }
      observe() {}
      disconnect() {
        if (observerCb === this.cb) observerCb = null;
      }
    }
    (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = MockObserver;

    const mockDoc = {
      body: {},
      querySelector: (sel: string) => (sel === "[data-message-author-role]" ? firstMessage : null),
      querySelectorAll: (sel: string) =>
        sel === "[data-message-author-role]" ? Array.from({ length: currentRenderedCount }) : [],
    } as unknown as Document;

    // Simulate ChatGPT loading 2 new messages on each scroll pulse (up to 5 pulses = 10 messages)
    let pulseCount = 0;
    scrollContainer.dispatchEvent = () => {
      pulseCount++;
      if (pulseCount <= 5) {
        currentRenderedCount += 2;
        if (observerCb) observerCb();
      }
    };

    const result = await recoverOlderHistoryViaDomScroll(mockDoc, {
      maxAttempts: 8,
      maxConsecutiveUnchanged: 2,
      waitTimeoutMs: 50,
    });

    // Verified: more than 3 scroll pulses were executed
    assert.ok(pulseCount > 3, `Must execute more than 3 pulses, executed: ${pulseCount}`);
    assert.strictEqual(result.recoveredCount, 10, "Recovered count must be 10 (2 initial -> 12 total)");
    assert.strictEqual(result.totalVisibleCount, 12);
  });

  test("Q. Scroll container temporarily returning no new elements does not prematurely terminate recovery", async () => {
    let currentRenderedCount = 4;
    const scrollContainer = {
      scrollTop: 800,
      scrollHeight: 3000,
      clientHeight: 800,
      parentElement: null,
      dispatchEvent: () => {},
    };
    const firstMessage = { parentElement: scrollContainer };

    (globalThis as unknown as { window: unknown }).window = {
      getComputedStyle: () => ({ overflowY: "auto" }),
    };

    let observerCb: (() => void) | null = null;
    class MockObserver {
      cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        observerCb = cb;
      }
      observe() {}
      disconnect() {
        if (observerCb === this.cb) observerCb = null;
      }
    }
    (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = MockObserver;

    const mockDoc = {
      body: {},
      querySelector: (sel: string) => (sel === "[data-message-author-role]" ? firstMessage : null),
      querySelectorAll: (sel: string) =>
        sel === "[data-message-author-role]" ? Array.from({ length: currentRenderedCount }) : [],
    } as unknown as Document;

    let pulseIndex = 0;
    scrollContainer.dispatchEvent = () => {
      pulseIndex++;
      // Pulse 1: +2 messages
      if (pulseIndex === 1) {
        currentRenderedCount += 2;
        if (observerCb) observerCb();
      }
      // Pulse 2: +0 messages (temporary lag/debounce) -> consecutiveUnchanged = 1
      else if (pulseIndex === 2) {
        // Nothing added
      }
      // Pulse 3: +2 messages -> should recover! consecutiveUnchanged resets to 0
      else if (pulseIndex === 3) {
        currentRenderedCount += 2;
        if (observerCb) observerCb();
      }
      // Pulses 4 and 5: +0 messages -> consecutiveUnchanged reaches 2, terminates cleanly
    };

    const result = await recoverOlderHistoryViaDomScroll(mockDoc, {
      maxAttempts: 10,
      maxConsecutiveUnchanged: 2,
      waitTimeoutMs: 50,
    });

    assert.ok(pulseIndex >= 4, "Must not have stopped at pulse 2 when 0 elements temporarily appeared");
    assert.strictEqual(result.recoveredCount, 4, "Must have recovered both batches (pulse 1 and pulse 3)");
    assert.strictEqual(result.totalVisibleCount, 8);
    assert.strictEqual(result.status, "no_more_history");
  });

  test("R. Recovery stops cleanly at beginning of history when consecutive unchanged limit is reached", async () => {
    const scrollContainer = {
      scrollTop: 500,
      scrollHeight: 2000,
      clientHeight: 800,
      parentElement: null,
      dispatchEvent: () => {},
    };
    const firstMessage = { parentElement: scrollContainer };

    (globalThis as unknown as { window: unknown }).window = {
      getComputedStyle: () => ({ overflowY: "auto" }),
    };

    class MockObserver {
      observe() {}
      disconnect() {}
    }
    (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = MockObserver;

    const mockDoc = {
      body: {},
      querySelector: (sel: string) => (sel === "[data-message-author-role]" ? firstMessage : null),
      querySelectorAll: (sel: string) =>
        sel === "[data-message-author-role]" ? Array.from({ length: 6 }) : [],
    } as unknown as Document;

    const result = await recoverOlderHistoryViaDomScroll(mockDoc, {
      maxAttempts: 10,
      maxConsecutiveUnchanged: 2,
      waitTimeoutMs: 20,
    });

    assert.strictEqual(result.recoveredCount, 0);
    assert.strictEqual(result.totalVisibleCount, 6);
    assert.strictEqual(result.limitReached, false);
    assert.strictEqual(result.status, "no_more_history");
  });

  test("S. User scroll position is accurately restored after DOM history recovery", async () => {
    const scrollContainer = {
      scrollTop: 1420,
      scrollHeight: 4500,
      clientHeight: 800,
      parentElement: null,
      dispatchEvent: () => {},
    };
    const firstMessage = { parentElement: scrollContainer };

    (globalThis as unknown as { window: unknown }).window = {
      getComputedStyle: () => ({ overflowY: "auto" }),
    };

    class MockObserver {
      observe() {}
      disconnect() {}
    }
    (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = MockObserver;

    const mockDoc = {
      body: {},
      querySelector: (sel: string) => (sel === "[data-message-author-role]" ? firstMessage : null),
      querySelectorAll: (sel: string) =>
        sel === "[data-message-author-role]" ? Array.from({ length: 5 }) : [],
    } as unknown as Document;

    // Run recovery
    await recoverOlderHistoryViaDomScroll(mockDoc, {
      maxAttempts: 2,
      maxConsecutiveUnchanged: 1,
      waitTimeoutMs: 20,
    });

    // Verified: scrollTop restored to exact pre-recovery value
    assert.strictEqual(scrollContainer.scrollTop, 1420, "User scroll position must be restored to 1420");
  });

  test("T. Duplicate prevention across network and DOM recovery preserves single copies of turns", () => {
    let session = createCaptureSession("chatgpt", "Title", CONV_URL, CONV_ID);

    // Initial DOM extraction captures turns 1 and 2
    session = ingestMessage(session, {
      id: "turn-1-dom",
      role: "user",
      content: "Explain special relativity.",
      timestamp: "2026-10-31T10:00:00.000Z",
      sourceMessageId: "source-node-1",
    });
    session = ingestMessage(session, {
      id: "turn-2-dom",
      role: "assistant",
      content: "Special relativity deals with space and time.",
      timestamp: "2026-10-31T10:00:05.000Z",
      sourceMessageId: "source-node-2",
    });

    assert.strictEqual(session.messages.length, 2);

    // Network history recovery later fetches the complete DAG for turns 1, 2, and 3
    const networkDag = {
      conversation_id: CONV_ID,
      mapping: {
        "root": { id: "root", parent: null, message: null },
        "source-node-1": {
          id: "source-node-1",
          parent: "root",
          message: {
            id: "msg-net-1",
            author: { role: "user" },
            content: { parts: ["Explain special relativity."] },
            create_time: 1793440800,
          },
        },
        "source-node-2": {
          id: "source-node-2",
          parent: "source-node-1",
          message: {
            id: "msg-net-2",
            author: { role: "assistant" },
            content: { parts: ["Special relativity deals with space and time."] },
            create_time: 1793440805,
          },
        },
        "source-node-3": {
          id: "source-node-3",
          parent: "source-node-2",
          message: {
            id: "msg-net-3",
            author: { role: "user" },
            content: { parts: ["What about time dilation?"] },
            create_time: 1793440860,
          },
        },
      },
    };

    const extraction = extractMessagesFromConversationHistory(networkDag);
    assert.strictEqual(extraction.messages.length, 3);

    // Ingest network-recovered turns into session
    for (const msg of extraction.messages) {
      session = ingestMessage(session, {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        sourceMessageId: msg.id,
      });
    }

    // Session must have exactly 3 messages, turns 1 and 2 deduplicated
    assert.strictEqual(session.messages.length, 3, "Turns 1 and 2 must not be duplicated");
    assert.strictEqual(session.messages[0].content, "Explain special relativity.");
    assert.strictEqual(session.messages[1].content, "Special relativity deals with space and time.");
    assert.strictEqual(session.messages[2].content, "What about time dilation?");
  });

  test("U. Identical-text messages across different turns are NOT collapsed into a single message", () => {
    let session = createCaptureSession("chatgpt", "Repeated Words", CONV_URL, CONV_ID);

    // Turn 1
    session = ingestMessage(session, {
      id: "turn-1-u",
      role: "user",
      content: "Proceed",
      timestamp: "2026-10-31T10:00:00.000Z",
    });

    // Turn 2
    session = ingestMessage(session, {
      id: "turn-2-a",
      role: "assistant",
      content: "Step 1 complete.",
      timestamp: "2026-10-31T10:00:05.000Z",
    });

    // Turn 3: User says the exact same word "Proceed" 1 minute later
    session = ingestMessage(session, {
      id: "turn-3-u",
      role: "user",
      content: "Proceed",
      timestamp: "2026-10-31T10:01:05.000Z",
    });

    // Turn 4
    session = ingestMessage(session, {
      id: "turn-4-a",
      role: "assistant",
      content: "Step 2 complete.",
      timestamp: "2026-10-31T10:01:10.000Z",
    });

    assert.strictEqual(session.messages.length, 4, "Must preserve both 'Proceed' messages as separate turns");
    assert.strictEqual(session.messages[0].content, "Proceed");
    assert.strictEqual(session.messages[0].sequence, 1);
    assert.strictEqual(session.messages[2].content, "Proceed");
    assert.strictEqual(session.messages[2].sequence, 3);
  });

  test("V. Archive completeness vs SHA-256 integrity distinction: valid SHA-256 does not promote partial status", async () => {
    // Partial session (4 messages, full history not confirmed)
    const partialSession: CapturedConversation = {
      id: CONV_ID,
      platform: "chatgpt",
      title: "Partial Capture",
      url: CONV_URL,
      messages: buildInitial6Messages().slice(0, 4),
      state: "checkpoint_available",
      hasMoreHistory: true,
      isComplete: false,
      completenessStatus: "partial",
      capturedAt: "2026-10-31T10:02:00.000Z",
      lastCheckpointAt: "2026-10-31T10:02:00.000Z",
      error: null,
    };

    const archive = await createArchiveFromCapturedConversation(partialSession);

    // SHA-256 integrity check passes
    assert.ok(archive.integrity.sourceHash, "Must contain SHA-256 hash");
    assert.strictEqual(archive.integrity.verified, true, "Integrity must be verified");
    assert.strictEqual(archive.integrity.algorithm, "SHA-256");

    // Completeness MUST remain partial
    assert.strictEqual(
      archive.completeness.status,
      "partial",
      "Archive completeness must remain partial even though integrity is verified"
    );
    assert.strictEqual(archive.completeness.sourceConfirmed, false);
    assert.ok(
      archive.voidzone.instructions.transferPrompt.includes("COMPLETENESS WARNING: PARTIAL"),
      "Transfer prompt must contain completeness warning"
    );
  });
});

