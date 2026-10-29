import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createCaptureSession,
  ingestMessage,
  startAssistantStream,
  appendAssistantChunk,
  completeAssistantStream,
  interruptStream,
  completeCapture,
} from "../src/continuity/captureLifecycle.ts";
import {
  createArchiveFromCapturedConversation,
  serializeArchive,
  parseAndValidateArchive,
} from "../src/continuity/archiveLifecycle.ts";

describe("captureArchiveIntegration â€” Captured Conversation to Archive Conversion & Round-Trip", () => {
  test("creates valid canonical archive from verified complete capture session", async () => {
    let session = createCaptureSession(
      "chatgpt",
      "Full API Discussion",
      "https://chatgpt.com/c/full-session",
      "conv-complete-1"
    );

    session = ingestMessage(session, {
      id: "chatgpt-msg-1",
      role: "user",
      content: "Let's review the system architecture.",
      timestamp: "2026-10-29T10:15:00.000Z",
    });

    session = startAssistantStream(session, "chatgpt-msg-2", "Here is ");
    session = appendAssistantChunk(session, "the architecture breakdown.");
    session = completeAssistantStream(session);

    // Platform confirmed full history
    session = completeCapture(session, false);
    assert.strictEqual(session.isComplete, true);

    const archive = await createArchiveFromCapturedConversation(session, {
      targetPlatform: "claude",
    });

    // Verification of canonical foundation fields
    assert.strictEqual(archive.format, "voidzone.continuity.archive");
    assert.strictEqual(archive.schemaVersion, "1.0");
    assert.strictEqual(archive.source.platform, "chatgpt");
    assert.strictEqual(archive.source.captureMethod, "supported_connector");
    assert.strictEqual(archive.source.provenance, "source_extracted");
    assert.strictEqual(archive.source.url, "https://chatgpt.com/c/full-session");

    // Completeness semantics
    assert.strictEqual(archive.completeness.status, "complete");
    assert.strictEqual(archive.completeness.sourceConfirmed, true);
    assert.strictEqual(archive.completeness.messageCount, 2);
    assert.ok(
      archive.completeness.reason.includes("Source platform connector confirmed")
    );

    // Messages
    assert.strictEqual(archive.conversation.messages.length, 2);
    assert.strictEqual(archive.conversation.messages[0].id, "chatgpt-msg-1");
    assert.strictEqual(archive.conversation.messages[1].id, "chatgpt-msg-2");
    assert.strictEqual(
      archive.conversation.messages[1].content,
      "Here is the architecture breakdown."
    );

    // Integrity hash
    assert.match(archive.integrity.sourceHash, /^[0-9a-f]{64}$/);
    assert.strictEqual(archive.integrity.algorithm, "SHA-256");

    // Instructions
    assert.strictEqual(archive.voidzone.instructions.targetPlatform, "claude");
    assert.ok(
      archive.voidzone.instructions.transferPrompt.includes(
        "Let's review the system architecture."
      )
    );
    assert.ok(
      !archive.voidzone.instructions.transferPrompt.includes(
        "COMPLETENESS WARNING"
      )
    );
  });

  test("creates partial archive with honest warning when capture is interrupted", async () => {
    let session = createCaptureSession(
      "chatgpt",
      "Interrupted Stream Session",
      "https://chatgpt.com/c/partial-1"
    );

    session = ingestMessage(session, {
      role: "user",
      content: "Explain consensus protocols.",
    });

    session = startAssistantStream(session, "msg-cut", "Raft uses a leader...");
    session = interruptStream(session, "Tab closed unexpectedly.");

    assert.strictEqual(session.isComplete, false);
    assert.strictEqual(session.state, "interrupted");

    const archive = await createArchiveFromCapturedConversation(session);

    assert.strictEqual(archive.completeness.status, "partial");
    assert.strictEqual(archive.completeness.sourceConfirmed, false);
    assert.ok(
      archive.completeness.reason.includes("Capture was interrupted")
    );

    // Continuation prompt must contain the PARTIAL warning
    assert.ok(
      archive.voidzone.instructions.transferPrompt.includes(
        "COMPLETENESS WARNING: PARTIAL"
      )
    );
  });

  test("creates partial archive when older platform history exists (hasMoreHistory: true)", async () => {
    let session = createCaptureSession("chatgpt", "Pagination Test");

    session = ingestMessage(session, {
      role: "user",
      content: "Latest question",
    });
    session = ingestMessage(session, {
      role: "assistant",
      content: "Latest answer",
    });

    session = completeCapture(session, true); // hasMoreHistory = true
    assert.strictEqual(session.isComplete, false);

    const archive = await createArchiveFromCapturedConversation(session);

    assert.strictEqual(archive.completeness.status, "partial");
    assert.strictEqual(archive.completeness.sourceConfirmed, false);
    assert.ok(
      archive.completeness.reason.includes("Older conversation messages remain")
    );
  });

  test("preserves custom prompt verbatim without auto-generated warning", async () => {
    let session = createCaptureSession("chatgpt");
    session = ingestMessage(session, {
      role: "user",
      content: "Query",
    });

    const customPrompt = "My hand-crafted custom continuation instructions.";
    const archive = await createArchiveFromCapturedConversation(session, {
      customTransferPrompt: customPrompt,
    });

    assert.strictEqual(
      archive.voidzone.instructions.transferPrompt,
      customPrompt
    );
    assert.strictEqual(archive.voidzone.instructions.isEdited, true);
    assert.ok(
      !archive.voidzone.instructions.transferPrompt.includes(
        "COMPLETENESS WARNING"
      )
    );
  });

  test("round-trip export -> import succeeds and passes full integrity check", async () => {
    let session = createCaptureSession(
      "chatgpt",
      "Round Trip Captured Test",
      "https://chatgpt.com/c/round-trip"
    );

    session = ingestMessage(session, {
      id: "rt-1",
      role: "user",
      content: "Round trip message with multi-line\ncode block:\n```js\nconsole.log(1);\n```",
    });
    session = ingestMessage(session, {
      id: "rt-2",
      role: "assistant",
      content: "Round trip confirmed with Unicode âœ¨",
    });

    session = completeCapture(session, false);

    const originalArchive = await createArchiveFromCapturedConversation(session);
    const jsonString = serializeArchive(originalArchive);

    const importResult = await parseAndValidateArchive(jsonString);

    assert.strictEqual(importResult.success, true);
    assert.strictEqual(importResult.errors.length, 0);
    assert.strictEqual(importResult.integrityVerified, true);
    assert.ok(importResult.archive);

    const reimported = importResult.archive;
    assert.strictEqual(reimported.archiveId, originalArchive.archiveId);
    assert.strictEqual(
      reimported.integrity.sourceHash,
      originalArchive.integrity.sourceHash
    );
    assert.strictEqual(reimported.conversation.messages.length, 2);
    assert.deepStrictEqual(
      reimported.conversation.messages,
      originalArchive.conversation.messages
    );
  });

  test("rejects empty captured conversation", async () => {
    const emptySession = createCaptureSession("chatgpt");

    await assert.rejects(
      async () => {
        await createArchiveFromCapturedConversation(emptySession);
      },
      {
        message: "Captured conversation contains no messages.",
      }
    );
  });
});
