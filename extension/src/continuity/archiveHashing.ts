/**
 * archiveHashing.ts
 *
 * Deterministic source-content hashing using SHA-256.
 * Covers canonical rawTranscript and the ordered message sequence.
 * Works across both modern browser (Web Crypto API) and Node.js environments.
 */

import type { ArchiveMessage } from "./archiveSchema.ts";

/**
 * Produces a deterministic UTF-8 string representation of source content.
 * Normalizes line endings to \n to ensure cross-platform consistency.
 */
export function canonicalizeSourceContent(
  rawTranscript: string,
  messages: ArchiveMessage[]
): string {
  const normTranscript = rawTranscript.replace(/\r\n/g, "\n");
  const normMessages = messages
    .map(
      (m) =>
        `${m.sequence}|${m.role}|${m.content.replace(/\r\n/g, "\n")}`
    )
    .join("\n---\n");

  return `VOIDZONE_CANONICAL_V1\n${normTranscript}\n===MESSAGES===\n${normMessages}`;
}

/**
 * Computes a 64-character lowercase hex SHA-256 hash over canonical source content.
 */
export async function computeSourceHash(
  rawTranscript: string,
  messages: ArchiveMessage[]
): Promise<string> {
  const canonicalString = canonicalizeSourceContent(rawTranscript, messages);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalString);

  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
    return bufferToHex(hashBuffer);
  }

  throw new Error(
    "Cryptographic SHA-256 (crypto.subtle) is unavailable in this environment."
  );
}

/**
 * Converts ArrayBuffer to lowercase 64-character hex string.
 */
function bufferToHex(buffer: ArrayBuffer): string {
  const byteArray = new Uint8Array(buffer);
  const hexCodes: string[] = [];
  for (let i = 0; i < byteArray.length; i++) {
    hexCodes.push(byteArray[i].toString(16).padStart(2, "0"));
  }
  return hexCodes.join("").toLowerCase();
}
