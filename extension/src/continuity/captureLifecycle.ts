/**
 * captureLifecycle.ts
 *
 * Capture Lifecycle Engine & State Machine for VOIDZONE.
 * Manages capture states (idle, capturing, response_in_progress, checkpoint_available,
 * interrupted, completed, failed), message normalization, deduplication, and
 * streaming response reconstruction.
 */

import {
  type NormalizedCaptureMessage,
  type CapturedConversation,
  type EpochRecord,
  type EpochRegistry,
  type PendingLifecycleTransition,
  PRIVACY_CUTOFF_SENTINEL,
} from "./captureTypes.ts";
import type { MessageRole, CompletenessStatus } from "./archiveSchema.ts";

/**
 * Capture eligibility interval representing a time window during which capture was actively enabled.
 */
export interface CaptureEligibilityInterval {
  start: number; // epoch ms when capture was enabled
  end?: number | null; // epoch ms when capture was disabled, or null if currently active
}

/**
 * Context required to evaluate message capture eligibility across privacy boundaries.
 */
export interface CaptureEligibilityContext {
  isCaptureCurrentlyEnabled: boolean;
  intervals: CaptureEligibilityInterval[];
  persistedMessageIds?: Set<string>;
}

/**
 * Strict privacy boundary validator.
 * Positively establishes whether a candidate message is eligible for capture.
 *
 * Rules:
 * 1. Capture OFF immediately stops accepting new content.
 * 2. Previously persisted messages remain intact.
 * 3. If capture has never been disabled and is currently enabled, current conversation messages are eligible.
 * 4. If capture has been disabled, re-enabling capture starts a new eligible interval.
 * 5. Historical recovery cannot automatically import messages across a capture-disabled interval.
 * 6. Messages sent while capture was disabled must not be backfilled.
 * 7. If a recovered message cannot be positively established as eligible for capture (e.g. missing/unparseable timestamp, or timestamp within disabled interval), exclude it.
 */
export function isMessageEligibleForCapture(
  msg: { id?: string; sourceMessageId?: string | null; timestamp?: string | null },
  context: CaptureEligibilityContext
): boolean {
  // Rule 1: Capture OFF immediately stops accepting new content
  if (!context.isCaptureCurrentlyEnabled) {
    return false;
  }

  // Rule 2: Previously persisted messages remain intact
  if (context.persistedMessageIds) {
    if (msg.id && context.persistedMessageIds.has(msg.id)) return true;
    if (msg.sourceMessageId && context.persistedMessageIds.has(msg.sourceMessageId)) return true;
  }

  // Rule 3: If capture was never disabled and is currently enabled, messages are eligible
  const hasDisabledIntervals = context.intervals.some((i) => typeof i.end === "number");
  if (!hasDisabledIntervals && context.intervals.length <= 1) {
    return true;
  }

  // Rule 4: If capture has been disabled and re-enabled, recovered messages must be positively established
  if (!msg.timestamp) {
    // Cannot be positively established as eligible without an authoritative timestamp -> exclude
    return false;
  }

  const msgTime = Date.parse(msg.timestamp);
  if (isNaN(msgTime)) {
    return false;
  }

  // Check if msgTime falls within ANY eligible capture interval
  return context.intervals.some((interval) => {
    const start = interval.start;
    const end = typeof interval.end === "number" ? interval.end : Infinity;
    return msgTime >= start && msgTime <= end;
  });
}

/**
 * Validates whether an incoming SSE data payload has recognized streaming message content.
 * Accepts recognized message/chunk content and explicit delta events.
 * Rejects empty objects, heartbeats/pings, and unrelated events.
 */
export function isRecognizedStreamChunk(data: unknown, eventName?: string | null): boolean {
  if (eventName === "delta") return true;
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  // 1. Text chunk: { v: "..." }
  if (typeof obj["v"] === "string" && obj["v"].length > 0) return true;

  // 2. Message object: { v: { message: ... } } or { message: ... }
  const vObj = obj["v"];
  if (vObj && typeof vObj === "object" && !Array.isArray(vObj)) {
    const vRec = vObj as Record<string, unknown>;
    if (vRec["message"] && typeof vRec["message"] === "object") return true;
  }
  if (obj["message"] && typeof obj["message"] === "object") return true;

  // 3. Patch array: { v: [ { p: "/message/content/parts/...", o: "append", v: "..." } ] }
  if (Array.isArray(vObj) && vObj.length > 0) {
    return vObj.some((patch) => {
      if (!patch || typeof patch !== "object") return false;
      const p = patch as Record<string, unknown>;
      return (
        typeof p["p"] === "string" &&
        p["p"].startsWith("/message/content/parts/") &&
        typeof p["v"] === "string"
      );
    });
  }

  // 4. Direct patch: { p: "/message/content/parts/...", o: "append", v: "..." }
  if (
    typeof obj["p"] === "string" &&
    obj["p"].startsWith("/message/content/parts/") &&
    typeof obj["v"] === "string"
  ) {
    return true;
  }

  return false;
}


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
    completenessStatus: "unknown",
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
  let existingIndex = session.messages.findIndex(
    (m) =>
      (rawMessage.id && m.id === rawMessage.id) ||
      (sourceMessageId && m.sourceMessageId === sourceMessageId) ||
      (m.role === rawMessage.role &&
        m.content.trim() === content.trim() &&
        m.timestamp &&
        timestamp &&
        Math.abs(new Date(m.timestamp).getTime() - new Date(timestamp).getTime()) < 3000)
  );

  // Safe pre-flight prompt reconciliation:
  // If not matched by exact ID or timestamp, check if rawMessage is a server/DOM user turn
  // reconciling an active pre-flight prompt (e.g. client generated usr-req-* or missing timestamp).
  // Crucial safeguard: NEVER merge distinct user turns simply because their text is identical!
  // Match ONLY if the pre-flight turn has no subsequent assistant response.
  if (existingIndex < 0 && rawMessage.role === "user" && content.trim().length > 0) {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i];
      if (m.role === "user" && m.content.trim() === content.trim()) {
        const isPreflight =
          m.id.startsWith("usr-req-") ||
          m.id.startsWith("prompt-") ||
          m.id.startsWith("input-") ||
          !m.timestamp;

        // Verify there is no subsequent assistant reply after this prompt turn
        const hasSubsequentAssistant = session.messages
          .slice(i + 1)
          .some((subMsg) => subMsg.role === "assistant");

        if (isPreflight && !hasSubsequentAssistant) {
          existingIndex = i;
          break;
        }
      }
    }
  }

  if (existingIndex >= 0) {
    // Update existing message in place without duplicating or disturbing sequence
    const updatedMessages = [...session.messages];
    const prev = updatedMessages[existingIndex];
    updatedMessages[existingIndex] = {
      ...prev,
      id: rawMessage.id || prev.id,
      content,
      timestamp: timestamp ?? prev.timestamp,
      sourceMessageId: sourceMessageId || prev.sourceMessageId,
      isInProgress: false,
    };
    return {
      ...session,
      messages: updatedMessages,
      completenessStatus: session.isComplete ? "complete" : "partial",
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
      completenessStatus: session.isComplete ? "complete" : "partial",
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
    completenessStatus: session.isComplete ? "complete" : "partial",
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
    timestamp: timestamp ?? null,
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

  const completenessStatus: CompletenessStatus = session.isComplete
    ? "complete"
    : reindexed.length > 0
    ? "partial"
    : "unknown";

  return {
    ...session,
    state: "checkpoint_available",
    messages: reindexed,
    completenessStatus,
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
    isComplete: false,
    completenessStatus: "partial",
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

  const completenessStatus: CompletenessStatus = isComplete ? "complete" : "partial";

  return {
    ...session,
    state: "completed",
    hasMoreHistory: hasMore,
    isComplete,
    completenessStatus,
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

/**
 * Evaluates whether a captured session legitimately corresponds to the currently active browser tab.
 * Enforces strict isolation between different conversation IDs while supporting the new-chat lifecycle.
 */
export function isSessionMatchingActiveTab(
  session: CapturedConversation | null,
  tabUrl: string | null,
  tabConvId: string | null
): boolean {
  if (!session) return false;

  // If the active tab is not a ChatGPT page at all, do not bind live session
  if (tabUrl && !tabUrl.includes("chatgpt.com")) {
    return false;
  }

  // Case 1: Tab has an authoritative conversation UUID (e.g. /c/3847f98d-...)
  if (tabConvId && tabConvId !== "new-chat") {
    // Exact ID match
    if (session.id === tabConvId) {
      return true;
    }
    // Session URL explicitly contains this exact conversation path
    if (session.url && session.url.includes(`/c/${tabConvId}`)) {
      return true;
    }
    // Transient promotional match: if the session is still provisional or temporary on chatgpt.com,
    // keep it matching during the URL update window while storage write settles
    if (
      (session.id === "provisional-tab" || session.id === "new-chat" || session.id.startsWith("temp-")) &&
      tabUrl &&
      tabUrl.includes("chatgpt.com")
    ) {
      return true;
    }
    // Crucial safeguard: An old conversation or different UUID MUST NEVER be associated with this tab
    return false;
  }

  // Case 2: Tab is on a brand new chat (https://chatgpt.com/ with no /c/ conversation ID yet)
  if (tabConvId === "new-chat") {
    // Explicit temporary or provisional session identifier
    if (
      session.id === "new-chat" ||
      session.id === "provisional-tab" ||
      session.id.startsWith("temp-") ||
      session.id.startsWith("provisional-")
    ) {
      return true;
    }
    // Session whose source URL is specifically the new chat root (and does not point to a saved /c/ ID)
    if (session.url && !session.url.includes("/c/")) {
      return true;
    }
    // An existing, established conversation (e.g. /c/conv-A) must NEVER bleed into a brand new chat tab
    return false;
  }

  // Case 3: Tab URL not yet available or non-browser test environment
  if (!tabUrl && !tabConvId) {
    return true;
  }

  return false;
}

export interface HistoricalConversationExtraction {
  conversationId: string | null;
  title?: string;
  messages: {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp?: string | null;
  }[];
  isComplete: boolean;
}

/**
 * Parses conversation history payloads returned by ChatGPT endpoints:
 * 1. GET /backend-api/conversation/<uuid> (mapping DAG structure with node message objects)
 * 2. GET /backend-api/conversations/<uuid>/messages (paginated messages array)
 */
export function extractMessagesFromConversationHistory(
  data: unknown
): HistoricalConversationExtraction {
  if (!data || typeof data !== "object") {
    return { conversationId: null, messages: [], isComplete: false };
  }

  const obj = data as Record<string, unknown>;
  const conversationId =
    typeof obj["conversation_id"] === "string" && obj["conversation_id"].length > 0
      ? obj["conversation_id"]
      : typeof obj["id"] === "string" && obj["id"].length > 0
      ? obj["id"]
      : null;

  const title =
    typeof obj["title"] === "string" && obj["title"].length > 0 ? obj["title"] : undefined;

  // Format 1: mapping DAG (ChatGPT web standard endpoint /backend-api/conversation/<uuid>)
  if (obj["mapping"] && typeof obj["mapping"] === "object" && !Array.isArray(obj["mapping"])) {
    const mapping = obj["mapping"] as Record<string, unknown>;
    const collected: {
      id: string;
      role: "user" | "assistant" | "system";
      content: string;
      createTime: number;
    }[] = [];

    for (const [nodeId, rawNode] of Object.entries(mapping)) {
      if (!rawNode || typeof rawNode !== "object") continue;
      const node = rawNode as Record<string, unknown>;
      const rawMsg = node["message"];
      if (!rawMsg || typeof rawMsg !== "object") continue;
      const msgObj = rawMsg as Record<string, unknown>;

      const author = msgObj["author"] as Record<string, unknown> | undefined;
      const role = (author?.["role"] || msgObj["role"]) as string | undefined;
      if (role !== "user" && role !== "assistant" && role !== "system") continue;

      let content = "";
      const rawContent = msgObj["content"];
      if (typeof rawContent === "string") {
        content = rawContent;
      } else if (rawContent && typeof rawContent === "object") {
        const cObj = rawContent as Record<string, unknown>;
        if (Array.isArray(cObj["parts"])) {
          content = cObj["parts"]
            .map((p) => {
              if (typeof p === "string") return p;
              if (p && typeof p === "object" && "text" in p) {
                return String((p as Record<string, unknown>).text);
              }
              return "";
            })
            .filter(Boolean)
            .join("\n");
        } else if (typeof cObj["text"] === "string") {
          content = cObj["text"];
        }
      }

      if (!content.trim() && role !== "system") continue;

      const id =
        typeof msgObj["id"] === "string" && msgObj["id"].length > 0 ? msgObj["id"] : nodeId;
      const createTimeNum =
        typeof msgObj["create_time"] === "number" ? msgObj["create_time"] : 0;

      collected.push({
        id,
        role: role as "user" | "assistant" | "system",
        content,
        createTime: createTimeNum,
      });
    }

    // Sort chronologically by create_time
    collected.sort((a, b) => a.createTime - b.createTime);

    // Completeness validation:
    // 1. Must have collected at least 1 message
    // 2. Explicit truncation or incomplete flags
    const isExplicitlyIncomplete =
      obj["is_complete"] === false ||
      obj["has_missing_messages"] === true ||
      obj["is_truncated"] === true ||
      obj["has_more"] === true;

    // 3. DAG integrity check:
    // Verify there is a root node (parent === null or undefined)
    // and that no node in the mapping points to an unincluded parent
    let hasRootNode = false;
    let hasBrokenParentLink = false;
    for (const rawNode of Object.values(mapping)) {
      if (!rawNode || typeof rawNode !== "object") continue;
      const node = rawNode as Record<string, unknown>;
      const parent = node["parent"];
      if (parent === null || parent === undefined) {
        hasRootNode = true;
      } else if (typeof parent === "string" && !mapping[parent]) {
        hasBrokenParentLink = true;
      }
    }

    const isComplete =
      collected.length > 0 &&
      !isExplicitlyIncomplete &&
      hasRootNode &&
      !hasBrokenParentLink;

    return {
      conversationId,
      title,
      messages: collected.map((c) => ({
        id: c.id,
        role: c.role,
        content: c.content,
        timestamp: c.createTime > 0 ? new Date(c.createTime * 1000).toISOString() : null,
      })),
      isComplete,
    };
  }

  // Format 2: raw messages array (paginated endpoint)
  const rawList = Array.isArray(obj["messages"])
    ? obj["messages"]
    : Array.isArray(data)
    ? data
    : null;

  if (rawList) {
    const messages: {
      id: string;
      role: "user" | "assistant" | "system";
      content: string;
      timestamp?: string | null;
    }[] = [];

    for (let idx = 0; idx < rawList.length; idx++) {
      const rawMsg = rawList[idx];
      if (!rawMsg || typeof rawMsg !== "object") continue;
      const m = rawMsg as Record<string, unknown>;
      const author = m["author"] as Record<string, unknown> | undefined;
      const role = (author?.["role"] || m["role"]) as string | undefined;
      if (role !== "user" && role !== "assistant" && role !== "system") continue;

      let content = "";
      if (typeof m["content"] === "string") {
        content = m["content"];
      } else if (m["content"] && typeof m["content"] === "object") {
        const cObj = m["content"] as Record<string, unknown>;
        if (Array.isArray(cObj["parts"])) {
          content = cObj["parts"].map((p) => (typeof p === "string" ? p : "")).join("\n");
        } else if (typeof cObj["text"] === "string") {
          content = cObj["text"];
        }
      }

      if (!content.trim() && role !== "system") continue;

      const id = typeof m["id"] === "string" ? m["id"] : `hist-msg-${idx + 1}`;
      const createTime = m["create_time"] ?? m["timestamp"];
      const timestamp =
        typeof createTime === "number"
          ? new Date(createTime * 1000).toISOString()
          : typeof createTime === "string"
          ? createTime
          : null;

      messages.push({
        id,
        role: role as "user" | "assistant" | "system",
        content,
        timestamp,
      });
    }

    const pageInfo = obj["page_info"] as Record<string, unknown> | undefined;
    const hasPrev = pageInfo?.["has_previous_page"] === true;
    const hasNext = pageInfo?.["has_next_page"] === true;
    const isExplicitlyIncomplete =
      obj["is_complete"] === false ||
      obj["has_missing_messages"] === true ||
      obj["is_truncated"] === true;

    return {
      conversationId,
      title,
      messages,
      isComplete: messages.length > 0 && !hasPrev && !hasNext && !isExplicitlyIncomplete,
    };
  }

  return { conversationId, title, messages: [], isComplete: false };
}

/**
 * Merges two captured conversation sessions deterministically.
 * Preserves existing messages, appends new messages, deduplicates by ID / sourceMessageId / content,
 * preserves chronological ordering, and normalizes sequence numbers 1..N.
 */
export function mergeCapturedSessions(
  existing: CapturedConversation,
  incoming: CapturedConversation
): CapturedConversation {
  if (!existing && !incoming) {
    throw new Error("Cannot merge two null sessions");
  }
  if (!existing) return incoming;
  const isIncomingCutoff =
    incoming.state === "interrupted" &&
    incoming.error === "Capture was paused by user.";

  const isExistingCutoff =
    existing.state === "interrupted" &&
    existing.error === "Capture was paused by user.";

  const state = isIncomingCutoff
    ? "interrupted"
    : (isExistingCutoff && incoming.state === "response_in_progress"
      ? "interrupted"
      : (incoming.state === "interrupted"
        ? "interrupted"
        : (incoming.state === "response_in_progress"
          ? "response_in_progress"
          : (existing.state === "response_in_progress"
            ? "response_in_progress"
            : (incoming.state === "checkpoint_available" || existing.state === "checkpoint_available"
              ? "checkpoint_available"
              : incoming.state)))));

  const isInterruptedResult = state === "interrupted";

  // Reconcile messages by ID / source ID / content
  const messageMap = new Map<string, NormalizedCaptureMessage>();

  for (const msg of existing.messages) {
    messageMap.set(msg.id, {
      ...msg,
      isInProgress: isInterruptedResult ? false : msg.isInProgress,
    });
  }

  for (const msg of incoming.messages) {
    let matchedId: string | null = null;
    if (messageMap.has(msg.id)) {
      matchedId = msg.id;
    } else {
      for (const [existingId, existingMsg] of messageMap.entries()) {
        const sameSource =
          Boolean(msg.sourceMessageId && existingMsg.sourceMessageId && msg.sourceMessageId === existingMsg.sourceMessageId) ||
          Boolean(msg.sourceMessageId && existingMsg.id === msg.sourceMessageId) ||
          Boolean(existingMsg.sourceMessageId && existingMsg.sourceMessageId === msg.id);

        const sameContentAndTime =
          existingMsg.role === msg.role &&
          existingMsg.content.trim() === msg.content.trim() &&
          existingMsg.timestamp &&
          msg.timestamp &&
          Math.abs(Date.parse(existingMsg.timestamp) - Date.parse(msg.timestamp)) < 3000;

        if (sameSource || sameContentAndTime) {
          matchedId = existingId;
          break;
        }
      }
    }

    if (matchedId) {
      const existingMsg = messageMap.get(matchedId)!;
      const betterContent =
        existingMsg.content.length >= msg.content.length ? existingMsg.content : msg.content;
      messageMap.set(matchedId, {
        ...existingMsg,
        content: isExistingCutoff && !isIncomingCutoff ? existingMsg.content : betterContent,
        timestamp: existingMsg.timestamp || msg.timestamp,
        sourceMessageId: existingMsg.sourceMessageId || msg.sourceMessageId,
        isInProgress: isInterruptedResult ? false : (existingMsg.isInProgress && msg.isInProgress),
      });
    } else {
      if (!isExistingCutoff || isIncomingCutoff) {
        messageMap.set(msg.id, {
          ...msg,
          isInProgress: isInterruptedResult ? false : msg.isInProgress,
        });
      }
    }
  }

  const mergedMessages = sortMessagesChronologically(Array.from(messageMap.values()));

  const isComplete = (isIncomingCutoff || isExistingCutoff)
    ? false
    : (existing.isComplete || incoming.isComplete);
  const completenessStatus: CompletenessStatus = (isIncomingCutoff || isExistingCutoff)
    ? "partial"
    : (isComplete
      ? "complete"
      : (existing.completenessStatus === "partial" || incoming.completenessStatus === "partial"
        ? "partial"
        : "unknown"));

  const latestCheckpoint =
    existing.lastCheckpointAt && incoming.lastCheckpointAt
      ? (Date.parse(existing.lastCheckpointAt) >= Date.parse(incoming.lastCheckpointAt)
        ? existing.lastCheckpointAt
        : incoming.lastCheckpointAt)
      : (incoming.lastCheckpointAt || existing.lastCheckpointAt || null);

  const error = isIncomingCutoff
    ? incoming.error
    : (isExistingCutoff
      ? existing.error
      : (incoming.error || existing.error || null));

  const isExistingProvisional = existing.id === "provisional-tab" || existing.id === "new-chat";
  const isIncomingProvisional = incoming.id === "provisional-tab" || incoming.id === "new-chat";
  let targetId: string;
  if (isIncomingProvisional && !isExistingProvisional) {
    targetId = existing.id;
  } else if (!isIncomingProvisional) {
    targetId = incoming.id;
  } else {
    targetId = existing.id || incoming.id;
  }

  return {
    id: targetId,
    platform: incoming.platform || existing.platform || "chatgpt",
    title:
      incoming.title && incoming.title !== "ChatGPT" && incoming.title !== "ChatGPT conversation"
        ? incoming.title
        : (existing.title || "ChatGPT conversation"),
    url: incoming.url || existing.url || null,
    messages: mergedMessages,
    state,
    hasMoreHistory: incoming.hasMoreHistory ?? existing.hasMoreHistory ?? false,
    isComplete,
    completenessStatus,
    capturedAt: existing.capturedAt || incoming.capturedAt || new Date().toISOString(),
    lastCheckpointAt: latestCheckpoint,
    error,
  };
}

/**
 * Converts a persisted storage Conversation entity into a CapturedConversation session.
 */
export function conversationToCapturedSession(
  conv: {
    id: string;
    platform?: string;
    title?: string;
    url?: string;
    completeness?: string;
    capturedAt?: string;
    messages?: {
      id: string;
      role: MessageRole;
      content: string;
      timestamp?: string;
      sourceMessageId?: string;
    }[];
  }
): CapturedConversation {
  const isComplete = conv.completeness === "complete";
  const messages: NormalizedCaptureMessage[] = (conv.messages || []).map((m, idx) => ({
    id: m.id,
    sequence: idx + 1,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp ?? null,
    sourceMessageId: m.sourceMessageId ?? m.id,
    isInProgress: false,
  }));

  return {
    id: conv.id,
    platform: conv.platform || "chatgpt",
    title: conv.title || "ChatGPT conversation",
    url: conv.url || null,
    messages,
    state: "completed",
    hasMoreHistory: false,
    isComplete,
    completenessStatus: isComplete ? "complete" : "partial",
    capturedAt: conv.capturedAt || new Date().toISOString(),
    lastCheckpointAt: conv.capturedAt || null,
    error: null,
  };
}

/**
 * Standard regular expression for UUID v4 epoch IDs.
 */
export const EPOCH_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Runtime schema validator for authoritative EpochRecord entities.
 */
export function isValidEpochRecord(record: unknown): record is EpochRecord {
  if (!record || typeof record !== "object") return false;
  const r = record as Record<string, unknown>;
  if (typeof r.epochId !== "string" || !EPOCH_ID_REGEX.test(r.epochId)) return false;
  if (r.status !== "active" && r.status !== "closed" && r.status !== "invalidated") return false;
  if (typeof r.createdAt !== "number" || isNaN(r.createdAt) || r.createdAt <= 0) return false;
  if (r.createdBy !== "popup" && r.createdBy !== "recovery") return false;
  if (r.closedAt !== undefined && r.closedAt !== null && (typeof r.closedAt !== "number" || isNaN(r.closedAt))) return false;
  if (r.invalidatedAt !== undefined && r.invalidatedAt !== null && (typeof r.invalidatedAt !== "number" || isNaN(r.invalidatedAt))) return false;
  return true;
}

/**
 * Predicate checking whether a session snapshot represents an intentional privacy cutoff.
 */
export function isCutoffSnapshot(session: unknown): boolean {
  if (!session || typeof session !== "object") return false;
  const s = session as Record<string, unknown>;
  return s.state === "interrupted" && s.error === PRIVACY_CUTOFF_SENTINEL;
}

/**
 * Structural integrity validator for active CapturedConversation entities (Predicate P6).
 */
export function isValidCapturedSessionStructure(session: unknown): boolean {
  if (!session || typeof session !== "object" || Array.isArray(session)) return false;
  const s = session as Record<string, unknown>;
  if (typeof s.id !== "string" || s.id.trim().length === 0) return false;
  if (s.platform !== "chatgpt") return false;
  const validStates = [
    "idle",
    "capturing",
    "response_in_progress",
    "checkpoint_available",
    "interrupted",
    "completed",
    "failed",
  ];
  if (typeof s.state !== "string" || !validStates.includes(s.state)) return false;
  if (!Array.isArray(s.messages)) return false;
  for (const m of s.messages) {
    if (!m || typeof m !== "object") return false;
    if (typeof m.id !== "string" || m.id.length === 0) return false;
    if (typeof m.sequence !== "number" || !Number.isInteger(m.sequence) || m.sequence <= 0) return false;
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") return false;
    if (typeof m.content !== "string") return false;
  }
  if (typeof s.capturedAt !== "string" || isNaN(Date.parse(s.capturedAt))) return false;
  if (typeof s.epochId !== "string" || !EPOCH_ID_REGEX.test(s.epochId)) return false;
  if (typeof s.hasMoreHistory !== "boolean" || typeof s.isComplete !== "boolean") return false;
  return true;
}

export type StartRecoveryOutcome =
  | { status: "complete" }
  | { status: "pending_resumable" }
  | { status: "corrupted_session" }
  | { status: "invalid_epoch" }
  | { status: "expired" };

/**
 * Evaluates the 6-part start_capture recovery predicate (P1–P6).
 */
export function evaluateStartRecoveryPredicate(
  storage: {
    activeCaptureSession?: unknown;
    activeEpoch?: unknown;
    epochRegistry?: unknown;
  },
  pending: PendingLifecycleTransition,
  now: number = Date.now()
): StartRecoveryOutcome {
  if (now > pending.expiresAt) {
    return { status: "expired" };
  }

  const targetEpoch = pending.targetEpochId;
  const session = storage.activeCaptureSession as Record<string, unknown> | undefined;
  const registry = (storage.epochRegistry && typeof storage.epochRegistry === "object"
    ? (storage.epochRegistry as EpochRegistry)
    : {}) as EpochRegistry;
  const epochRec = registry[targetEpoch];

  const p1 = !!session && typeof session === "object";
  const p2 = p1 && session.epochId === targetEpoch;
  const p3 = storage.activeEpoch === targetEpoch;
  const p4 = !!epochRec && isValidEpochRecord(epochRec);
  const p5 = p4 && epochRec.status === "active";
  const p6 = p1 && isValidCapturedSessionStructure(session);

  if (p1 && p2 && p3 && p4 && p5 && p6) {
    return { status: "complete" };
  }

  if (!p3 || !p4 || !p5) {
    return { status: "invalid_epoch" };
  }

  if (p1 && p2 && !p6) {
    return { status: "corrupted_session" };
  }

  return { status: "pending_resumable" };
}

export type StopRecoveryOutcome =
  | { status: "complete" }
  | { status: "session_cutoff_registry_pending" }
  | { status: "cutoff_failed" }
  | { status: "expired" };

/**
 * Evaluates the 2-part stop_capture recovery predicate (Q1–Q2).
 */
export function evaluateStopRecoveryPredicate(
  storage: {
    activeCaptureSession?: unknown;
    activeEpoch?: unknown;
    epochRegistry?: unknown;
  },
  pending: PendingLifecycleTransition,
  now: number = Date.now()
): StopRecoveryOutcome {
  if (now > pending.expiresAt) {
    return { status: "expired" };
  }

  const targetEpoch = pending.targetEpochId;
  const session = storage.activeCaptureSession as Record<string, unknown> | undefined;
  const registry = (storage.epochRegistry && typeof storage.epochRegistry === "object"
    ? (storage.epochRegistry as EpochRegistry)
    : {}) as EpochRegistry;
  const epochRec = registry[targetEpoch];

  const isEpochClosedOrInvalidated =
    !!epochRec &&
    isValidEpochRecord(epochRec) &&
    (epochRec.status === "closed" || epochRec.status === "invalidated");

  const q1 =
    (!session && isEpochClosedOrInvalidated) ||
    (!!session && session.epochId === targetEpoch && isCutoffSnapshot(session));

  const q2 = isEpochClosedOrInvalidated;

  if (q1 && q2) {
    return { status: "complete" };
  }

  if (q1 && !q2) {
    return { status: "session_cutoff_registry_pending" };
  }

  return { status: "cutoff_failed" };
}

