import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createArchiveFromInput,
  serializeArchive,
  parseAndValidateArchive,
  buildTransferPrompt,
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

// ---------------------------------------------------------------------------
// Test 8 — buildTransferPrompt completeness warnings (regression)
// ---------------------------------------------------------------------------
describe("buildTransferPrompt — completeness warnings", () => {
  const PLATFORM = "Claude";
  const TITLE = "Test Session";
  const TRANSCRIPT = "Human: Hello\nClaude: Hi";

  test("unknown completeness inserts UNKNOWN warning", () => {
    const prompt = buildTransferPrompt(PLATFORM, TITLE, TRANSCRIPT, "unknown");
    assert.ok(
      prompt.includes("COMPLETENESS WARNING: UNKNOWN"),
      "Expected UNKNOWN warning block"
    );
    assert.ok(
      prompt.includes("may be incomplete, truncated, or missing"),
      "Expected incomplete-transcript advisory"
    );
    assert.ok(
      prompt.includes("Do NOT treat it as the full conversation history"),
      "Expected 'Do NOT treat as full history' advisory"
    );
  });

  test("partial completeness inserts PARTIAL warning", () => {
    const prompt = buildTransferPrompt(PLATFORM, TITLE, TRANSCRIPT, "partial");
    assert.ok(
      prompt.includes("COMPLETENESS WARNING: PARTIAL"),
      "Expected PARTIAL warning block"
    );
    assert.ok(
      prompt.includes("partial portion of a longer conversation"),
      "Expected partial-transcript advisory"
    );
    assert.ok(
      prompt.includes("Do NOT treat it as the full conversation history"),
      "Expected 'Do NOT treat as full history' advisory"
    );
  });

  test("complete completeness does NOT insert any completeness warning", () => {
    const prompt = buildTransferPrompt(PLATFORM, TITLE, TRANSCRIPT, "complete");
    assert.ok(
      !prompt.includes("COMPLETENESS WARNING"),
      "Expected no COMPLETENESS WARNING block for complete archives"
    );
  });

  test("defaults to unknown warning when completenessStatus omitted", () => {
    const prompt = buildTransferPrompt(PLATFORM, TITLE, TRANSCRIPT);
    assert.ok(
      prompt.includes("COMPLETENESS WARNING: UNKNOWN"),
      "Expected UNKNOWN warning when status omitted"
    );
  });

  test("createArchiveFromInput with unknown completeness produces prompt containing UNKNOWN warning", async () => {
    const archive = await createArchiveFromInput({
      platform: "Claude",
      title: "Warning Test",
      rawTranscript: "Human: Test\nClaude: Yes",
      completenessStatus: "unknown",
    });
    assert.ok(
      archive.voidzone.instructions.transferPrompt.includes(
        "COMPLETENESS WARNING: UNKNOWN"
      ),
      "Expected UNKNOWN warning in generated transfer prompt"
    );
    assert.strictEqual(
      archive.voidzone.instructions.isEdited,
      false,
      "isEdited must be false for auto-generated prompt"
    );
  });

  test("createArchiveFromInput with partial completeness produces prompt containing PARTIAL warning", async () => {
    const archive = await createArchiveFromInput({
      platform: "ChatGPT",
      title: "Partial Test",
      rawTranscript: "User: Half\nAssistant: Done",
      completenessStatus: "partial",
    });
    assert.ok(
      archive.voidzone.instructions.transferPrompt.includes(
        "COMPLETENESS WARNING: PARTIAL"
      ),
      "Expected PARTIAL warning in generated transfer prompt"
    );
  });

  test("custom transfer prompt is preserved as-is regardless of completeness", async () => {
    const customPrompt = "My custom hand-written prompt.";
    const archive = await createArchiveFromInput({
      platform: "Claude",
      title: "Custom Prompt Test",
      rawTranscript: "Human: A\nClaude: B",
      completenessStatus: "unknown",
      customTransferPrompt: customPrompt,
    });
    assert.strictEqual(
      archive.voidzone.instructions.transferPrompt,
      customPrompt,
      "Custom prompt must be used verbatim"
    );
    assert.strictEqual(
      archive.voidzone.instructions.isEdited,
      true,
      "isEdited must be true when customTransferPrompt is supplied"
    );
    assert.ok(
      !archive.voidzone.instructions.transferPrompt.includes(
        "COMPLETENESS WARNING"
      ),
      "Custom prompt must not have auto-generated warning prepended"
    );
  });
});

// ---------------------------------------------------------------------------
// Test 14 — import-state-preservation logic (regression, unit-level)
//
// The React component manages import errors with a separate `importError`
// state so that a failed import does NOT clear the previously loaded archive.
// This suite tests the underlying `parseAndValidateArchive` guard, which is
// the pure-function boundary that the component relies on.
//
// A full browser-level React component test is not performed here; this
// is a unit test of the import guard logic only.
// ---------------------------------------------------------------------------
describe("parseAndValidateArchive — import-state-preservation (Test 14 regression)", () => {
  test("valid archive parses and validates successfully", async () => {
    const original = await createArchiveFromInput({
      platform: "Claude",
      title: "State Preservation Test",
      rawTranscript: "Human: Load me\nClaude: Loaded",
    });
    const json = serializeArchive(original);
    const result = await parseAndValidateArchive(json);

    assert.strictEqual(result.success, true, "Valid archive must succeed");
    assert.ok(result.archive, "Archive must be present on success");
  });

  test("malformed JSON import fails without returning an archive (caller must preserve existing state)", async () => {
    const result = await parseAndValidateArchive("{ not valid json !!!}");

    assert.strictEqual(
      result.success,
      false,
      "Malformed JSON must not succeed"
    );
    assert.strictEqual(
      result.archive,
      undefined,
      "No archive must be returned on failure — caller keeps existing archive in state"
    );
    assert.ok(
      result.errors.length > 0,
      "At least one error must describe the failure"
    );
    assert.ok(
      result.errors[0].includes("Malformed JSON"),
      "Error must identify malformed JSON"
    );
  });

  test("archive with tampered rawTranscript fails integrity check (caller must preserve existing state)", async () => {
    const original = await createArchiveFromInput({
      platform: "Claude",
      title: "Integrity Test",
      rawTranscript: "Human: Integrity\nClaude: Intact",
    });

    // Tamper: modify rawTranscript after the hash was computed
    const parsed = JSON.parse(serializeArchive(original)) as Record<string, unknown>;
    parsed["rawTranscript"] = "Human: TAMPERED\nClaude: Intact";
    const tamperedJson = JSON.stringify(parsed);

    const result = await parseAndValidateArchive(tamperedJson);

    assert.strictEqual(
      result.success,
      false,
      "Tampered archive must not succeed"
    );
    assert.strictEqual(
      result.archive,
      undefined,
      "No archive must be returned after integrity failure — caller keeps existing archive in state"
    );
  });

  test("archive with unsupported schema version (99.0) is rejected with a clear error", async () => {
    const original = await createArchiveFromInput({
      platform: "Claude",
      title: "Version Test",
      rawTranscript: "Human: Old\nClaude: Archive",
    });
    const parsed = JSON.parse(serializeArchive(original)) as Record<string, unknown>;
    parsed["schemaVersion"] = "99.0";
    const futureJson = JSON.stringify(parsed);

    const result = await parseAndValidateArchive(futureJson);

    assert.strictEqual(result.success, false, "Unsupported version must fail");
    assert.ok(
      result.errors.some((e) => e.includes("schemaVersion")),
      "Error must reference schemaVersion field"
    );
  });

  test("a subsequent valid import succeeds after a failed import attempt", async () => {
    // Simulate the sequence: valid load → bad import → good import
    const goodArchive = await createArchiveFromInput({
      platform: "Claude",
      title: "Good Archive",
      rawTranscript: "Human: Good\nClaude: Archive",
    });
    const goodJson = serializeArchive(goodArchive);

    // Step 1: first import succeeds
    const first = await parseAndValidateArchive(goodJson);
    assert.strictEqual(first.success, true, "First import must succeed");

    // Step 2: bad import returns failure (simulate keeping first.archive in component state)
    const bad = await parseAndValidateArchive("} broken {");
    assert.strictEqual(bad.success, false, "Second (bad) import must fail");

    // Step 3: another good import succeeds
    const second = await parseAndValidateArchive(goodJson);
    assert.strictEqual(second.success, true, "Third import must succeed");
    assert.strictEqual(
      second.archive?.archiveId,
      goodArchive.archiveId,
      "Re-imported archive ID must match original"
    );
  });
});
