import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_FORMAT,
  CANONICAL_SCHEMA_VERSION,
  HASH_ALGORITHM,
  type ContinuityArchive,
} from "../src/continuity/archiveSchema.ts";

describe("archiveSchema — Constants & Types", () => {
  test("defines canonical format identifier and schema version", () => {
    assert.strictEqual(CANONICAL_FORMAT, "voidzone.continuity.archive");
    assert.strictEqual(CANONICAL_SCHEMA_VERSION, "1.0");
    assert.strictEqual(HASH_ALGORITHM, "SHA-256");
  });

  test("can instantiate valid minimal archive structure", () => {
    const archive: ContinuityArchive = {
      format: CANONICAL_FORMAT,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      archiveId: "urn:uuid:test-archive-1",
      createdAt: "2026-10-28T10:00:00.000Z",
      source: {
        platform: "claude",
        captureMethod: "manual_paste",
        title: "Test Archive",
        url: null,
        capturedAt: "2026-10-28T10:00:00.000Z",
        provenance: "user_provided",
      },
      completeness: {
        status: "unknown",
        reason: "Imported via manual text paste",
        messageCount: 1,
        sourceConfirmed: false,
        lastCheckpoint: null,
      },
      rawTranscript: "Hello VOIDZONE",
      conversation: {
        messages: [
          {
            id: "msg-1",
            sequence: 1,
            role: "user",
            content: "Hello VOIDZONE",
            timestamp: null,
            isSynthetic: true,
          },
        ],
      },
      integrity: {
        algorithm: HASH_ALGORITHM,
        sourceHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        canonicalFields: ["rawTranscript", "messages"],
        verified: true,
      },
      voidzone: {
        instructions: {
          targetPlatform: "chatgpt",
          transferPrompt: "Continue the work...",
          isEdited: false,
        },
        derivedProjectState: null,
        reviewStatus: "unreviewed",
      },
    };

    assert.strictEqual(archive.format, "voidzone.continuity.archive");
    assert.strictEqual(archive.conversation.messages.length, 1);
    assert.strictEqual(archive.completeness.status, "unknown");
    assert.strictEqual(archive.voidzone.derivedProjectState, null);
  });
});
