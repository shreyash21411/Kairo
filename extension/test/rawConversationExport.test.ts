/**
 * rawConversationExport.test.ts
 *
 * Automated regression suite for Standalone Raw Conversation JSON Export.
 *
 * Verifies all required capabilities:
 * 1. Raw export contains user messages.
 * 2. Raw export contains assistant messages.
 * 3. Message order is preserved.
 * 4. Content is unchanged.
 * 5. Partial capture remains marked partial (honest status).
 * 6. No continuity transfer prompt is included.
 * 7. No memory extraction output is included.
 * 8. No credentials are included.
 * 9. Export works with Meta disabled.
 * 10. Export works without a configured backend.
 * 11. Filename generation is safe (handles special characters, spaces, fallbacks).
 * 12. Existing full continuity archive generation remains unchanged.
 * 13. System messages and internal prompts are strictly excluded while user and assistant messages retain order and content.
 * 14. Completeness verification: complete remains complete, interrupted/partial remains partial, unknown remains unknown.
 * 15. No incomplete capture is incorrectly marked complete.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createRawConversationFromCaptured,
  createRawConversationFromManual,
  createRawConversationFromTranscript,
  generateSafeRawExportFilename,
  serializeRawConversation,
  resolveCaptureCompleteness,
  RAW_CONVERSATION_FORMAT,
  RAW_CONVERSATION_VERSION,
  type RawConversationExport,
} from "../src/continuity/rawConversationExport.ts";
import {
  createArchiveFromCapturedConversation,
  createArchiveFromInput,
  type ContinuityArchive,
} from "../src/continuity/archiveLifecycle.ts";
import type { CapturedConversation, NormalizedCaptureMessage } from "../src/continuity/captureTypes.ts";

function createMockCapturedSession(overrides: Partial<CapturedConversation> = {}): CapturedConversation {
  const messages: NormalizedCaptureMessage[] = [
    {
      id: "msg-1-u",
      sequence: 1,
      role: "user",
      content: "Can you explain quantum superposition?",
      timestamp: "2026-11-04T10:00:00.000Z",
      sourceMessageId: "turn-1-u",
    },
    {
      id: "msg-2-a",
      sequence: 2,
      role: "assistant",
      content: "Quantum superposition is a fundamental principle of quantum mechanics.",
      timestamp: "2026-11-04T10:00:05.000Z",
      sourceMessageId: "turn-2-a",
    },
    {
      id: "msg-3-u",
      sequence: 3,
      role: "user",
      content: "How does it apply to quantum computers?",
      timestamp: "2026-11-04T10:01:00.000Z",
      sourceMessageId: "turn-3-u",
    },
    {
      id: "msg-4-a",
      sequence: 4,
      role: "assistant",
      content: "In quantum computers, qubits can represent 0 and 1 simultaneously.",
      timestamp: "2026-11-04T10:01:08.000Z",
      sourceMessageId: "turn-4-a",
    },
  ];

  return {
    id: "3847f98d-test-conv-uuid-1234",
    platform: "chatgpt",
    title: "Quantum Physics Exploration",
    url: "https://chatgpt.com/c/3847f98d-test-conv-uuid-1234",
    messages,
    state: "completed",
    hasMoreHistory: false,
    isComplete: false,
    completenessStatus: "partial",
    capturedAt: "2026-11-04T10:00:00.000Z",
    lastCheckpointAt: "2026-11-04T10:01:08.000Z",
    ...overrides,
  };
}

describe("Raw Conversation JSON Export (Mode B)", () => {
  // Test 1: Raw export contains user messages
  test("1. Raw export contains user messages", () => {
    const session = createMockCapturedSession();
    const rawExport = createRawConversationFromCaptured(session);

    const userMessages = rawExport.messages.filter((m) => m.role === "user");
    assert.strictEqual(userMessages.length, 2);
    assert.strictEqual(userMessages[0].content, "Can you explain quantum superposition?");
    assert.strictEqual(userMessages[1].content, "How does it apply to quantum computers?");
  });

  // Test 2: Raw export contains assistant messages
  test("2. Raw export contains assistant messages", () => {
    const session = createMockCapturedSession();
    const rawExport = createRawConversationFromCaptured(session);

    const asstMessages = rawExport.messages.filter((m) => m.role === "assistant");
    assert.strictEqual(asstMessages.length, 2);
    assert.strictEqual(
      asstMessages[0].content,
      "Quantum superposition is a fundamental principle of quantum mechanics."
    );
    assert.strictEqual(
      asstMessages[1].content,
      "In quantum computers, qubits can represent 0 and 1 simultaneously."
    );
  });

  // Test 3: Message order is preserved
  test("3. Message order is preserved", () => {
    const session = createMockCapturedSession();
    const rawExport = createRawConversationFromCaptured(session);

    assert.strictEqual(rawExport.messages.length, 4);
    assert.strictEqual(rawExport.messages[0].sequence, 1);
    assert.strictEqual(rawExport.messages[0].role, "user");
    assert.strictEqual(rawExport.messages[1].sequence, 2);
    assert.strictEqual(rawExport.messages[1].role, "assistant");
    assert.strictEqual(rawExport.messages[2].sequence, 3);
    assert.strictEqual(rawExport.messages[2].role, "user");
    assert.strictEqual(rawExport.messages[3].sequence, 4);
    assert.strictEqual(rawExport.messages[3].role, "assistant");
  });

  // Test 4: Content is unchanged
  test("4. Content is unchanged (exact verbatim preservation)", () => {
    const session = createMockCapturedSession();
    const rawExport = createRawConversationFromCaptured(session);

    for (let i = 0; i < session.messages.length; i++) {
      assert.strictEqual(
        rawExport.messages[i].content,
        session.messages[i].content,
        `Message ${i} content must match original verbatim`
      );
    }
  });

  // Test 5: Partial capture remains marked partial
  test("5. Partial capture remains marked partial (honest status)", () => {
    const session = createMockCapturedSession({ isComplete: false, completenessStatus: "partial" });
    const rawExport = createRawConversationFromCaptured(session);

    assert.strictEqual(rawExport.captureCompleteness, "partial");
    assert.notStrictEqual(rawExport.captureCompleteness, "complete");
  });

  // Test 6: No continuity transfer prompt is included
  test("6. No continuity transfer prompt is included", () => {
    const session = createMockCapturedSession();
    const rawExport = createRawConversationFromCaptured(session);
    const jsonStr = serializeRawConversation(rawExport);

    assert.strictEqual((rawExport as any).transferPrompt, undefined);
    assert.strictEqual((rawExport as any).instructions, undefined);
    assert.strictEqual((rawExport as any).voidzone, undefined);
    assert.doesNotMatch(jsonStr, /transferPrompt/i);
    assert.doesNotMatch(jsonStr, /Continue the following conversation/i);
  });

  // Test 7: No memory extraction output is included
  test("7. No memory extraction output is included", () => {
    const session = createMockCapturedSession();
    const rawExport = createRawConversationFromCaptured(session);
    const jsonStr = serializeRawConversation(rawExport);

    assert.strictEqual((rawExport as any).decisions, undefined);
    assert.strictEqual((rawExport as any).requirements, undefined);
    assert.strictEqual((rawExport as any).derivedProjectState, undefined);
    assert.strictEqual((rawExport as any).tokenUsage, undefined);
    assert.doesNotMatch(jsonStr, /tokenUsage/i);
    assert.doesNotMatch(jsonStr, /meta_ai/i);
  });

  // Test 8: No credentials are included
  test("8. No credentials are included", () => {
    const session = createMockCapturedSession();
    const rawExport = createRawConversationFromCaptured(session);
    const jsonStr = serializeRawConversation(rawExport);

    assert.strictEqual((rawExport as any).kairoApiKey, undefined);
    assert.strictEqual((rawExport as any).apiKey, undefined);
    assert.strictEqual((rawExport as any).password, undefined);
    assert.strictEqual((rawExport as any).secret, undefined);
    assert.doesNotMatch(jsonStr, /kro_live_/i);
    assert.doesNotMatch(jsonStr, /apiKey/i);
  });

  // Test 9: Export works with Meta disabled
  test("9. Export works with Meta disabled", () => {
    // Pure local transformation with zero network or backend dependency
    const session = createMockCapturedSession();
    const rawExport = createRawConversationFromCaptured(session);

    assert.strictEqual(rawExport.format, RAW_CONVERSATION_FORMAT);
    assert.strictEqual(rawExport.version, RAW_CONVERSATION_VERSION);
    assert.strictEqual(rawExport.messageCount, 4);
  });

  // Test 10: Export works without a configured backend
  test("10. Export works without a configured backend", () => {
    const transcript = "HUMAN: Hello world\nASSISTANT: Hello! How can I help you today?";
    const rawExport = createRawConversationFromTranscript(transcript, {
      title: "Pasted Session",
      platform: "chatgpt",
    });

    assert.strictEqual(rawExport.format, RAW_CONVERSATION_FORMAT);
    assert.strictEqual(rawExport.messages.length, 2);
    assert.strictEqual(rawExport.messages[0].role, "user");
    assert.strictEqual(rawExport.messages[0].content, "Hello world");
    assert.strictEqual(rawExport.messages[1].role, "assistant");
    assert.strictEqual(rawExport.messages[1].content, "Hello! How can I help you today?");
  });

  // Test 11: Filename generation is safe
  test("11. Filename generation is safe (handles special characters, slashes, spaces)", () => {
    // Standard title
    const f1 = generateSafeRawExportFilename("Quantum Physics Discussion", "6ae9c6b5-1234");
    assert.strictEqual(f1, "quantum-physics-discussion-6ae9c6b5-raw.json");

    // Title with illegal filesystem characters: / \ : * ? " < > |
    const f2 = generateSafeRawExportFilename('Architecture: v2/v3? *Test* "Quoted" <Tag> | Path', "test-id");
    assert.doesNotMatch(f2, /[/\\?%*:|"<>]/);
    assert.ok(f2.endsWith("-raw.json"));

    // Empty title fallback
    const f3 = generateSafeRawExportFilename("", null);
    assert.strictEqual(f3, "voidzone-conversation-raw.json");

    // All-special-character title fallback
    const f4 = generateSafeRawExportFilename("???///:::***", null);
    assert.strictEqual(f4, "voidzone-conversation-raw.json");
  });

  // Test 12: Existing full continuity archive generation remains unchanged
  test("12. Existing full continuity archive generation remains unchanged (Mode A)", async () => {
    const session = createMockCapturedSession();
    const archive = await createArchiveFromCapturedConversation(session);

    // Verify all canonical Continuity Archive properties remain 100% intact
    assert.strictEqual(archive.format, "voidzone.continuity.archive");
    assert.strictEqual(archive.schemaVersion, "1.0");
    assert.ok(archive.archiveId);
    assert.ok(archive.createdAt);
    assert.ok(archive.source);
    assert.ok(archive.completeness);
    assert.strictEqual(archive.completeness.status, "partial");
    assert.ok(archive.integrity);
    assert.strictEqual(archive.integrity.algorithm, "SHA-256");
    assert.ok(archive.integrity.sourceHash);
    assert.ok(archive.voidzone);
    assert.ok(archive.voidzone.instructions.transferPrompt);
    assert.strictEqual(archive.conversation.messages.length, 4);
  });

  // Test 13: Strict role filtering — ONLY 'user' and 'assistant' are included
  test("13. Strict role filtering: system messages and internal prompts are excluded", () => {
    const session = createMockCapturedSession({
      messages: [
        {
          id: "sys-0",
          sequence: 1,
          role: "system",
          content: "You are a helpful assistant with internal prompt XYZ.",
          timestamp: "2026-11-04T09:59:00.000Z",
          sourceMessageId: "sys-turn",
        },
        {
          id: "msg-1-u",
          sequence: 2,
          role: "user",
          content: "User message 1",
          timestamp: "2026-11-04T10:00:00.000Z",
          sourceMessageId: "turn-1",
        },
        {
          id: "sys-1",
          sequence: 3,
          role: "system",
          content: "System instruction: format output as JSON.",
          timestamp: "2026-11-04T10:00:02.000Z",
          sourceMessageId: "sys-inst",
        },
        {
          id: "msg-2-a",
          sequence: 4,
          role: "assistant",
          content: "Assistant response 1",
          timestamp: "2026-11-04T10:00:05.000Z",
          sourceMessageId: "turn-2",
        },
      ],
    });

    const rawExport = createRawConversationFromCaptured(session);

    // Verify system messages are excluded
    assert.strictEqual(rawExport.messages.length, 2);
    assert.strictEqual(rawExport.messageCount, 2);

    // Verify only 'user' and 'assistant' exist
    const roles = rawExport.messages.map((m) => m.role);
    assert.deepStrictEqual(roles, ["user", "assistant"]);

    // Verify ordering and content are preserved
    assert.strictEqual(rawExport.messages[0].content, "User message 1");
    assert.strictEqual(rawExport.messages[0].sequence, 1);
    assert.strictEqual(rawExport.messages[1].content, "Assistant response 1");
    assert.strictEqual(rawExport.messages[1].sequence, 2);
  });

  // Test 14: Completeness verification logic
  test("14. Completeness verification: complete remains complete, interrupted/partial remains partial, unknown remains unknown", () => {
    // A. Explicitly complete
    const completeStatus = resolveCaptureCompleteness({
      isComplete: true,
      completenessStatus: "complete",
      state: "completed",
      hasMoreHistory: false,
    });
    assert.strictEqual(completeStatus, "complete");

    // B. Explicitly partial
    const partialStatus = resolveCaptureCompleteness({
      isComplete: false,
      completenessStatus: "partial",
      state: "completed",
      hasMoreHistory: false,
    });
    assert.strictEqual(partialStatus, "partial");

    // C. Interrupted state -> must be partial
    const interruptedStatus = resolveCaptureCompleteness({
      isComplete: false,
      state: "interrupted",
      hasMoreHistory: false,
    });
    assert.strictEqual(interruptedStatus, "partial");

    // D. Older history exists -> must be partial
    const moreHistoryStatus = resolveCaptureCompleteness({
      isComplete: false,
      state: "completed",
      hasMoreHistory: true,
    });
    assert.strictEqual(moreHistoryStatus, "partial");

    // E. Explicitly unknown completeness -> remains unknown
    const unknownStatus = resolveCaptureCompleteness({
      isComplete: false,
      completenessStatus: "unknown",
      state: "idle",
      hasMoreHistory: false,
    });
    assert.strictEqual(unknownStatus, "unknown");
  });

  // Test 15: Incomplete captures are NEVER marked complete
  test("15. No incomplete capture is incorrectly marked complete", () => {
    // If isComplete is true but state is interrupted -> MUST be partial
    const interruptedConflict = resolveCaptureCompleteness({
      isComplete: true,
      state: "interrupted",
      hasMoreHistory: false,
    });
    assert.strictEqual(interruptedConflict, "partial");

    // If isComplete is true but hasMoreHistory is true -> MUST be partial
    const historyConflict = resolveCaptureCompleteness({
      isComplete: true,
      state: "completed",
      hasMoreHistory: true,
    });
    assert.strictEqual(historyConflict, "partial");

    // If completenessStatus is partial even if isComplete was set -> MUST be partial
    const partialConflict = resolveCaptureCompleteness({
      isComplete: true,
      completenessStatus: "partial",
      state: "completed",
      hasMoreHistory: false,
    });
    assert.strictEqual(partialConflict, "partial");
  });
});
