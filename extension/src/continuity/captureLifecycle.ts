/**
 * captureLifecycle.ts
 *
 * Capture Lifecycle Engine & State Machine for VOIDZONE.
 * Manages capture states (idle, capturing, response_in_progress, checkpoint_available,
 * interrupted, completed, failed), message normalization, deduplication, and
 * streaming response reconstruction.
 */

import type {
  NormalizedCaptureMessage,
  CapturedConversation,
} from "./captureTypes.ts";
import type { MessageRole } from "./archiveSchema.ts";

/**
 * Generates a stable fallback message ID when the source platform does not provide one.
 */
export function generateMessageId(
  role: MessageRole,
  content: string,
  sequence: number
): string {
  // Simple deterministic hash based on content and sequence
  let hash = 0;
  const key = `${sequence}:${role}:${content}`;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `msg-${sequence}-${role}-${hex}`;
}

/**
 * Sorts messages chronologically by timestamp if parseable ISO dates are present.
 * Maintains stable relative order and reindexes sequences 1..N.
 */
export function sortMessagesChronologically(
  messages: NormalizedCaptureMessage[]
): NormalizedCaptureMessage[] {
  if (!messages || messages.length <= 1) {
    return messages ? messages.map((m, i) => ({ ...m, sequence: i + 1 })) : [];
  }

  const hasTimestamps = messages.some(
    (m) => m.timestamp && !isNaN(Date.parse(m.timestamp))
  );

  if (!hasTimestamps) {
    return messages.map((m, i) => ({ ...m, sequence: i + 1 }));
  }

  const sorted = [...messages].sort((a, b) => {
    const timeA = a.timestamp ? Date.parse(a.timestamp) : 0;
    const timeB = b.timestamp ? Date.parse(b.timestamp) : 0;
    if (timeA && timeB && timeA !== timeB) {
      return timeA - timeB;
    }
    return a.sequence - b.sequence;
  });

  return sorted.map((m, i) => ({ ...m, sequence: i + 1 }));
}

/**
 * Computes logical human, assistant, and total valid message counts.
 * Excludes empty transport fragments, metadata objects, and empty placeholders.
 */
export interface ConversationMetrics {
  humanCount: number;
  assistantCount: number;
  totalValidCount: number;
}

export function computeConversationMetrics(
  messages?: NormalizedCaptureMessage[]
): ConversationMetrics {
  if (!messages || !Array.isArray(messages)) {
    return { humanCount: 0, assistantCount: 0, totalValidCount: 0 };
  }

  const valid = messages.filter(
    (m) => m && typeof m.content === "string" && m.content.trim().length > 0
  );

  const humanCount = valid.filter((m) => m.role === "user").length;
  const assistantCount = valid.filter((m) => m.role === "assistant").length;

  return {
    humanCount,
    assistantCount,
    totalValidCount: valid.length,
  };
}

/**
 * Creates an initial idle capture session.
 */
export function createCaptureSession(
  platform: string,
  title: string = "Untitled conversation",
  url: string | null = null,
  conversationId?: string
): CapturedConversation {
  return {
    id: conversationId || (typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `session-${Date.now()}`),
    platform,
    title,
    url,
    messages: [],
    state: "idle",
    hasMoreHistory: false,
    isComplete: false,
    capturedAt: new Date().toISOString(),
    lastCheckpointAt: null,
    error: null,
  };
}

/**
 * Transitions session to the "capturing" state.
 */
export function startCapture(
  session: CapturedConversation
): CapturedConversation {
  return {
    ...session,
    state: "capturing",
    capturedAt: new Date().toISOString(),
    error: null,
  };
}

/**
 * Ingests a completed user or system message into the session.
 * Handles deduplication by message ID / source ID / content, filters out
 * empty transport placeholders, and preserves chronological sequence.
 */
export function ingestMessage(
  session: CapturedConversation,
  rawMessage: {
    id?: string;
    role: MessageRole;
    content: string;
    timestamp?: string | null;
    sourceMessageId?: string | null;
  }
): CapturedConversation {
  const content = rawMessage.content ?? "";
  // Do not ingest completely empty messages unless system note
  if (!content.trim() && rawMessage.role !== "system") {
    return session;
  }

  const timestamp = rawMessage.timestamp ?? null;
  const sourceMessageId = rawMessage.sourceMessageId ?? rawMessage.id ?? null;

  // Check for deduplication
  const existingIndex = session.messages.findIndex(
    (m) =>
      (rawMessage.id && m.id === rawMessage.id) ||
      (sourceMessageId && m.sourceMessageId === sourceMessageId) ||
      (m.role === rawMessage.role &&
        m.content === content &&
        m.timestamp &&
        timestamp &&
        Math.abs(new Date(m.timestamp).getTime() - new Date(timestamp).getTime()) < 3000)
  );

  if (existingIndex >= 0) {
    // Update existing message in place without duplicating or disturbing sequence
    const updatedMessages = [...session.messages];
    updatedMessages[existingIndex] = {
      ...updatedMessages[existingIndex],
      content,
      timestamp: timestamp ?? updatedMessages[existingIndex].timestamp,
      isInProgress: false,
    };
    return {
      ...session,
      messages: updatedMessages,
      capturedAt: new Date().toISOString(),
    };
  }

  // If there is an active in-progress message of the same role that has empty content, reuse it
  const activeInProgIndex = session.messages.findIndex(
    (m) => m.isInProgress && m.role === rawMessage.role
  );
  if (
    activeInProgIndex >= 0 &&
    session.messages[activeInProgIndex].content.trim().length === 0
  ) {
    const updatedMessages = [...session.messages];
    updatedMessages[activeInProgIndex] = {
      ...updatedMessages[activeInProgIndex],
      id: rawMessage.id || updatedMessages[activeInProgIndex].id,
      content,
      timestamp: timestamp ?? updatedMessages[activeInProgIndex].timestamp,
      sourceMessageId,
      isInProgress: false,
    };
    return {
      ...session,
      messages: updatedMessages,
      capturedAt: new Date().toISOString(),
    };
  }

  const nextSequence = session.messages.length + 1;
  const id = rawMessage.id || generateMessageId(rawMessage.role, content, nextSequence);

  const newMessage: NormalizedCaptureMessage = {
    id,
    sequence: nextSequence,
    role: rawMessage.role,
    content,
    timestamp,
    isInProgress: false,
    sourceMessageId,
  };

  const sorted = sortMessagesChronologically([...session.messages, newMessage]);

  return {
    ...session,
    messages: sorted,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Signals that an assistant response stream has started.
 * Reuses or finalizes existing in-progress messages to prevent split responses or empty artifacts.
 * Transitions lifecycle state to "response_in_progress".
 */
export function startAssistantStream(
  session: CapturedConversation,
  messageId?: string,
  initialChunk: string = "",
  timestamp?: string | null
): CapturedConversation {
  // If an in-progress assistant message already exists:
  const activeIndex = session.messages.findIndex((m) => m.isInProgress === true);
  if (activeIndex >= 0) {
    const active = session.messages[activeIndex];
    // If it has matching ID, or if it is currently empty, reuse/update it
    if ((messageId && active.id === messageId) || active.content.trim().length === 0) {
      const updatedMessages = [...session.messages];
      updatedMessages[activeIndex] = {
        ...active,
        id: messageId || active.id,
        content: initialChunk || active.content,
        timestamp: timestamp ?? active.timestamp,
        sourceMessageId: messageId ?? active.sourceMessageId,
      };
      return {
        ...session,
        state: "response_in_progress",
        messages: updatedMessages,
        capturedAt: new Date().toISOString(),
      };
    }
    // If it already has content and a new distinct message starts, finalize previous
    const finalizedMessages = session.messages.map((m) =>
      m.isInProgress ? { ...m, isInProgress: false } : m
    );
    session = { ...session, messages: finalizedMessages };
  }

  // Also check if this messageId already exists in session.messages
  if (messageId) {
    const existingByIdIndex = session.messages.findIndex(
      (m) => m.id === messageId || m.sourceMessageId === messageId
    );
    if (existingByIdIndex >= 0) {
      const updatedMessages = [...session.messages];
      updatedMessages[existingByIdIndex] = {
        ...updatedMessages[existingByIdIndex],
        isInProgress: true,
        content: initialChunk || updatedMessages[existingByIdIndex].content,
      };
      return {
        ...session,
        state: "response_in_progress",
        messages: updatedMessages,
        capturedAt: new Date().toISOString(),
      };
    }
  }

  const nextSequence = session.messages.length + 1;
  const id = messageId || `stream-asst-${Date.now()}-${nextSequence}`;

  const streamingMessage: NormalizedCaptureMessage = {
    id,
    sequence: nextSequence,
    role: "assistant",
    content: initialChunk,
    timestamp: timestamp ?? new Date().toISOString(),
    isInProgress: true,
    sourceMessageId: messageId ?? null,
  };

  return {
    ...session,
    state: "response_in_progress",
    messages: [...session.messages, streamingMessage],
    capturedAt: new Date().toISOString(),
    error: null,
  };
}

/**
 * Appends streaming text chunks to the currently active assistant message.
 */
export function appendAssistantChunk(
  session: CapturedConversation,
  chunk: string
): CapturedConversation {
  if (!chunk) return session;

  const messages = [...session.messages];
  const activeIndex = messages.findIndex((m) => m.isInProgress === true);

  if (activeIndex === -1) {
    // If no in-progress message exists, check if the last message was an assistant message
    const lastIndex = messages.length - 1;
    if (lastIndex >= 0 && messages[lastIndex].role === "assistant") {
      messages[lastIndex] = {
        ...messages[lastIndex],
        content: messages[lastIndex].content + chunk,
        isInProgress: true,
      };
      return {
        ...session,
        state: "response_in_progress",
        messages,
        capturedAt: new Date().toISOString(),
      };
    }
    return startAssistantStream(session, undefined, chunk);
  }

  const activeMsg = messages[activeIndex];
  messages[activeIndex] = {
    ...activeMsg,
    content: activeMsg.content + chunk,
  };

  return {
    ...session,
    messages,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Signals that an assistant stream has successfully finished.
 * Finalizes in-progress messages, prunes empty transport placeholders,
 * reindexes sequences 1..N, and transitions state to "checkpoint_available".
 * Idempotent: safe to call multiple times if stream end markers repeat.
 */
export function completeAssistantStream(
  session: CapturedConversation
): CapturedConversation {
  const hasInProgress = session.messages.some((m) => m.isInProgress);
  if (!hasInProgress && session.state !== "response_in_progress") {
    // Prune any empty messages even if already marked
    const pruned = session.messages.filter(
      (m) => m.content && m.content.trim().length > 0
    );
    if (pruned.length !== session.messages.length) {
      return {
        ...session,
        messages: pruned.map((m, i) => ({ ...m, sequence: i + 1 })),
      };
    }
    return session;
  }

  // Finalize all in-progress messages
  const finalized = session.messages.map((m) =>
    m.isInProgress ? { ...m, isInProgress: false } : m
  );

  // Prune empty placeholders (e.g. tool or thought messages with no text)
  const validMessages = finalized.filter(
    (m) => m.content && m.content.trim().length > 0
  );

  const reindexed = validMessages.map((m, idx) => ({
    ...m,
    sequence: idx + 1,
  }));

  return {
    ...session,
    state: "checkpoint_available",
    messages: reindexed,
    capturedAt: new Date().toISOString(),
    lastCheckpointAt: new Date().toISOString(),
  };
}

/**
 * Marks an ongoing stream as interrupted (e.g. network disconnect, page reload, user stop).
 * Keeps existing captured text and transitions to "interrupted".
 */
export function interruptStream(
  session: CapturedConversation,
  reason: string = "Capture stream was interrupted."
): CapturedConversation {
  const messages = session.messages.map((m) =>
    m.isInProgress ? { ...m, isInProgress: false } : m
  );

  return {
    ...session,
    state: "interrupted",
    messages,
    error: reason,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Creates or updates a checkpoint for an ongoing session.
 */
export function recordCheckpoint(
  session: CapturedConversation
): CapturedConversation {
  return {
    ...session,
    state: "checkpoint_available",
    lastCheckpointAt: new Date().toISOString(),
  };
}

export interface HistoryVerificationOptions {
  hasMoreHistory?: boolean;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

/**
 * Marks session capture as completed.
 * Conservative evidence-based completeness rule:
 * isComplete is true ONLY if:
 * 1. The session contains at least one message.
 * 2. History verification explicitly confirmed no older messages (hasPreviousPage === false)
 *    AND no newer uncaptured messages (hasNextPage === false).
 * 3. hasMoreHistory is explicitly false.
 * 4. Session is not in an interrupted or failed state.
 */
export function completeCapture(
  session: CapturedConversation,
  verificationOrHasMore?: boolean | HistoryVerificationOptions
): CapturedConversation {
  let hasMore: boolean;
  let isVerifiedFull: boolean;

  if (typeof verificationOrHasMore === "boolean") {
    hasMore = verificationOrHasMore;
    isVerifiedFull = !hasMore && session.messages.length > 0;
  } else if (verificationOrHasMore && typeof verificationOrHasMore === "object") {
    hasMore = Boolean(
      verificationOrHasMore.hasMoreHistory ||
      verificationOrHasMore.hasPreviousPage ||
      verificationOrHasMore.hasNextPage
    );
    isVerifiedFull =
      verificationOrHasMore.hasPreviousPage === false &&
      verificationOrHasMore.hasNextPage === false &&
      session.messages.length > 0;
  } else {
    // No verification metadata provided -> conservative default: not proven complete
    hasMore = false;
    isVerifiedFull = false;
  }

  const isComplete =
    isVerifiedFull &&
    !hasMore &&
    session.state !== "interrupted" &&
    session.state !== "failed";

  return {
    ...session,
    state: "completed",
    hasMoreHistory: hasMore,
    isComplete,
    capturedAt: new Date().toISOString(),
    lastCheckpointAt: new Date().toISOString(),
  };
}

/**
 * Records a capture failure without discarding already captured messages.
 */
export function failCapture(
  session: CapturedConversation,
  error: string
): CapturedConversation {
  return {
    ...session,
    state: "failed",
    error,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Builds a clean, verbatim raw transcript from normalized messages.
 * Respects the source platform: uses "User: " and "Assistant: " for ChatGPT,
 * and "Human: " and "Assistant: " for Claude.
 * NEVER attributes an assistant response as "Claude:" for ChatGPT.
 * Prunes empty placeholders from the transcript.
 */
export function buildRawTranscriptFromMessages(
  messages: NormalizedCaptureMessage[],
  platform?: string
): string {
  if (!messages || messages.length === 0) {
    return "";
  }

  const normPlatform = (platform || "").toLowerCase().trim();
  const isClaude = normPlatform === "claude";

  const validMessages = messages.filter(
    (m) => m && typeof m.content === "string" && m.content.trim().length > 0
  );

  return validMessages
    .map((msg) => {
      let rolePrefix: string;
      if (msg.role === "user") {
        rolePrefix = isClaude ? "Human: " : "User: ";
      } else if (msg.role === "assistant") {
        rolePrefix = isClaude ? "Assistant: " : "Assistant: ";
      } else {
        rolePrefix = "System: ";
      }
      return `${rolePrefix}${msg.content}`;
    })
    .join("\n\n");
}
