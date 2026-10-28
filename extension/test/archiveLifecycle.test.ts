import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createArchiveFromInput,
  serializeArchive,
  parseAndValidateArchive,
} from "../src/continuity/archiveLifecycle.ts";
import { computeSourceHash } from "../src/continuity/archiveHashing.ts";

describe("archiveLifecycle — Normalization, Integrity, Round-Trip & Migration", () => {
  test("createArchiveFromInput produces valid canonical archive with honest defaults", async () => {
    const rawTranscript = [
      "Human: Let's design the schema.",
      "Claude: Here is the proposed schema.",
    ].join("\n");

    const archive = await createArchiveFromInput({
      platform: "Claude",
      title: "Architecture Session",
      rawTranscript,
    });

    assert.strictEqual(archive.format, "voidzone.continuity.archive");
    assert.strictEqual(archive.schemaVersion, "1.0");
    assert.strictEqual(archive.source.platform, "Claude");
    assert.strictEqual(archive.source.title, "Architecture Session");
    assert.strictEqual(archive.source.captureMethod, "manual_paste");
    assert.strictEqual(archive.source.provenance, "user_provided");

    // Completeness must default to unknown for pasted text
    assert.strictEqual(archive.completeness.status, "unknown");
    assert.strictEqual(archive.completeness.messageCount, 2);
    assert.strictEqual(archive.completeness.sourceConfirmed, false);

    // Messages must preserve sequence and roles
    assert.strictEqual(archive.conversation.messages.length, 2);
    assert.strictEqual(archive.conversation.messages[0].role, "user");
    assert.strictEqual(archive.conversation.messages[1].role, "assistant");
    assert.strictEqual(archive.conversation.messages[0].timestamp, null);

    // Integrity hash must be 64-char hex
    assert.match(archive.integrity.sourceHash, /^[0-9a-f]{64}$/);
    assert.strictEqual(archive.integrity.algorithm, "SHA-256");

    // Transfer prompt must be generated and contain source transcript
    assert.ok(
      archive.voidzone.instructions.transferPrompt.includes(
        "Let's design the schema."
      )
    );
  });

  test("preserves exact supplied raw transcript including leading and trailing whitespace", async () => {
    const rawWithWhitespace = "\n\n  Human: Exact test\nClaude: Preserved\n\n  ";

    const archive = await createArchiveFromInput({
      platform: "Claude",
      title: "Whitespace Preservation",
      rawTranscript: rawWithWhitespace,
    });

    // rawTranscript MUST be exact verbatim string without silent trimming
    assert.strictEqual(archive.rawTranscript, rawWithWhitespace);

    const json = serializeArchive(archive);
    const reimported = await parseAndValidateArchive(json);

    assert.strictEqual(reimported.success, true);
    assert.strictEqual(reimported.archive?.rawTranscript, rawWithWhitespace);
  });

  test("distinguishes user-declared completeness from platform-confirmed completeness", async () => {
    // Case 1: User declares "complete" on manual paste
    const manualComplete = await createArchiveFromInput({
      platform: "Claude",
      rawTranscript: "Human: Finished\nClaude: Done",
      captureMethod: "manual_paste",
      completenessStatus: "complete",
    });

    assert.strictEqual(manualComplete.completeness.status, "complete");
    assert.strictEqual(manualComplete.completeness.sourceConfirmed, false);
    assert.ok(
      manualComplete.completeness.reason.includes(
        "User declared transcript complete"
      )
    );

    // Case 2: Supported connector confirms completeness
    const connectorComplete = await createArchiveFromInput({
      platform: "ChatGPT",
      rawTranscript: "User: API\nAssistant: Response",
      captureMethod: "supported_connector",
      completenessStatus: "complete",
    });

    assert.strictEqual(connectorComplete.completeness.status, "complete");
    assert.strictEqual(connectorComplete.completeness.sourceConfirmed, true);
    assert.ok(
      connectorComplete.completeness.reason.includes("Source platform connector")
    );
  });

  test("rejects empty or whitespace transcript", async () => {
    await assert.rejects(
      async () => {
        await createArchiveFromInput({
          platform: "Claude",
          rawTranscript: "   \n\t  ",
        });
      },
      {
        message: "Transcript content cannot be empty.",
      }
    );
  });

  test("hashing is deterministic and detects message sequence changes", async () => {
    const transcriptA = "Human: One\nClaude: Two";
    const messagesA = [
      {
        id: "msg-1",
        sequence: 1,
        role: "user" as const,
        content: "One",
        timestamp: null,
      },
      {
        id: "msg-2",
        sequence: 2,
        role: "assistant" as const,
        content: "Two",
        timestamp: null,
      },
    ];

    const hash1 = await computeSourceHash(transcriptA, messagesA);
    const hash2 = await computeSourceHash(transcriptA, messagesA);

    // Identical content produces identical hash
    assert.strictEqual(hash1, hash2);

    // Reversed order produces different hash
    const messagesReversed = [
      {
        id: "msg-2",
        sequence: 1,
        role: "assistant" as const,
        content: "Two",
        timestamp: null,
      },
      {
        id: "msg-1",
        sequence: 2,
        role: "user" as const,
        content: "One",
        timestamp: null,
      },
    ];

    const hashReversed = await computeSourceHash(transcriptA, messagesReversed);
    assert.notStrictEqual(hash1, hashReversed);
  });

  test("round-trip export -> import preserves exact source data and passes integrity", async () => {
    const rawTranscript = [
      "User: Test round trip integrity.",
      "Assistant: All fields must match verbatim.",
    ].join("\n");

    const originalArchive = await createArchiveFromInput({
      platform: "ChatGPT",
      title: "Round Trip Test",
      rawTranscript,
    });

    const exportedJson = serializeArchive(originalArchive);
    assert.ok(typeof exportedJson === "string");

    const importResult = await parseAndValidateArchive(exportedJson);

    assert.strictEqual(importResult.success, true);
    assert.strictEqual(importResult.errors.length, 0);
    assert.strictEqual(importResult.integrityVerified, true);
    assert.ok(importResult.archive);

    const imported = importResult.archive;
    assert.strictEqual(imported.archiveId, originalArchive.archiveId);
    assert.strictEqual(imported.rawTranscript, originalArchive.rawTranscript);
    assert.strictEqual(
      imported.integrity.sourceHash,
      originalArchive.integrity.sourceHash
    );
    assert.strictEqual(
      imported.conversation.messages.length,
      originalArchive.conversation.messages.length
    );
    assert.deepStrictEqual(
      imported.conversation.messages,
      originalArchive.conversation.messages
    );
  });

  test("parseAndValidateArchive rejects malformed JSON", async () => {
    const result = await parseAndValidateArchive("{ this is not valid json");
    assert.strictEqual(result.success, false);
    assert.ok(result.errors[0].includes("Malformed JSON"));
  });

  test("parseAndValidateArchive migrates legacy v1.0 prototype package seamlessly", async () => {
    const legacyPackage = {
      schemaVersion: "1.0",
      createdAt: "2026-10-27T08:00:00.000Z",
      source: {
        platform: "Claude",
        title: "Legacy Project Discussion",
      },
      transcript: "Human: Old message\nClaude: Old response",
      transferPrompt: "Continue legacy work...",
    };

    const serialized = JSON.stringify(legacyPackage);
    const result = await parseAndValidateArchive(serialized);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.wasMigrated, true);
    assert.strictEqual(result.integrityVerified, true);
    assert.ok(result.archive);

    const archive = result.archive;
    assert.strictEqual(archive.format, "voidzone.continuity.archive");
    assert.strictEqual(archive.schemaVersion, "1.0");
    assert.strictEqual(archive.source.title, "Legacy Project Discussion");
    assert.strictEqual(archive.completeness.status, "unknown");
    assert.strictEqual(archive.conversation.messages.length, 2);
    assert.match(archive.integrity.sourceHash, /^[0-9a-f]{64}$/);
    assert.strictEqual(
      archive.voidzone.instructions.transferPrompt,
      "Continue legacy work..."
    );
  });

  test("rejects invalid or corrupted legacy package", async () => {
    const badLegacy = {
      schemaVersion: "1.0",
      transcript: 12345, // invalid type
      transferPrompt: "prompt",
    };

    const result = await parseAndValidateArchive(JSON.stringify(badLegacy));
    assert.strictEqual(result.success, false);
  });

  test("treats malicious-looking transcript text (HTML/script tags) as inert string data", async () => {
    const rawTranscript =
      "<script>alert('xss');</script><img src=x onerror=alert(1)>";

    const archive = await createArchiveFromInput({
      platform: "Other",
      title: "Security Test",
      rawTranscript,
    });

    const json = serializeArchive(archive);
    const result = await parseAndValidateArchive(json);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.archive?.rawTranscript, rawTranscript);
    assert.strictEqual(
      result.archive?.conversation.messages[0].content,
      rawTranscript
    );
  });
});
