/**
 * milestone1CutoffVerification.test.ts
 *
 * Targeted tests for Milestone 1 Blocker Fixes & Final Legacy Authorization Correction:
 * 1. Successful cutoff persistence returns success only after read-back verification.
 * 2. Failed storage write returns failure and never transitions to OFF.
 * 3. Read-back mismatch (session ID) returns failure and never transitions to OFF.
 * 4. A same-length but different-message read-back snapshot is rejected.
 * 5. A valid closed/active epoch passes the cutoff exception.
 * 6. An invalidated epoch is rejected.
 * 7. Missing registry keys do not automatically grant legacy authorization.
 * 8. Corrupted registry data fails closed.
 * 9. An epoch-aware session with a missing or stripped epoch ID is rejected.
 * 10. A malformed epoch ID is rejected.
 * 11. Genuine explicitly identified legacy sessions retain the intended compatibility behavior.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  saveActiveCaptureSession,
  getActiveCaptureSession,
  EPOCH_REGISTRY_KEY,
  ACTIVE_EPOCH_KEY,
} from "../src/storage/conversationStorage.ts";
import {
  createCaptureSession,
  interruptStream,
} from "../src/continuity/captureLifecycle.ts";
import {
  PRIVACY_CUTOFF_SENTINEL,
  type EpochRegistry,
  type CapturedConversation,
} from "../src/continuity/captureTypes.ts";

// ---------------------------------------------------------------------------
// In-memory mock for chrome.storage.local with fault injection capabilities
// ---------------------------------------------------------------------------
const mockStorage = new Map<string, unknown>();
let injectSetError: Error | null = null;
let corruptOnSet = false;
let corruptMessagesOnSet = false;

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
        if (injectSetError) {
          const err = injectSetError;
          injectSetError = null;
          throw err;
        }
        for (const [k, v] of Object.entries(items)) {
          if (k === "activeCaptureSession" && corruptOnSet) {
            mockStorage.set(k, { ...(v as object), id: "corrupted-session-id" });
            corruptOnSet = false;
            continue;
          }
          if (k === "activeCaptureSession" && corruptMessagesOnSet) {
            const sess = v as CapturedConversation;
            const altered = sess.messages.map((m, idx) =>
              idx === 0 ? { ...m, content: "Tampered content that does not match original cutoff" } : m
            );
            mockStorage.set(k, { ...sess, messages: altered });
            corruptMessagesOnSet = false;
            continue;
          }
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

// Valid UUID v4 strings matching EPOCH_ID_REGEX
const VALID_EPOCH_ID = "3847f98d-0000-4000-8000-000000000001";
const CLOSED_EPOCH_ID = "3847f98d-0000-4000-8000-000000000002";
const INVALIDATED_EPOCH_ID = "3847f98d-0000-4000-8000-000000000003";

describe("Milestone 1 Blocker Verification Tests", () => {
  beforeEach(() => {
    mockStorage.clear();
    injectSetError = null;
    corruptOnSet = false;
    corruptMessagesOnSet = false;
  });

  test("1. Successful cutoff persistence returns success only after read-back verification", async () => {
    // Setup epoch registry with active epoch
    const registry: EpochRegistry = {
      [VALID_EPOCH_ID]: {
        epochId: VALID_EPOCH_ID,
        status: "active",
        createdAt: Date.now(),
        createdBy: "popup",
        closedAt: null,
        invalidatedAt: null,
        reason: null,
      },
    };
    mockStorage.set("memoryEnabled", false);
    mockStorage.set(EPOCH_REGISTRY_KEY, registry);
    mockStorage.set(ACTIVE_EPOCH_KEY, VALID_EPOCH_ID);

    const session = createCaptureSession("chatgpt", "Verification Test", "https://chatgpt.com/c/test", "test-conv-1");
    session.epochId = VALID_EPOCH_ID;
    session.state = "response_in_progress";
    session.messages = [
      {
        id: "msg-1",
        sequence: 1,
        role: "user",
        content: "Hello",
        timestamp: new Date().toISOString(),
      },
      {
        id: "msg-2",
        sequence: 2,
        role: "assistant",
        content: "In-progress response chunk",
        timestamp: new Date().toISOString(),
        isInProgress: true,
      },
    ];

    const cutoff = interruptStream(session, PRIVACY_CUTOFF_SENTINEL);
    cutoff.epochId = VALID_EPOCH_ID;

    const result = await saveActiveCaptureSession(cutoff);
    assert.strictEqual(result.success, true, "Cutoff persistence must succeed");

    // Read back directly to verify storage matches
    const stored = await getActiveCaptureSession();
    assert.ok(stored, "Stored session must exist");
    assert.strictEqual(stored.id, "test-conv-1");
    assert.strictEqual(stored.epochId, VALID_EPOCH_ID);
    assert.strictEqual(stored.state, "interrupted");
    assert.strictEqual(stored.error, PRIVACY_CUTOFF_SENTINEL);
    assert.strictEqual(stored.messages.length, 2);
  });

  test("2. Failed storage write returns failure and never transitions to OFF", async () => {
    const registry: EpochRegistry = {
      [VALID_EPOCH_ID]: {
        epochId: VALID_EPOCH_ID,
        status: "active",
        createdAt: Date.now(),
        createdBy: "popup",
      },
    };
    mockStorage.set("memoryEnabled", false);
    mockStorage.set(EPOCH_REGISTRY_KEY, registry);
    mockStorage.set(ACTIVE_EPOCH_KEY, VALID_EPOCH_ID);

    const session = createCaptureSession("chatgpt", "Failure Test", null, "test-conv-fail");
    session.epochId = VALID_EPOCH_ID;
    const cutoff = interruptStream(session, PRIVACY_CUTOFF_SENTINEL);
    cutoff.epochId = VALID_EPOCH_ID;

    // Inject storage write failure (disk error / quota exceeded)
    injectSetError = new Error("QUOTA_BYTES_PER_ITEM exceeded");

    const result = await saveActiveCaptureSession(cutoff);
    assert.strictEqual(result.success, false, "Must return failure when storage write fails");
    assert.ok(result.error?.includes("QUOTA_BYTES_PER_ITEM"), "Error must report underlying write failure");
  });

  test("3. Read-back mismatch (session ID) returns failure and never transitions to OFF", async () => {
    const registry: EpochRegistry = {
      [VALID_EPOCH_ID]: {
        epochId: VALID_EPOCH_ID,
        status: "active",
        createdAt: Date.now(),
        createdBy: "popup",
      },
    };
    mockStorage.set("memoryEnabled", false);
    mockStorage.set(EPOCH_REGISTRY_KEY, registry);
    mockStorage.set(ACTIVE_EPOCH_KEY, VALID_EPOCH_ID);

    const session = createCaptureSession("chatgpt", "Mismatch Test", null, "test-conv-mismatch");
    session.epochId = VALID_EPOCH_ID;
    const cutoff = interruptStream(session, PRIVACY_CUTOFF_SENTINEL);
    cutoff.epochId = VALID_EPOCH_ID;

    // Simulate storage mismatch on write
    corruptOnSet = true;

    const result = await saveActiveCaptureSession(cutoff);
    assert.strictEqual(result.success, false, "Must fail if read-back verification detects a mismatch");
    assert.ok(
      result.error?.includes("read-back verification failed"),
      "Error must identify read-back verification failure"
    );
  });

  test("4. A same-length but different-message read-back snapshot is rejected", async () => {
    const registry: EpochRegistry = {
      [VALID_EPOCH_ID]: {
        epochId: VALID_EPOCH_ID,
        status: "active",
        createdAt: Date.now(),
        createdBy: "popup",
      },
    };
    mockStorage.set("memoryEnabled", false);
    mockStorage.set(EPOCH_REGISTRY_KEY, registry);
    mockStorage.set(ACTIVE_EPOCH_KEY, VALID_EPOCH_ID);

    const session = createCaptureSession("chatgpt", "Content Check", null, "test-conv-content");
    session.epochId = VALID_EPOCH_ID;
    session.state = "response_in_progress";
    session.messages = [
      {
        id: "msg-1",
        sequence: 1,
        role: "user",
        content: "What is quantum tunneling?",
        timestamp: new Date().toISOString(),
      },
      {
        id: "msg-2",
        sequence: 2,
        role: "assistant",
        content: "Quantum tunneling is a quantum mechanical phenomenon...",
        timestamp: new Date().toISOString(),
        isInProgress: true,
      },
    ];

    const cutoff = interruptStream(session, PRIVACY_CUTOFF_SENTINEL);
    cutoff.epochId = VALID_EPOCH_ID;

    // Simulate same-length array with altered message content on storage write
    corruptMessagesOnSet = true;

    const result = await saveActiveCaptureSession(cutoff);
    assert.strictEqual(result.success, false, "Must reject read-back snapshot if message content was altered");
    assert.ok(
      result.error?.includes("message content mismatch"),
      `Error must specify message content mismatch, got: ${result.error}`
    );
  });

  test("5. A valid closed/active epoch passes the cutoff exception", async () => {
    const registry: EpochRegistry = {
      [VALID_EPOCH_ID]: {
        epochId: VALID_EPOCH_ID,
        status: "active",
        createdAt: Date.now(),
        createdBy: "popup",
      },
      [CLOSED_EPOCH_ID]: {
        epochId: CLOSED_EPOCH_ID,
        status: "closed",
        createdAt: Date.now() - 5000,
        closedAt: Date.now(),
        createdBy: "popup",
      },
    };
    mockStorage.set("memoryEnabled", false);
    mockStorage.set(EPOCH_REGISTRY_KEY, registry);

    // Active epoch session
    const activeSession = createCaptureSession("chatgpt", "Active Epoch", null, "active-conv");
    activeSession.epochId = VALID_EPOCH_ID;
    const activeCutoff = interruptStream(activeSession, PRIVACY_CUTOFF_SENTINEL);
    activeCutoff.epochId = VALID_EPOCH_ID;

    const activeResult = await saveActiveCaptureSession(activeCutoff);
    assert.strictEqual(activeResult.success, true, "Active epoch cutoff must be accepted");

    // Closed epoch session
    const closedSession = createCaptureSession("chatgpt", "Closed Epoch", null, "closed-conv");
    closedSession.epochId = CLOSED_EPOCH_ID;
    const closedCutoff = interruptStream(closedSession, PRIVACY_CUTOFF_SENTINEL);
    closedCutoff.epochId = CLOSED_EPOCH_ID;

    const closedResult = await saveActiveCaptureSession(closedCutoff);
    assert.strictEqual(closedResult.success, true, "Closed epoch cutoff must be accepted");
  });

  test("6. An invalidated epoch is rejected", async () => {
    const registry: EpochRegistry = {
      [INVALIDATED_EPOCH_ID]: {
        epochId: INVALIDATED_EPOCH_ID,
        status: "invalidated",
        createdAt: Date.now() - 10000,
        invalidatedAt: Date.now() - 2000,
        reason: "Emergency revocation",
        createdBy: "popup",
      },
    };
    mockStorage.set("memoryEnabled", false);
    mockStorage.set(EPOCH_REGISTRY_KEY, registry);

    const session = createCaptureSession("chatgpt", "Invalidated Test", null, "inv-conv");
    session.epochId = INVALIDATED_EPOCH_ID;
    const cutoff = interruptStream(session, PRIVACY_CUTOFF_SENTINEL);
    cutoff.epochId = INVALIDATED_EPOCH_ID;

    const result = await saveActiveCaptureSession(cutoff);
    assert.strictEqual(result.success, false, "Cutoff with invalidated epoch must be rejected");
    assert.ok(result.error?.includes("Capture is not enabled"), "Must be rejected at privacy boundary");
  });

  test("7. Missing registry keys do not automatically grant legacy authorization", async () => {
    // Storage has NO registry keys (e.g. storage wipe, quota eviction, or uninitialized storage)
    mockStorage.set("memoryEnabled", false);
    assert.strictEqual(mockStorage.get(EPOCH_REGISTRY_KEY), undefined);

    // Session has no epochId and no explicit legacy marker
    const unauthenticatedSession = createCaptureSession("chatgpt", "No Epoch Session", null, "unauth-conv");
    delete (unauthenticatedSession as Partial<typeof unauthenticatedSession>).epochId;
    delete (unauthenticatedSession as Partial<typeof unauthenticatedSession>).schemaVersion;

    const cutoff = interruptStream(unauthenticatedSession, PRIVACY_CUTOFF_SENTINEL);
    delete (cutoff as Partial<typeof cutoff>).epochId;
    delete (cutoff as Partial<typeof cutoff>).schemaVersion;

    const result = await saveActiveCaptureSession(cutoff);
    assert.strictEqual(
      result.success,
      false,
      "Missing registry keys must NOT grant legacy authorization to unauthenticated sessions"
    );
  });

  test("8. Corrupted registry data fails closed", async () => {
    // Corrupted registry: registry is stored as a string instead of an object
    mockStorage.set("memoryEnabled", false);
    mockStorage.set(EPOCH_REGISTRY_KEY, "corrupted_non_object_string");

    const session1 = createCaptureSession("chatgpt", "Corrupt Test 1", null, "corrupt-conv-1");
    session1.epochId = VALID_EPOCH_ID;
    const cutoff1 = interruptStream(session1, PRIVACY_CUTOFF_SENTINEL);
    cutoff1.epochId = VALID_EPOCH_ID;

    const result1 = await saveActiveCaptureSession(cutoff1);
    assert.strictEqual(result1.success, false, "Corrupted string registry must fail closed");

    // Corrupted registry: registry object contains malformed/invalid records
    mockStorage.set(EPOCH_REGISTRY_KEY, {
      [VALID_EPOCH_ID]: { corruptedRecord: true, status: "unknown" },
    });

    const result2 = await saveActiveCaptureSession(cutoff1);
    assert.strictEqual(result2.success, false, "Corrupted record in registry must fail closed");
  });

  test("9. An epoch-aware session with a missing or stripped epoch ID is rejected", async () => {
    const registry: EpochRegistry = {
      [VALID_EPOCH_ID]: {
        epochId: VALID_EPOCH_ID,
        status: "active",
        createdAt: Date.now(),
        createdBy: "popup",
      },
    };
    mockStorage.set("memoryEnabled", false);
    mockStorage.set(EPOCH_REGISTRY_KEY, registry);
    mockStorage.set(ACTIVE_EPOCH_KEY, VALID_EPOCH_ID);

    // Session missing epochId entirely in epoch-aware environment
    const strippedSession = createCaptureSession("chatgpt", "Stripped Test", null, "stripped-conv");
    delete (strippedSession as Partial<typeof strippedSession>).epochId;
    const cutoff1 = interruptStream(strippedSession, PRIVACY_CUTOFF_SENTINEL);
    delete (cutoff1 as Partial<typeof cutoff1>).epochId;

    const result1 = await saveActiveCaptureSession(cutoff1);
    assert.strictEqual(result1.success, false, "Missing epochId in epoch-aware storage must be rejected");

    // Session with empty string epochId
    const emptyEpochSession = createCaptureSession("chatgpt", "Empty Epoch Test", null, "empty-conv");
    emptyEpochSession.epochId = "";
    const cutoff2 = interruptStream(emptyEpochSession, PRIVACY_CUTOFF_SENTINEL);
    cutoff2.epochId = "";

    const result2 = await saveActiveCaptureSession(cutoff2);
    assert.strictEqual(result2.success, false, "Empty epochId in epoch-aware storage must be rejected");
  });

  test("10. A malformed epoch ID is rejected", async () => {
    const registry: EpochRegistry = {
      [VALID_EPOCH_ID]: {
        epochId: VALID_EPOCH_ID,
        status: "active",
        createdAt: Date.now(),
        createdBy: "popup",
      },
    };
    mockStorage.set("memoryEnabled", false);
    mockStorage.set(EPOCH_REGISTRY_KEY, registry);

    const session = createCaptureSession("chatgpt", "Malformed Test", null, "malformed-conv");
    session.epochId = "invalid_not-a-uuid-format";
    const cutoff = interruptStream(session, PRIVACY_CUTOFF_SENTINEL);
    cutoff.epochId = "invalid_not-a-uuid-format";

    const result = await saveActiveCaptureSession(cutoff);
    assert.strictEqual(result.success, false, "Malformed epochId must be rejected");
  });

  test("11. Genuine explicitly identified legacy sessions retain the intended compatibility behavior", async () => {
    mockStorage.set("memoryEnabled", false);

    // Case A: Explicit schemaVersion: "1.0"
    const legacySessionA = {
      ...createCaptureSession("chatgpt", "Legacy Session A", null, "legacy-conv-a"),
      schemaVersion: "1.0" as const,
    };
    delete (legacySessionA as Partial<typeof legacySessionA>).epochId;

    const cutoffA = interruptStream(legacySessionA, PRIVACY_CUTOFF_SENTINEL);
    cutoffA.schemaVersion = "1.0";
    delete (cutoffA as Partial<typeof cutoffA>).epochId;

    const resultA = await saveActiveCaptureSession(cutoffA);
    assert.strictEqual(resultA.success, true, "Legacy session with schemaVersion '1.0' must be accepted");

    // Case B: Explicit isLegacySession: true
    const legacySessionB = {
      ...createCaptureSession("chatgpt", "Legacy Session B", null, "legacy-conv-b"),
      isLegacySession: true,
    };
    delete (legacySessionB as Partial<typeof legacySessionB>).epochId;

    const cutoffB = interruptStream(legacySessionB, PRIVACY_CUTOFF_SENTINEL);
    cutoffB.isLegacySession = true;
    delete (cutoffB as Partial<typeof cutoffB>).epochId;

    const resultB = await saveActiveCaptureSession(cutoffB);
    assert.strictEqual(resultB.success, true, "Legacy session with isLegacySession: true must be accepted");

    // Verify stored session maintains state and sentinel
    const stored = await getActiveCaptureSession();
    assert.ok(stored);
    assert.strictEqual(stored.id, "legacy-conv-b");
    assert.strictEqual(stored.state, "interrupted");
    assert.strictEqual(stored.error, PRIVACY_CUTOFF_SENTINEL);
  });
});
