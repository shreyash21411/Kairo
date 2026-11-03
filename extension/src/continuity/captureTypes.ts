/**
 * captureTypes.ts
 *
 * Typed internal representation for conversation capture data and lifecycle state.
 * Compatible with the canonical archive model (archiveSchema.ts).
 */

import type { MessageRole, CompletenessStatus } from "./archiveSchema.ts";

/**
 * Frozen sentinel string indicating an intentional user privacy cutoff snapshot.
 * Must not be localized, shortened, or generalized.
 */
export const PRIVACY_CUTOFF_SENTINEL = "Capture was paused by user." as const;

/**
 * Status of an epoch in the authoritative epoch registry.
 */
export type EpochStatus = "active" | "closed" | "invalidated";

/**
 * Authoritative record of an epoch created by popup or recovery.
 */
export interface EpochRecord {
  epochId: string;
  status: EpochStatus;
  createdAt: number;
  createdBy: "popup" | "recovery";
  closedAt?: number | null;
  invalidatedAt?: number | null;
  reason?: string | null;
}

/**
 * Registry mapping epoch ID to its authoritative record.
 */
export type EpochRegistry = Record<string, EpochRecord>;

/**
 * Persistent pending lifecycle transition record stored in chrome.storage.local.
 */
export interface PendingLifecycleTransition {
  readonly transitionId: string;
  readonly type: "start_capture" | "stop_capture" | "emergency_seal";
  readonly targetEpochId: string;
  readonly initiatedAt: number;
  readonly expiresAt: number;
}

/**
 * Formal contract for LIFECYCLE_PING response from Content Script.
 */
export interface LifecyclePingResponse {
  readonly alive: true;
  readonly epochId: string | null;
  readonly observerAttached: boolean;
  readonly state: "idle" | "capturing" | "quiescent" | "error";
  readonly lastDisconnectedEpochId: string | null;
}

/**
 * Lifecycle states of an active conversation capture session.
 */
export type CaptureLifecycleState =
  | "idle"
  | "capturing"
  | "response_in_progress"
  | "checkpoint_available"
  | "interrupted"
  | "completed"
  | "failed";

/**
 * Normalized captured message with deterministic identity and ordering.
 */
export interface NormalizedCaptureMessage {
  /** Stable unique identifier (from source platform or deterministic hash) */
  id: string;
  /** 1-based sequential position in the conversation */
  sequence: number;
  /** Author role: user, assistant, or system */
  role: MessageRole;
  /** Preserved raw message content (verbatim, Unicode-safe) */
  content: string;
  /** ISO-8601 timestamp string if legitimately available; null otherwise */
  timestamp: string | null;
  /** Whether this message is currently being streamed/reconstructed */
  isInProgress?: boolean;
  /** Source-assigned message ID from the AI platform if known */
  sourceMessageId?: string | null;
  /** Storage epoch ID under which this message was admitted */
  epochId?: string | null;
}

/**
 * A captured conversation snapshot ready for persistence or archive generation.
 */
export interface CapturedConversation {
  /** Conversation identifier (e.g. ChatGPT UUID or local session ID) */
  id: string;
  /** Source platform name (e.g. "chatgpt", "claude", "other") */
  platform: string;
  /** Conversation or project title */
  title: string;
  /** Source URL if captured from a web page */
  url: string | null;
  /** Normalized messages in chronological order */
  messages: NormalizedCaptureMessage[];
  /** Current capture lifecycle state */
  state: CaptureLifecycleState;
  /** Whether the source platform indicates older historical messages exist */
  hasMoreHistory: boolean;
  /** Whether the entire conversation history has been verified complete */
  isComplete: boolean;
  /** Canonical completeness status matching archive schema ("complete" | "partial" | "unknown") */
  completenessStatus?: CompletenessStatus;
  /** Timestamp when capture was initiated or last updated */
  capturedAt: string;
  /** Timestamp of the most recent saved checkpoint, if any */
  lastCheckpointAt: string | null;
  /** Error description if lifecycle is in "failed" or "interrupted" state */
  error?: string | null;
  /** Storage epoch ID authorizing this capture session */
  epochId?: string | null;
  /** Optional schema version matching legacy Conversation contract (e.g. "1.0") */
  schemaVersion?: "1.0" | string;
  /** Explicit compatibility flag identifying genuine pre-epoch legacy sessions */
  isLegacySession?: boolean;
  /** Explicit compatibility mode identifying genuine pre-epoch legacy sessions */
  legacyMode?: "pre_epoch" | string;
}

/**
 * Options for converting a captured conversation into a canonical ContinuityArchive.
 */
export interface CaptureToArchiveOptions {
  /** Target continuation platform for the prompt (defaults to "chatgpt") */
  targetPlatform?: string;
  /** Project metadata to attach to the archive */
  project?: {
    id: string;
    name: string;
  };
  /** Explicit completeness status override if desired */
  completenessStatus?: CompletenessStatus;
  /** Custom continuation prompt overriding default generation */
  customTransferPrompt?: string;
}
