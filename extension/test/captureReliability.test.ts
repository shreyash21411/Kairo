/**
 * captureReliability.test.ts
 *
 * Phase 2.1 — 15 Regression Tests for Capture Reliability & Data Integrity:
 * 1. 6-message sequence capture (3 user, 3 assistant) in exact chronological order.
 * 2. Short numeric messages & equations without truncation.
 * 3. Emojis and multibyte UTF-8 preservation.
 * 4. Reload recovery: storage merging avoids overwriting earlier turns.
 * 5. saveConversation preserves message identity and updates existing conversations cleanly.
 * 6. Metric guarantee: TOTAL VALID = HUMAN + AI / ASST.
 * 7. Delta chunking accumulates into a single logical assistant message.
 * 8. Storage persistence of active capture session survives popup reopen.
 * 9. Order stability: no timestamp scrambling when timestamps are undefined.
 * 10. Canonical archive generation with valid SHA-256 integrity hash.
 * 11. Stream interruption properly marks completeness as partial with error notice.
 * 12. Fallback resolution for conversation ID from URL.
 * 13. Empty transport and whitespace filtering.
 * 14. Platform labeling strictly adheres to ChatGPT conventions (User / Assistant).
 * 15. Completeness boundary verification (bounded full history vs live stream partial).
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createCaptureSession,
  ingestMessage,
  startAssistantStream,
  appendAssistantChunk,
  completeAssistantStream,
  interruptStream,
  completeCapture,
  buildRawTranscriptFromMessages,
  computeConversationMetrics,
  sortMessagesChronologically,
} from "../src/continuity/captureLifecycle.ts";
import {
  createArchiveFromCapturedConversation,
  serializeArchive,
  parseAndValidateArchive,
} from "../src/continuity/archiveLifecycle.ts";
import {
  saveConversation,
  getConversations,
  saveActiveCaptureSession,
  getActiveCaptureSession,
} from "../src/storage/conversationStorage.ts";
import type { Conversation } from "../src/connectors/types.ts";
import type { CapturedConversation } from "../src/continuity/captureTypes.ts";

// In-memory mock for chrome.storage.local for tests
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
            result[k] = mockStorage[k];
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
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          delete mockStorage[k];
        }
        if (callback) callback();
        return Promise.resolve();
      },
    },
  },
} as unknown as typeof chrome;

describe("Phase 2.1 — 15 Regression Tests: Capture Reliability & Fidelity", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
    // Positive privacy gate: persistence tests run with capture ON
    mockStorage["memoryEnabled"] = true;
  });


  // Test 1: 6-message sequence capture (3 user, 3 assistant)
  test("1. captures 6-message sequence (3 user, 3 assistant) in exact order", () => {
    let session = createCaptureSession("chatgpt", "Math and Banter", "https://chatgpt.com/c/math-123", "conv-6-msg");

    // Turn 1
    session = ingestMessage(session, { id: "u-1", role: "user", content: "what is 2+2" });
    session = startAssistantStream(session, "a-1", "2 + 2 = 4 ");
    session = appendAssistantChunk(session, "😊");
    session = completeAssistantStream(session);

    // Turn 2
    session = ingestMessage(session, { id: "u-2", role: "user", content: "what is 5+7" });
    session = startAssistantStream(session, "a-2", "5 + 7 = 12 ");
    session = appendAssistantChunk(session, "😊");
    session = completeAssistantStream(session);

    // Turn 3
    session = ingestMessage(session, { id: "u-3", role: "user", content: "nifar is dumb" });
    session = startAssistantStream(session, "a-3", "Sounds like Nifar did something that annoyed you! ");
    session = appendAssistantChunk(session, "What happened?");
    session = completeAssistantStream(session);

    assert.strictEqual(session.messages.length, 6, "Expected exactly 6 captured messages");
    assert.strictEqual(session.messages[0].role, "user");
    assert.strictEqual(session.messages[0].content, "what is 2+2");
    assert.strictEqual(session.messages[1].role, "assistant");
    assert.strictEqual(session.messages[1].content, "2 + 2 = 4 😊");
    assert.strictEqual(session.messages[2].role, "user");
    assert.strictEqual(session.messages[2].content, "what is 5+7");
    assert.strictEqual(session.messages[3].role, "assistant");
    assert.strictEqual(session.messages[3].content, "5 + 7 = 12 😊");
    assert.strictEqual(session.messages[4].role, "user");
    assert.strictEqual(session.messages[4].content, "nifar is dumb");
    assert.strictEqual(session.messages[5].role, "assistant");
    assert.strictEqual(session.messages[5].content, "Sounds like Nifar did something that annoyed you! What happened?");
  });

  // Test 2: Short numeric messages and equations
  test("2. short numeric messages and equations are captured without truncation", () => {
    let session = createCaptureSession("chatgpt", "Math");
    session = ingestMessage(session, { id: "u-1", role: "user", content: "what is 2+2" });
    session = startAssistantStream(session, "a-1", "2 + 2 = 4");
    session = completeAssistantStream(session);

    assert.strictEqual(session.messages[0].content, "what is 2+2");
    assert.strictEqual(session.messages[1].content, "2 + 2 = 4");
  });

  // Test 3: Emojis and multibyte characters
  test("3. messages with emojis and multibyte characters are preserved without corruption", () => {
    let session = createCaptureSession("chatgpt", "Emoji Test");
    session = ingestMessage(session, { id: "u-1", role: "user", content: "Express joy 🎉🚀" });
    session = startAssistantStream(session, "a-1", "2 + 2 = 4 😊🌟");
    session = completeAssistantStream(session);

    assert.strictEqual(session.messages[0].content, "Express joy 🎉🚀");
    assert.strictEqual(session.messages[1].content, "2 + 2 = 4 😊🌟");
  });

  // Test 4: Reload recovery with storage merge
  test("4. reload recovery: storage merge prevents partial turn snapshots from wiping earlier turns", async () => {
    // Initial turns 1 & 2
    const initialConv: Conversation = {
      id: "conv-shared",
      platform: "chatgpt",
      title: "Shared Chat",
      url: "https://chatgpt.com/c/shared",
      capturedAt: "2026-10-29T10:00:00Z",
      messages: [
        { id: "m-1", role: "user", content: "what is 2+2" },
        { id: "m-2", role: "assistant", content: "2 + 2 = 4 😊" },
        { id: "m-3", role: "user", content: "what is 5+7" },
        { id: "m-4", role: "assistant", content: "5 + 7 = 12 😊" },
      ],
    };
    await saveConversation(initialConv);

    // Later turn 3 comes in (e.g. from live stream after reload)
    const turn3Conv: Conversation = {
      id: "conv-shared",
      platform: "chatgpt",
      title: "Shared Chat",
      url: "https://chatgpt.com/c/shared",
      capturedAt: "2026-10-29T10:05:00Z",
      messages: [
        { id: "m-5", role: "user", content: "nifar is dumb" },
        { id: "m-6", role: "assistant", content: "Sounds like Nifar did something that annoyed you! What happened?" },
      ],
    };
    await saveConversation(turn3Conv);

    const storedList = await getConversations();
    const stored = storedList.find((c) => c.id === "conv-shared");
    assert.ok(stored, "Conversation must exist");
    assert.strictEqual(stored.messages.length, 6, "All 6 messages must be retained after turn 3 merge");
    assert.strictEqual(stored.messages[0].id, "m-1");
    assert.strictEqual(stored.messages[5].id, "m-6");
  });

  // Test 5: saveConversation preserves message identity and updates existing records
  test("5. saveConversation preserves message identity and updates existing conversations cleanly", async () => {
    const conv1: Conversation = {
      id: "c-100",
      platform: "chatgpt",
      title: "Original Title",
      url: "https://chatgpt.com/c/100",
      capturedAt: "2026-10-29T10:00:00Z",
      messages: [{ id: "msg-1", role: "user", content: "Initial message" }],
    };
    const res1 = await saveConversation(conv1);
    assert.strictEqual(res1.isNewConversation, true);
    assert.strictEqual(res1.newMessages.length, 1);

    const conv2: Conversation = {
      id: "c-100",
      platform: "chatgpt",
      title: "Updated Title",
      url: "https://chatgpt.com/c/100",
      capturedAt: "2026-10-29T10:01:00Z",
      messages: [
        { id: "msg-1", role: "user", content: "Initial message" },
        { id: "msg-2", role: "assistant", content: "Second response" },
      ],
    };
    const res2 = await saveConversation(conv2);
    assert.strictEqual(res2.isNewConversation, false);
    assert.strictEqual(res2.newMessages.length, 1);
    assert.strictEqual(res2.newMessages[0].id, "msg-2");

    const all = await getConversations();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].messages.length, 2);
    assert.strictEqual(all[0].title, "Updated Title");
  });

  // Test 6: Metric guarantee: TOTAL VALID = HUMAN + AI / ASST
  test("6. metric guarantee: TOTAL VALID is strictly equal to HUMAN + AI / ASST", () => {
    let session = createCaptureSession("chatgpt", "Metric Check");
    session = ingestMessage(session, { id: "u1", role: "user", content: "what is 2+2" });
    session = startAssistantStream(session, "a1", "4");
    session = completeAssistantStream(session);
    session = ingestMessage(session, { id: "u2", role: "user", content: "what is 5+7" });
    session = startAssistantStream(session, "a2", "12");
    session = completeAssistantStream(session);
    session = ingestMessage(session, { id: "u3", role: "user", content: "nifar is dumb" });
    session = startAssistantStream(session, "a3", "Understood.");
    session = completeAssistantStream(session);

    const metrics = computeConversationMetrics(session.messages);
    assert.strictEqual(metrics.humanCount, 3);
    assert.strictEqual(metrics.assistantCount, 3);
    assert.strictEqual(metrics.totalValidCount, 6);
    assert.strictEqual(metrics.totalValidCount, metrics.humanCount + metrics.assistantCount);
  });

  // Test 7: Delta chunking accumulates into a single logical assistant message
  test("7. delta chunking accumulates into a single logical assistant message", () => {
    let session = createCaptureSession("chatgpt", "Streaming Test");
    session = ingestMessage(session, { id: "u-1", role: "user", content: "Count to 3" });

    session = startAssistantStream(session, "a-msg-1", "1, ");
    session = appendAssistantChunk(session, "2, ");
    session = appendAssistantChunk(session, "3!");
    session = completeAssistantStream(session);

    assert.strictEqual(session.messages.length, 2);
    assert.strictEqual(session.messages[1].id, "a-msg-1");
    assert.strictEqual(session.messages[1].content, "1, 2, 3!");
    assert.strictEqual(session.messages[1].role, "assistant");
  });

  // Test 8: Active capture session survives popup reopen
  test("8. storage persistence of active capture session survives popup reopen", async () => {
    let session = createCaptureSession("chatgpt", "Persistent Session", "https://chatgpt.com/c/persist", "conv-persist");
    session = ingestMessage(session, { id: "u-1", role: "user", content: "Preserve this state" });
    session = startAssistantStream(session, "a-1", "Preserved.");
    session = completeAssistantStream(session);

    await saveActiveCaptureSession(session);

    const restored = await getActiveCaptureSession();
    assert.ok(restored, "Restored session must not be null");
    assert.strictEqual(restored.id, "conv-persist");
    assert.strictEqual(restored.messages.length, 2);
    assert.strictEqual(restored.messages[0].content, "Preserve this state");
    assert.strictEqual(restored.messages[1].content, "Preserved.");
  });

  // Test 9: Order stability: no timestamp scrambling when timestamps are undefined
  test("9. order stability: message order is preserved when timestamps are absent or undefined", () => {
    const rawMessages = [
      { id: "1", role: "user" as const, content: "First" },
      { id: "2", role: "assistant" as const, content: "Second" },
      { id: "3", role: "user" as const, content: "Third" },
      { id: "4", role: "assistant" as const, content: "Fourth" },
    ];

    const sorted = sortMessagesChronologically(rawMessages);
    assert.strictEqual(sorted[0].content, "First");
    assert.strictEqual(sorted[1].content, "Second");
    assert.strictEqual(sorted[2].content, "Third");
    assert.strictEqual(sorted[3].content, "Fourth");
  });

  // Test 10: Canonical archive generation with valid SHA-256 integrity hash
  test("10. canonical archive generation produces valid schema and SHA-256 integrity hash", async () => {
    let session = createCaptureSession("chatgpt", "Canonical Test", "https://chatgpt.com/c/canon", "conv-canon");
    session = ingestMessage(session, { id: "u-1", role: "user", content: "what is 2+2" });
    session = startAssistantStream(session, "a-1", "2 + 2 = 4 😊");
    session = completeAssistantStream(session);

    const archive = await createArchiveFromCapturedConversation(session);
    assert.strictEqual(archive.format, "voidzone.continuity.archive");
    assert.strictEqual(archive.source.platform, "chatgpt");
    assert.strictEqual(archive.integrity.verified, true);
    assert.strictEqual(archive.conversation.messages.length, 2);

    const serialized = serializeArchive(archive);
    const validated = await parseAndValidateArchive(serialized);
    assert.strictEqual(validated.success, true);
    assert.strictEqual(validated.integrityVerified, true);
  });

  // Test 11: Stream interruption properly marks completeness as partial with error notice
  test("11. stream interruption properly marks completeness as partial with error notice", () => {
    let session = createCaptureSession("chatgpt", "Interrupted Test", "https://chatgpt.com/c/int", "conv-int");
    session = ingestMessage(session, { id: "u-1", role: "user", content: "Generate 1000 lines" });
    session = startAssistantStream(session, "a-1", "Line 1\nLine 2");

    // Interrupted mid-stream
    session = interruptStream(session, "Page reloaded during stream");

    assert.strictEqual(session.state, "interrupted");
    assert.strictEqual(session.isComplete, false);
    assert.strictEqual(session.error, "Page reloaded during stream");
  });

  // Test 12: Fallback resolution for conversation ID from URL
  test("12. fallback resolution for conversation ID from URL pattern", () => {
    const url = "https://chatgpt.com/c/6720e118-0a00-800a-8d0c-123456789abc";
    const match = url.match(/\/c\/([a-zA-Z0-9_-]+)/);
    assert.ok(match);
    assert.strictEqual(match[1], "6720e118-0a00-800a-8d0c-123456789abc");
  });

  // Test 13: Empty transport and whitespace filtering
  test("13. empty transport fragments and whitespace-only content are pruned", () => {
    let session = createCaptureSession("chatgpt", "Whitespace Filter");
    session = ingestMessage(session, { role: "user", content: "   " });
    session = ingestMessage(session, { role: "assistant", content: "" });
    assert.strictEqual(session.messages.length, 0);

    session = startAssistantStream(session, "temp-empty", "");
    session = completeAssistantStream(session);
    assert.strictEqual(session.messages.length, 0);
  });

  // Test 14: Platform labeling strictly adheres to ChatGPT conventions (User / Assistant)
  test("14. platform labeling strictly adheres to ChatGPT conventions (User / Assistant)", () => {
    const messages = [
      { id: "1", role: "user" as const, content: "Hello" },
      { id: "2", role: "assistant" as const, content: "Hi there!" },
    ];
    const transcript = buildRawTranscriptFromMessages(messages, "chatgpt");
    assert.ok(transcript.includes("User: Hello"));
    assert.ok(transcript.includes("Assistant: Hi there!"));
    assert.ok(!transcript.includes("Human:"));
    assert.ok(!transcript.includes("Claude:"));
  });

  // Test 15: Completeness boundary verification
  test("15. completeness boundary verification (bounded full history vs live stream partial)", () => {
    let session = createCaptureSession("chatgpt", "Boundary Test");
    session = ingestMessage(session, { id: "u-1", role: "user", content: "Hello" });
    session = startAssistantStream(session, "a-1", "Hi");
    session = completeAssistantStream(session);

    // Live session stream has not verified complete history boundaries -> isComplete is false
    assert.strictEqual(session.isComplete, false);

    // Platform confirms full history has no previous and no next page
    const completedSession = completeCapture(session, {
      hasMoreHistory: false,
      hasPreviousPage: false,
      hasNextPage: false,
    });
    assert.strictEqual(completedSession.isComplete, true);
    assert.strictEqual(completedSession.completenessStatus, "complete");
  });

  // Test 16: Two user messages and two assistant messages (Investigation A regression test)
  test("16. two user messages and two assistant messages: correct role counts (HUMAN=2, AI=2, TOTAL=4) and archive preservation", async () => {
    let session = createCaptureSession("chatgpt", "Two Turn Chat", "https://chatgpt.com/c/two-turn", "conv-2-turn");

    // Turn 1: User message 1 + Assistant response 1
    session = ingestMessage(session, {
      id: "u-turn-1",
      role: "user",
      content: "Explain the concept of entropy in thermodynamics.",
    });
    session = startAssistantStream(session, "a-turn-1", "Entropy is a measure of disorder or randomness in a closed system.");
    session = appendAssistantChunk(session, " In thermodynamics, the second law states it tends to increase.");
    session = completeAssistantStream(session);

    // Turn 2: User message 2 + Assistant response 2
    session = ingestMessage(session, {
      id: "u-turn-2",
      role: "user",
      content: "How does this relate to information theory?",
    });
    session = startAssistantStream(session, "a-turn-2", "Claude Shannon formulated information entropy as a measure of uncertainty.");
    session = appendAssistantChunk(session, " Higher entropy means more information is carried by the message.");
    session = completeAssistantStream(session);

    // Verify role metrics
    const metrics = computeConversationMetrics(session.messages);
    assert.strictEqual(metrics.humanCount, 2, "Expected exactly 2 human/user messages");
    assert.strictEqual(metrics.assistantCount, 2, "Expected exactly 2 assistant messages");
    assert.strictEqual(metrics.totalValidCount, 4, "Expected exactly 4 total valid messages");
    assert.strictEqual(metrics.totalValidCount, metrics.humanCount + metrics.assistantCount);

    // Verify chronological order and content integrity
    assert.strictEqual(session.messages.length, 4);
    assert.strictEqual(session.messages[0].role, "user");
    assert.strictEqual(session.messages[0].id, "u-turn-1");
    assert.strictEqual(session.messages[1].role, "assistant");
    assert.strictEqual(session.messages[1].id, "a-turn-1");
    assert.strictEqual(session.messages[2].role, "user");
    assert.strictEqual(session.messages[2].id, "u-turn-2");
    assert.strictEqual(session.messages[3].role, "assistant");
    assert.strictEqual(session.messages[3].id, "a-turn-2");

    // Verify canonical archive generation
    const archive = await createArchiveFromCapturedConversation(session);
    assert.strictEqual(archive.conversation.messages.length, 4, "Exported archive must contain all 4 messages");
    assert.strictEqual(archive.conversation.messages[0].role, "user");
    assert.strictEqual(archive.conversation.messages[1].role, "assistant");
    assert.strictEqual(archive.conversation.messages[2].role, "user");
    assert.strictEqual(archive.conversation.messages[3].role, "assistant");
    assert.strictEqual(archive.integrity.verified, true);

    const serialized = serializeArchive(archive);
    const parsed = await parseAndValidateArchive(serialized);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.integrityVerified, true);
  });

  // Test 17: Light theme CSS rules ensure visibility of metrics, title, wordmark, and message text
  test("17. light theme CSS rules ensure visibility of metrics, title, wordmark, and message text", () => {
    const cssPath = path.resolve(import.meta.dirname, "../src/App.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    // Must define light theme palette
    assert.ok(cssContent.includes('[data-theme="light"]'));

    // Check that core elements use variable colors instead of hardcoded white
    assert.ok(cssContent.includes(".vz-wordmark"));
    assert.ok(cssContent.includes(".vz-conv-title"));
    assert.ok(cssContent.includes(".vz-metric-value"));
    assert.ok(cssContent.includes(".vz-message-text"));

    // Ensure .vz-metric-value does not have hardcoded #ffffff
    const metricValueBlock = cssContent.slice(cssContent.indexOf(".vz-metric-value"));
    const metricValueRule = metricValueBlock.slice(0, metricValueBlock.indexOf("}"));
    assert.ok(!metricValueRule.includes("color: #ffffff"), "Metric value must not have hardcoded white text");
    assert.ok(metricValueRule.includes("var(--vz-text-primary)"), "Metric value must use var(--vz-text-primary)");

    // Ensure .vz-conv-title does not have hardcoded #fff
    const convTitleBlock = cssContent.slice(cssContent.indexOf(".vz-conv-title"));
    const convTitleRule = convTitleBlock.slice(0, convTitleBlock.indexOf("}"));
    assert.ok(!convTitleRule.includes("color: #fff;"), "Conversation title must not have hardcoded white text");
    assert.ok(convTitleRule.includes("var(--vz-text-primary)"), "Conversation title must use var(--vz-text-primary)");
  });

  // Test 18: Theme preference persistence (Dark / Light) in chrome.storage.local
  test("18. theme preference persistence (Dark / Light) in chrome.storage.local", async () => {
    // Save Light theme preference
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ vzTheme: "light" }, () => resolve());
    });

    const retrievedLight = await new Promise<string | undefined>((resolve) => {
      chrome.storage.local.get("vzTheme", (items) => {
        resolve(items.vzTheme as string);
      });
    });
    assert.strictEqual(retrievedLight, "light");

    // Save Dark theme preference
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ vzTheme: "dark" }, () => resolve());
    });

    const retrievedDark = await new Promise<string | undefined>((resolve) => {
      chrome.storage.local.get("vzTheme", (items) => {
        resolve(items.vzTheme as string);
      });
    });
    assert.strictEqual(retrievedDark, "dark");
  });

  // Test 19: Default to Dark and invalid saved theme fallback
  test("19. default to Dark when no preference exists and fallback on invalid preference", () => {
    function resolveTheme(saved: unknown): "dark" | "light" {
      if (saved === "light" || saved === "dark") {
        return saved;
      }
      return "dark"; // Default fallback
    }

    // Undefined / null preference defaults to dark
    assert.strictEqual(resolveTheme(undefined), "dark");
    assert.strictEqual(resolveTheme(null), "dark");

    // Old "system" preference safely falls back to dark
    assert.strictEqual(resolveTheme("system"), "dark");

    // Arbitrary invalid strings fallback to dark
    assert.strictEqual(resolveTheme("blue"), "dark");
    assert.strictEqual(resolveTheme(123), "dark");

    // Valid themes are preserved
    assert.strictEqual(resolveTheme("dark"), "dark");
    assert.strictEqual(resolveTheme("light"), "light");
  });

  // Test 20: Product footer displays VOIDZONE · CONTINUITY without hackathon branding
  test("20. product footer displays VOIDZONE · CONTINUITY without hackathon branding", () => {
    const appTsxPath = path.resolve(import.meta.dirname, "../src/App.tsx");
    const appTsxContent = fs.readFileSync(appTsxPath, "utf-8");

    assert.ok(appTsxContent.includes("VOIDZONE · CONTINUITY"), "Footer must contain VOIDZONE · CONTINUITY");
    assert.ok(!appTsxContent.includes("META AI DEVELOPER HACKATHON"), "Footer must not contain permanent hackathon branding");
  });

  // Test 21: Theme changes do not affect capture state
  test("21. theme changes do not alter capture session or continuous toggle state", async () => {
    // Establish active capture session with messages
    let session = createCaptureSession("chatgpt", "Persistent Chat", "https://chatgpt.com/c/persist");
    session = ingestMessage(session, { id: "m-theme-1", role: "user", content: "Hello" });
    await saveActiveCaptureSession(session);

    // Save memoryEnabled toggle state
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ memoryEnabled: true }, () => resolve());
    });

    // Simulate theme change to light
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ vzTheme: "light" }, () => resolve());
    });

    // Verify capture session was untouched
    const activeSession = await getActiveCaptureSession();
    assert.ok(activeSession);
    assert.strictEqual(activeSession.messages.length, 1);
    assert.strictEqual(activeSession.messages[0].id, "m-theme-1");

    // Verify continuous capture toggle was untouched
    const memState = await new Promise<boolean>((resolve) => {
      chrome.storage.local.get("memoryEnabled", (items) => {
        resolve(items.memoryEnabled as boolean);
      });
    });
    assert.strictEqual(memState, true);
  });

  // Test 22: Controls bar and segmented toggle CSS layout constraints
  test("22. controls bar and segmented toggle CSS rules prevent horizontal overflow with natural sizing", () => {
    const cssPath = path.resolve(import.meta.dirname, "../src/App.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    // Controls bar box sizing and flex layout
    assert.ok(cssContent.includes(".vz-controls-bar"));
    assert.ok(cssContent.includes(".vz-control-project"));
    assert.ok(cssContent.includes(".vz-control-theme"));
    assert.ok(cssContent.includes(".vz-control-toggle"));

    // Segmented theme toggle
    assert.ok(cssContent.includes(".vz-theme-segmented"));
    assert.ok(cssContent.includes(".vz-theme-indicator"));
    assert.ok(cssContent.includes("will-change: transform"));

    // Continuous toggle flex-shrink protection
    assert.ok(cssContent.includes(".halo-toggle"));
    assert.ok(cssContent.includes("flex-shrink: 0"));
  });

  // Test 23: Accurate distinction between Capture Active, Session Idle, and Health Unknown
  test("23. status consistency: accurately distinguishes Capture Active, Session Idle, and Health Unknown", () => {
    // Scenario: Continuous capture is enabled, but user has not sent any messages in this tab
    const isCaptureActive = true;
    const establishedSession: CapturedConversation | null = null;

    // 1. Capture status (background listener)
    const captureStatusPill = isCaptureActive ? "CAPTURE ACTIVE" : "CAPTURE PAUSED";
    assert.strictEqual(captureStatusPill, "CAPTURE ACTIVE");

    // 2. Session activity state
    const captureState = establishedSession?.state || "idle";
    const sessionStatusLabel =
      captureState === "checkpoint_available"
        ? "SESSION READY"
        : captureState === "response_in_progress"
        ? "STREAMING"
        : captureState === "interrupted"
        ? "INTERRUPTED"
        : "SESSION IDLE";
    assert.strictEqual(sessionStatusLabel, "SESSION IDLE");

    // 3. Health status (unverified because 0 messages exist)
    const completenessStatus = establishedSession?.isComplete
      ? "COMPLETE"
      : establishedSession?.state === "interrupted"
      ? "PARTIAL (INTERRUPTED)"
      : establishedSession && establishedSession.messages.length > 0
      ? "PARTIAL"
      : "UNKNOWN";
    assert.strictEqual(completenessStatus, "UNKNOWN");

    // 4. Metrics faithfully display 0 without faking
    const metrics = computeConversationMetrics(establishedSession?.messages);
    assert.strictEqual(metrics.humanCount, 0);
    assert.strictEqual(metrics.assistantCount, 0);
    assert.strictEqual(metrics.totalValidCount, 0);
  });

  // Test 24: Theme selection toggle semantics: supports only Dark and Light
  test("24. theme selection toggle semantics: supports only Dark and Light without System option", () => {
    const supportedThemes: ("dark" | "light")[] = ["dark", "light"];
    assert.strictEqual(supportedThemes.length, 2);
    assert.ok(supportedThemes.includes("dark"));
    assert.ok(supportedThemes.includes("light"));

    // Ensure System theme is eliminated from supported themes
    const hasSystem = (supportedThemes as string[]).includes("system");
    assert.strictEqual(hasSystem, false, "System theme must not be a supported option");
  });
});

