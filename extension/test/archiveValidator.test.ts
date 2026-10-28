import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateArchive } from "../src/continuity/archiveValidator.ts";
import { computeSourceHash } from "../src/continuity/archiveHashing.ts";
import {
  CANONICAL_FORMAT,
  CANONICAL_SCHEMA_VERSION,
  HASH_ALGORITHM,
  type ContinuityArchive,
} from "../src/continuity/archiveSchema.ts";

describe("archiveValidator — Schema & Invariant Validation", () => {
  async function createValidFixture(): Promise<ContinuityArchive> {
    const rawTranscript = "Human: Hi\nClaude: Hello!";
    const messages = [
      {
        id: "msg-1",
        sequence: 1,
        role: "user" as const,
        content: "Hi",
        timestamp: null,
        isSynthetic: true,
      },
      {
        id: "msg-2",
        sequence: 2,
        role: "assistant" as const,
        content: "Hello!",
        timestamp: null,
        isSynthetic: true,
      },
    ];
    const sourceHash = await computeSourceHash(rawTranscript, messages);

    return {
      format: CANONICAL_FORMAT,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      archiveId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      createdAt: "2026-10-28T12:00:00.000Z",
      source: {
        platform: "claude",
        captureMethod: "manual_paste",
        title: "Test Session",
        url: null,
        capturedAt: "2026-10-28T12:00:00.000Z",
        provenance: "user_provided",
      },
      completeness: {
        status: "unknown",
        reason: "Imported via manual text paste",
        messageCount: 2,
        sourceConfirmed: false,
        lastCheckpoint: null,
      },
      rawTranscript,
      conversation: {
        messages,
      },
      integrity: {
        algorithm: HASH_ALGORITHM,
        sourceHash,
        canonicalFields: ["rawTranscript", "messages"],
        verified: true,
      },
      voidzone: {
        instructions: {
          targetPlatform: "chatgpt",
          transferPrompt: "Continue...",
          isEdited: false,
        },
        derivedProjectState: null,
        reviewStatus: "unreviewed",
      },
    };
  }

  test("validates genuine minimal archive successfully", async () => {
    const fixture = await createValidFixture();
    const result = await validateArchive(fixture);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.integrityVerified, true);
    assert.ok(result.archive);
  });

  test("rejects non-object or null input", async () => {
    const r1 = await validateArchive(null);
    assert.strictEqual(r1.valid, false);
    assert.ok(r1.errors.some((e) => e.path === "$"));

    const r2 = await validateArchive("not an object");
    assert.strictEqual(r2.valid, false);

    const r3 = await validateArchive([1, 2, 3]);
    assert.strictEqual(r3.valid, false);
  });

  test("rejects invalid format identifier", async () => {
    const fixture = await createValidFixture();
    (fixture as unknown as Record<string, unknown>)["format"] = "wrong.format";

    const result = await validateArchive(fixture);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "format"));
  });

  test("rejects unsupported future schema version", async () => {
    const fixture = await createValidFixture();
    (fixture as unknown as Record<string, unknown>)["schemaVersion"] = "99.0";

    const result = await validateArchive(fixture);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "schemaVersion"));
  });

  test("rejects missing or invalid archiveId and createdAt", async () => {
    const fixture = await createValidFixture();
    (fixture as unknown as Record<string, unknown>)["archiveId"] = "";
    (fixture as unknown as Record<string, unknown>)["createdAt"] = "not-a-date";

    const result = await validateArchive(fixture);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "archiveId"));
    assert.ok(result.errors.some((e) => e.path === "createdAt"));
  });

  test("rejects invalid role in message", async () => {
    const fixture = await createValidFixture();
    (fixture.conversation.messages[0] as unknown as Record<string, unknown>)["role"] =
      "robot";

    const result = await validateArchive(fixture);
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.path.includes("role") && e.message.includes("robot"))
    );
  });

  test("rejects non-sequential message sequences", async () => {
    const fixture = await createValidFixture();
    fixture.conversation.messages[1].sequence = 5; // expected 2

    const result = await validateArchive(fixture);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.path.includes("sequence")));
  });

  test("rejects mismatched completeness.messageCount", async () => {
    const fixture = await createValidFixture();
    fixture.completeness.messageCount = 99; // actual length is 2

    const result = await validateArchive(fixture);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "completeness.messageCount"));
  });

  test("rejects invalid completeness.status", async () => {
    const fixture = await createValidFixture();
    (fixture.completeness as unknown as Record<string, unknown>)["status"] =
      "all_done";

    const result = await validateArchive(fixture);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "completeness.status"));
  });

  test("rejects invalid hash format (must be 64-char hex)", async () => {
    const fixture = await createValidFixture();
    fixture.integrity.sourceHash = "short_hash";

    const result = await validateArchive(fixture);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === "integrity.sourceHash"));
  });

  test("detects tampered content with original hash (integrity check)", async () => {
    const fixture = await createValidFixture();
    // Tamper with transcript after hash was computed
    fixture.rawTranscript = "Human: Tampered text\nClaude: Injected content";

    const result = await validateArchive(fixture, { verifyIntegrity: true });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.integrityVerified, false);
    assert.ok(
      result.errors.some(
        (e) =>
          e.path === "integrity.sourceHash" && e.message.includes("Integrity check failed")
      )
    );
  });

  test("allows metadata updates without invalidating source hash", async () => {
    const fixture = await createValidFixture();
    // Update metadata only: title, transferPrompt, reviewStatus
    fixture.source.title = "Updated Session Title";
    fixture.voidzone.instructions.transferPrompt = "Custom instructions...";
    fixture.voidzone.instructions.isEdited = true;

    const result = await validateArchive(fixture, { verifyIntegrity: true });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.integrityVerified, true);
  });
});

