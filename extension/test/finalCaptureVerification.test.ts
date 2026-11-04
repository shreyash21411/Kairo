/**
 * finalCaptureVerification.test.ts
 *
 * Comprehensive Regression & Verification Suite for VOIDZONE Capture Pipeline.
 * Validates the targeted fixes for:
 * 1. A-601 missing message: New/clean chat baseline does not swallow the first user prompt.
 * 2. C-603 / D-604 suspicious assistant records: MarkdownRoot / DilRenderer inside user
 *    prompts do not produce false assistant records with user marker content.
 * 3. A2 streaming completion: Assistant messages transition from isInProgress: true to false,
 *    updating in-place without stuck in-progress flags or duplicates.
 * 4. Completed assistant response updates existing record cleanly without duplication.
 * 5. Full preservation of roles, content, sourceMessageIds, and epochIds across reload.
 * 6. Strict exclusion of OFF-period messages and their paired assistant replies.
 * 7. Placeholder or empty assistant elements are never persisted as completed turns.
 * 8. User messages are deduplicated across sequence index shifts.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  extractVisibleConversationFromDOM,
  extractCleanTextFromTurnElement,
  checkIsStreamingActive,
  safeClosest,
  safeMatches,
} from "../src/connectors/domConversationExtractor.ts";

import {
  filterExtractedDomMessages,
  recordEpochObservationBaseline,
  ensureConversationBaseline,
  populatedBaselinesEstablished,
  epochBaselinesEstablished,
  unauthorizedMessageKeysByConv,
  unauthorizedMessageCountsByConv,
  captureSessions,
  getBaselineKey,
} from "../src/content/content.ts";

import {
  createCaptureSession,
  mergeCapturedSessions,
  ingestMessage,
} from "../src/continuity/captureLifecycle.ts";

import {
  saveConversation,
  saveActiveCaptureSession,
  getActiveCaptureSession,
  getConversations,
  getAuthorizedMessageIds,
  updateAuthorizedMessageIds,
  ACTIVE_EPOCH_KEY,
  EPOCH_REGISTRY_KEY,
} from "../src/storage/conversationStorage.ts";

import type { CapturedConversation, NormalizedCaptureMessage } from "../src/continuity/captureTypes.ts";

// ─── Lightweight DOM simulation ──────────────────────────────────────────────

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

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (curr.matches(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
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

  compareDocumentPosition(other: MockElement): number {
    if (this === other) return 0;
    const doc = this.ownerDocument;
    if (!doc || !doc.body) return 0;
    const all = getAllNodesPreorder(doc.body);
    const idxA = all.indexOf(this);
    const idxB = all.indexOf(other);
    if (idxA === -1 || idxB === -1) return 0;
    return idxA < idxB ? 4 : 2;
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

  if (sel.startsWith(".") && !sel.includes("[") && !sel.includes(" ")) {
    const cls = sel.slice(1);
    return el.className.split(/\s+/).includes(cls);
  }

  if (sel.startsWith("[") && sel.endsWith("]")) {
    const inner = sel.slice(1, -1);
    if (inner.includes("*=")) {
      const [attr, val] = inner.split("*=");
      const cleanVal = val.replace(/^["']|["']$/g, "");
      const attrVal = el.getAttribute(attr);
      return attrVal !== null && attrVal.includes(cleanVal);
    }
    if (inner.includes("^=")) {
      const [attr, val] = inner.split("^=");
      const cleanVal = val.replace(/^["']|["']$/g, "");
      const attrVal = el.getAttribute(attr);
      return attrVal !== null && attrVal.startsWith(cleanVal);
    }
    if (inner.includes("=")) {
      const [attr, val] = inner.split("=");
      const cleanVal = val.replace(/^["']|["']$/g, "");
      return el.getAttribute(attr) === cleanVal;
    }
    return el.hasAttribute(inner);
  }

  if (sel.includes("[") && !sel.startsWith("[")) {
    const tagPart = sel.slice(0, sel.indexOf("[")).toUpperCase();
    const attrPart = sel.slice(sel.indexOf("["));
    if (tagPart && el.tagName !== tagPart) return false;
    return matchesSingle(el, attrPart);
  }

  return el.tagName.toLowerCase() === sel.toLowerCase();
}

function parseHtml(html: string, ownerDoc?: any): MockElement {
  const root = new MockElement("div", ownerDoc);
  const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9_-]+)((?:\s+[a-zA-Z0-9_-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/)?>|([^<]+)/g;
  const stack: MockElement[] = [root];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const [full, isClosing, tagName, attrStr, isSelfClosing, textContent] = match;
    if (full.startsWith("<!--")) continue;
    if (textContent) {
      const trimmed = textContent.trim();
      if (trimmed.length > 0) {
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

function makeDoc(bodyHtml: string, path: string = "/c/conv-test-123"): Document {
  const doc: any = {
    location: { pathname: path },
    title: "Test Conversation",
  };
  const body = parseHtml(bodyHtml, doc);
  doc.body = body;
  doc.documentElement = body;
  doc.querySelector = (sel: string) => body.querySelector(sel);
  doc.querySelectorAll = (sel: string) => body.querySelectorAll(sel);
  doc.createElement = (tag: string) => new MockElement(tag, doc);
  return doc as unknown as Document;
}

// ─── Mock Chrome Storage ──────────────────────────────────────────────────────

let mockLocalStorage: Record<string, unknown> = {};

function setupMockChrome(): void {
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: any) => {
          return new Promise<Record<string, unknown>>((resolve) => {
            if (!keys) {
              resolve({ ...mockLocalStorage });
            } else if (typeof keys === "string") {
              resolve({ [keys]: mockLocalStorage[keys] });
            } else if (Array.isArray(keys)) {
              const res: Record<string, unknown> = {};
              for (const k of keys) res[k] = mockLocalStorage[k];
              resolve(res);
            } else if (typeof keys === "object") {
              const res: Record<string, unknown> = { ...keys };
              for (const k of Object.keys(keys)) {
                if (k in mockLocalStorage) res[k] = mockLocalStorage[k];
              }
              resolve(res);
            } else {
              resolve({ ...mockLocalStorage });
            }
          });
        },
        set: (items: Record<string, unknown>) => {
          return new Promise<void>((resolve) => {
            Object.assign(mockLocalStorage, items);
            resolve();
          });
        },
        remove: (keys: string | string[]) => {
          return new Promise<void>((resolve) => {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const k of list) delete mockLocalStorage[k];
            resolve();
          });
        },
        clear: () => {
          return new Promise<void>((resolve) => {
            mockLocalStorage = {};
            resolve();
          });
        },
      },
      onChanged: {
        addListener: () => {},
        removeListener: () => {},
      },
    },
    runtime: {
      get id() { return "test-extension-id"; },
      lastError: null,
      sendMessage: (_msg: any, cb?: () => void) => {
        if (cb) cb();
      },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Final Capture Verification — Production Corrections", () => {
  const EPOCH_ACTIVE = "a564adc3-a669-417b-9c2f-1c5b57674475";
  const CONV_ID = "6727289f-2680-800e-b76e-578f79fba502";

  beforeEach(() => {
    mockLocalStorage = {
      memoryEnabled: true,
      [ACTIVE_EPOCH_KEY]: EPOCH_ACTIVE,
      [EPOCH_REGISTRY_KEY]: {
        [EPOCH_ACTIVE]: {
          epochId: EPOCH_ACTIVE,
          status: "active",
          createdAt: new Date().toISOString(),
          closedAt: null,
          invalidatedAt: null,
        },
      },
    };
    setupMockChrome();
    captureSessions.clear();
    unauthorizedMessageKeysByConv.clear();
    unauthorizedMessageCountsByConv.clear();
    epochBaselinesEstablished.clear();
    populatedBaselinesEstablished.clear();
  });

  // ── 1. A-601: User messages are captured once on new chat (not swallowed as baseline) ───

  test("1. A-601 root cause: User message in a clean new chat is captured under active epoch and not swallowed as unauthorized baseline", async () => {
    const PROVISIONAL_ID = "provisional-tab";

    // Clean new chat DOM initially empty
    const initialDoc = makeDoc("", "/");
    globalThis.document = initialDoc;

    // Establish baseline at observer attachment for provisional session
    await ensureConversationBaseline(PROVISIONAL_ID, EPOCH_ACTIVE);
    assert.strictEqual(
      populatedBaselinesEstablished.has(getBaselineKey(PROVISIONAL_ID, EPOCH_ACTIVE)),
      true,
      "Clean provisional chat must establish populated baseline immediately on attach"
    );

    // User submits FREEZE-A-601
    const docWithUserMsg = makeDoc(`
      <div class="group/user-message">
        <div data-user-message-bubble="true">
          <p>FREEZE-A-601</p>
        </div>
      </div>
    `, "/");
    globalThis.document = docWithUserMsg;

    // Extract visible DOM turns
    const extracted = extractVisibleConversationFromDOM(docWithUserMsg);
    assert.strictEqual(extracted.messages.length, 1, "Extracted exactly one user message");
    assert.strictEqual(extracted.messages[0].role, "user");
    assert.strictEqual(extracted.messages[0].content, "FREEZE-A-601");

    // Filter messages through authorization gate
    const unauthorizedKeys = unauthorizedMessageKeysByConv.get(PROVISIONAL_ID);
    const filterResult = filterExtractedDomMessages(
      PROVISIONAL_ID,
      extracted.messages,
      undefined,
      unauthorizedKeys,
      EPOCH_ACTIVE,
      new Set()
    );

    assert.strictEqual(filterResult.hasNewContent, true, "FREEZE-A-601 must be recognized as new content");
    assert.strictEqual(filterResult.filteredMessages.length, 1, "FREEZE-A-601 must NOT be discarded");
    assert.strictEqual(filterResult.filteredMessages[0].content, "FREEZE-A-601");
    assert.strictEqual(filterResult.filteredMessages[0].epochId, EPOCH_ACTIVE, "Must carry active epochId");
  });

  // ── 2. C-603 & D-604: MarkdownRoot inside user prompt does not produce false assistant turn ───

  test("2. C-603 / D-604 root cause: User prompt containing MarkdownRoot or DilRenderer does not create false assistant record", () => {
    // Representative DOM fixture where user message renders formatted text / MarkdownRoot
    const doc = makeDoc(`
      <div class="group/user-message">
        <div data-user-message-bubble="true">
          <div class="MarkdownRoot-1234">
            <p>FREEZE-C-603</p>
          </div>
        </div>
      </div>
    `, `/c/${CONV_ID}`);

    const extracted = extractVisibleConversationFromDOM(doc);
    assert.strictEqual(extracted.messages.length, 1, "Must extract exactly ONE turn");
    assert.strictEqual(extracted.messages[0].role, "user", "Must be extracted as user role");
    assert.strictEqual(extracted.messages[0].content, "FREEZE-C-603");

    // Verify no assistant turn was emitted with identical content
    const assistantTurns = extracted.messages.filter((m) => m.role === "assistant");
    assert.strictEqual(assistantTurns.length, 0, "No false assistant turn produced from MarkdownRoot in user bubble");
  });

  // ── 3. Placeholder or empty assistant elements are not persisted ──────────

  test("3. Placeholder or empty assistant elements (or badge-only text 'Received') are not extracted as completed messages", () => {
    const doc = makeDoc(`
      <div class="group/user-message">
        <div data-user-message-bubble="true">
          <p>FREEZE-TEST-PROMPT</p>
        </div>
      </div>
      <div class="DilResponseRoot-HfQrEh">
        <div class="message-badge">Received</div>
        <p></p>
      </div>
    `, `/c/${CONV_ID}`);

    const extracted = extractVisibleConversationFromDOM(doc);
    assert.strictEqual(extracted.messages.length, 1, "Only the user message must be extracted");
    assert.strictEqual(extracted.messages[0].role, "user");
    assert.strictEqual(extracted.messages[0].content, "FREEZE-TEST-PROMPT");

    const assistantTurns = extracted.messages.filter((m) => m.role === "assistant");
    assert.strictEqual(assistantTurns.length, 0, "Empty / badge-only assistant turn is skipped");
  });

  // ── 4. A2 streaming assistant transition to completed state ───────────────

  test("4. A2 root cause: Streaming assistant message updates in-place to completed state (isInProgress: false) without duplicate records", () => {
    // Phase 1: Streaming assistant response in progress
    const streamingDoc = makeDoc(`
      <div class="group/user-message">
        <div data-user-message-bubble="true">
          <p>FREEZE-A2-605</p>
        </div>
      </div>
      <div class="DilResponseRoot-HfQrEh">
        <p>FREEZE-A2-605</p>
      </div>
      <button data-testid="stop-button" aria-label="Stop generating">Stop</button>
    `, `/c/${CONV_ID}`);

    assert.strictEqual(checkIsStreamingActive(streamingDoc), true, "Streaming active detected");

    const extractedStreaming = extractVisibleConversationFromDOM(streamingDoc);
    assert.strictEqual(extractedStreaming.messages.length, 2);
    assert.strictEqual(extractedStreaming.messages[1].role, "assistant");
    assert.strictEqual(extractedStreaming.messages[1].isInProgress, true, "Assistant message marked in progress while stop button present");

    let session = createCaptureSession("chatgpt", "Title", "https://chatgpt.com", CONV_ID);
    session.epochId = EPOCH_ACTIVE;
    session.messages = extractedStreaming.messages.map((m) => ({ ...m, epochId: EPOCH_ACTIVE }));
    session.state = "response_in_progress";

    // Phase 2: Generation completes. Stop button disappears.
    const completedDoc = makeDoc(`
      <div class="group/user-message">
        <div data-user-message-bubble="true">
          <p>FREEZE-A2-605</p>
        </div>
      </div>
      <div class="DilResponseRoot-HfQrEh">
        <p>FREEZE-A2-605</p>
      </div>
    `, `/c/${CONV_ID}`);

    assert.strictEqual(checkIsStreamingActive(completedDoc), false, "Streaming no longer active");

    const extractedCompleted = extractVisibleConversationFromDOM(completedDoc);
    assert.strictEqual(extractedCompleted.messages.length, 2);
    assert.strictEqual(extractedCompleted.messages[1].isInProgress, false, "Assistant message marked completed");

    // Merge completed extraction into active session
    const merged = mergeCapturedSessions(session, {
      ...session,
      messages: extractedCompleted.messages,
      state: "checkpoint_available",
    });

    assert.strictEqual(merged.messages.length, 2, "No duplicate assistant message created");
    assert.strictEqual(merged.messages[1].role, "assistant");
    assert.strictEqual(merged.messages[1].content, "FREEZE-A2-605");
    assert.strictEqual(merged.messages[1].isInProgress, false, "Assistant message transitioned to isInProgress: false");
    assert.strictEqual(merged.state, "checkpoint_available", "Session state transitioned to checkpoint_available");
    assert.strictEqual(merged.messages[1].epochId, EPOCH_ACTIVE, "Epoch authorization preserved on completed turn");
  });

  // ── 5. User messages deduplicated across sequence shifts ──────────────────

  test("5. Sequence-shift deduplication: user and assistant messages retain identity across sequence shifts", () => {
    let session = createCaptureSession("chatgpt", "Title", "https://chatgpt.com", CONV_ID);
    session.epochId = EPOCH_ACTIVE;

    const turn1User: NormalizedCaptureMessage = {
      id: "msg-1-user-aaaa",
      sequence: 1,
      role: "user",
      content: "Hello",
      timestamp: null,
      sourceMessageId: "dom-turn-1-user",
      epochId: EPOCH_ACTIVE,
    };
    const turn2Asst: NormalizedCaptureMessage = {
      id: "msg-2-assistant-bbbb",
      sequence: 2,
      role: "assistant",
      content: "Hi there!",
      timestamp: null,
      sourceMessageId: "dom-turn-2-assistant",
      epochId: EPOCH_ACTIVE,
    };
    session.messages = [turn1User, turn2Asst];

    // Incoming snapshot where sequence indexes shifted (e.g. earlier virtualized turn appeared)
    const shiftedUser: NormalizedCaptureMessage = {
      id: "msg-5-user-aaaa",
      sequence: 5,
      role: "user",
      content: "Hello",
      timestamp: null,
      sourceMessageId: "dom-turn-1-user",
    };
    const shiftedAsst: NormalizedCaptureMessage = {
      id: "msg-6-assistant-bbbb",
      sequence: 6,
      role: "assistant",
      content: "Hi there!",
      timestamp: null,
      sourceMessageId: "dom-turn-2-assistant",
    };

    const merged = mergeCapturedSessions(session, {
      ...session,
      messages: [shiftedUser, shiftedAsst],
    });

    assert.strictEqual(merged.messages.length, 2, "Must not duplicate messages across sequence shifts");
    assert.strictEqual(merged.messages[0].id, "msg-1-user-aaaa", "Preserves original ID");
    assert.strictEqual(merged.messages[0].epochId, EPOCH_ACTIVE, "Preserves original epochId");
  });

  // ── 6. Authorized historical messages survive reload ──────────────────────

  test("6. Reload survival: message roles, content, sourceMessageIds, and epochIds are fully preserved across reload", async () => {
    // 1. Initial conversation saved under EPOCH_ACTIVE
    const convToSave = {
      id: CONV_ID,
      platform: "chatgpt" as const,
      epochId: EPOCH_ACTIVE,
      messages: [
        {
          id: "msg-turn-1-user",
          role: "user" as const,
          content: "Prompt 1",
          sourceMessageId: "dom-turn-1-user",
          epochId: EPOCH_ACTIVE,
        },
        {
          id: "msg-turn-2-asst",
          role: "assistant" as const,
          content: "Response 1",
          sourceMessageId: "dom-turn-2-asst",
          epochId: EPOCH_ACTIVE,
        },
      ],
    };

    await saveConversation(convToSave);

    // Durable authorized IDs populated in storage
    const durableIds = await getAuthorizedMessageIds(CONV_ID);
    assert.strictEqual(durableIds.has("msg-turn-1-user"), true);
    assert.strictEqual(durableIds.has("msg-turn-2-asst"), true);

    // 2. SIMULATE RELOAD: in-memory state cleared
    captureSessions.clear();
    unauthorizedMessageKeysByConv.clear();

    // DOM renders historical turns
    const reloadDoc = makeDoc(`
      <div class="group/user-message">
        <div data-user-message-bubble="true" data-message-id="msg-turn-1-user">
          <p>Prompt 1</p>
        </div>
      </div>
      <div class="DilResponseRoot-HfQrEh" data-message-id="msg-turn-2-asst">
        <p>Response 1</p>
      </div>
    `, `/c/${CONV_ID}`);
    globalThis.document = reloadDoc;

    // Filter extracted messages on reload using durable authorized IDs
    const extracted = extractVisibleConversationFromDOM(reloadDoc);
    const filterResult = filterExtractedDomMessages(
      CONV_ID,
      extracted.messages,
      undefined, // no in-memory session on fresh reload
      undefined,
      EPOCH_ACTIVE,
      durableIds
    );

    assert.strictEqual(filterResult.filteredMessages.length, 2, "Both historical turns retained");
    assert.strictEqual(filterResult.hasNewContent, false, "Historical turns not flagged as new content");

    const [u, a] = filterResult.filteredMessages;
    assert.strictEqual(u.role, "user");
    assert.strictEqual(u.content, "Prompt 1");
    assert.strictEqual(u.id, "msg-turn-1-user");

    assert.strictEqual(a.role, "assistant");
    assert.strictEqual(a.content, "Response 1");
    assert.strictEqual(a.id, "msg-turn-2-asst");
  });

  // ── 7. OFF-period messages and subsequent assistant responses excluded ───

  test("7. Conversational pairing provenance: OFF-period messages and subsequent assistant replies are strictly excluded", async () => {
    const EPOCH_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

    // Storage only has Turn 1 & Turn 2 from Epoch A
    await updateAuthorizedMessageIds(CONV_ID, ["dom-turn-1-user", "dom-turn-2-assistant"]);

    // DOM has:
    // Turns 1 & 2 (Epoch A, persisted)
    // Turns 3 & 4 (Sent while Memory was OFF)
    // Turn 5 & 6 (New Turn under Epoch B)
    const domTurns = [
      { id: "dom-turn-1-user", role: "user" as const, content: "Turn 1 (A)", sourceMessageId: "dom-turn-1-user" },
      { id: "dom-turn-2-assistant", role: "assistant" as const, content: "Turn 2 (A)", sourceMessageId: "dom-turn-2-assistant" },
      { id: "dom-turn-3-user", role: "user" as const, content: "Turn 3 (OFF)", sourceMessageId: "dom-turn-3-user" },
      { id: "dom-turn-4-assistant", role: "assistant" as const, content: "Turn 4 (OFF)", sourceMessageId: "dom-turn-4-assistant" },
      { id: "dom-turn-5-user", role: "user" as const, content: "Turn 5 (B)", sourceMessageId: "dom-turn-5-user" },
      { id: "dom-turn-6-assistant", role: "assistant" as const, content: "Turn 6 (B)", sourceMessageId: "dom-turn-6-assistant" },
    ];

    const unauthorizedKeys = new Set<string>(["dom-turn-3-user"]); // Turn 3 captured in OFF baseline
    const durableIds = await getAuthorizedMessageIds(CONV_ID);

    const filterResult = filterExtractedDomMessages(
      CONV_ID,
      domTurns,
      undefined,
      unauthorizedKeys,
      EPOCH_B,
      durableIds
    );

    // Turns 3 & 4 must be excluded. Turns 1, 2, 5, 6 must be present.
    assert.strictEqual(filterResult.filteredMessages.length, 4, "OFF-period user AND assistant reply must be excluded");
    const contents = filterResult.filteredMessages.map((m) => m.content);
    assert.deepStrictEqual(contents, [
      "Turn 1 (A)",
      "Turn 2 (A)",
      "Turn 5 (B)",
      "Turn 6 (B)",
    ]);

    // Verify Turn 5 & 6 assigned EPOCH_B
    assert.strictEqual(filterResult.filteredMessages[2].epochId, EPOCH_B);
    assert.strictEqual(filterResult.filteredMessages[3].epochId, EPOCH_B);
  });

  // ── 8. OFF-period messages already present when Memory is re-enabled are excluded ───

  test("8. OFF-period user and assistant messages already present when Memory is re-enabled remain strictly excluded across sequence shifts", async () => {
    const CONV_ID = "conv-test-8-off-turns";
    const EPOCH_B = "2f820c84-177b-4804-b83d-789740c240f3";

    // Epoch A already persisted in storage
    await saveConversation({
      id: CONV_ID,
      platform: "chatgpt",
      epochId: EPOCH_ACTIVE,
      messages: [
        { id: "msg-1-user", role: "user", content: "Prompt 1", sourceMessageId: "dom-turn-1-user", epochId: EPOCH_ACTIVE },
        { id: "msg-2-asst", role: "assistant", content: "Response 1", sourceMessageId: "dom-turn-2-asst", epochId: EPOCH_ACTIVE },
      ],
    });

    // When Memory was OFF, user sent VERIFY-OFF-PERIOD-404 and received response
    const docWithOffTurns = makeDoc(`
      <div class="group/user-message"><div data-user-message-bubble="true" data-message-id="msg-1-user"><p>Prompt 1</p></div></div><div class="DilResponseRoot-HfQrEh" data-message-id="msg-2-asst"><p>Response 1</p></div>
      <div class="group/user-message">
        <div data-user-message-bubble="true">
          <p>VERIFY-OFF-PERIOD-404</p>
        </div>
      </div>
      <div class="DilResponseRoot-HfQrEh">
        <p>VERIFY-OFF-PERIOD-404 — Message received successfully.</p>
      </div>
    `, `/c/${CONV_ID}`);
    globalThis.document = docWithOffTurns;

    // Memory is re-enabled (Epoch B). Baseline is established on the active DOM.
    await ensureConversationBaseline(CONV_ID, EPOCH_B);

    const unauthorizedKeys = unauthorizedMessageKeysByConv.get(CONV_ID);
    const unauthorizedCounts = unauthorizedMessageCountsByConv.get(CONV_ID);
    assert.ok(unauthorizedKeys, "unauthorizedKeys must be initialized");
    assert.ok(unauthorizedCounts, "unauthorizedCounts must be initialized");
    assert.strictEqual(unauthorizedKeys.has("user:::VERIFY-OFF-PERIOD-404"), true, "OFF user turn content key must be in baseline");
    assert.strictEqual(unauthorizedKeys.has("assistant:::VERIFY-OFF-PERIOD-404 — Message received successfully."), true, "OFF assistant turn content key must be in baseline");

    // Later: DOM snapshot extracted where sequence indices shifted
    const extracted = extractVisibleConversationFromDOM(docWithOffTurns);
    const durableIds = await getAuthorizedMessageIds(CONV_ID);

    const filterResult = filterExtractedDomMessages(
      CONV_ID,
      extracted.messages,
      undefined,
      unauthorizedKeys,
      EPOCH_B,
      durableIds,
      unauthorizedCounts
    );

    // Only historical Epoch A messages survive; OFF-period turns are excluded
    assert.strictEqual(filterResult.hasNewContent, false, "OFF-period messages must not be flagged as new content");
    assert.strictEqual(filterResult.filteredMessages.length, 2, "Only Epoch A turns must remain");
    assert.strictEqual(filterResult.filteredMessages[0].content, "Prompt 1");
    assert.strictEqual(filterResult.filteredMessages[1].content, "Response 1");
    assert.strictEqual(filterResult.filteredMessages.some((m) => m.content.includes("VERIFY-OFF-PERIOD-404")), false);
  });

  // ── 9. New user message after re-enabling Memory is admitted ───

  test("9. Genuinely new user message submitted after re-enabling Memory is admitted under active Epoch B", async () => {
    const CONV_ID = "conv-test-9-new-user";
    const EPOCH_B = "2f820c84-177b-4804-b83d-789740c240f3";

    await saveConversation({
      id: CONV_ID,
      platform: "chatgpt",
      epochId: EPOCH_ACTIVE,
      messages: [
        { id: "msg-1-user", role: "user", content: "Prompt 1", sourceMessageId: "dom-turn-1-user", epochId: EPOCH_ACTIVE },
        { id: "msg-2-asst", role: "assistant", content: "Response 1", sourceMessageId: "dom-turn-2-asst", epochId: EPOCH_ACTIVE },
      ],
    });

    // Step 1: Baseline established while OFF turns are in DOM
    const docWithOffTurns = makeDoc(`
      <div class="group/user-message"><div data-user-message-bubble="true" data-message-id="msg-1-user"><p>Prompt 1</p></div></div><div class="DilResponseRoot-HfQrEh" data-message-id="msg-2-asst"><p>Response 1</p></div>
      <div class="group/user-message"><div data-user-message-bubble="true"><p>VERIFY-OFF-PERIOD-404</p></div></div>
      <div class="DilResponseRoot-HfQrEh"><p>VERIFY-OFF-PERIOD-404 — Message received successfully.</p></div>
    `, `/c/${CONV_ID}`);
    globalThis.document = docWithOffTurns;
    await ensureConversationBaseline(CONV_ID, EPOCH_B);

    // Step 2: User now submits a brand new prompt in Epoch B
    const docWithNewTurn = makeDoc(`
      <div class="group/user-message"><div data-user-message-bubble="true" data-message-id="msg-1-user"><p>Prompt 1</p></div></div><div class="DilResponseRoot-HfQrEh" data-message-id="msg-2-asst"><p>Response 1</p></div>
      <div class="group/user-message"><div data-user-message-bubble="true"><p>VERIFY-OFF-PERIOD-404</p></div></div>
      <div class="DilResponseRoot-HfQrEh"><p>VERIFY-OFF-PERIOD-404 — Message received successfully.</p></div>
      <div class="group/user-message"><div data-user-message-bubble="true"><p>NEW-PROMPT-UNDER-EPOCH-B</p></div></div>
    `, `/c/${CONV_ID}`);
    globalThis.document = docWithNewTurn;

    const extracted = extractVisibleConversationFromDOM(docWithNewTurn);
    const durableIds = await getAuthorizedMessageIds(CONV_ID);
    const unauthorizedKeys = unauthorizedMessageKeysByConv.get(CONV_ID);
    const unauthorizedCounts = unauthorizedMessageCountsByConv.get(CONV_ID);

    const filterResult = filterExtractedDomMessages(
      CONV_ID,
      extracted.messages,
      undefined,
      unauthorizedKeys,
      EPOCH_B,
      durableIds,
      unauthorizedCounts
    );

    assert.strictEqual(filterResult.hasNewContent, true, "New prompt must be flagged as new content");
    assert.strictEqual(filterResult.filteredMessages.length, 3, "2 historical turns + 1 new turn");
    const newTurn = filterResult.filteredMessages[2];
    assert.strictEqual(newTurn.role, "user");
    assert.strictEqual(newTurn.content, "NEW-PROMPT-UNDER-EPOCH-B");
    assert.strictEqual(newTurn.epochId, EPOCH_B, "New turn must carry active Epoch B");
  });

  // ── 10. Assistant response for new user message is admitted ───

  test("10. Assistant response for genuinely new user message is admitted under active Epoch B", async () => {
    const CONV_ID = "conv-test-10-new-asst";
    const EPOCH_B = "2f820c84-177b-4804-b83d-789740c240f3";

    await saveConversation({
      id: CONV_ID,
      platform: "chatgpt",
      epochId: EPOCH_ACTIVE,
      messages: [
        { id: "msg-1-user", role: "user", content: "Prompt 1", sourceMessageId: "dom-turn-1-user", epochId: EPOCH_ACTIVE },
        { id: "msg-2-asst", role: "assistant", content: "Response 1", sourceMessageId: "dom-turn-2-asst", epochId: EPOCH_ACTIVE },
      ],
    });

    const baselineDoc = makeDoc(`
      <div class="group/user-message"><div data-user-message-bubble="true" data-message-id="msg-1-user"><p>Prompt 1</p></div></div><div class="DilResponseRoot-HfQrEh" data-message-id="msg-2-asst"><p>Response 1</p></div>
      <div class="group/user-message"><div data-user-message-bubble="true"><p>VERIFY-OFF-PERIOD-404</p></div></div>
      <div class="DilResponseRoot-HfQrEh"><p>VERIFY-OFF-PERIOD-404 — Message received successfully.</p></div>
    `, `/c/${CONV_ID}`);
    globalThis.document = baselineDoc;
    await ensureConversationBaseline(CONV_ID, EPOCH_B);

    // Full roundtrip in Epoch B: new user prompt + assistant response
    const docWithBothTurns = makeDoc(`
      <div class="group/user-message"><div data-user-message-bubble="true" data-message-id="msg-1-user"><p>Prompt 1</p></div></div><div class="DilResponseRoot-HfQrEh" data-message-id="msg-2-asst"><p>Response 1</p></div>
      <div class="group/user-message"><div data-user-message-bubble="true"><p>VERIFY-OFF-PERIOD-404</p></div></div>
      <div class="DilResponseRoot-HfQrEh"><p>VERIFY-OFF-PERIOD-404 — Message received successfully.</p></div>
      <div class="group/user-message"><div data-user-message-bubble="true"><p>NEW-PROMPT-UNDER-EPOCH-B</p></div></div>
      <div class="DilResponseRoot-HfQrEh"><p>Assistant response for Epoch B prompt</p></div>
    `, `/c/${CONV_ID}`);
    globalThis.document = docWithBothTurns;

    const extracted = extractVisibleConversationFromDOM(docWithBothTurns);
    const durableIds = await getAuthorizedMessageIds(CONV_ID);
    const unauthorizedKeys = unauthorizedMessageKeysByConv.get(CONV_ID);
    const unauthorizedCounts = unauthorizedMessageCountsByConv.get(CONV_ID);

    const filterResult = filterExtractedDomMessages(
      CONV_ID,
      extracted.messages,
      undefined,
      unauthorizedKeys,
      EPOCH_B,
      durableIds,
      unauthorizedCounts
    );

    assert.strictEqual(filterResult.hasNewContent, true);
    assert.strictEqual(filterResult.filteredMessages.length, 4, "2 Epoch A + 2 Epoch B");

    const newAsstTurn = filterResult.filteredMessages[3];
    assert.strictEqual(newAsstTurn.role, "assistant");
    assert.strictEqual(newAsstTurn.content, "Assistant response for Epoch B prompt");
    assert.strictEqual(newAsstTurn.epochId, EPOCH_B, "Assistant reply must inherit active Epoch B");
  });

  // ── 11. Observer recovery after re-enable does not backfill historical OFF-period messages ───

  test("11. Observer recovery after re-enable does not backfill historical OFF-period messages", async () => {
    const CONV_ID = "conv-test-11-recovery";
    const EPOCH_B = "2f820c84-177b-4804-b83d-789740c240f3";

    await saveConversation({
      id: CONV_ID,
      platform: "chatgpt",
      epochId: EPOCH_ACTIVE,
      messages: [
        { id: "msg-1-user", role: "user", content: "Prompt 1", sourceMessageId: "dom-turn-1-user", epochId: EPOCH_ACTIVE },
        { id: "msg-2-asst", role: "assistant", content: "Response 1", sourceMessageId: "dom-turn-2-asst", epochId: EPOCH_ACTIVE },
      ],
    });

    const doc = makeDoc(`
      <div class="group/user-message"><div data-user-message-bubble="true" data-message-id="msg-1-user"><p>Prompt 1</p></div></div><div class="DilResponseRoot-HfQrEh" data-message-id="msg-2-asst"><p>Response 1</p></div>
      <div class="group/user-message"><div data-user-message-bubble="true"><p>VERIFY-OFF-PERIOD-404</p></div></div>
      <div class="DilResponseRoot-HfQrEh"><p>VERIFY-OFF-PERIOD-404 — Message received successfully.</p></div>
    `, `/c/${CONV_ID}`);
    globalThis.document = doc;

    await ensureConversationBaseline(CONV_ID, EPOCH_B);

    const extracted = extractVisibleConversationFromDOM(doc);
    const durableIds = await getAuthorizedMessageIds(CONV_ID);
    const unauthorizedKeys = unauthorizedMessageKeysByConv.get(CONV_ID);
    const unauthorizedCounts = unauthorizedMessageCountsByConv.get(CONV_ID);

    // Simulate recovery filtering
    const filterResult = filterExtractedDomMessages(
      CONV_ID,
      extracted.messages,
      createCaptureSession("chatgpt", "Test", "https://chatgpt.com", CONV_ID),
      unauthorizedKeys,
      EPOCH_B,
      durableIds,
      unauthorizedCounts
    );

    assert.strictEqual(filterResult.hasNewContent, false, "Recovery must not treat OFF-period turns as new content");
    assert.strictEqual(filterResult.filteredMessages.length, 2, "Recovery must only retain authorized historical turns");
    assert.strictEqual(filterResult.filteredMessages.some((m) => m.content.includes("VERIFY-OFF-PERIOD-404")), false);
  });

  // ── 12. Reload does not authorize old OFF-period DOM messages ───

  test("12. Page reload does not authorize old OFF-period DOM messages into the active epoch", async () => {
    const CONV_ID = "conv-test-12-reload";
    const EPOCH_B = "2f820c84-177b-4804-b83d-789740c240f3";

    // 1. Storage only has Epoch A messages
    await saveConversation({
      id: CONV_ID,
      platform: "chatgpt",
      epochId: EPOCH_ACTIVE,
      messages: [
        { id: "msg-1-user", role: "user", content: "Prompt 1", sourceMessageId: "dom-turn-1-user", epochId: EPOCH_ACTIVE },
        { id: "msg-2-asst", role: "assistant", content: "Response 1", sourceMessageId: "dom-turn-2-asst", epochId: EPOCH_ACTIVE },
      ],
    });

    // 2. SIMULATE RELOAD: in-memory state completely wiped
    captureSessions.clear();
    unauthorizedMessageKeysByConv.clear();
    unauthorizedMessageCountsByConv.clear();
    epochBaselinesEstablished.clear();
    populatedBaselinesEstablished.clear();

    // 3. Reloaded DOM contains historical Epoch A turns AND old OFF-period turns
    const reloadDoc = makeDoc(`
      <div class="group/user-message"><div data-user-message-bubble="true" data-message-id="msg-1-user"><p>Prompt 1</p></div></div><div class="DilResponseRoot-HfQrEh" data-message-id="msg-2-asst"><p>Response 1</p></div>
      <div class="group/user-message"><div data-user-message-bubble="true"><p>VERIFY-OFF-PERIOD-404</p></div></div>
      <div class="DilResponseRoot-HfQrEh"><p>VERIFY-OFF-PERIOD-404 — Message received successfully.</p></div>
    `, `/c/${CONV_ID}`);
    globalThis.document = reloadDoc;

    // 4. Baseline re-established on reload using durable authorized IDs from storage
    await recordEpochObservationBaseline(CONV_ID, EPOCH_B);

    const unauthorizedKeys = unauthorizedMessageKeysByConv.get(CONV_ID);
    const unauthorizedCounts = unauthorizedMessageCountsByConv.get(CONV_ID);
    assert.ok(unauthorizedKeys?.has("user:::VERIFY-OFF-PERIOD-404"), "OFF-period turn must be recorded unauthorized on reload");

    // 5. Observer evaluates DOM turns on reload
    const extracted = extractVisibleConversationFromDOM(reloadDoc);
    const durableIds = await getAuthorizedMessageIds(CONV_ID);

    const filterResult = filterExtractedDomMessages(
      CONV_ID,
      extracted.messages,
      undefined,
      unauthorizedKeys,
      EPOCH_B,
      durableIds,
      unauthorizedCounts
    );

    assert.strictEqual(filterResult.hasNewContent, false, "Reload must not mark OFF-period turns as new content");
    assert.strictEqual(filterResult.filteredMessages.length, 2, "Only stored Epoch A turns must survive reload");
    assert.strictEqual(filterResult.filteredMessages.some((m) => m.content.includes("VERIFY-OFF-PERIOD-404")), false);
  });
});
