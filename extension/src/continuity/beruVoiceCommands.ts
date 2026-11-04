/**
 * beruVoiceCommands.ts
 *
 * Dedicated Voice Command & Transfer Orchestration for BERU:
 * - Natural language intent parsing for voice commands:
 *     - Wake-word: "Hey Beru", "Beru"
 *     - Export: "Get/download me the chat file"
 *     - Cross-Platform Transfer: "Give this file to Claude"
 *     - Control: "Stop listening", "Cancel"
 * - Reuses existing standalone conversation JSON generation (rawConversationExport.ts).
 * - Strictly decoupled from Meta AI, Memory Extraction, and Continuity Engines.
 * - Formats honest continuation prompts for Claude without altering or truncating source messages.
 */

import {
  createRawConversationFromCaptured,
  generateSafeRawExportFilename,
  serializeRawConversation,
  type RawConversationExport,
} from "./rawConversationExport.ts";
import type { CapturedConversation } from "./captureTypes.ts";

export type BeruCommandType =
  | "wake_word"
  | "get_chat_file"
  | "transfer_to_claude"
  | "stop_listening"
  | "general_query";

export interface BeruVoiceIntent {
  type: BeruCommandType;
  rawInput: string;
  cleanedText: string;
  query?: string;
}

export interface GetChatFileResult {
  success: boolean;
  exportData?: RawConversationExport;
  jsonString?: string;
  filename?: string;
  message: string;
  spokenText: string;
}

export interface TransferToClaudeResult {
  success: boolean;
  continuationPrompt: string;
  targetUrl: string;
  message: string;
  spokenText: string;
  filename?: string;
}

export const CLAUDE_NEW_CHAT_URL = "https://claude.ai/new";

/**
 * Normalizes speech text by stripping punctuation and extraneous whitespace.
 */
export function normalizeSpeech(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks whether the transcribed speech is or begins with the wake word "Hey Beru" or "Beru".
 */
export function isWakeWord(text: string): boolean {
  const norm = normalizeSpeech(text);
  return (
    norm === "hey beru" ||
    norm === "hi beru" ||
    norm === "hello beru" ||
    norm === "ok beru" ||
    norm === "okay beru" ||
    norm === "beru"
  );
}

/**
 * Strips leading wake-word prefixes from user speech input.
 */
export function stripWakeWordPrefix(text: string): string {
  const norm = normalizeSpeech(text);
  const prefixes = [
    "hey beru",
    "hi beru",
    "hello beru",
    "ok beru",
    "okay beru",
    "beru",
  ];

  for (const prefix of prefixes) {
    if (norm === prefix) {
      return "";
    }
    if (norm.startsWith(`${prefix} `)) {
      return norm.slice(prefix.length + 1).trim();
    }
  }

  return norm;
}

/**
 * Parses spoken speech text into a structured BERU voice intent.
 */
export function parseBeruVoiceCommand(speechText: string): BeruVoiceIntent {
  const rawInput = speechText || "";
  const cleanedText = normalizeSpeech(rawInput);

  if (!cleanedText) {
    return { type: "general_query", rawInput, cleanedText: "", query: "" };
  }

  // 1. Check for pure wake-word
  if (isWakeWord(cleanedText)) {
    return { type: "wake_word", rawInput, cleanedText };
  }

  // Strip optional wake word prefix if user said "Hey Beru, [command]" in one sentence
  const commandBody = stripWakeWordPrefix(cleanedText);

  if (!commandBody) {
    return { type: "wake_word", rawInput, cleanedText };
  }

  // 2. Check for "Stop listening" / "Cancel" commands
  const stopPhrases = [
    "stop listening",
    "stop",
    "cancel",
    "cancel that",
    "mute",
    "be quiet",
    "never mind",
  ];
  if (stopPhrases.some((phrase) => commandBody === phrase || commandBody.startsWith(`${phrase} `))) {
    return { type: "stop_listening", rawInput, cleanedText };
  }

  // 3. Check for "Get / download chat file" command
  const getFilePatterns = [
    "get me the chat file",
    "get the chat file",
    "get my chat file",
    "get chat file",
    "download me the chat file",
    "download the chat file",
    "download my chat file",
    "download chat file",
    "download this chat",
    "download conversation",
    "download this conversation",
    "get conversation file",
    "get conversation",
    "export chat file",
    "export conversation",
    "save chat file",
  ];

  const matchesGetFile = getFilePatterns.some(
    (pattern) => commandBody === pattern || commandBody.includes(pattern)
  );

  if (matchesGetFile) {
    return { type: "get_chat_file", rawInput, cleanedText };
  }

  // 4. Check for "Give this file to Claude" / "Transfer to Claude" command
  const transferPatterns = [
    "give this file to claude",
    "give the file to claude",
    "give file to claude",
    "give this to claude",
    "transfer this file to claude",
    "transfer this to claude",
    "transfer to claude",
    "send this file to claude",
    "send this to claude",
    "send to claude",
    "open this in claude",
    "open claude",
    "open a new claude chat",
    "open a new claude conversation",
    "pass this to claude",
  ];

  const matchesTransfer = transferPatterns.some(
    (pattern) => commandBody === pattern || commandBody.includes(pattern)
  );

  if (matchesTransfer) {
    return { type: "transfer_to_claude", rawInput, cleanedText };
  }

  // 5. Default to general query (for conversational responses)
  return {
    type: "general_query",
    rawInput,
    cleanedText,
    query: commandBody || rawInput,
  };
}

/**
 * Builds the canonical continuation prompt for Claude using the exact standalone conversation export.
 * Preserves message ordering, user/assistant attribution, timestamps, and conversation metadata.
 */
export function buildClaudeContinuationPrompt(exportData: RawConversationExport): string {
  if (!exportData || !Array.isArray(exportData.messages) || exportData.messages.length === 0) {
    throw new Error("Cannot format Claude continuation prompt: Export contains no messages.");
  }

  const lines: string[] = [
    "You are continuing a project previously discussed in another AI session. Below is the verified conversation transcript from the previous session:",
    "",
    `=== PREVIOUS CONVERSATION: ${exportData.conversationTitle || "Untitled Session"} ===`,
    `Source Platform: ${(exportData.sourcePlatform || "chatgpt").toUpperCase()}`,
    `Exported At: ${exportData.exportedAt || new Date().toISOString()}`,
    `Completeness: ${exportData.captureCompleteness.toUpperCase()}`,
    `Message Count: ${exportData.messageCount}`,
    "",
    "--- TRANSCRIPT BEGIN ---",
  ];

  for (const msg of exportData.messages) {
    const roleLabel = msg.role === "user" ? "User" : "Assistant";
    const timeLabel = msg.timestamp ? ` [${msg.timestamp}]` : "";
    lines.push(`${roleLabel}${timeLabel}:`);
    lines.push(msg.content);
    lines.push(""); // blank line separating turns
  }

  lines.push("--- TRANSCRIPT END ---");
  lines.push("");
  lines.push(
    "Please review the preceding transcript and continue assisting me with our project from our last point of discussion."
  );

  return lines.join("\n");
}

/**
 * Executes the "Get / download chat file" command.
 * Retrieves the current captured conversation, generates the standalone JSON export,
 * and triggers a client-side file download.
 */
export function executeGetChatFile(
  capturedSession: CapturedConversation | null,
  triggerBrowserDownload = true
): GetChatFileResult {
  if (
    !capturedSession ||
    !Array.isArray(capturedSession.messages) ||
    capturedSession.messages.length === 0
  ) {
    return {
      success: false,
      message:
        "No captured conversation found. Please ensure ChatGPT is active and messages have been captured.",
      spokenText:
        "I couldn't retrieve the current conversation. Please make sure you have an active ChatGPT session captured.",
    };
  }

  try {
    const exportData = createRawConversationFromCaptured(capturedSession);
    const jsonString = serializeRawConversation(exportData);
    const filename = generateSafeRawExportFilename(
      exportData.conversationTitle,
      exportData.conversationId
    );

    if (triggerBrowserDownload && typeof document !== "undefined") {
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) {
          document.body.removeChild(a);
        }
        URL.revokeObjectURL(url);
      }, 1000);
    }

    return {
      success: true,
      exportData,
      jsonString,
      filename,
      message: `Conversation file ready: ${filename} (${exportData.messageCount} messages).`,
      spokenText: `Your conversation file is ready. I've downloaded ${filename}.`,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Failed to create conversation export.";
    return {
      success: false,
      message: errorMsg,
      spokenText: "I couldn't generate the chat file due to an error.",
    };
  }
}

/**
 * Executes the "Give this file to Claude" command.
 * Prepares the continuation prompt from the standalone JSON export,
 * copies it to the user's clipboard for direct pasting into Claude,
 * and opens https://claude.ai/new in a new browser tab.
 */
export async function executeTransferToClaude(
  exportData: RawConversationExport,
  openTab = true
): Promise<TransferToClaudeResult> {
  if (!exportData || !Array.isArray(exportData.messages) || exportData.messages.length === 0) {
    return {
      success: false,
      continuationPrompt: "",
      targetUrl: CLAUDE_NEW_CHAT_URL,
      message: "No conversation file available to transfer to Claude.",
      spokenText: "I couldn't find a conversation file to transfer. Please get the chat file first.",
    };
  }

  const prompt = buildClaudeContinuationPrompt(exportData);

  // Copy continuation prompt to clipboard so user can seamlessly paste (Ctrl+V / Cmd+V) in Claude
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Tolerate clipboard permission error in non-interactive / background contexts
    }
  }

  // Open Claude new conversation
  if (openTab) {
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url: CLAUDE_NEW_CHAT_URL });
    } else if (typeof window !== "undefined") {
      window.open(CLAUDE_NEW_CHAT_URL, "_blank");
    }
  }

  const filename = generateSafeRawExportFilename(
    exportData.conversationTitle,
    exportData.conversationId
  );

  return {
    success: true,
    continuationPrompt: prompt,
    targetUrl: CLAUDE_NEW_CHAT_URL,
    filename,
    message: `Opened Claude in a new tab. Verified conversation context (${exportData.messageCount} messages) copied to clipboard.`,
    spokenText:
      "Opening a new Claude conversation. Your conversation transcript is prepared and copied to your clipboard so you can paste it directly.",
  };
}
