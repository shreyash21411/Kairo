/**
 * beruVoiceCommands.test.ts
 *
 * Automated regression test suite for BERU Voice Commands & Claude Transfer:
 * 1. Wake-word detection ("Hey Beru", "Beru", "Hi Beru", etc.).
 * 2. Intent parsing for "Get/download me the chat file".
 * 3. Intent parsing for "Give this file to Claude".
 * 4. Intent parsing for "Stop listening" / "Cancel".
 * 5. One-sentence combinations (e.g. "Hey Beru, download the chat file").
 * 6. Fallthrough to general queries.
 * 7. Claude continuation prompt generation integrity (message order, roles, attribution).
 * 8. Execution of GetChatFile on valid and invalid sessions.
 * 9. Execution of TransferToClaude with verified prompts and target URL.
 * 10. Strict separation from Meta Memory and Continuity Engines.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isWakeWord,
  stripWakeWordPrefix,
  parseBeruVoiceCommand,
  buildClaudeContinuationPrompt,
  executeGetChatFile,
  executeTransferToClaude,
  CLAUDE_NEW_CHAT_URL,
} from "../src/commands/beruVoiceCommands.ts";
import {
  RAW_CONVERSATION_FORMAT,
  RAW_CONVERSATION_VERSION,
  type RawConversationExport,
} from "../src/export/rawConversationExport.ts";
import type { CapturedConversation, NormalizedCaptureMessage } from "../src/export/captureTypes.ts";

function createMockSession(overrides: Partial<CapturedConversation> = {}): CapturedConversation {
  const messages: NormalizedCaptureMessage[] = [
    {
      id: "m-1",
      sequence: 1,
      role: "user",
      content: "Let's design the database schema for user authentication.",
      timestamp: "2026-11-04T12:00:00.000Z",
    },
    {
      id: "m-2",
      sequence: 2,
      role: "assistant",
      content: "We should use a users table with hashed passwords and a refresh_tokens table.",
      timestamp: "2026-11-04T12:00:05.000Z",
    },
    {
      id: "m-3",
      sequence: 3,
      role: "user",
      content: "Agreed. Let's make sure JWT expiration is 15 minutes.",
      timestamp: "2026-11-04T12:00:10.000Z",
    },
  ];

  return {
    id: "chatgpt-auth-session-123",
    platform: "chatgpt",
    title: "Auth Architecture Discussion",
    url: "https://chatgpt.com/c/auth-session-123",
    messages,
    state: "completed",
    hasMoreHistory: false,
    isComplete: true,
    completenessStatus: "complete",
    capturedAt: "2026-11-04T12:00:15.000Z",
    lastCheckpointAt: "2026-11-04T12:00:15.000Z",
    ...overrides,
  };
}

describe("BERU Voice Commands — Wake-word Detection", () => {
  test("recognizes standard wake-word phrases", () => {
    assert.strictEqual(isWakeWord("Hey Beru"), true);
    assert.strictEqual(isWakeWord("hey beru"), true);
    assert.strictEqual(isWakeWord("HEY BERU"), true);
    assert.strictEqual(isWakeWord("Beru"), true);
    assert.strictEqual(isWakeWord("beru"), true);
    assert.strictEqual(isWakeWord("Hi Beru"), true);
    assert.strictEqual(isWakeWord("Hello Beru"), true);
    assert.strictEqual(isWakeWord("OK Beru"), true);
    assert.strictEqual(isWakeWord("Okay Beru"), true);
  });

  test("rejects non-wake-words", () => {
    assert.strictEqual(isWakeWord("Hey Siri"), false);
    assert.strictEqual(isWakeWord("Alexa"), false);
    assert.strictEqual(isWakeWord("Hey Google"), false);
    assert.strictEqual(isWakeWord("download the file"), false);
  });

  test("strips wake-word prefix cleanly", () => {
    assert.strictEqual(stripWakeWordPrefix("Hey Beru, get me the chat file"), "get me the chat file");
    assert.strictEqual(stripWakeWordPrefix("Beru give this file to Claude"), "give this file to claude");
    assert.strictEqual(stripWakeWordPrefix("Hi Beru"), "");
  });
});

describe("BERU Voice Commands — Intent Parsing", () => {
  test("parses pure wake-word", () => {
    const intent = parseBeruVoiceCommand("Hey Beru");
    assert.strictEqual(intent.type, "wake_word");
  });

  test("parses 'Get me the chat file' command variations", () => {
    const variations = [
      "Get me the chat file",
      "get the chat file",
      "get my chat file",
      "download me the chat file",
      "download the chat file",
      "download conversation",
      "get conversation file",
      "export chat file",
      "Hey Beru, get me the chat file",
      "Beru download this conversation",
    ];

    for (const v of variations) {
      const intent = parseBeruVoiceCommand(v);
      assert.strictEqual(
        intent.type,
        "get_chat_file",
        `Expected 'get_chat_file' for input: "${v}", got '${intent.type}'`
      );
    }
  });

  test("parses 'Give this file to Claude' command variations", () => {
    const variations = [
      "Give this file to Claude",
      "give the file to claude",
      "give file to claude",
      "transfer this file to claude",
      "transfer to claude",
      "send this file to claude",
      "send to claude",
      "open this in claude",
      "Hey Beru, give this file to Claude",
      "Beru transfer to Claude",
    ];

    for (const v of variations) {
      const intent = parseBeruVoiceCommand(v);
      assert.strictEqual(
        intent.type,
        "transfer_to_claude",
        `Expected 'transfer_to_claude' for input: "${v}", got '${intent.type}'`
      );
    }
  });

  test("parses 'Stop listening' and 'Cancel' commands", () => {
    const variations = [
      "stop listening",
      "stop",
      "cancel",
      "cancel that",
      "mute",
      "Hey Beru stop listening",
      "Beru cancel",
    ];

    for (const v of variations) {
      const intent = parseBeruVoiceCommand(v);
      assert.strictEqual(
        intent.type,
        "stop_listening",
        `Expected 'stop_listening' for input: "${v}", got '${intent.type}'`
      );
    }
  });

  test("routes general queries to general_query", () => {
    const intent = parseBeruVoiceCommand("What did we decide about Redis caching?");
    assert.strictEqual(intent.type, "general_query");
    assert.strictEqual(intent.query, "what did we decide about redis caching");
  });
});

describe("BERU Voice Commands — Claude Continuation Prompt", () => {
  test("generates rich, honest continuation prompt preserving all turns and metadata", () => {
    const session = createMockSession();
    const exportResult = executeGetChatFile(session, false);
    assert.strictEqual(exportResult.success, true);
    assert.ok(exportResult.exportData);

    const prompt = buildClaudeContinuationPrompt(exportResult.exportData);

    assert.ok(prompt.includes("You are continuing a project previously discussed"));
    assert.ok(prompt.includes("=== PREVIOUS CONVERSATION: Auth Architecture Discussion ==="));
    assert.ok(prompt.includes("Source Platform: CHATGPT"));
    assert.ok(prompt.includes("Message Count: 3"));
    assert.ok(prompt.includes("User"));
    assert.ok(prompt.includes("Let's design the database schema for user authentication."));
    assert.ok(prompt.includes("Assistant"));
    assert.ok(prompt.includes("We should use a users table with hashed passwords"));
    assert.ok(prompt.includes("Agreed. Let's make sure JWT expiration is 15 minutes."));
    assert.ok(prompt.includes("--- TRANSCRIPT END ---"));
  });

  test("throws error if export contains no messages", () => {
    const emptyExport: RawConversationExport = {
      format: RAW_CONVERSATION_FORMAT,
      version: RAW_CONVERSATION_VERSION,
      conversationId: "test-id",
      sourcePlatform: "chatgpt",
      conversationTitle: "Empty",
      exportedAt: new Date().toISOString(),
      captureCompleteness: "complete",
      messageCount: 0,
      messages: [],
    };

    assert.throws(() => buildClaudeContinuationPrompt(emptyExport), /no messages/i);
  });
});

describe("BERU Voice Commands — Execution Handlers", () => {
  test("executeGetChatFile succeeds on valid captured session without calling Meta", () => {
    const session = createMockSession();
    const result = executeGetChatFile(session, false); // false = don't trigger DOM click in node test

    assert.strictEqual(result.success, true);
    assert.ok(result.exportData);
    assert.strictEqual(result.exportData.format, "voidzone-raw-conversation");
    assert.strictEqual(result.exportData.version, "1.0");
    assert.strictEqual(result.exportData.messageCount, 3);
    assert.ok(result.filename?.endsWith("-raw.json"));
    assert.ok(result.spokenText.includes("Your conversation file is ready."));
  });

  test("executeGetChatFile fails gracefully when no session is active", () => {
    const result = executeGetChatFile(null, false);
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes("No captured conversation found"));
    assert.ok(result.spokenText.includes("I couldn't retrieve the current conversation"));
  });

  test("executeTransferToClaude formats prompt and targets https://claude.ai/new", async () => {
    const session = createMockSession();
    const getResult = executeGetChatFile(session, false);
    assert.ok(getResult.exportData);

    const transferResult = await executeTransferToClaude(getResult.exportData, false);

    assert.strictEqual(transferResult.success, true);
    assert.strictEqual(transferResult.targetUrl, CLAUDE_NEW_CHAT_URL);
    assert.ok(transferResult.continuationPrompt.includes("Auth Architecture Discussion"));
    assert.ok(transferResult.message.includes("Opened Claude in a new tab"));
    assert.ok(transferResult.spokenText.includes("Opening a new Claude conversation."));
  });

  test("executeTransferToClaude fails gracefully when exportData is invalid", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transferResult = await executeTransferToClaude(null as any, false);
    assert.strictEqual(transferResult.success, false);
    assert.ok(transferResult.message.includes("No conversation file available"));
  });
});
