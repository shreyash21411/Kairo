/**
 * captureFidelity.test.ts
 *
 * Phase 2.1 — Regression test suite for:
 * 1. Truthful message reconstruction and attribution (User: / Assistant:, no Claude: on ChatGPT).
 * 2. Empty transport fragment pruning and deduplication.
 * 3. Single logical assistant message reconstruction from streaming deltas.
 * 4. Accurate conversation metrics (human count, assistant count, valid total).
 * 5. Checkpoint, archive consistency, and round-trip export/import.
 */

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

describe("Phase 2.1 — Stage 2: Message Fidelity & Speaker Attribution", () => {
  test("ChatGPT transcript formats strictly as User: and Assistant: (no Claude: labels)", () => {
    let session = createCaptureSession("chatgpt", "ChatGPT Architecture Discussion");
    session = ingestMessage(session, {
      role: "user",
      content: "What is the event-driven architecture?",
    });
    session = startAssistantStream(session, "asst-1", "Event-driven architecture is ");
    session = appendAssistantChunk(session, "a software design pattern.");
    session = completeAssistantStream(session);

    const transcript = buildRawTranscriptFromMessages(session.messages, "chatgpt");

    assert.ok(transcript.includes("User: What is the event-driven architecture?"));
    assert.ok(transcript.includes("Assistant: Event-driven architecture is a software design pattern."));
    assert.ok(!transcript.includes("Claude:"), "ChatGPT transcript must NEVER contain Claude: prefix");
    assert.ok(!transcript.includes("Human:"), "ChatGPT transcript must use User: instead of Human:");
  });

  test("Claude transcript formats with Human: and Assistant:", () => {
    let session = createCaptureSession("claude", "Claude Discussion");
    session = ingestMessage(session, {
      role: "user",
      content: "Hello Claude",
    });
    session = ingestMessage(session, {
      role: "assistant",
      content: "Hello! How can I assist?",
    });

    const transcript = buildRawTranscriptFromMessages(session.messages, "claude");
    assert.ok(transcript.includes("Human: Hello Claude"));
    assert.ok(transcript.includes("Assistant: Hello! How can I assist?"));
  });

  test("empty transport fragments and empty JSON patch placeholders are not stored as messages", () => {
    let session = createCaptureSession("chatgpt", "Empty Fragment Test");

    // Ingesting empty or whitespace-only strings must be ignored
    session = ingestMessage(session, { role: "user", content: "" });
    session = ingestMessage(session, { role: "user", content: "   \n\t  " });
    session = ingestMessage(session, { role: "assistant", content: "" });

    assert.strictEqual(session.messages.length, 0, "No messages should be stored for empty content");

    // Streaming placeholder that never receives content must be pruned on complete
    session = startAssistantStream(session, "empty-placeholder-1", "");
    assert.strictEqual(session.messages.length, 1);
    session = completeAssistantStream(session);
    assert.strictEqual(session.messages.length, 0, "Empty assistant streaming artifact must be pruned");
  });

  test("multiple streaming deltas assemble into exactly one logical assistant message", () => {
    let session = createCaptureSession("chatgpt", "Streaming Assembly");
    session = ingestMessage(session, {
      id: "u-1",
      role: "user",
      content: "Explain consensus.",
    });

    // Start stream with initial chunk
    session = startAssistantStream(session, "asst-msg-100", "Consensus ");
    // Multiple chunks arrive
    session = appendAssistantChunk(session, "protocols ");
    session = appendAssistantChunk(session, "ensure ");
    session = appendAssistantChunk(session, "agreement.");

    // Complete stream
    session = completeAssistantStream(session);

    assert.strictEqual(session.messages.length, 2);
    assert.strictEqual(session.messages[0].role, "user");
    assert.strictEqual(session.messages[1].role, "assistant");
    assert.strictEqual(
      session.messages[1].content,
      "Consensus protocols ensure agreement."
    );
    assert.strictEqual(session.messages[1].isInProgress, false);
  });

  test("duplicate assistant metadata events during active stream do not create split messages", () => {
    let session = createCaptureSession("chatgpt", "Stream Metadata Resend");
    session = ingestMessage(session, { role: "user", content: "Query" });

    // Stream begins
    session = startAssistantStream(session, "resp-msg-1", "Part 1 ");

    // Duplicate message start event arriving with same ID during streaming
    session = startAssistantStream(session, "resp-msg-1", "");

    // Subsequent text appended
    session = appendAssistantChunk(session, "Part 2");
    session = completeAssistantStream(session);

    assert.strictEqual(session.messages.length, 2);
    assert.strictEqual(session.messages[1].content, "Part 1 Part 2");
  });

  test("distinct assistant responses in separate turns remain distinct", () => {
    let session = createCaptureSession("chatgpt", "Multi-turn Discussion");

    // Turn 1
    session = ingestMessage(session, { id: "u-1", role: "user", content: "Turn 1 question" });
    session = startAssistantStream(session, "a-1", "Turn 1 answer.");
    session = completeAssistantStream(session);

    // Turn 2
    session = ingestMessage(session, { id: "u-2", role: "user", content: "Turn 2 question" });
    session = startAssistantStream(session, "a-2", "Turn 2 answer.");
    session = completeAssistantStream(session);

    assert.strictEqual(session.messages.length, 4);
    assert.strictEqual(session.messages[1].id, "a-1");
    assert.strictEqual(session.messages[3].id, "a-2");
    assert.strictEqual(session.messages[1].content, "Turn 1 answer.");
    assert.strictEqual(session.messages[3].content, "Turn 2 answer.");
  });

  test("live capture and history hydration do not double-count or reverse messages", () => {
    let session = createCaptureSession("chatgpt", "Live + History Hydration");

    // Turn 1 was captured live with timestamp
    session = ingestMessage(session, {
      id: "u-1",
      role: "user",
      content: "What is VOIDZONE?",
      timestamp: "2026-10-29T10:00:00.000Z",
    });
    session = startAssistantStream(session, "a-1", "VOIDZONE is a platform.", "2026-10-29T10:00:05.000Z");
    session = completeAssistantStream(session);

    // Later, historical /messages endpoint returns the same messages plus an earlier greeting
    session = ingestMessage(session, {
      id: "u-0",
      role: "user",
      content: "Hello",
      timestamp: "2026-10-29T09:55:00.000Z",
    });
    session = ingestMessage(session, {
      id: "a-0",
      role: "assistant",
      content: "Hi there!",
      timestamp: "2026-10-29T09:55:02.000Z",
    });
    // Ingest u-1 and a-1 again from history
    session = ingestMessage(session, {
      id: "u-1",
      role: "user",
      content: "What is VOIDZONE?",
      timestamp: "2026-10-29T10:00:00.000Z",
    });
    session = ingestMessage(session, {
      id: "a-1",
      role: "assistant",
      content: "VOIDZONE is a platform.",
      timestamp: "2026-10-29T10:00:05.000Z",
    });

    // Exactly 4 distinct messages, ordered chronologically
    assert.strictEqual(session.messages.length, 4);
    assert.strictEqual(session.messages[0].id, "u-0");
    assert.strictEqual(session.messages[1].id, "a-0");
    assert.strictEqual(session.messages[2].id, "u-1");
    assert.strictEqual(session.messages[3].id, "a-1");
    assert.strictEqual(session.messages[0].sequence, 1);
    assert.strictEqual(session.messages[3].sequence, 4);
  });

  test("interrupted stream preserves all captured text and marks state interrupted", () => {
    let session = createCaptureSession("chatgpt", "Interrupted Stream");
    session = ingestMessage(session, { role: "user", content: "Tell me a story" });
    session = startAssistantStream(session, "msg-cut", "Once upon a time in a city ");
    session = appendAssistantChunk(session, "of neon lights...");
    session = interruptStream(session, "User pressed Stop Generating.");

    assert.strictEqual(session.state, "interrupted");
    assert.strictEqual(session.messages.length, 2);
    assert.strictEqual(
      session.messages[1].content,
      "Once upon a time in a city of neon lights..."
    );
    assert.strictEqual(session.messages[1].isInProgress, false);
    assert.strictEqual(session.error, "User pressed Stop Generating.");
  });
});

describe("Phase 2.1 — Stage 3: Accurate Conversation Metrics", () => {
  test("computes accurate human and assistant counts excluding empty artifacts", () => {
    const messages = [
      { id: "1", sequence: 1, role: "user" as const, content: "Hello", timestamp: null, isInProgress: false, sourceMessageId: null },
      { id: "2", sequence: 2, role: "assistant" as const, content: "Hi", timestamp: null, isInProgress: false, sourceMessageId: null },
      { id: "3", sequence: 3, role: "user" as const, content: "How does this work?", timestamp: null, isInProgress: false, sourceMessageId: null },
      { id: "4", sequence: 4, role: "assistant" as const, content: "", timestamp: null, isInProgress: false, sourceMessageId: null }, // empty artifact
      { id: "5", sequence: 5, role: "assistant" as const, content: "Like this.", timestamp: null, isInProgress: false, sourceMessageId: null },
    ];

    const metrics = computeConversationMetrics(messages);
    assert.strictEqual(metrics.humanCount, 2);
    assert.strictEqual(metrics.assistantCount, 2); // message 4 is excluded because content is empty
    assert.strictEqual(metrics.totalValidCount, 4);
  });

  test("counts a partially received assistant message as one assistant message", () => {
    const messages = [
      { id: "1", sequence: 1, role: "user" as const, content: "Prompt", timestamp: null, isInProgress: false, sourceMessageId: null },
      { id: "2", sequence: 2, role: "assistant" as const, content: "Partial text", timestamp: null, isInProgress: true, sourceMessageId: null },
    ];

    const metrics = computeConversationMetrics(messages);
    assert.strictEqual(metrics.humanCount, 1);
    assert.strictEqual(metrics.assistantCount, 1);
    assert.strictEqual(metrics.totalValidCount, 2);
  });

  test("handles empty or null messages array cleanly", () => {
    assert.deepStrictEqual(computeConversationMetrics([]), {
      humanCount: 0,
      assistantCount: 0,
      totalValidCount: 0,
    });
    assert.deepStrictEqual(computeConversationMetrics(undefined), {
      humanCount: 0,
      assistantCount: 0,
      totalValidCount: 0,
    });
  });
});

describe("Phase 2.1 — Stage 4: Checkpoint, Archive Consistency & Round-Trip", () => {
  test("createArchiveFromCapturedConversation generates pristine canonical archive for ChatGPT", async () => {
    let session = createCaptureSession("chatgpt", "Full Pipeline Test", "https://chatgpt.com/c/pipe-1");
    session = ingestMessage(session, {
      id: "u-1",
      role: "user",
      content: "Explain the actor model.",
      timestamp: "2026-10-29T10:00:00.000Z",
    });
    session = startAssistantStream(session, "a-1", "The actor model is a mathematical model.", "2026-10-29T10:00:05.000Z");
    session = completeAssistantStream(session);
    session = completeCapture(session, {
      hasMoreHistory: false,
      hasPreviousPage: false,
      hasNextPage: false,
    });

    const archive = await createArchiveFromCapturedConversation(session);

    assert.strictEqual(archive.format, "voidzone.continuity.archive");
    assert.strictEqual(archive.schemaVersion, "1.0");
    assert.strictEqual(archive.source.platform, "chatgpt");
    assert.strictEqual(archive.completeness.status, "complete");
    assert.strictEqual(archive.completeness.sourceConfirmed, true);
    assert.strictEqual(archive.completeness.messageCount, 2);

    // rawTranscript check: must NOT have Claude: or Human:
    assert.ok(archive.rawTranscript.includes("User: Explain the actor model."));
    assert.ok(archive.rawTranscript.includes("Assistant: The actor model is a mathematical model."));
    assert.ok(!archive.rawTranscript.includes("Claude:"));
    assert.ok(!archive.rawTranscript.includes("Human:"));

    // Integrity hash verification
    assert.strictEqual(archive.integrity.verified, true);
    assert.match(archive.integrity.sourceHash, /^[0-9a-f]{64}$/);

    // Round trip: serialize -> parse & validate
    const jsonStr = serializeArchive(archive);
    const parsed = await parseAndValidateArchive(jsonStr);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.integrityVerified, true);
    assert.strictEqual(parsed.archive?.source.platform, "chatgpt");
    assert.strictEqual(parsed.archive?.conversation.messages.length, 2);
  });

  test("rejects capture sessions with only empty messages", async () => {
    let session = createCaptureSession("chatgpt", "Empty Test");
    session = startAssistantStream(session, "temp", "");
    session.messages[0].isInProgress = false; // forced empty message

    await assert.rejects(
      createArchiveFromCapturedConversation(session),
      { message: /no valid non-empty messages/ }
    );
  });
});