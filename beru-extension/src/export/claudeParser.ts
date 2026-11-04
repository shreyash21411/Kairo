/**
 * claudeParser.ts
 *
 * Heuristic parser for multi-turn conversation transcripts (e.g. Claude, ChatGPT).
 * Recognizes common speaker prefix delimiters (Human:, Claude:, User:, Assistant:, You:).
 *
 * Guarantees:
 * - Original message content is preserved without alteration.
 * - Sequence order is strictly 1-based ascending.
 * - Timestamps are NEVER invented (remain null).
 * - Identifiers are marked isSynthetic: true.
 * - Unstructured text safely falls back to a single synthetic user message.
 * - Code blocks containing "User:" / "Assistant:" do not trigger false turn splits.
 */

import type { ArchiveMessage, MessageRole } from "./archiveSchema.ts";

export interface ParseTranscriptResult {
  messages: ArchiveMessage[];
  parseConfidence: "structured" | "unstructured";
}

const ROLE_MAP: Record<string, MessageRole> = {
  human: "user",
  user: "user",
  you: "user",
  claude: "assistant",
  assistant: "assistant",
  chatgpt: "assistant",
};

/**
 * Parses raw transcript text into an ordered list of ArchiveMessage objects.
 */
export function parseTranscriptToMessages(
  rawTranscript: string
): ParseTranscriptResult {
  const trimmed = rawTranscript.trim();

  if (!trimmed) {
    return {
      messages: [],
      parseConfidence: "unstructured",
    };
  }

  const lines = trimmed.split(/\r?\n/);
  const turnBlocks: { role: MessageRole; lines: string[] }[] = [];
  let currentTurn: { role: MessageRole; lines: string[] } | null = null;
  let detectedTurns = 0;
  let inCodeBlock = false;

  for (const line of lines) {
    // Detect fenced code block delimiters (``` or ~~~)
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeBlock = !inCodeBlock;
      if (currentTurn) {
        currentTurn.lines.push(line);
      } else {
        currentTurn = { role: "user", lines: [line] };
      }
      continue;
    }

    // Only inspect for speaker labels when OUTSIDE code blocks
    const match = !inCodeBlock
      ? line.match(/^(Human|Claude|User|Assistant|You|ChatGPT):\s*(.*)$/i)
      : null;

    if (match) {
      const speakerKey = match[1].toLowerCase();
      const role = ROLE_MAP[speakerKey] ?? "user";
      const remainingContent = match[2];

      detectedTurns++;

      if (currentTurn) {
        turnBlocks.push(currentTurn);
      }

      currentTurn = {
        role,
        lines: remainingContent ? [remainingContent] : [],
      };
    } else {
      if (currentTurn) {
        currentTurn.lines.push(line);
      } else {
        // Text before any speaker label — initialize default turn
        currentTurn = {
          role: "user",
          lines: [line],
        };
      }
    }
  }

  if (currentTurn && currentTurn.lines.length > 0) {
    turnBlocks.push(currentTurn);
  }

  // If at least 2 speaker labels were recognized, consider it structured
  if (detectedTurns >= 2 && turnBlocks.length > 0) {
    const messages: ArchiveMessage[] = turnBlocks
      .map((block, index) => {
        const content = block.lines.join("\n").trim();
        return {
          id: `msg-${index + 1}`,
          sequence: index + 1,
          role: block.role,
          content,
          timestamp: null,
          isSynthetic: true,
        };
      })
      .filter((m) => m.content.length > 0);

    // Re-index sequences after any empty filter
    const reindexed = messages.map((m, idx) => ({
      ...m,
      id: `msg-${idx + 1}`,
      sequence: idx + 1,
    }));

    return {
      messages: reindexed,
      parseConfidence: "structured",
    };
  }

  // Fallback for unstructured prose or single turn
  return {
    messages: [
      {
        id: "msg-1",
        sequence: 1,
        role: "user",
        content: trimmed,
        timestamp: null,
        isSynthetic: true,
      },
    ],
    parseConfidence: "unstructured",
  };
}
