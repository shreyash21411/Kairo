import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createCaptureSession,
  startCapture,
  ingestMessage,
  startAssistantStream,
  appendAssistantChunk,
  completeAssistantStream,
  interruptStream,
  recordCheckpoint,
  completeCapture,
  failCapture,
  buildRawTranscriptFromMessages,
  generateMessageId,
} from "../src/continuity/captureLifecycle.ts";

describe("captureLifecycle â€” Normalization, Deduplication, and Lifecycle State Machine", () => {
  test("createCaptureSession initializes in idle state with clean defaults", () => {
    const session = createCaptureSession(
      "chatgpt",
      "Test ChatGPT Conversation",
      "https://chatgpt.com/c/test-123",
      "test-123"
    );

    assert.strictEqual(session.id, "test-123");
    assert.strictEqual(session.platform, "chatgpt");
    assert.strictEqual(session.title, "Test ChatGPT Conversation");
    assert.strictEqual(session.url, "https://chatgpt.com/c/test-123");
    assert.strictEqual(session.state, "idle");
    assert.strictEqual(session.messages.length, 0);
    assert.strictEqual(session.hasMoreHistory, false);
    assert.strictEqual(session.isComplete, false);
    assert.strictEqual(session.lastCheckpointAt, null);
    assert.strictEqual(session.error, null);
  });

  test("startCapture transitions session to capturing state", () => {
    const session = createCaptureSession("chatgpt");
    const started = startCapture(session);

    assert.strictEqual(started.state, "capturing");
    assert.strictEqual(started.error, null);
  });

  test("ingestMessage normalizes user and system messages with stable ordering", () => {
    let session = createCaptureSession("chatgpt");
    session = startCapture(session);

    session = ingestMessage(session, {
      id: "user-msg-1",
      role: "user",
      content: "Hello from user! Line 1\nLine 2 with Unicode ðŸš€",
      timestamp: "2026-10-29T10:00:00.000Z",
    });

    session = ingestMessage(session, {
      id: "asst-msg-1",
      role: "assistant",
      content: "```typescript\nconst x = 42;\n```",
      timestamp: "2026-10-29T10:00:05.000Z",
    });

    assert.strictEqual(session.messages.length, 2);
    assert.strictEqual(session.messages[0].sequence, 1);
    assert.strictEqual(session.messages[0].role, "user");
    assert.strictEqual(
      session.messages[0].content,
      "Hello from user! Line 1\nLine 2 with Unicode ðŸš€"
    );
    assert.strictEqual(session.messages[0].timestamp, "2026-10-29T10:00:00.000Z");

    assert.strictEqual(session.messages[1].sequence, 2);
    assert.strictEqual(session.messages[1].role, "assistant");
    assert.ok(session.messages[1].content.includes("const x = 42;"));
  });

  test("deduplicates messages with identical IDs without adding duplicate items", () => {
    let session = createCaptureSession("chatgpt");

    // Ingest first time
    session = ingestMessage(session, {
      id: "msg-dup-1",
      role: "user",
      content: "Initial text",
    });
    assert.strictEqual(session.messages.length, 1);

    // Ingest same message ID again with updated content (e.g. streaming update or re-render)
    session = ingestMessage(session, {
      id: "msg-dup-1",
      role: "user",
      content: "Updated text",
    });
    assert.strictEqual(session.messages.length, 1);
    assert.strictEqual(session.messages[0].content, "Updated text");
    assert.strictEqual(session.messages[0].sequence, 1);
  });

  test("preserves distinct messages with identical text content", () => {
    let session = createCaptureSession("chatgpt");

    session = ingestMessage(session, {
      id: "msg-distinct-1",
      role: "user",
      content: "Yes, continue.",
    });

    session = ingestMessage(session, {
      id: "msg-distinct-2",
      role: "assistant",
      content: "Working on it...",
    });

    // Another user message with the exact same text
    session = ingestMessage(session, {
      id: "msg-distinct-3",
      role: "user",
      content: "Yes, continue.",
    });

    assert.strictEqual(session.messages.length, 3);
    assert.strictEqual(session.messages[0].id, "msg-distinct-1");
    assert.strictEqual(session.messages[2].id, "msg-distinct-3");
    assert.strictEqual(session.messages[0].content, session.messages[2].content);
    assert.strictEqual(session.messages[2].sequence, 3);
  });

  test("streaming response lifecycle: start -> chunk -> complete transitions states properly", () => {
    let session = createCaptureSession("chatgpt");
    session = startCapture(session);

    session = ingestMessage(session, {
      id: "user-1",
      role: "user",
      content: "What is VOIDZONE?",
    });

    // 1. Assistant stream begins
    session = startAssistantStream(session, "asst-stream-1", "VOIDZONE is ");
    assert.strictEqual(session.state, "response_in_progress");
    assert.strictEqual(session.messages.length, 2);
    assert.strictEqual(session.messages[1].isInProgress, true);
    assert.strictEqual(session.messages[1].content, "VOIDZONE is ");

    // 2. Stream chunk arrives
    session = appendAssistantChunk(session, "a persistent AI continuity ");
    assert.strictEqual(session.state, "response_in_progress");
    assert.strictEqual(
      session.messages[1].content,
      "VOIDZONE is a persistent AI continuity "
    );

    // 3. Another chunk arrives
    session = appendAssistantChunk(session, "platform.");
    assert.strictEqual(
      session.messages[1].content,
      "VOIDZONE is a persistent AI continuity platform."
    );

    // 4. Stream completes
    session = completeAssistantStream(session);
    assert.strictEqual(session.state, "checkpoint_available");
    assert.strictEqual(session.messages[1].isInProgress, false);
    assert.ok(session.lastCheckpointAt !== null);
  });

  test("interrupted stream preserves captured content and sets interrupted state", () => {
    let session = createCaptureSession("chatgpt");
    session = startAssistantStream(session, "asst-int-1", "Partial answer...");
    assert.strictEqual(session.state, "response_in_progress");

    session = interruptStream(
      session,
      "User navigated away or tab was reloaded."
    );
    assert.strictEqual(session.state, "interrupted");
    assert.strictEqual(
      session.error,
      "User navigated away or tab was reloaded."
    );
    assert.strictEqual(session.messages.length, 1);
    assert.strictEqual(session.messages[0].content, "Partial answer...");
    assert.strictEqual(session.messages[0].isInProgress, false);
  });

  test("recordCheckpoint updates timestamp and transitions to checkpoint_available", () => {
    let session = createCaptureSession("chatgpt");
    session = startCapture(session);
    session = recordCheckpoint(session);

    assert.strictEqual(session.state, "checkpoint_available");
    assert.ok(typeof session.lastCheckpointAt === "string");
  });

  test("completeCapture marks session completed and isComplete according to hasMoreHistory", () => {
    let session1 = createCaptureSession("chatgpt");
    session1 = ingestMessage(session1, { role: "user", content: "Msg" });
    session1 = completeCapture(session1, false); // No more history -> complete
    assert.strictEqual(session1.state, "completed");
    assert.strictEqual(session1.isComplete, true);
    assert.strictEqual(session1.hasMoreHistory, false);

    let session2 = createCaptureSession("chatgpt");
    session2 = ingestMessage(session2, { role: "user", content: "Msg" });
    session2 = completeCapture(session2, true); // Older history still exists on platform -> not complete
    assert.strictEqual(session2.state, "completed");
    assert.strictEqual(session2.isComplete, false);
    assert.strictEqual(session2.hasMoreHistory, true);
  });

  test("failCapture records error without deleting existing captured messages", () => {
    let session = createCaptureSession("chatgpt");
    session = ingestMessage(session, {
      id: "u-1",
      role: "user",
      content: "Important query",
    });

    session = failCapture(session, "Network connection terminated");
    assert.strictEqual(session.state, "failed");
    assert.strictEqual(session.error, "Network connection terminated");
    assert.strictEqual(session.messages.length, 1);
    assert.strictEqual(session.messages[0].content, "Important query");
  });

  test("isolation between different conversation sessions", () => {
    const sessionA = createCaptureSession("chatgpt", "Conv A", null, "conv-A");
    const sessionB = createCaptureSession("chatgpt", "Conv B", null, "conv-B");

    const updatedA = ingestMessage(sessionA, {
      id: "a-1",
      role: "user",
      content: "Message for A",
    });

    const updatedB = ingestMessage(sessionB, {
      id: "b-1",
      role: "user",
      content: "Message for B",
    });

    assert.strictEqual(updatedA.messages.length, 1);
    assert.strictEqual(updatedA.messages[0].content, "Message for A");

    assert.strictEqual(updatedB.messages.length, 1);
    assert.strictEqual(updatedB.messages[0].content, "Message for B");
  });

  test("buildRawTranscriptFromMessages formats readable transcript correctly", () => {
    let session = createCaptureSession("chatgpt");
    session = ingestMessage(session, {
      id: "1",
      role: "user",
      content: "Hello!",
    });
    session = ingestMessage(session, {
      id: "2",
      role: "assistant",
      content: "Hi there!",
    });

    const chatgptTranscript = buildRawTranscriptFromMessages(session.messages, "chatgpt");
    assert.strictEqual(chatgptTranscript, "User: Hello!\n\nAssistant: Hi there!");

    const claudeTranscript = buildRawTranscriptFromMessages(session.messages, "claude");
    assert.strictEqual(claudeTranscript, "Human: Hello!\n\nAssistant: Hi there!");
  });

  test("generateMessageId produces deterministic, format-compliant IDs", () => {
    const id1 = generateMessageId("user", "Hello world", 1);
    const id2 = generateMessageId("user", "Hello world", 1);
    const id3 = generateMessageId("user", "Different text", 1);

    assert.strictEqual(id1, id2);
    assert.notStrictEqual(id1, id3);
    assert.ok(id1.startsWith("msg-1-user-"));
  });
});
