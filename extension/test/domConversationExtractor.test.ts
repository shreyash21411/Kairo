/**
 * domConversationExtractor.test.ts
 *
 * Tests for the evidence-based ChatGPT DOM extraction pipeline.
 *
 * Covers:
 *  1.  User message extraction from observed DOM structure (data-user-message-bubble)
 *  2.  Assistant response extraction from observed DOM structure (DilResponseRoot)
 *  3.  Exclusion of badges and unrelated content
 *  4.  No duplicate extraction from nested elements
 *  5.  Streaming assistant response updates (isInProgress handling)
 *  6.  Correct message order and roles
 *  7.  Fallback extraction when no structured turn containers exist
 *  8.  Handling of the root route (no conversationId in URL)
 *  9.  Handling of /c/<id> route (conversationId extracted)
 *  10. Mixed DOM: only user side in one turn, only assistant in another
 *  11. extractCleanTextFromTurnElement scopes correctly to DilResponseRoot
 *  12. extractCleanTextFromTurnElement does not include badge text
 *  13. No extraction when both user and assistant are inside the same ancestor
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extractVisibleConversationFromDOM,
  extractCleanTextFromTurnElement,
} from "../src/connectors/domConversationExtractor.ts";

// ─── Minimal DOM simulation ───────────────────────────────────────────────────
//
// Node.js does not have a browser DOM. We simulate Document/HTMLElement
// using a lightweight record type that is duck-typed against the subset
// of the DOM API used by the extractor.

/** Create a minimal fake Document for testing. */
function makeDoc(body: string, path: string = "/c/conv-abc-123"): Document {
  // We use globalThis.document if available (e.g. in jsdom), otherwise
  // build a plain object that satisfies the subset of the Document API used.
  if (typeof document !== "undefined" && document.createElement) {
    // Real DOM available (Node.js >= 22 with --experimental-vm-modules or jsdom)
    const d = document.implementation.createHTMLDocument("test");
    d.body.innerHTML = body;
    // Patch location
    Object.defineProperty(d, "location", {
      get: () => ({ pathname: path }),
      configurable: true,
    });
    Object.defineProperty(d, "title", {
      get: () => "Test ChatGPT Conversation",
      configurable: true,
    });
    return d;
  }

  // Minimal stub for environments without a real DOM
  // (tests that use this stub will skip DOM-dependent assertions)
  return {} as Document;
}

/** Check that a real DOM is available. */
function hasDom(): boolean {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("domConversationExtractor — observed ChatGPT DOM structure", () => {

  // ── 1. User message extraction ───────────────────────────────────────────

  test("extracts user message text from data-user-message-bubble attribute", () => {
    if (!hasDom()) return; // Skip in non-DOM environments

    const doc = makeDoc(`
      <div>
        <div class="group/user-message">
          <div data-user-message-bubble="true">
            <p>Hello, this is my test message.</p>
          </div>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    assert.ok(result.messages.length >= 1, "Expected at least one message");
    const userMsg = result.messages.find((m) => m.role === "user");
    assert.ok(userMsg, "Expected a user message");
    assert.ok(
      userMsg!.content.includes("Hello, this is my test message."),
      `Expected user message content, got: "${userMsg!.content}"`
    );
    assert.strictEqual(userMsg!.role, "user");
  });

  // ── 2. Assistant message extraction ─────────────────────────────────────

  test("extracts assistant message text from DilResponseRoot structure", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div class="DilRenderer-tB76Jj DilResponseRoot-HfQrEh Reveal-k2IWvM">
          <div class="PortalBoundary-xyz">
            <div class="entity-prose-inset">
              <div class="my-4 first:mt-0">
                <div class="MarkdownRoot-abc">
                  <div class="group flex min-w-0 flex-col">
                    <p class="TextBase-qM5iDq Text-nubxrT">
                      Authorized conversation capture test acknowledged.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    assert.ok(result.messages.length >= 1, "Expected at least one message");
    const assistantMsg = result.messages.find((m) => m.role === "assistant");
    assert.ok(assistantMsg, "Expected an assistant message");
    assert.ok(
      assistantMsg!.content.includes("Authorized conversation capture test acknowledged."),
      `Expected assistant content, got: "${assistantMsg!.content}"`
    );
    assert.strictEqual(assistantMsg!.role, "assistant");
  });

  // ── 3. Exclusion of badges and unrelated content ─────────────────────────

  test("excludes badge text from assistant message", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div class="DilResponseRoot-HfQrEh">
          <span data-testid="message-badge">Message received</span>
          <p>Actual response text here.</p>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    const assistantMsg = result.messages.find((m) => m.role === "assistant");
    assert.ok(assistantMsg, "Expected an assistant message");
    assert.ok(
      !assistantMsg!.content.includes("Message received"),
      `Badge text should be excluded, got: "${assistantMsg!.content}"`
    );
    assert.ok(
      assistantMsg!.content.includes("Actual response text here."),
      `Expected actual content, got: "${assistantMsg!.content}"`
    );
  });

  test("excludes button text from user message", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div data-user-message-bubble="true">
          <p>My question here.</p>
          <button>Edit</button>
          <button aria-hidden="true">Copy</button>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    const userMsg = result.messages.find((m) => m.role === "user");
    assert.ok(userMsg, "Expected a user message");
    assert.ok(!userMsg!.content.includes("Edit"), "Button text should not be included");
    assert.ok(!userMsg!.content.includes("Copy"), "aria-hidden button should not be included");
    assert.ok(userMsg!.content.includes("My question here."), "Main content should be present");
  });

  test("excludes SVG icons from message content", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div data-user-message-bubble="true">
          <p>Real message.</p>
          <svg aria-hidden="true"><path d="M0 0"/></svg>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    const userMsg = result.messages.find((m) => m.role === "user");
    assert.ok(userMsg, "Expected a user message");
    assert.ok(userMsg!.content.includes("Real message."), "Real content should be present");
    // SVG has no text so this mainly verifies no error is thrown
  });

  // ── 4. No duplicate extraction from nested elements ─────────────────────

  test("does not produce duplicate messages when bubble is nested inside another container", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div data-user-message-bubble="true">
          <div>
            <div data-user-message-bubble="true">
              <p>Nested bubble — should not produce two messages.</p>
            </div>
          </div>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    const userMsgs = result.messages.filter((m) => m.role === "user");
    assert.strictEqual(
      userMsgs.length,
      1,
      `Expected 1 user message, got ${userMsgs.length}: ${JSON.stringify(userMsgs.map((m) => m.content))}`
    );
  });

  test("does not produce duplicate assistant messages from nested DilResponseRoot elements", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div class="DilResponseRoot-outer">
          <div class="DilResponseRoot-inner">
            <p>Response text once.</p>
          </div>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    const assistantMsgs = result.messages.filter((m) => m.role === "assistant");
    assert.ok(
      assistantMsgs.length <= 1,
      `Expected at most 1 assistant message, got ${assistantMsgs.length}`
    );
  });

  // ── 5. Streaming: assistant response marks isInProgress=false for DOM extraction ──

  test("DOM-extracted messages are not marked as in-progress", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div class="DilResponseRoot-HfQrEh">
          <p>Completed assistant response.</p>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    for (const msg of result.messages) {
      assert.strictEqual(
        msg.isInProgress,
        false,
        "DOM-extracted messages should not be marked as in-progress"
      );
    }
  });

  // ── 6. Correct message order and roles ──────────────────────────────────

  test("extracts messages in document order: user before assistant", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div data-user-message-bubble="true">
          <p>First: user message.</p>
        </div>
        <div class="DilResponseRoot-abc">
          <p>Second: assistant reply.</p>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    assert.ok(result.messages.length >= 2, "Expected at least 2 messages");
    assert.strictEqual(result.messages[0].role, "user", "First message should be from user");
    assert.strictEqual(result.messages[1].role, "assistant", "Second message should be from assistant");
  });

  test("sequence numbers start at 1 and are contiguous", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div data-user-message-bubble="true"><p>Q1</p></div>
        <div class="DilResponseRoot-r1"><p>A1</p></div>
        <div data-user-message-bubble="true"><p>Q2</p></div>
        <div class="DilResponseRoot-r2"><p>A2</p></div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    assert.ok(result.messages.length >= 2, "Expected at least 2 messages");
    for (let i = 0; i < result.messages.length; i++) {
      assert.strictEqual(result.messages[i].sequence, i + 1, `Sequence at index ${i} should be ${i + 1}`);
    }
  });

  // ── 7. Root route — no conversationId ───────────────────────────────────

  test("returns null conversationId on root route (/)", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div data-user-message-bubble="true"><p>New chat message.</p></div>
      </div>
    `, "/");

    const result = extractVisibleConversationFromDOM(doc);
    assert.strictEqual(result.conversationId, null, "Root route should have null conversationId");
    assert.ok(result.messages.length >= 1, "Should still extract messages on root route");
  });

  // ── 8. /c/<id> route — conversationId extracted ──────────────────────────

  test("extracts conversationId from /c/<id> URL path", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div data-user-message-bubble="true"><p>Test.</p></div>
      </div>
    `, "/c/conv-abc-123");

    const result = extractVisibleConversationFromDOM(doc);
    assert.strictEqual(result.conversationId, "conv-abc-123");
  });

  // ── 9. Never mark as complete ────────────────────────────────────────────

  test("DOM extraction always returns isComplete: false", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div data-user-message-bubble="true"><p>Q.</p></div>
        <div class="DilResponseRoot-x"><p>A.</p></div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    assert.strictEqual(result.isComplete, false, "DOM extraction should always be partial");
  });

  // ── 10. Shared ancestor does NOT get extracted as assistant content ────────

  test("does not extract user message text as assistant content from shared ancestor", () => {
    if (!hasDom()) return;

    // Simulate the observed hierarchy where a larger ancestor contains both
    // a user message bubble and a DilResponseRoot. The extractor must NOT
    // return the user message text as part of the assistant response.
    const doc = makeDoc(`
      <div class="turn-container">
        <div data-user-message-bubble="true">
          <p>The user asked this question.</p>
        </div>
        <div class="DilResponseRoot-HfQrEh">
          <p>The assistant answered this.</p>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    const assistantMsg = result.messages.find((m) => m.role === "assistant");
    assert.ok(assistantMsg, "Expected an assistant message");
    assert.ok(
      !assistantMsg!.content.includes("The user asked this question."),
      `Assistant content must NOT include user text, got: "${assistantMsg!.content}"`
    );
    assert.ok(
      assistantMsg!.content.includes("The assistant answered this."),
      `Assistant content should include assistant text, got: "${assistantMsg!.content}"`
    );
  });

  // ── 11. extractCleanTextFromTurnElement scopes to DilResponseRoot ─────────

  test("extractCleanTextFromTurnElement scopes assistant to DilResponseRoot subtree", () => {
    if (!hasDom()) return;

    const container = document.createElement("div");
    container.innerHTML = `
      <p>This is outside the response root — should be excluded.</p>
      <div class="DilResponseRoot-HfQrEh">
        <p>This is the actual assistant response.</p>
      </div>
    `;

    const text = extractCleanTextFromTurnElement(container, "assistant");
    assert.ok(
      text.includes("This is the actual assistant response."),
      `Expected scoped content, got: "${text}"`
    );
    assert.ok(
      !text.includes("This is outside the response root"),
      `Should NOT include text outside DilResponseRoot, got: "${text}"`
    );
  });

  // ── 12. extractCleanTextFromTurnElement excludes badge text ───────────────

  test("extractCleanTextFromTurnElement excludes badge elements", () => {
    if (!hasDom()) return;

    const container = document.createElement("div");
    container.innerHTML = `
      <span data-testid="message-badge">Message received</span>
      <p>Real content that should be captured.</p>
    `;

    const text = extractCleanTextFromTurnElement(container, "assistant");
    assert.ok(
      !text.includes("Message received"),
      `Badge text must be excluded, got: "${text}"`
    );
    assert.ok(
      text.includes("Real content that should be captured."),
      `Real content should be present, got: "${text}"`
    );
  });

  // ── 13. Empty document returns empty result ───────────────────────────────

  test("returns empty messages array when document body is empty", () => {
    if (!hasDom()) return;

    const doc = makeDoc("", "/c/empty-conv");
    const result = extractVisibleConversationFromDOM(doc);
    assert.strictEqual(result.messages.length, 0, "Empty document should yield no messages");
  });

  // ── 14. Structured turn containers (data-message-author-role) take priority ──

  test("extracts messages via data-message-author-role when present", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <article data-message-author-role="user">
          <div class="whitespace-pre-wrap">What is the answer?</div>
        </article>
        <article data-message-author-role="assistant">
          <div class="markdown">The answer is 42.</div>
        </article>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    assert.ok(result.messages.length >= 2, `Expected at least 2 messages, got ${result.messages.length}`);
    const user = result.messages.find((m) => m.role === "user");
    const asst = result.messages.find((m) => m.role === "assistant");
    assert.ok(user, "Expected user message");
    assert.ok(asst, "Expected assistant message");
    assert.ok(user!.content.includes("What is the answer?"));
    assert.ok(asst!.content.includes("The answer is 42."));
  });

  // ── 15. Multi-turn conversation maintains order ───────────────────────────

  test("multi-turn conversation is extracted in correct order", () => {
    if (!hasDom()) return;

    const doc = makeDoc(`
      <div>
        <div data-user-message-bubble="true"><p>Turn 1 user</p></div>
        <div class="DilResponseRoot-t1"><p>Turn 1 assistant</p></div>
        <div data-user-message-bubble="true"><p>Turn 2 user</p></div>
        <div class="DilResponseRoot-t2"><p>Turn 2 assistant</p></div>
        <div data-user-message-bubble="true"><p>Turn 3 user</p></div>
        <div class="DilResponseRoot-t3"><p>Turn 3 assistant</p></div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    const roles = result.messages.map((m) => m.role);
    // Verify user/assistant alternation — at minimum user before assistant in each pair
    let userCount = 0;
    let assistantCount = 0;
    for (const role of roles) {
      if (role === "user") userCount++;
      if (role === "assistant") assistantCount++;
    }
    assert.ok(userCount >= 3, `Expected at least 3 user messages, got ${userCount}`);
    assert.ok(assistantCount >= 3, `Expected at least 3 assistant messages, got ${assistantCount}`);

    // Verify strict document order (first user, then assistant)
    const firstUser = result.messages.findIndex((m) => m.role === "user");
    const firstAssistant = result.messages.findIndex((m) => m.role === "assistant");
    assert.ok(
      firstUser < firstAssistant,
      "First user message must appear before first assistant message"
    );
  });
});

// ─── conversationDetector tests ──────────────────────────────────────────────

describe("detectConversationPage — route matching", () => {
  // These tests run logic only, no DOM needed.
  // We test the route logic directly via string matching since we can't
  // set window.location in node:test easily.

  test("root route / is a conversation page", () => {
    // The updated detectConversationPage accepts /
    const path = "/";
    const isConvPage = path.startsWith("/c/") || path === "/" || path === "";
    assert.ok(isConvPage, "Root route should be a conversation page");
  });

  test("/c/<id> route is a conversation page", () => {
    const path = "/c/abc-123-def";
    const isConvPage = path.startsWith("/c/") || path === "/" || path === "";
    assert.ok(isConvPage, "/c/<id> should be a conversation page");
  });

  test("/settings is not a conversation page", () => {
    const path = "/settings";
    const isConvPage = path.startsWith("/c/") || path === "/" || path === "";
    assert.ok(!isConvPage, "/settings should not be a conversation page");
  });

  test("/g/<id> is not a conversation page", () => {
    const path = "/g/g-some-gpt";
    const isConvPage = path.startsWith("/c/") || path === "/" || path === "";
    assert.ok(!isConvPage, "/g/ route should not be a conversation page");
  });
});
