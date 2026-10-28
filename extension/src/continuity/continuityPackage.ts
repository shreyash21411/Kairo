/**
 * continuityPackage.ts
 *
 * Backward-compatible facade for continuity package creation.
 * Re-exports canonical archive types and lifecycle methods from Phase 1 foundation.
 */

export * from "./archiveSchema";
export * from "./archiveHashing";
export * from "./archiveValidator";
export * from "./archiveLifecycle";
export * from "./claudeParser";

import {
  createArchiveFromInput,
  buildTransferPrompt,
} from "./archiveLifecycle";
import type { ContinuityArchive } from "./archiveSchema";

/**
 * Legacy ContinuityPackage interface (v1.0 prototype)
 */
export interface ContinuityPackage {
  schemaVersion: "1.0";
  createdAt: string;
  source: {
    platform: string;
    title: string;
  };
  transcript: string;
  transferPrompt: string;
}

export interface ContinuityInput {
  transcript: string;
  platform: string;
  title: string;
}

/**
 * Creates legacy package (synchronous) for backwards compatibility.
 */
export function createContinuityPackage(
  input: ContinuityInput
): ContinuityPackage {
  const transcript = input.transcript.trim();

  if (!transcript) {
    throw new Error("Paste a conversation before creating a package.");
  }

  const platform = input.platform.trim() || "Unknown";
  const title = input.title.trim() || "Untitled conversation";
  const transferPrompt = buildTransferPrompt(platform, title, transcript);

  return {
    schemaVersion: "1.0",
    createdAt: new Date().toISOString(),
    source: {
      platform,
      title,
    },
    transcript,
    transferPrompt,
  };
}

/**
 * Creates canonical Phase 1 ContinuityArchive (asynchronous with cryptographic hashing).
 */
export async function createCanonicalArchive(
  input: ContinuityInput
): Promise<ContinuityArchive> {
  return createArchiveFromInput({
    platform: input.platform,
    title: input.title,
    rawTranscript: input.transcript,
  });
}
