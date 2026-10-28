import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseTranscriptToMessages } from "../src/continuity/claudeParser.ts";

describe("claudeParser — Heuristic Transcript Parsing", () => {
  test("parses multi-turn Human: and Claude: conversation", () => {
    const transcript = [
      "Human: What is VOIDZONE?",
      "Claude: VOIDZONE is an AI continuity platform.",
      "Human: Does it work offline?",
      "Claude: Yes, Phase 1 works completely offline without network.",
    ].join("\n");

    const result = parseTranscriptToMessages(transcript);

    assert.strictEqual(result.parseConfidence, "structured");
    assert.strictEqual(result.messages.length, 4);

    assert.strictEqual(result.messages[0].sequence, 1);
    assert.strictEqual(result.messages[0].role, "user");
    assert.strictEqual(result.messages[0].content, "What is VOIDZONE?");
    assert.strictEqual(result.messages[0].timestamp, null);
    assert.strictEqual(result.messages[0].isSynthetic, true);

    assert.strictEqual(result.messages[1].sequence, 2);
    assert.strictEqual(result.messages[1].role, "assistant");
    assert.strictEqual(
      result.messages[1].content,
      "VOIDZONE is an AI continuity platform."
    );

    assert.strictEqual(result.messages[2].sequence, 3);
    assert.strictEqual(result.messages[2].role, "user");

    assert.strictEqual(result.messages[3].sequence, 4);
    assert.strictEqual(result.messages[3].role, "assistant");
  });

  test("parses multi-turn User: and Assistant: / You: turns", () => {
    const transcript = [
      "User: Can we test edge cases?",
      "Assistant: Certainly! Here is a multiline response:\nLine 1\nLine 2",
      "You: Looks great.",
      "ChatGPT: Glad to help.",
    ].join("\n");

    const result = parseTranscriptToMessages(transcript);

    assert.strictEqual(result.parseConfidence, "structured");
    assert.strictEqual(result.messages.length, 4);
    assert.strictEqual(result.messages[0].role, "user");
    assert.strictEqual(result.messages[1].role, "assistant");
    assert.ok(result.messages[1].content.includes("Line 1\nLine 2"));
    assert.strictEqual(result.messages[2].role, "user");
    assert.strictEqual(result.messages[3].role, "assistant");
  });

  test("does not split turns inside fenced code blocks containing User: or Assistant:", () => {
    const transcript = [
      "Human: Please generate a YAML prompt template.",
      "Claude: Here is the YAML template:",
      "```yaml",
      "template:",
      "  User: Provide your inputs here",
      "  Assistant: Expected output structure",
      "```",
      "Human: Thanks, that looks correct.",
      "Claude: You are welcome!",
    ].join("\n");

    const result = parseTranscriptToMessages(transcript);

    assert.strictEqual(result.parseConfidence, "structured");
    // Should be exactly 4 turns, NOT 6 turns
    assert.strictEqual(result.messages.length, 4);
    assert.strictEqual(result.messages[0].role, "user");
    assert.strictEqual(result.messages[1].role, "assistant");
    assert.ok(result.messages[1].content.includes("User: Provide your inputs here"));
    assert.ok(result.messages[1].content.includes("Assistant: Expected output structure"));
    assert.strictEqual(result.messages[2].role, "user");
    assert.strictEqual(result.messages[3].role, "assistant");
  });

  test("falls back to single synthetic message for unstructured prose", () => {
    const transcript =
      "This is just some freeform text without any speaker labels. It explains a database bug.";

    const result = parseTranscriptToMessages(transcript);

    assert.strictEqual(result.parseConfidence, "unstructured");
    assert.strictEqual(result.messages.length, 1);
    assert.strictEqual(result.messages[0].sequence, 1);
    assert.strictEqual(result.messages[0].role, "user");
    assert.strictEqual(result.messages[0].content, transcript);
    assert.strictEqual(result.messages[0].timestamp, null);
  });

  test("handles empty or whitespace-only transcript", () => {
    const result = parseTranscriptToMessages("   \n\t  ");

    assert.strictEqual(result.parseConfidence, "unstructured");
    assert.strictEqual(result.messages.length, 0);
  });

  test("preserves unicode, code snippets and markdown in content", () => {
    const transcript = [
      "Human: Check this code: `const x = 🚀;`",
      "Claude: ```typescript\nfunction test() { return '你好'; }\n```",
    ].join("\n");

    const result = parseTranscriptToMessages(transcript);

    assert.strictEqual(result.parseConfidence, "structured");
    assert.strictEqual(result.messages.length, 2);
    assert.ok(result.messages[0].content.includes("🚀"));
    assert.ok(result.messages[1].content.includes("你好"));
  });
});
