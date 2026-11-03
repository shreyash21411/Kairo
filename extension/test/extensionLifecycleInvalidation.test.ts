/**
 * extensionLifecycleInvalidation.test.ts
 *
 * Comprehensive regression tests for Extension Context Invalidation & Storage Persistence:
 * 1. Extension context invalidation during an active capture.
 * 2. Extension context invalidation during assistant streaming.
 * 3. Navigation while a save operation is pending.
 * 4. Conversation switching while a stream callback is pending.
 * 5. Storage quota failure.
 * 6. Repeated invalidation errors do not create notification spam.
 * 7. Valid storage operations still persist messages normally.
 * 8. No stale callback writes into a different conversation.
 * 9. Incomplete snapshot cannot overwrite previously saved complete message.
 * 10. Pending writes during teardown and DOM cache recovery without duplicates.
 * 11. New content-script initialization retires older orphaned instances.
 * 12. No false successful-save notifications when storage persistence fails.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  isExtensionContextValid,
  isExtensionContextInvalidatedError,
  ContentScriptLifecycle,
  preservePendingSessionInDOM,
  recoverPendingSessionsFromDOM,
  CONTENT_SCRIPT_REINIT_EVENT,
} from "../src/continuity/contentScriptLifecycle.ts";
import {
  saveActiveCaptureSession,
  getActiveCaptureSession,
  clearActiveCaptureSession,
  saveConversation,
  getConversations,
} from "../src/storage/conversationStorage.ts";
import {
  createCaptureSession,
  ingestMessage,
  startAssistantStream,
  appendAssistantChunk,
  completeAssistantStream,
  interruptStream,
  computeConversationMetrics,
  isSessionMatchingActiveTab,
} from "../src/continuity/captureLifecycle.ts";
import type { CapturedConversation } from "../src/continuity/captureTypes.ts";
import type { Conversation } from "../src/connectors/types.ts";

// Mock storage and DOM environments
let mockLocalStorage: Record<string, unknown> = {};
let mockSessionStorage: Record<string, string> = {};
let storageThrowError: Error | null = null;
let runtimeInvalidated = false;

// Event target mock for window
const windowListeners = new Map<string, Set<(e: Event) => void>>();

function resetWindowListeners() {
  windowListeners.clear();
}

function mockAddEventListener(type: string, listener: (e: Event) => void) {
  if (!windowListeners.has(type)) {
    windowListeners.set(type, new Set());
  }
  windowListeners.get(type)!.add(listener);
}

function mockRemoveEventListener(type: string, listener: (e: Event) => void) {
  windowListeners.get(type)?.delete(listener);
}

function mockDispatchEvent(event: Event): boolean {
  const set = windowListeners.get(event.type);
  if (set) {
    for (const l of Array.from(set)) {
      l(event);
    }
  }
  return true;
}

// Global browser environment setup
globalThis.window = {
  location: { href: "https://chatgpt.com/c/test-lifecycle-123" },
  sessionStorage: {
    getItem: (key: string) => mockSessionStorage[key] ?? null,
    setItem: (key: string, val: string) => {
      mockSessionStorage[key] = val;
    },
    removeItem: (key: string) => {
      delete mockSessionStorage[key];
    },
    clear: () => {
      mockSessionStorage = {};
    },
    get length() {
      return Object.keys(mockSessionStorage).length;
    },
    key: (index: number) => Object.keys(mockSessionStorage)[index] ?? null,
  },
  addEventListener: mockAddEventListener,
  removeEventListener: mockRemoveEventListener,
  dispatchEvent: mockDispatchEvent,
} as unknown as Window & typeof globalThis;

globalThis.CustomEvent = class CustomEvent extends Event {
  public detail: unknown;
  constructor(type: string, params?: { detail?: unknown }) {
    super(type);
    this.detail = params?.detail;
  }
} as unknown as typeof CustomEvent;

globalThis.chrome = {
  get runtime() {
    if (runtimeInvalidated) {
      throw new Error("Extension context invalidated.");
    }
    return {
      id: "mock-extension-id-12345",
      get lastError() {
        return null;
      },
    };
  },
  storage: {
    local: {
      get: (keys: string | string[] | null) => {
        if (runtimeInvalidated) {
          return Promise.reject(new Error("Extension context invalidated."));
        }
        if (storageThrowError) {
          return Promise.reject(storageThrowError);
        }
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
        if (runtimeInvalidated) {
          return Promise.reject(new Error("Extension context invalidated."));
        }
        if (storageThrowError) {
          return Promise.reject(storageThrowError);
        }
        Object.assign(mockLocalStorage, items);
        return Promise.resolve();
      },
      remove: (keys: string | string[]) => {
        if (runtimeInvalidated) {
          return Promise.reject(new Error("Extension context invalidated."));
        }
        if (storageThrowError) {
          return Promise.reject(storageThrowError);
        }
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete mockLocalStorage[k];
        return Promise.resolve();
      },
    },
  },
} as unknown as typeof chrome;

describe("Extension Context Lifecycle & Storage Invalidation Handling", () => {
  beforeEach(() => {
    mockLocalStorage = { memoryEnabled: true };
    mockSessionStorage = {};
    storageThrowError = null;
    runtimeInvalidated = false;
    globalThis.window.location.href = "https://chatgpt.com/c/test-lifecycle-123";
    resetWindowListeners();
  });


  // 1. Extension context invalidation during an active capture
  test("1. Extension context invalidation during an active capture: returns explicit failure and caches in DOM", async () => {
    assert.strictEqual(isExtensionContextValid(), true);

    const session: CapturedConversation = createCaptureSession(
      "chatgpt",
      "Active Capture Invalidation",
      "https://chatgpt.com/c/act-101",
      "act-101"
    );
    const updated = ingestMessage(session, {
      id: "usr-msg-101",
      role: "user",
      content: "Explain transformer self-attention.",
    });

    // Invalidate context right before/during save attempt
    runtimeInvalidated = true;

    assert.strictEqual(isExtensionContextValid(), false, "Context should now be invalid");

    const saveResult = await saveActiveCaptureSession(updated);

    assert.strictEqual(saveResult.success, false, "Save must return explicit failure result");
    assert.strictEqual(saveResult.isContextInvalidated, true, "Must flag isContextInvalidated as true");
    assert.strictEqual(isExtensionContextInvalidatedError(new Error("Extension context invalidated.")), true);
    assert.match(saveResult.error ?? "", /context invalidated/i);

    // Caller safely caches unsaved state to DOM sessionStorage
    const preserved = preservePendingSessionInDOM(updated);
    assert.strictEqual(preserved, true, "Session must be safely preserved in DOM cache");
    assert.notStrictEqual(mockSessionStorage["vz_pending_session_act-101"], undefined);

    // Reading session when context is dead safely returns null
    const loaded = await getActiveCaptureSession();
    assert.strictEqual(loaded, null, "Must safely return null on invalidated context");
  });

  // 2. Extension context invalidation during assistant streaming
  test("2. Extension context invalidation during assistant streaming: interrupts stream cleanly without data corruption", async () => {
    const session = createCaptureSession(
      "chatgpt",
      "Streaming Invalidation",
      "https://chatgpt.com/c/stream-202",
      "stream-202"
    );
    let streamingSession = ingestMessage(session, {
      id: "usr-msg-202",
      role: "user",
      content: "Generate a summary of quantum mechanics.",
    });

    streamingSession = startAssistantStream(
      streamingSession,
      "asst-msg-202",
      "Quantum mechanics is "
    );
    assert.strictEqual(streamingSession.state, "response_in_progress");

    streamingSession = appendAssistantChunk(streamingSession, "a fundamental theory in physics ");
    streamingSession = appendAssistantChunk(streamingSession, "describing nature at atomic scales.");

    // Context becomes invalidated mid-stream
    runtimeInvalidated = true;

    const lifecycle = new ContentScriptLifecycle("cs-streaming");
    assert.strictEqual(lifecycle.isAlive(), false, "Lifecycle must detect invalidation");
    assert.strictEqual(lifecycle.isDisposed(), true);

    // Assistant stream is marked interrupted with error
    const interrupted = interruptStream(
      streamingSession,
      "Extension context invalidated during response stream."
    );
    assert.strictEqual(interrupted.state, "interrupted");
    assert.strictEqual(interrupted.isComplete, false);

    // Attempting to persist active capture session returns clean error
    const saveResult = await saveActiveCaptureSession(interrupted);
    assert.strictEqual(saveResult.success, false);
    assert.strictEqual(saveResult.isContextInvalidated, true);

    // Stream content up to interruption is preserved in DOM cache
    preservePendingSessionInDOM(interrupted);
    const recovered = recoverPendingSessionsFromDOM();
    assert.strictEqual(recovered.length, 1);
    assert.strictEqual(recovered[0].id, "stream-202");
    assert.strictEqual(recovered[0].messages.length, 2);
    assert.ok(recovered[0].messages[1].content.includes("atomic scales"));
  });

  // 3. Navigation while a save operation is pending
  test("3. Navigation while a save operation is pending: preserves isolation and rejects stale association", async () => {
    const sessionA = createCaptureSession(
      "chatgpt",
      "Conversation A",
      "https://chatgpt.com/c/conv-A",
      "conv-A"
    );

    // User is on Conversation A
    globalThis.window.location.href = "https://chatgpt.com/c/conv-A";
    assert.strictEqual(isSessionMatchingActiveTab(sessionA, globalThis.window.location.href, "conv-A"), true);

    // User navigates to Conversation B while an operation is pending
    globalThis.window.location.href = "https://chatgpt.com/c/conv-B";

    // Evaluation for the active tab conversation B
    const matchesNewTab = isSessionMatchingActiveTab(
      sessionA,
      globalThis.window.location.href,
      "conv-B"
    );
    assert.strictEqual(matchesNewTab, false, "Pending session A must NEVER match active tab B");
  });

  // 4. Conversation switching while a stream callback is pending
  test("4. Conversation switching while a stream callback is pending: routes strictly by ID without bleeding turns", () => {
    let sessionA = createCaptureSession("chatgpt", "Chat A", "https://chatgpt.com/c/conv-A", "conv-A");
    sessionA = ingestMessage(sessionA, { id: "turn-A1", role: "user", content: "Query in A" });
    sessionA = startAssistantStream(sessionA, "turn-A2", "Partial answer in A");

    let sessionB = createCaptureSession("chatgpt", "Chat B", "https://chatgpt.com/c/conv-B", "conv-B");
    sessionB = ingestMessage(sessionB, { id: "turn-B1", role: "user", content: "Query in B" });

    // Store in conversation map
    const sessions = new Map<string, CapturedConversation>();
    sessions.set("conv-A", sessionA);
    sessions.set("conv-B", sessionB);

    // Trailing stream callback for Conversation A arrives after tab navigated to B
    const trailingChunk = " — additional trailing text for A";
    const targetA = sessions.get("conv-A");
    assert.ok(targetA);
    const updatedA = appendAssistantChunk(targetA, trailingChunk);
    sessions.set("conv-A", updatedA);

    // Verify: Session B has NOT received text from A
    const currentB = sessions.get("conv-B");
    assert.ok(currentB);
    assert.strictEqual(currentB.messages.length, 1);
    assert.strictEqual(currentB.messages[0].content, "Query in B");

    // Verify: Session A has received text in its own session only
    const currentA = sessions.get("conv-A");
    assert.ok(currentA);
    assert.ok(currentA.messages[1].content.includes("trailing text for A"));
  });

  // 5. Storage quota failure
  test("5. Storage quota failure: reports error without falsely claiming context invalidation", async () => {
    storageThrowError = new Error("QUOTA_BYTES quota exceeded");

    const session = createCaptureSession("chatgpt", "Large Session", "https://chatgpt.com/c/lg-200", "lg-200");
    const saveResult = await saveActiveCaptureSession(session);

    assert.strictEqual(saveResult.success, false, "Save must fail on quota error");
    assert.strictEqual(saveResult.isContextInvalidated, false, "Quota error is not context invalidation");
    assert.match(saveResult.error ?? "", /QUOTA_BYTES/);
  });

  // 6. Repeated invalidation errors do not create notification spam
  test("6. Repeated invalidation errors do not create notification spam", async () => {
    runtimeInvalidated = true;

    const lifecycle = new ContentScriptLifecycle("cs-spam-test");
    let disposeCallCount = 0;
    lifecycle.onTeardown(() => {
      disposeCallCount++;
    });

    // First liveness check detects invalidation and disposes
    assert.strictEqual(lifecycle.isAlive(), false);
    assert.strictEqual(lifecycle.isDisposed(), true);
    assert.strictEqual(disposeCallCount, 1, "Teardown must fire exactly once");

    // 25 rapid subsequent checks or events
    for (let i = 0; i < 25; i++) {
      assert.strictEqual(lifecycle.isAlive(), false);
    }

    // Teardown callback must NOT fire repeatedly
    assert.strictEqual(disposeCallCount, 1, "Must never fire multiple teardowns");

    // Repeated save calls safely return failure without throwing unhandled rejections
    const session = createCaptureSession("chatgpt", "Chat", "https://chatgpt.com/c/spam-test", "spam-test");
    for (let i = 0; i < 5; i++) {
      const res = await saveActiveCaptureSession(session);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.isContextInvalidated, true);
    }
  });

  // 7. Valid storage operations still persist messages normally
  test("7. Valid storage operations still persist messages normally", async () => {
    assert.strictEqual(isExtensionContextValid(), true);

    let session = createCaptureSession("chatgpt", "Normal Conversation", "https://chatgpt.com/c/norm-707", "norm-707");
    session = ingestMessage(session, {
      id: "usr-norm-1",
      role: "user",
      content: "Explain binary search.",
    });
    session = startAssistantStream(session, "asst-norm-1", "Binary search is ");
    session = appendAssistantChunk(session, "an O(log n) search algorithm.");
    session = completeAssistantStream(session);

    // Save active capture session
    const saveResult = await saveActiveCaptureSession(session);
    assert.strictEqual(saveResult.success, true);
    assert.strictEqual(saveResult.isContextInvalidated, undefined);

    // Load active capture session
    const loaded = await getActiveCaptureSession();
    assert.notStrictEqual(loaded, null);
    assert.strictEqual(loaded!.id, "norm-707");
    assert.strictEqual(loaded!.messages.length, 2);
    assert.strictEqual(loaded!.messages[0].content, "Explain binary search.");
    assert.strictEqual(loaded!.messages[1].content, "Binary search is an O(log n) search algorithm.");

    // Clear active capture session
    const clearResult = await clearActiveCaptureSession();
    assert.strictEqual(clearResult.success, true);

    const cleared = await getActiveCaptureSession();
    assert.strictEqual(cleared, null);
  });

  // 8. No stale callback writes into a different conversation
  test("8. No stale callback writes into a different conversation", async () => {
    const convA: Conversation = {
      id: "conv-A-isolated",
      platform: "chatgpt",
      capturedAt: new Date().toISOString(),
      messages: [
        { id: "msg-A1", role: "user", content: "Question for A" },
        { id: "msg-A2", role: "assistant", content: "Answer for A" },
      ],
    };

    const convB: Conversation = {
      id: "conv-B-isolated",
      platform: "chatgpt",
      capturedAt: new Date().toISOString(),
      messages: [
        { id: "msg-B1", role: "user", content: "Question for B" },
      ],
    };

    await saveConversation(convA);
    await saveConversation(convB);

    // Stale delayed callback tries to write an additional turn for Conv A
    const convAUpdate: Conversation = {
      ...convA,
      messages: [
        ...convA.messages,
        { id: "msg-A3", role: "user", content: "Followup in A" },
      ],
    };
    await saveConversation(convAUpdate);

    // Query both conversations
    const all = await getConversations();
    const storedA = all.find((c) => c.id === "conv-A-isolated");
    const storedB = all.find((c) => c.id === "conv-B-isolated");

    assert.ok(storedA);
    assert.ok(storedB);

    // Verify Conv B is untouched and isolated
    assert.strictEqual(storedB.messages.length, 1);
    assert.strictEqual(storedB.messages[0].id, "msg-B1");
    assert.strictEqual(storedB.messages.some((m) => m.id.startsWith("msg-A")), false);

    // Verify Conv A has its 3 messages
    assert.strictEqual(storedA.messages.length, 3);
  });

  // 9. Incomplete snapshot cannot overwrite previously saved complete message
  test("9. Incomplete snapshot cannot overwrite previously saved complete message", async () => {
    const completeConv: Conversation = {
      id: "conv-snapshot-test",
      platform: "chatgpt",
      capturedAt: new Date().toISOString(),
      messages: [
        { id: "m-user", role: "user", content: "Write a poem about stars." },
        {
          id: "m-asst",
          role: "assistant",
          content: "Stars shine in the midnight sky with eternal brilliance and wonder.",
        },
      ],
      completeness: "complete",
    };

    await saveConversation(completeConv);

    // Incoming partial snapshot with same assistant message ID but truncated text
    const partialSnapshot: Conversation = {
      id: "conv-snapshot-test",
      platform: "chatgpt",
      capturedAt: new Date().toISOString(),
      messages: [
        { id: "m-user", role: "user", content: "Write a poem about stars." },
        { id: "m-asst", role: "assistant", content: "Stars shine" },
      ],
      completeness: "partial",
    };

    await saveConversation(partialSnapshot);

    const all = await getConversations();
    const stored = all.find((c) => c.id === "conv-snapshot-test");
    assert.ok(stored);
    assert.strictEqual(
      stored.messages[1].content,
      "Stars shine in the midnight sky with eternal brilliance and wonder.",
      "Complete message content must not be overwritten by shorter partial snapshot"
    );
    assert.strictEqual(stored.completeness, "complete");
  });

  // 10. Pending writes during teardown and DOM cache recovery
  test("10. Pending writes during teardown and DOM cache recovery without duplicates", () => {
    const original = createCaptureSession("chatgpt", "Recovery Chat", "https://chatgpt.com/c/rec-500", "rec-500");
    const turn1 = ingestMessage(original, {
      id: "stable-turn-1",
      sourceMessageId: "stable-turn-1",
      role: "user",
      content: "First turn",
    });
    const turn2 = ingestMessage(turn1, {
      id: "stable-turn-2",
      sourceMessageId: "stable-turn-2",
      role: "assistant",
      content: "First answer",
    });

    // Save to DOM cache as if interrupted
    preservePendingSessionInDOM(turn2);

    // New generation recovers
    const recoveredList = recoverPendingSessionsFromDOM();
    assert.strictEqual(recoveredList.length, 1);
    assert.strictEqual(recoveredList[0].id, "rec-500");
    assert.strictEqual(recoveredList[0].messages.length, 2);

    // Cache should now be cleared
    assert.strictEqual(mockSessionStorage["vz_pending_session_rec-500"], undefined);

    // Replay/re-ingest turn 2 (simulating duplicate event arriving)
    let rehydrated = recoveredList[0];
    rehydrated = ingestMessage(rehydrated, {
      id: "stable-turn-2",
      sourceMessageId: "stable-turn-2",
      role: "assistant",
      content: "First answer",
    });

    // Plus turn 3
    rehydrated = ingestMessage(rehydrated, {
      id: "stable-turn-3",
      sourceMessageId: "stable-turn-3",
      role: "user",
      content: "Second question",
    });

    // Assert: deduplicated! Exactly 3 messages total, not 4
    assert.strictEqual(rehydrated.messages.length, 3, "Turn 2 must be deduplicated by stable ID");
    const metrics = computeConversationMetrics(rehydrated.messages);
    assert.strictEqual(metrics.humanCount, 2);
    assert.strictEqual(metrics.assistantCount, 1);
    assert.strictEqual(metrics.totalValidCount, 3);
  });

  // 11. New content-script initialization retires older orphaned instances
  test("11. New content-script initialization retires older orphaned instances", () => {
    const csGen1 = new ContentScriptLifecycle("gen-1");
    let gen1Retired = false;

    // Listen for reinit events on window
    const onReinit = (event: Event) => {
      const customEvent = event as CustomEvent<{ lifecycleId?: string }>;
      if (customEvent.detail && customEvent.detail.lifecycleId !== csGen1.lifecycleId) {
        csGen1.dispose("Replaced by newer content script instance");
        gen1Retired = true;
      }
    };
    mockAddEventListener(CONTENT_SCRIPT_REINIT_EVENT, onReinit);
    csGen1.onTeardown(() => mockRemoveEventListener(CONTENT_SCRIPT_REINIT_EVENT, onReinit));

    assert.strictEqual(csGen1.isAlive(), true);

    // CS Gen 2 initializes
    const csGen2 = new ContentScriptLifecycle("gen-2");
    mockDispatchEvent(
      new CustomEvent(CONTENT_SCRIPT_REINIT_EVENT, {
        detail: { lifecycleId: csGen2.lifecycleId },
      })
    );

    // Assert: Gen 1 retired automatically
    assert.strictEqual(gen1Retired, true, "Gen 1 should retire on Gen 2 initialization");
    assert.strictEqual(csGen1.isDisposed(), true);
    assert.strictEqual(csGen1.isAlive(), false);
    assert.strictEqual(csGen2.isAlive(), true, "Gen 2 must remain alive as the sole active script");
  });

  // 12. No false successful-save notifications when storage persistence fails
  test("12. No false successful-save notifications when storage persistence fails", async () => {
    storageThrowError = new Error("Internal Chrome storage failure");

    let notifiedSuccess = false;
    let reportedFailure = false;

    const session = createCaptureSession("chatgpt", "Failure Chat", "https://chatgpt.com/c/fail-700", "fail-700");

    const result = await saveActiveCaptureSession(session);

    if (result.success) {
      notifiedSuccess = true;
    } else {
      reportedFailure = true;
    }

    assert.strictEqual(notifiedSuccess, false, "Must never report successful save when write fails");
    assert.strictEqual(reportedFailure, true, "Must acknowledge failure to caller");
    assert.strictEqual(result.success, false);
  });
});
