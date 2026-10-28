/**
 * archiveSchema.ts
 *
 * VOIDZONE Continuity Archive Foundation — Schema Version 1.0
 * Canonical format identifier: "voidzone.continuity.archive"
 *
 * Defines the portable, versioned data contract for carrying conversation
 * continuity between AI platforms.
 */

export const CANONICAL_FORMAT = "voidzone.continuity.archive" as const;
export const CANONICAL_SCHEMA_VERSION = "1.0" as const;
export const HASH_ALGORITHM = "SHA-256" as const;

export type SupportedPlatform =
  | "claude"
  | "chatgpt"
  | "gemini"
  | "other"
  | (string & {});

export type CaptureMethod =
  | "manual_paste"
  | "file_import"
  | "supported_connector"
  | "api_import"
  | "unknown";

export type ProvenanceKind =
  | "user_provided"
  | "source_extracted"
  | "inferred"
  | "unknown";

export type MessageRole = "user" | "assistant" | "system";

export type CompletenessStatus = "complete" | "partial" | "unknown";

export type ReviewStatus = "unreviewed" | "reviewed" | "unavailable";

export interface ArchiveMessage {
  id: string;
  sequence: number;
  role: MessageRole;
  content: string;
  timestamp: string | null;
  sourceMessageId?: string | null;
  isSynthetic?: boolean;
}

export interface ArchiveSource {
  platform: SupportedPlatform;
  captureMethod: CaptureMethod;
  title: string | null;
  url: string | null;
  capturedAt: string | null;
  provenance: ProvenanceKind;
}

export interface ArchiveCompleteness {
  status: CompletenessStatus;
  reason: string;
  messageCount: number;
  sourceConfirmed: boolean;
  lastCheckpoint: string | null;
}

export interface ArchiveIntegrity {
  algorithm: typeof HASH_ALGORITHM;
  sourceHash: string;
  canonicalFields: readonly ["rawTranscript", "messages"];
  verified?: boolean;
}

export interface ArchiveInstructions {
  targetPlatform: string;
  transferPrompt: string;
  isEdited: boolean;
}

export interface ArchiveVoidzoneExtension {
  instructions: ArchiveInstructions;
  derivedProjectState: null;
  reviewStatus: ReviewStatus;
}

export interface ArchiveProject {
  id: string | null;
  name: string | null;
}

/**
 * Top-level canonical VOIDZONE Continuity Archive v1.0
 */
export interface ContinuityArchive {
  format: typeof CANONICAL_FORMAT;
  schemaVersion: typeof CANONICAL_SCHEMA_VERSION;
  archiveId: string;
  createdAt: string;
  updatedAt?: string | null;
  source: ArchiveSource;
  project?: ArchiveProject;
  completeness: ArchiveCompleteness;
  rawTranscript: string;
  conversation: {
    messages: ArchiveMessage[];
  };
  integrity: ArchiveIntegrity;
  voidzone: ArchiveVoidzoneExtension;
}

/**
 * Input for creating a new archive from user / capture flow
 */
export interface CreateArchiveOptions {
  platform: string;
  title?: string | null;
  url?: string | null;
  rawTranscript: string;
  captureMethod?: CaptureMethod;
  completenessStatus?: CompletenessStatus;
  completenessReason?: string;
  targetPlatform?: string;
  customTransferPrompt?: string;
  project?: ArchiveProject;
}

