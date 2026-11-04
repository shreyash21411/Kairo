/**
 * rawConversationExport.ts
 *
 * Standalone Raw Conversation JSON Export for VOIDZONE.
 * Format identifier: "voidzone-raw-conversation"
 * Format version: "1.0"
 *
 * Strictly decoupled from Memory and Continuity Engines:
 * - Contains NO Meta AI memory extraction output.
 * - Contains NO continuity transfer prompts or instructions.
 * - Contains NO derived project state, recommendations, or decisions.
 * - Contains NO API keys, credentials, or secrets.
 * - Operates 100% locally with zero backend or network dependencies.
 *
 * Strict Role Filter:
 * - Exports ONLY 'user' and 'assistant' messages.
 * - Strictly excludes 'system' messages, internal prompts, or hidden instructions.
 */

import type { CapturedConversation } from "./captureTypes.ts";
import { parseTranscriptToMessages } from "./claudeParser.ts";

export const RAW_CONVERSATION_FORMAT = "voidzone-raw-conversation" as const;
export const RAW_CONVERSATION_VERSION = "1.0" as const;

export type RawCaptureCompleteness = "complete" | "partial" | "unknown";
export type RawConversationRole = "user" | "assistant";

export interface RawConversationMessage {
  id: string;
  sequence: number;
  role: RawConversationRole;
  content: string;
  timestamp: string | null;
  sourceMessageId?: string | null;
}

export interface RawConversationExport {
  format: typeof RAW_CONVERSATION_FORMAT;
  version: typeof RAW_CONVERSATION_VERSION;
  conversationId: string | null;
  sourcePlatform: string;
  conversationTitle: string;
  exportedAt: string;
  captureCompleteness: RawCaptureCompleteness;
  messageCount: number;
  messages: RawConversationMessage[];
}

/**
 * Resolves the capture completeness status honestly:
 * - Explicitly complete captures remain complete (provided not interrupted/hasMoreHistory).
 * - Interrupted or partial captures remain partial.
 * - Unknown completeness remains unknown.
 * - No incomplete capture is incorrectly marked complete.
 */
export function resolveCaptureCompleteness(
  captured: Pick<
    CapturedConversation,
    "isComplete" | "completenessStatus" | "state" | "hasMoreHistory"
  >
): RawCaptureCompleteness {
  // 1. Explicitly interrupted, has more history, or explicitly partial -> always partial
  if (
    captured.state === "interrupted" ||
    captured.hasMoreHistory === true ||
    captured.completenessStatus === "partial"
  ) {
    return "partial";
  }

  // 2. Explicitly unknown completeness -> remains unknown
  if (captured.completenessStatus === "unknown") {
    return "unknown";
  }

  // 3. Explicitly verified complete -> complete (guaranteed not interrupted / no more history)
  if (captured.isComplete === true || captured.completenessStatus === "complete") {
    return "complete";
  }

  // 4. Default for any ongoing or unverified session
  return "partial";
}

/**
 * Creates a raw conversation JSON export structure directly from a CapturedConversation.
 * Filters messages strictly to 'user' and 'assistant' roles only.
 */
export function createRawConversationFromCaptured(
  captured: CapturedConversation
): RawConversationExport {
  if (!captured || !Array.isArray(captured.messages) || captured.messages.length === 0) {
    throw new Error("Captured conversation contains no messages to export.");
  }

  // Strict role filter: ONLY 'user' and 'assistant' allowed.
  // System messages, internal prompts, and empty fragments are strictly excluded.
  const validMessages = captured.messages.filter(
    (m) =>
      m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0
  );

  if (validMessages.length === 0) {
    throw new Error("Captured conversation contains no valid user or assistant messages to export.");
  }

  // Preserve honest completeness status without fabricating completeness
  const captureCompleteness = resolveCaptureCompleteness(captured);

  // Safe conversation ID for traceability (null for provisional/new tabs)
  const conversationId =
    captured.id &&
    captured.id !== "provisional-tab" &&
    captured.id !== "new-chat"
      ? captured.id
      : null;

  const messages: RawConversationMessage[] = validMessages.map((m, idx) => ({
    id: m.id || `msg-${idx + 1}`,
    sequence: idx + 1,
    role: m.role as RawConversationRole,
    content: m.content,
    timestamp: m.timestamp ?? null,
    sourceMessageId: m.sourceMessageId ?? null,
  }));

  return {
    format: RAW_CONVERSATION_FORMAT,
    version: RAW_CONVERSATION_VERSION,
    conversationId,
    sourcePlatform: (captured.platform || "chatgpt").toLowerCase().trim(),
    conversationTitle: (captured.title || "Captured conversation").trim(),
    exportedAt: new Date().toISOString(),
    captureCompleteness,
    messageCount: messages.length,
    messages,
  };
}

/**
 * Fallback generator for manually provided messages.
 * Strictly filters to 'user' and 'assistant' roles only.
 */
export function createRawConversationFromManual(options: {
  messages: Array<{
    role: string;
    content: string;
    timestamp?: string | null;
    id?: string;
    sequence?: number;
    sourceMessageId?: string | null;
  }>;
  platform?: string;
  title?: string;
  conversationId?: string | null;
  completeness?: RawCaptureCompleteness;
}): RawConversationExport {
  if (!options || !Array.isArray(options.messages) || options.messages.length === 0) {
    throw new Error("No messages provided for raw export.");
  }

  // Strictly filter to user and assistant roles only
  const validMessages = options.messages.filter(
    (m) =>
      m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0
  );

  if (validMessages.length === 0) {
    throw new Error("No valid user or assistant messages provided for raw export.");
  }

  const messages: RawConversationMessage[] = validMessages.map((m, idx) => ({
    id: m.id || `msg-${idx + 1}`,
    sequence: idx + 1,
    role: m.role as RawConversationRole,
    content: m.content,
    timestamp: m.timestamp ?? null,
    sourceMessageId: m.sourceMessageId ?? null,
  }));

  return {
    format: RAW_CONVERSATION_FORMAT,
    version: RAW_CONVERSATION_VERSION,
    conversationId: options.conversationId ?? null,
    sourcePlatform: (options.platform || "chatgpt").toLowerCase().trim(),
    conversationTitle: (options.title || "Manual transcript").trim(),
    exportedAt: new Date().toISOString(),
    captureCompleteness: options.completeness || "unknown",
    messageCount: messages.length,
    messages,
  };
}

/**
 * Creates a raw conversation JSON export structure directly from a raw transcript string.
 */
export function createRawConversationFromTranscript(
  rawTranscript: string,
  options: {
    platform?: string;
    title?: string;
    conversationId?: string | null;
    completeness?: RawCaptureCompleteness;
  } = {}
): RawConversationExport {
  if (!rawTranscript || !rawTranscript.trim()) {
    throw new Error("Transcript content cannot be empty.");
  }
  const { messages } = parseTranscriptToMessages(rawTranscript);
  return createRawConversationFromManual({
    messages,
    platform: options.platform,
    title: options.title,
    conversationId: options.conversationId,
    completeness: options.completeness,
  });
}

/**
 * Generates a filesystem-safe filename for the exported JSON file.
 * Handles illegal characters, spaces, and edge cases gracefully.
 */
export function generateSafeRawExportFilename(
  title: string,
  conversationId?: string | null
): string {
  const sanitized = (title || "voidzone-conversation")
    .toLowerCase()
    .replace(/[/\\?%*:|"<>]/g, "") // strip illegal characters
    .replace(/\s+/g, "-")          // spaces to dashes
    .replace(/-+/g, "-")          // collapse consecutive dashes
    .replace(/^-|-$/g, "")        // trim leading/trailing dashes
    .slice(0, 40);

  const base = sanitized.length > 0 ? sanitized : "voidzone-conversation";
  const idSuffix = conversationId
    ? `-${conversationId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8)}`
    : "";

  return `${base}${idSuffix}-raw.json`;
}

/**
 * Serializes a RawConversationExport object into a formatted UTF-8 JSON string.
 */
export function serializeRawConversation(data: RawConversationExport): string {
  return JSON.stringify(data, null, 2);
}
