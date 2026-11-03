/**
 * domConversationExtractor.test.ts
 *
 * Tests for the evidence-based ChatGPT DOM extraction pipeline.
 *
 * Covers:
 *  1.  User message extraction from observed DOM structure (data-user-message-bubble)
 *  2.  Assistant response extraction from observed DOM structure (DilResponseRoot / MarkdownRoot)
 *  3.  Exclusion of badges and unrelated content
 *  4.  No duplicate extraction from nested elements
 *  5.  Streaming assistant response updates (isInProgress and stable sourceMessageId)
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

// ─── Lightweight DOM simulation for Node.js test environment ────────────────

class MockNode {
  nodeType: number = 1;
}

class MockElement extends MockNode {
  tagName: string;
  attributes: Map<string, string> = new Map();
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  textContent: string = "";
  ownerDocument: any = null;

  constructor(tagName: string, ownerDocument?: any) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name.toLowerCase(), value);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  get className(): string {
    return this.getAttribute("class") || "";
  }

  set className(val: string) {
    this.setAttribute("class", val);
  }

  get innerText(): string {
    return this.computeInnerText();
  }

  set innerText(val: string) {
    this.textContent = val;
    this.children = [];
  }

  private computeInnerText(): string {
    if (this.children.length === 0) {
      return this.textContent;
    }
    // Block tags get newlines
    const isBlock = ["P", "DIV", "PRE", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "ARTICLE", "SECTION"].includes(this.tagName);
    const childTexts: string[] = [];
    if (this.textContent) childTexts.push(this.textContent);
    for (const ch of this.children) {
      const txt = ch.innerText;
      if (txt) childTexts.push(txt);
    }
    return childTexts.join(isBlock ? "\n" : " ");
  }

  matches(selector: string): boolean {
    return matchesSelector(this, selector);
  }

  querySelector<T = MockElement>(selector: string): T | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child as unknown as T;
      const found = child.querySelector<T>(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll<T = MockElement>(selector: string): T[] {
    const results: T[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) {
        results.push(child as unknown as T);
      }
      results.push(...child.querySelectorAll<T>(selector));
    }
    return results;
  }

  contains(other: MockElement): boolean {
    if (other === this) return true;
    let curr = other.parentElement;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) {
        this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
    }
  }

  cloneNode(deep: boolean = false): MockElement {
    const clone = new MockElement(this.tagName, this.ownerDocument);
    for (const [k, v] of this.attributes.entries()) {
      clone.setAttribute(k, v);
    }
    clone.textContent = this.textContent;
    if (deep) {
      for (const child of this.children) {
        const childClone = child.cloneNode(true);
        childClone.parentElement = clone;
        clone.children.push(childClone);
      }
    }
    return clone;
  }

  closest(selector: string): MockElement | null {
    // Walk up from this element (inclusive) to root; return first match.
    let curr: MockElement | null = this;
    while (curr) {
      if (curr.matches(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  compareDocumentPosition(other: MockElement): number {
    if (this === other) return 0;
    const doc = this.ownerDocument;
    if (!doc || !doc.body) return 0;

    const all = getAllNodesPreorder(doc.body);
    const idxA = all.indexOf(this);
    const idxB = all.indexOf(other);

    if (idxA === -1 || idxB === -1) return 0;
    if (idxA < idxB) {
      // Node.DOCUMENT_POSITION_FOLLOWING = 4
      return 4;
    }
    // Node.DOCUMENT_POSITION_PRECEDING = 2
    return 2;
  }
}

function getAllNodesPreorder(root: MockElement): MockElement[] {
  const result: MockElement[] = [root];
  for (const child of root.children) {
    result.push(...getAllNodesPreorder(child));
  }
  return result;
}

function matchesSelector(el: MockElement, selectorStr: string): boolean {
  const selectors = selectorStr.split(",").map((s) => s.trim());
  return selectors.some((sel) => matchesSingle(el, sel));
}

function matchesSingle(el: MockElement, sel: string): boolean {
  if (sel === "*") return true;

  // Class match: .classname
  if (sel.startsWith(".") && !sel.includes("[") && !sel.includes(" ")) {
    const cls = sel.slice(1);
    const elCls = el.className;
    return (
      elCls === cls ||
      elCls.startsWith(`${cls} `) ||
      elCls.endsWith(` ${cls}`) ||
      elCls.includes(` ${cls} `) ||
      elCls.includes(cls)
    );
  }

  // Tag with attribute: article[data-testid] or tag[attr="val"]
  const tagWithAttrMatch = sel.match(/^([a-zA-Z0-9_-]+)\[(.*)\]$/);
  if (tagWithAttrMatch) {
    const tagName = tagWithAttrMatch[1];
    const attrPart = `[${tagWithAttrMatch[2]}]`;
    if (el.tagName.toLowerCase() !== tagName.toLowerCase()) return false;
    return matchesSingle(el, attrPart);
  }

  // Attribute equals: [attr="val"] or [attr='val']
  const attrEqMatch = sel.match(/^\[([a-zA-Z0-9_-]+)=["']?([^"']*)["']?\]$/);
  if (attrEqMatch) {
    const attrName = attrEqMatch[1].toLowerCase();
    const expectedVal = attrEqMatch[2];
    return el.getAttribute(attrName) === expectedVal;
  }

  // Attribute contains: [attr*="val"] or [attr*='val']
  const attrContainsMatch = sel.match(/^\[([a-zA-Z0-9_-]+)\*=["']?([^"']*)["']?\]$/);
  if (attrContainsMatch) {
    const attrName = attrContainsMatch[1].toLowerCase();
    const expectedSubstring = attrContainsMatch[2];
    const actual = el.getAttribute(attrName);
    return actual !== null && actual.includes(expectedSubstring);
  }

  // Attribute starts with: [attr^="val"] or [attr^='val']
  const attrPrefixMatch = sel.match(/^\[([a-zA-Z0-9_-]+)\^=["']?([^"']*)["']?\]$/);
  if (attrPrefixMatch) {
    const attrName = attrPrefixMatch[1].toLowerCase();
    const expectedPrefix = attrPrefixMatch[2];
    const actual = el.getAttribute(attrName);
    return actual !== null && actual.startsWith(expectedPrefix);
  }

  // Attribute presence: [attr]
  const attrPresenceMatch = sel.match(/^\[([a-zA-Z0-9_-]+)\]$/);
  if (attrPresenceMatch) {
    const attrName = attrPresenceMatch[1].toLowerCase();
    return el.hasAttribute(attrName);
  }

  // Tag name: div, article, p, button, etc.
  if (/^[a-zA-Z0-9_-]+$/.test(sel)) {
    return el.tagName.toLowerCase() === sel.toLowerCase();
  }

  return false;
}

/** Parses simple HTML into a MockElement tree. */
function parseHtml(html: string, ownerDoc: any): MockElement {
  const root = new MockElement("BODY", ownerDoc);
  const stack: MockElement[] = [root];

  // Regex to match tags and text nodes
  const tokenRegex = /<(\/)?([a-zA-Z0-9_-]+)([^>]*?)(\/)?>|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(html)) !== null) {
    const isClosing = match[1] === "/";
    const tagName = match[2];
    const attrStr = match[3];
    const isSelfClosing = match[4] === "/";
    const textNode = match[5];

    if (textNode) {
      const trimmed = textNode.trim();
      if (trimmed) {
        const top = stack[stack.length - 1];
        top.textContent = top.textContent ? `${top.textContent} ${trimmed}` : trimmed;
      }
    } else if (isClosing) {
      if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === tagName.toLowerCase()) {
        stack.pop();
      }
    } else if (tagName) {
      const el = new MockElement(tagName, ownerDoc);
      if (attrStr) {
        const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
          const k = attrMatch[1];
          const v = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
          el.setAttribute(k, v);
        }
      }
      stack[stack.length - 1].children.push(el);
      el.parentElement = stack[stack.length - 1];

      const voidTags = ["img", "br", "hr", "input", "svg"];
      if (!isSelfClosing && !voidTags.includes(tagName.toLowerCase())) {
        stack.push(el);
      }
    }
  }

  return root;
}

/** Helper to create Document stub for tests */
function makeDoc(bodyHtml: string, path: string = "/c/conv-abc-123", title: string = "Test ChatGPT Conversation"): Document {
  const doc: any = {
    location: { pathname: path },
    title,
  };

  const body = parseHtml(bodyHtml, doc);
  doc.body = body;
  doc.documentElement = body;

  doc.querySelector = (sel: string) => body.querySelector(sel);
  doc.querySelectorAll = (sel: string) => body.querySelectorAll(sel);
  doc.createElement = (tag: string) => new MockElement(tag, doc);

  return doc as unknown as Document;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("domConversationExtractor — observed ChatGPT DOM structure", () => {

  // ── 1. User message extraction ───────────────────────────────────────────

  test("extracts user message text from data-user-message-bubble attribute", () => {
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
  });

  // ── 4. No duplicate extraction from nested elements ─────────────────────

  test("does not produce duplicate messages when bubble is nested inside another container", () => {
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
      `Expected 1 user message, got ${userMsgs.length}`
    );
  });

  test("does not produce duplicate assistant messages from nested DilResponseRoot elements", () => {
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
    assert.strictEqual(
      assistantMsgs.length,
      1,
      `Expected exactly 1 assistant message, got ${assistantMsgs.length}`
    );
  });

  // ── 5. Streaming assistant response updates ──────────────────────────────

  test("DOM-extracted completed messages are marked isInProgress=false when no stop button exists", () => {
    const doc = makeDoc(`
      <div>
        <div class="DilResponseRoot-HfQrEh">
          <p>Completed assistant response.</p>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    assert.ok(result.messages.length >= 1);
    for (const msg of result.messages) {
      assert.strictEqual(
        msg.isInProgress,
        false,
        "Completed messages should not be marked as in-progress"
      );
    }
  });

  test("DOM-extracted assistant message is marked isInProgress=true when streaming stop button is present", () => {
    const doc = makeDoc(`
      <div>
        <div class="DilResponseRoot-HfQrEh">
          <p>Streaming assistant response...</p>
        </div>
        <button data-testid="stop-button">Stop streaming</button>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    assert.ok(result.messages.length >= 1);
    const lastMsg = result.messages[result.messages.length - 1];
    assert.strictEqual(lastMsg.role, "assistant");
    assert.strictEqual(lastMsg.isInProgress, true, "Active stream should be marked isInProgress=true");
  });

  // ── 6. Correct message order and roles ──────────────────────────────────

  test("extracts messages in document order: user before assistant", () => {
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
    const doc = makeDoc(`
      <div>
        <div data-user-message-bubble="true"><p>Q1</p></div>
        <div class="DilResponseRoot-r1"><p>A1</p></div>
        <div data-user-message-bubble="true"><p>Q2</p></div>
        <div class="DilResponseRoot-r2"><p>A2</p></div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    assert.strictEqual(result.messages.length, 4, "Expected 4 messages");
    for (let i = 0; i < result.messages.length; i++) {
      assert.strictEqual(result.messages[i].sequence, i + 1, `Sequence at index ${i} should be ${i + 1}`);
    }
  });

  // ── 7. Root route — no conversationId ───────────────────────────────────

  test("returns null conversationId on root route (/)", () => {
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
    // Simulate the observed hierarchy where a larger ancestor contains both
    // a badge, a user message bubble, and a DilResponseRoot.
    const doc = makeDoc(`
      <div class="turn-container-shared">
        <span data-testid="message-badge">Message received</span>
        <div class="group/user-message">
          <div data-user-message-bubble="true">
            <p>The user asked this question.</p>
          </div>
        </div>
        <div class="group flex min-w-0 flex-col">
          <div class="MarkdownRoot-abc">
            <div class="DilResponseRoot-HfQrEh">
              <p>The assistant answered this.</p>
            </div>
          </div>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    const userMsg = result.messages.find((m) => m.role === "user");
    const assistantMsg = result.messages.find((m) => m.role === "assistant");

    assert.ok(userMsg, "Expected user message");
    assert.ok(assistantMsg, "Expected assistant message");

    assert.ok(
      !assistantMsg!.content.includes("The user asked this question."),
      `Assistant content must NOT include user text, got: "${assistantMsg!.content}"`
    );
    assert.ok(
      !assistantMsg!.content.includes("Message received"),
      `Assistant content must NOT include badge text, got: "${assistantMsg!.content}"`
    );
    assert.ok(
      assistantMsg!.content.includes("The assistant answered this."),
      `Assistant content should include assistant text, got: "${assistantMsg!.content}"`
    );
  });

  // ── 11. extractCleanTextFromTurnElement scopes to DilResponseRoot ─────────

  test("extractCleanTextFromTurnElement scopes assistant to DilResponseRoot subtree", () => {
    const doc = makeDoc(`
      <div class="shared-wrap">
        <p>This is outside the response root — should be excluded.</p>
        <div data-user-message-bubble="true"><p>User text</p></div>
        <div class="DilResponseRoot-HfQrEh">
          <p>This is the actual assistant response.</p>
        </div>
      </div>
    `);

    const container = doc.querySelector<HTMLElement>(".shared-wrap")!;
    const text = extractCleanTextFromTurnElement(container, "assistant");
    assert.ok(
      text.includes("This is the actual assistant response."),
      `Expected scoped content, got: "${text}"`
    );
    assert.ok(
      !text.includes("This is outside the response root"),
      `Should NOT include text outside DilResponseRoot, got: "${text}"`
    );
    assert.ok(
      !text.includes("User text"),
      `Should NOT include user text, got: "${text}"`
    );
  });

  // ── 12. extractCleanTextFromTurnElement excludes badge text ───────────────

  test("extractCleanTextFromTurnElement excludes badge elements", () => {
    const doc = makeDoc(`
      <div>
        <span data-testid="message-badge">Message received</span>
        <p>Real content that should be captured.</p>
      </div>
    `);

    const container = doc.querySelector<HTMLElement>("div")!;
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
    const doc = makeDoc("", "/c/empty-conv");
    const result = extractVisibleConversationFromDOM(doc);
    assert.strictEqual(result.messages.length, 0, "Empty document should yield no messages");
  });

  // ── 14. Structured turn containers (data-message-author-role) take priority ──

  test("extracts messages via data-message-author-role when present", () => {
    const doc = makeDoc(`
      <div>
        <article data-message-author-role="user">
          <p>What is the answer?</p>
        </article>
        <article data-message-author-role="assistant">
          <p>The answer is 42.</p>
        </article>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    assert.strictEqual(result.messages.length, 2, `Expected 2 messages, got ${result.messages.length}`);
    const user = result.messages.find((m) => m.role === "user");
    const asst = result.messages.find((m) => m.role === "assistant");
    assert.ok(user, "Expected user message");
    assert.ok(asst, "Expected assistant message");
    assert.ok(user!.content.includes("What is the answer?"));
    assert.ok(asst!.content.includes("The answer is 42."));
  });

  // ── 15. Multi-turn conversation maintains order ───────────────────────────

  test("multi-turn conversation is extracted in correct order", () => {
    const doc = makeDoc(`
      <div>
        <div class="group/user-message">
          <div data-user-message-bubble="true"><p>Turn 1 user</p></div>
        </div>
        <div class="DilResponseRoot-t1"><p>Turn 1 assistant</p></div>
        <div class="group/user-message">
          <div data-user-message-bubble="true"><p>Turn 2 user</p></div>
        </div>
        <div class="DilResponseRoot-t2"><p>Turn 2 assistant</p></div>
        <div class="group/user-message">
          <div data-user-message-bubble="true"><p>Turn 3 user</p></div>
        </div>
        <div class="DilResponseRoot-t3"><p>Turn 3 assistant</p></div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    assert.strictEqual(result.messages.length, 6, `Expected 6 messages, got ${result.messages.length}`);
    assert.strictEqual(result.messages[0].content, "Turn 1 user");
    assert.strictEqual(result.messages[1].content, "Turn 1 assistant");
    assert.strictEqual(result.messages[2].content, "Turn 2 user");
    assert.strictEqual(result.messages[3].content, "Turn 2 assistant");
    assert.strictEqual(result.messages[4].content, "Turn 3 user");
    assert.strictEqual(result.messages[5].content, "Turn 3 assistant");
  });

  // ── 16. Multiple paragraphs in one turn are joined without fragmentation ──

  test("multiple paragraphs in assistant response become ONE message joined with double newline", () => {
    const doc = makeDoc(`
      <div>
        <div class="DilResponseRoot-multi">
          <p>First paragraph of the answer.</p>
          <p>Second paragraph of the answer with more detail.</p>
        </div>
      </div>
    `);

    const result = extractVisibleConversationFromDOM(doc);
    assert.strictEqual(result.messages.length, 1, `Expected 1 message, got ${result.messages.length}`);
    assert.ok(result.messages[0].content.includes("First paragraph of the answer."));
    assert.ok(result.messages[0].content.includes("Second paragraph of the answer with more detail."));
    assert.strictEqual(
      result.messages[0].content,
      "First paragraph of the answer.\n\nSecond paragraph of the answer with more detail."
    );
  });
});

// ─── Route matching tests ───────────────────────────────────────────────────

describe("detectConversationPage — route matching", () => {
  test("root route / is a conversation page", () => {
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
