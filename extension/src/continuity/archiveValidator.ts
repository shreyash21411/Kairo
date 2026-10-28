/**
 * archiveValidator.ts
 *
 * Runtime validation for VOIDZONE Continuity Archives.
 * Validates untrusted input, ensures structural invariants, and verifies cryptographic integrity.
 */

import {
  CANONICAL_FORMAT,
  CANONICAL_SCHEMA_VERSION,
  HASH_ALGORITHM,
  type ContinuityArchive,
  type ArchiveMessage,
  type MessageRole,
  type CompletenessStatus,
} from "./archiveSchema.ts";
import { computeSourceHash } from "./archiveHashing.ts";

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  archive?: ContinuityArchive;
  integrityVerified?: boolean;
}

const VALID_ROLES = new Set<MessageRole>(["user", "assistant", "system"]);
const VALID_COMPLETENESS = new Set<CompletenessStatus>([
  "complete",
  "partial",
  "unknown",
]);
const HEX_64_REGEX = /^[0-9a-f]{64}$/;

function isValidIsoDate(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && value.includes("T");
}

/**
 * Validates an arbitrary object against the ContinuityArchive v1.0 specification.
 * Performs deep structural checking and verifies SHA-256 source content integrity.
 */
export async function validateArchive(
  data: unknown,
  options: { verifyIntegrity?: boolean } = { verifyIntegrity: true }
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      valid: false,
      errors: [
        {
          path: "$",
          message: "Archive must be a valid JSON object.",
        },
      ],
    };
  }

  const obj = data as Record<string, unknown>;

  // Format identifier
  if (obj["format"] !== CANONICAL_FORMAT) {
    errors.push({
      path: "format",
      message: `Invalid format identifier. Expected '${CANONICAL_FORMAT}', got '${String(
        obj["format"]
      )}'.`,
    });
  }

  // Schema version
  if (obj["schemaVersion"] !== CANONICAL_SCHEMA_VERSION) {
    errors.push({
      path: "schemaVersion",
      message: `Unsupported schema version '${String(
        obj["schemaVersion"]
      )}'. Supported version: '${CANONICAL_SCHEMA_VERSION}'.`,
    });
  }

  // Archive ID
  if (typeof obj["archiveId"] !== "string" || !obj["archiveId"].trim()) {
    errors.push({
      path: "archiveId",
      message: "archiveId is required and must be a non-empty string.",
    });
  }

  // Created timestamp
  if (!isValidIsoDate(obj["createdAt"])) {
    errors.push({
      path: "createdAt",
      message: "createdAt must be a valid ISO-8601 timestamp string.",
    });
  }

  // Raw transcript
  if (typeof obj["rawTranscript"] !== "string") {
    errors.push({
      path: "rawTranscript",
      message: "rawTranscript must be a string.",
    });
  }

  // Source metadata
  const source = obj["source"];
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    errors.push({
      path: "source",
      message: "source metadata object is required.",
    });
  } else {
    const srcObj = source as Record<string, unknown>;
    if (typeof srcObj["platform"] !== "string" || !srcObj["platform"].trim()) {
      errors.push({
        path: "source.platform",
        message: "source.platform is required.",
      });
    }
    if (
      typeof srcObj["captureMethod"] !== "string" ||
      !srcObj["captureMethod"].trim()
    ) {
      errors.push({
        path: "source.captureMethod",
        message: "source.captureMethod is required.",
      });
    }
  }

  // Conversation & messages
  const conversation = obj["conversation"];
  const messages: ArchiveMessage[] = [];

  if (
    !conversation ||
    typeof conversation !== "object" ||
    Array.isArray(conversation)
  ) {
    errors.push({
      path: "conversation",
      message: "conversation object is required.",
    });
  } else {
    const convObj = conversation as Record<string, unknown>;
    const rawMessages = convObj["messages"];

    if (!Array.isArray(rawMessages)) {
      errors.push({
        path: "conversation.messages",
        message: "conversation.messages must be an array.",
      });
    } else {
      for (let i = 0; i < rawMessages.length; i++) {
        const item = rawMessages[i];
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          errors.push({
            path: `conversation.messages[${i}]`,
            message: "Message must be an object.",
          });
          continue;
        }

        const msgObj = item as Record<string, unknown>;
        const seq = msgObj["sequence"];
        const role = msgObj["role"] as MessageRole;
        const content = msgObj["content"];

        if (typeof seq !== "number" || seq !== i + 1) {
          errors.push({
            path: `conversation.messages[${i}].sequence`,
            message: `sequence must be sequential 1-based index (expected ${i + 1}, got ${String(
              seq
            )}).`,
          });
        }

        if (!VALID_ROLES.has(role)) {
          errors.push({
            path: `conversation.messages[${i}].role`,
            message: `Invalid role '${String(role)}'. Must be 'user', 'assistant', or 'system'.`,
          });
        }

        if (typeof content !== "string") {
          errors.push({
            path: `conversation.messages[${i}].content`,
            message: "content must be a string.",
          });
        }

        if (msgObj["timestamp"] !== null && msgObj["timestamp"] !== undefined) {
          if (!isValidIsoDate(msgObj["timestamp"])) {
            errors.push({
              path: `conversation.messages[${i}].timestamp`,
              message: "timestamp must be null or a valid ISO-8601 string.",
            });
          }
        }

        messages.push({
          id: String(msgObj["id"] ?? `msg-${i + 1}`),
          sequence: typeof seq === "number" ? seq : i + 1,
          role,
          content: typeof content === "string" ? content : "",
          timestamp:
            typeof msgObj["timestamp"] === "string" ? msgObj["timestamp"] : null,
          sourceMessageId:
            typeof msgObj["sourceMessageId"] === "string"
              ? msgObj["sourceMessageId"]
              : null,
          isSynthetic: Boolean(msgObj["isSynthetic"]),
        });
      }
    }
  }

  // Completeness metadata
  const completeness = obj["completeness"];
  if (
    !completeness ||
    typeof completeness !== "object" ||
    Array.isArray(completeness)
  ) {
    errors.push({
      path: "completeness",
      message: "completeness object is required.",
    });
  } else {
    const compObj = completeness as Record<string, unknown>;
    const status = compObj["status"] as CompletenessStatus;

    if (!VALID_COMPLETENESS.has(status)) {
      errors.push({
        path: "completeness.status",
        message: `Invalid status '${String(
          status
        )}'. Must be 'complete', 'partial', or 'unknown'.`,
      });
    }

    if (
      typeof compObj["messageCount"] !== "number" ||
      compObj["messageCount"] !== messages.length
    ) {
      errors.push({
        path: "completeness.messageCount",
        message: `messageCount (${String(
          compObj["messageCount"]
        )}) does not match actual messages length (${messages.length}).`,
      });
    }
  }

  // Integrity metadata
  const integrity = obj["integrity"];
  let declaredHash = "";

  if (!integrity || typeof integrity !== "object" || Array.isArray(integrity)) {
    errors.push({
      path: "integrity",
      message: "integrity object is required.",
    });
  } else {
    const intObj = integrity as Record<string, unknown>;
    if (intObj["algorithm"] !== HASH_ALGORITHM) {
      errors.push({
        path: "integrity.algorithm",
        message: `Unsupported hash algorithm '${String(
          intObj["algorithm"]
        )}'. Expected '${HASH_ALGORITHM}'.`,
      });
    }

    declaredHash = String(intObj["sourceHash"] ?? "").toLowerCase();
    if (!HEX_64_REGEX.test(declaredHash)) {
      errors.push({
        path: "integrity.sourceHash",
        message: "sourceHash must be a 64-character lowercase hexadecimal string.",
      });
    }
  }

  // VOIDZONE instructions extension
  const voidzone = obj["voidzone"];
  if (!voidzone || typeof voidzone !== "object" || Array.isArray(voidzone)) {
    errors.push({
      path: "voidzone",
      message: "voidzone extension object is required.",
    });
  } else {
    const vzObj = voidzone as Record<string, unknown>;
    const instructions = vzObj["instructions"];
    if (
      !instructions ||
      typeof instructions !== "object" ||
      Array.isArray(instructions)
    ) {
      errors.push({
        path: "voidzone.instructions",
        message: "voidzone.instructions object is required.",
      });
    } else {
      const instObj = instructions as Record<string, unknown>;
      if (typeof instObj["transferPrompt"] !== "string") {
        errors.push({
          path: "voidzone.instructions.transferPrompt",
          message: "voidzone.instructions.transferPrompt must be a string.",
        });
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
  }

  // Valid shape — perform integrity verification if requested
  const archive = data as ContinuityArchive;
  let integrityVerified = true;

  if (options.verifyIntegrity) {
    try {
      const computedHash = await computeSourceHash(
        archive.rawTranscript,
        archive.conversation.messages
      );

      if (computedHash !== declaredHash) {
        errors.push({
          path: "integrity.sourceHash",
          message: `Integrity check failed: declared hash '${declaredHash}' does not match computed source hash '${computedHash}'.`,
        });
        integrityVerified = false;
      }
    } catch (err) {
      errors.push({
        path: "integrity",
        message: `Failed to verify integrity hash: ${err instanceof Error ? err.message : String(err)
          }`,
      });
      integrityVerified = false;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    archive: errors.length === 0 ? archive : undefined,
    integrityVerified,
  };
}
