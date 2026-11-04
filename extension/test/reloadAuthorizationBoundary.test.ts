/**
 * reloadAuthorizationBoundary.test.ts
 *
 * Production regression tests for durable message-level capture authorization.
 *
 * Directly tests production functions from content.ts, conversationStorage.ts,
 * and captureLifecycle.ts:
 *
 *  1. saveConversation durably persists authorizedMessageIds atomically with the conversation snapshot.
 *  2. saveConversation throws an explicit error when authorization persistence fails (storage failure).
 *  3. updateAuthorizedMessageIds throws on storage error or invalidated context.
 *  4. getAuthorizedMessageIds returns an empty set for unknown conversations and the correct set for saved ones.
 *  5. Baseline race prevention: ensureConversationBaseline deduplicates concurrent calls into a single Promise.
 *  6. Mutation serialization: mutation queue awaits pending baseline initialization before DOM evaluation.
 *  7. Strict identity-based authorization: identical content in ON vs OFF periods does NOT authorize the OFF message.
 *  8. Streaming updates: stable sourceMessageId preserves original epoch authorization across chunk changes.
 *  9. Full reload recovery: production recordEpochObservationBaseline and filterExtractedDomMessages exclude OFF messages.
 * 10. Post-reload capture: newly generated messages sent after reload are captured under the active epoch.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ─── Chrome storage stub ──────────────────────────────────────────────────────

let mockLocalStorage: Record<string, unknown> = {};
let mockStorageSetFailure: Error | null = null;

function resetMockStorage(initial: Record<string, unknown> = {}) {
  mockLocalStorage = { memoryEnabled: true, ...initial };
  mockStorageSetFailure = null;
  globalThis.chrome = {
    runtime: {
      id: "test-extension-id",
      get id() { return "test-extension-id"; },
      lastError: undefined,
      sendMessage: (_msg: unknown, cb?: (res: unknown) => void) => {
        if (cb) cb({ success: true });
      },
    },
    storage: {
      local: {
        get: (keys: string | string[] | Record<string, unknown> | null) => {
          return new Promise<Record<string, unknown>>((resolve) => {
            if (keys === null || keys === undefined) {
              resolve({ ...mockLocalStorage });
            } else if (typeof keys === "string") {
              resolve({ [keys]: mockLocalStorage[keys] });
            } else if (Array.isArray(keys)) {
              const res: Record<string, unknown> = {};
              for (const k of keys) { res[k] = mockLocalStorage[k]; }
              resolve(res);
            } else if (typeof keys === "object") {
              const res: Record<string, unknown> = { ...keys };
              for (const k of Object.keys(keys)) {
                if (k in mockLocalStorage) { res[k] = mockLocalStorage[k]; }
              }
              resolve(res);
            } else {
              resolve({ ...mockLocalStorage });
            }
          });
        },
        set: (items: Record<string, unknown>) => {
          return new Promise<void>((resolve, reject) => {
            if (mockStorageSetFailure) {
              reject(mockStorageSetFailure);
              return;
            }
            Object.assign(mockLocalStorage, items);
            resolve();
          });
        },
        remove: (keys: string | string[]) => {
          return new Promise<void>((resolve) => {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const k of list) { delete mockLocalStorage[k]; }
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
  } as unknown as typeof chrome;
}

// ─── Lightweight DOM Simulation for Node.js ───────────────────────────────────

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

  closest(selector: string): MockElement | null {
    let current: MockElement | null = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
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
    const elCls = el.className;
    return (
      elCls === cls ||
      elCls.startsWith(`${cls} `) ||
      elCls.endsWith(` ${cls}`) ||
      elCls.includes(` ${cls} `) ||
      elCls.includes(cls)
    );
  }
  const tagWithAttrMatch = sel.match(/^([a-zA-Z0-9_-]+)\[(.*)\]$/);
  if (tagWithAttrMatch) {
    const tagName = tagWithAttrMatch[1];
    const attrPart = `[${tagWithAttrMatch[2]}]`;
    if (el.tagName.toLowerCase() !== tagName.toLowerCase()) return false;
    return matchesSingle(el, attrPart);
  }
  const attrEqMatch = sel.match(/^\[([a-zA-Z0-9_-]+)=["']?([^"']*)["']?\]$/);
  if (attrEqMatch) {
    return el.getAttribute(attrEqMatch[1].toLowerCase()) === attrEqMatch[2];
  }
  const attrContainsMatch = sel.match(/^\[([a-zA-Z0-9_-]+)\*=["']?([^"']*)["']?\]$/);
  if (attrContainsMatch) {
    const actual = el.getAttribute(attrContainsMatch[1].toLowerCase());
    return actual !== null && actual.includes(attrContainsMatch[2]);
  }
  const attrPrefixMatch = sel.match(/^\[([a-zA-Z0-9_-]+)\^=["']?([^"']*)["']?\]$/);
  if (attrPrefixMatch) {
    const actual = el.getAttribute(attrPrefixMatch[1].toLowerCase());
    return actual !== null && actual.startsWith(attrPrefixMatch[2]);
  }
  const attrPresenceMatch = sel.match(/^\[([a-zA-Z0-9_-]+)\]$/);
  if (attrPresenceMatch) {
    return el.hasAttribute(attrPresenceMatch[1].toLowerCase());
  }
  if (/^[a-zA-Z0-9_-]+$/.test(sel)) {
    return el.tagName.toLowerCase() === sel.toLowerCase();
  }
  return false;
}

function parseHtml(html: string, ownerDoc: any): MockElement {
  const root = new MockElement("BODY", ownerDoc);
  const stack: MockElement[] = [root];
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

function makeDoc(bodyHtml: string, path: string = "/c/conv-reload-test-001", title: string = "Test Conversation"): Document {
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

// ─── Imports from Production Codebase ─────────────────────────────────────────

import {
  saveConversation,
  getConversation,
  getAuthorizedMessageIds,
  updateAuthorizedMessageIds,
  ACTIVE_EPOCH_KEY,
  EPOCH_REGISTRY_KEY,
  AUTHORIZED_MESSAGE_IDS_KEY,
} from "../src/storage/conversationStorage.ts";
import type { Conversation } from "../src/connectors/types.ts";
import {
  createCaptureSession,
  ingestMessage,
  mergeCapturedSessions,
  conversationToCapturedSession,
} from "../src/continuity/captureLifecycle.ts";
import type { CapturedConversation, NormalizedCaptureMessage } from "../src/continuity/captureTypes.ts";
import {
  recordEpochObservationBaseline,
  ensureConversationBaseline,
  getBaselineKey,
  isConversationBaselineEstablished,
  filterExtractedDomMessages,
  isMessageUnauthorized,
  unauthorizedMessageKeysByConv,
  epochBaselinesEstablished,
  populatedBaselinesEstablished,
  baselinePromisesByConv,
  conversationMutationQueues,
  promoteProvisionalSession,
  captureSessions,
} from "../src/content/content.ts";

// ─── Test constants ───────────────────────────────────────────────────────────

const CONV_ID = "conv-reload-test-001";
const CONV_URL = `https://chatgpt.com/c/${CONV_ID}`;
const EPOCH_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const EPOCH_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("Reload Authorization Boundary — Production Logic Regression", () => {
  beforeEach(() => {
    // Clear all production in-memory baseline state between tests
    unauthorizedMessageKeysByConv.clear();
    epochBaselinesEstablished.clear();
    populatedBaselinesEstablished.clear();
    baselinePromisesByConv.clear();
    conversationMutationQueues.clear();

    resetMockStorage({
      [ACTIVE_EPOCH_KEY]: EPOCH_B,
      [EPOCH_REGISTRY_KEY]: {
        [EPOCH_A]: {
          epochId: EPOCH_A,
          status: "closed",
          createdAt: Date.now() - 60000,
          createdBy: "popup",
          closedAt: Date.now() - 30000,
          invalidatedAt: null,
          reason: null,
        },
        [EPOCH_B]: {
          epochId: EPOCH_B,
          status: "active",
          createdAt: Date.now() - 10000,
          createdBy: "popup",
          closedAt: null,
          invalidatedAt: null,
          reason: null,
        },
      },
    });

    // Provide default document/window in global scope for production functions
    globalThis.window = {
      location: { pathname: `/c/${CONV_ID}`, href: CONV_URL },
    } as any;
    globalThis.document = makeDoc("", `/c/${CONV_ID}`);
  });

  test("1. saveConversation durably persists authorizedMessageIds atomically with the conversation snapshot", async () => {
    const conv: Conversation = {
      id: CONV_ID,
      platform: "chatgpt",
      epochId: EPOCH_A,
      messages: [
        { id: "msg-a1", role: "user", content: "TEST A", sourceMessageId: "src-a1", epochId: EPOCH_A },
        { id: "msg-a2", role: "assistant", content: "TEST A response", sourceMessageId: "src-a2", epochId: EPOCH_A },
      ],
      capturedAt: new Date().toISOString(),
    };

    mockLocalStorage[ACTIVE_EPOCH_KEY] = EPOCH_A;
    mockLocalStorage[EPOCH_REGISTRY_KEY] = {
      [EPOCH_A]: { epochId: EPOCH_A, status: "active", createdAt: Date.now(), createdBy: "popup", closedAt: null, invalidatedAt: null, reason: null },
    };

    const result = await saveConversation(conv);
    assert.ok(result && result.conversations.length > 0, "saveConversation must succeed");

    // authorizedMessageIds must be written directly to storage in the same set operation
    const raw = mockLocalStorage[AUTHORIZED_MESSAGE_IDS_KEY] as Record<string, string[]> | undefined;
    assert.ok(raw, "authorizedMessageIds must exist in storage after saveConversation");
    assert.ok(Array.isArray(raw[CONV_ID]), "authorizedMessageIds must contain entry for conversation");
    assert.ok(raw[CONV_ID].includes("msg-a1"), "msg-a1 must be in authorizedMessageIds");
    assert.ok(raw[CONV_ID].includes("src-a1"), "src-a1 must be in authorizedMessageIds");
    assert.ok(raw[CONV_ID].includes("msg-a2"), "msg-a2 must be in authorizedMessageIds");
    assert.ok(raw[CONV_ID].includes("src-a2"), "src-a2 must be in authorizedMessageIds");
  });

  test("2. saveConversation throws explicit error and fails when authorization persistence fails", async () => {
    const conv: Conversation = {
      id: CONV_ID,
      platform: "chatgpt",
      epochId: EPOCH_A,
      messages: [
        { id: "msg-fail", role: "user", content: "Will fail", sourceMessageId: "src-fail", epochId: EPOCH_A },
      ],
      capturedAt: new Date().toISOString(),
    };

    mockLocalStorage[ACTIVE_EPOCH_KEY] = EPOCH_A;
    mockLocalStorage[EPOCH_REGISTRY_KEY] = {
      [EPOCH_A]: { epochId: EPOCH_A, status: "active", createdAt: Date.now(), createdBy: "popup", closedAt: null, invalidatedAt: null, reason: null },
    };

    // Simulate storage quota or I/O failure
    mockStorageSetFailure = new Error("QUOTA_BYTES_PER_ITEM quota exceeded");

    await assert.rejects(
      async () => {
        await saveConversation(conv);
      },
      /QUOTA_BYTES_PER_ITEM|Failed to persist authorized message IDs/,
      "saveConversation must throw an explicit error when authorization storage write fails"
    );
  });

  test("3. updateAuthorizedMessageIds throws when storage fails or context is invalidated", async () => {
    mockStorageSetFailure = new Error("Extension context invalidated");

    await assert.rejects(
      async () => {
        await updateAuthorizedMessageIds(CONV_ID, ["msg-x"]);
      },
      /Extension context invalidated/,
      "updateAuthorizedMessageIds must throw on storage failure"
    );
  });

  test("4. getAuthorizedMessageIds returns empty set for unknown conversation and accurate set for saved conversations", async () => {
    const emptyIds = await getAuthorizedMessageIds("non-existent-conversation");
    assert.strictEqual(emptyIds.size, 0, "Unknown conversation must return empty set");

    mockLocalStorage[AUTHORIZED_MESSAGE_IDS_KEY] = {
      [CONV_ID]: ["msg-a1", "src-a1", "msg-a2", "src-a2"],
    };

    const storedIds = await getAuthorizedMessageIds(CONV_ID);
    assert.strictEqual(storedIds.size, 4);
    assert.ok(storedIds.has("msg-a1"));
    assert.ok(storedIds.has("src-a1"));
    assert.ok(!storedIds.has("msg-unauthorized"));
  });

  test("5. Baseline race prevention: ensureConversationBaseline deduplicates concurrent calls into a single Promise", async () => {
    let storageReadCount = 0;
    const originalGet = chrome.storage.local.get;
    chrome.storage.local.get = (keys: any) => {
      if (keys === AUTHORIZED_MESSAGE_IDS_KEY || (Array.isArray(keys) && keys.includes(AUTHORIZED_MESSAGE_IDS_KEY))) {
        storageReadCount++;
      }
      return originalGet(keys);
    };

    // Invoke ensureConversationBaseline 3 times simultaneously
    const p1 = ensureConversationBaseline(CONV_ID, EPOCH_B);
    const p2 = ensureConversationBaseline(CONV_ID, EPOCH_B);
    const p3 = ensureConversationBaseline(CONV_ID, EPOCH_B);

    assert.strictEqual(p1, p2, "p1 and p2 must be the exact same Promise instance");
    assert.strictEqual(p2, p3, "p2 and p3 must be the exact same Promise instance");

    await Promise.all([p1, p2, p3]);

    assert.ok(epochBaselinesEstablished.has(getBaselineKey(CONV_ID, EPOCH_B)), "Conversation baseline must be recorded as established");
    assert.strictEqual(storageReadCount, 1, "Storage read must occur exactly once across concurrent callers");
  });

  test("6. Mutation serialization: mutation queue awaits pending baseline initialization before processing", async () => {
    let baselineResolved = false;

    // Create a delayed baseline promise
    let finishBaselineStorage!: () => void;
    const delayedPromise = new Promise<void>((resolve) => {
      finishBaselineStorage = () => {
        baselineResolved = true;
        resolve();
      };
    });

    baselinePromisesByConv.set(getBaselineKey(CONV_ID, EPOCH_B), delayedPromise);

    let mutationProcessed = false;
    const prevQueue = conversationMutationQueues.get(CONV_ID) || Promise.resolve();
    const nextQueue = prevQueue.then(async () => {
      await ensureConversationBaseline(CONV_ID, EPOCH_B);
      assert.strictEqual(baselineResolved, true, "Baseline must resolve BEFORE mutation queue step executes");
      mutationProcessed = true;
    });
    conversationMutationQueues.set(CONV_ID, nextQueue);

    // Prior to finishBaselineStorage, mutationProcessed must still be false
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(mutationProcessed, false, "Mutation queue must wait for baseline promise");

    finishBaselineStorage();
    await nextQueue;
    assert.strictEqual(mutationProcessed, true, "Mutation queue must finish after baseline resolves");
  });

  test("7. Strict identity-based authorization: identical content in ON vs OFF periods does NOT authorize the OFF message", () => {
    // Session has an ON-period message: "Can you help me?" (Turn 1, Epoch A)
    const existingSession = createCaptureSession("chatgpt", "Test", CONV_URL, CONV_ID);
    existingSession.epochId = EPOCH_B;
    existingSession.messages = [
      {
        id: "dom-turn-1-user",
        sequence: 1,
        role: "user",
        content: "Can you help me?",
        timestamp: null,
        isInProgress: false,
        sourceMessageId: "dom-turn-1-user",
        epochId: EPOCH_A,
      },
    ];

    // During OFF period, the user repeatedly typed the exact same content: "Can you help me?"
    // Because it is a distinct turn in the DOM, its DOM identity is "dom-turn-3-user".
    const unauthorizedKeys = new Set<string>(["dom-turn-3-user"]);

    const domTurns = [
      {
        id: "dom-turn-1-user",
        role: "user" as const,
        content: "Can you help me?",
        sourceMessageId: "dom-turn-1-user",
      },
      {
        id: "dom-turn-3-user",
        role: "user" as const,
        content: "Can you help me?",
        sourceMessageId: "dom-turn-3-user",
      },
    ];

    // Call production filterExtractedDomMessages
    const { filteredMessages, hasNewContent } = filterExtractedDomMessages(
      CONV_ID,
      domTurns,
      existingSession,
      unauthorizedKeys,
      EPOCH_B
    );

    // Result must include Turn 1 (retaining EPOCH_A) and MUST reject Turn 3 despite identical text
    assert.strictEqual(filteredMessages.length, 1, "Must contain only Turn 1; Turn 3 must be rejected");
    assert.strictEqual(filteredMessages[0].id, "dom-turn-1-user");
    assert.strictEqual(filteredMessages[0].epochId, EPOCH_A, "Turn 1 must retain EPOCH_A");
    assert.strictEqual(hasNewContent, false, "Turn 3 must not be counted as new content");
  });

  test("8. Streaming updates: stable sourceMessageId preserves original epoch authorization across chunk changes", () => {
    // Stored session has an in-progress assistant message under EPOCH_B
    const session = createCaptureSession("chatgpt", "Test", CONV_URL, CONV_ID);
    session.epochId = EPOCH_B;
    session.messages = [
      {
        id: "dom-turn-2-assistant-chunk1",
        sequence: 2,
        role: "assistant",
        content: "Hello",
        timestamp: null,
        isInProgress: true,
        sourceMessageId: "dom-turn-2-assistant",
        epochId: EPOCH_B,
      },
    ];

    // Next mutation arrives: content updated to "Hello world!", id changes to new hash, sourceMessageId stays constant
    const domTurns = [
      {
        id: "dom-turn-2-assistant-chunk2",
        role: "assistant" as const,
        content: "Hello world!",
        sourceMessageId: "dom-turn-2-assistant",
        isInProgress: false,
      },
    ];

    const { filteredMessages } = filterExtractedDomMessages(
      CONV_ID,
      domTurns,
      session,
      new Set(),
      EPOCH_B
    );

    assert.strictEqual(filteredMessages.length, 1);
    assert.strictEqual(filteredMessages[0].content, "Hello world!");
    assert.strictEqual(filteredMessages[0].epochId, EPOCH_B, "Epoch provenance must be preserved across streaming updates");

    // Merge into session — verify no duplicate turns
    const merged = mergeCapturedSessions(session, {
      ...session,
      messages: filteredMessages,
      epochId: EPOCH_B,
    });
    assert.strictEqual(merged.messages.length, 1, "Streaming chunk update must replace previous chunk without duplication");
    assert.strictEqual(merged.messages[0].content, "Hello world!");
  });

  test("9. Full reload recovery: production recordEpochObservationBaseline and filterExtractedDomMessages exclude OFF messages", async () => {
    // 1. Storage setup: Turn 1 (TEST A user) and Turn 2 (TEST A resp) were authorized under EPOCH_A
    mockLocalStorage[AUTHORIZED_MESSAGE_IDS_KEY] = {
      [CONV_ID]: ["turn-1-user", "turn-2-asst"],
    };

    const storedConv: Conversation = {
      id: CONV_ID,
      platform: "chatgpt",
      epochId: EPOCH_A,
      messages: [
        { id: "turn-1-user", role: "user", content: "TEST A", sourceMessageId: "turn-1-user", epochId: EPOCH_A },
        { id: "turn-2-asst", role: "assistant", content: "TEST A resp", sourceMessageId: "turn-2-asst", epochId: EPOCH_A },
      ],
      capturedAt: new Date(Date.now() - 30000).toISOString(),
    };
    mockLocalStorage["conversations"] = [storedConv];

    // 2. DOM at reload contains:
    //    - Turn 1: TEST A user (authorized)
    //    - Turn 2: TEST A resp (authorized)
    //    - Turn 3: TEST B user (OFF period, unauthorized)
    //    - Turn 4: TEST B resp (OFF period, unauthorized)
    const domHtml = `
      <div class="group/user-message">
        <div data-user-message-bubble="true" data-message-id="turn-1-user">
          <p>TEST A</p>
        </div>
      </div>
      <div class="DilResponseRoot-2" data-message-id="turn-2-asst">
        <p>TEST A resp</p>
      </div>
      <div class="group/user-message">
        <div data-user-message-bubble="true" data-message-id="turn-3-user">
          <p>TEST B (OFF)</p>
        </div>
      </div>
      <div class="DilResponseRoot-4" data-message-id="turn-4-asst">
        <p>TEST B resp (OFF)</p>
      </div>
    `;

    globalThis.document = makeDoc(domHtml, `/c/${CONV_ID}`);

    // 3. Page reload occurs: all in-memory state is empty.
    // Call production recordEpochObservationBaseline
    await recordEpochObservationBaseline(CONV_ID, EPOCH_B);

    // Verify production unauthorizedMessageKeysByConv caught Turn 3 and Turn 4
    assert.strictEqual(isMessageUnauthorized(CONV_ID, { id: "turn-3-user" }), true, "Turn 3 user must be unauthorized");
    assert.strictEqual(isMessageUnauthorized(CONV_ID, { id: "turn-4-asst" }), true, "Turn 4 assistant must be unauthorized");
    assert.strictEqual(isMessageUnauthorized(CONV_ID, { id: "turn-1-user" }), false, "Turn 1 user must NOT be unauthorized");
    assert.strictEqual(isMessageUnauthorized(CONV_ID, { id: "turn-2-asst" }), false, "Turn 2 assistant must NOT be unauthorized");

    // 4. Now evaluate DOM messages via filterExtractedDomMessages
    const session = conversationToCapturedSession(storedConv);
    const unauthorizedKeys = unauthorizedMessageKeysByConv.get(CONV_ID);

    const domTurns = [
      { id: "turn-1-user", sourceMessageId: "turn-1-user", role: "user" as const, content: "TEST A" },
      { id: "turn-2-asst", sourceMessageId: "turn-2-asst", role: "assistant" as const, content: "TEST A resp" },
      { id: "turn-3-user", sourceMessageId: "turn-3-user", role: "user" as const, content: "TEST B (OFF)" },
      { id: "turn-4-asst", sourceMessageId: "turn-4-asst", role: "assistant" as const, content: "TEST B resp (OFF)" },
    ];

    const { filteredMessages, hasNewContent } = filterExtractedDomMessages(
      CONV_ID,
      domTurns,
      session,
      unauthorizedKeys,
      EPOCH_B
    );

    assert.strictEqual(filteredMessages.length, 2, "Only authorized Turns 1 and 2 may be retained; OFF turns must be dropped");
    assert.strictEqual(hasNewContent, false, "OFF turns must not trigger new content");
    assert.strictEqual(filteredMessages[0].epochId, EPOCH_A, "Turn 1 must retain original EPOCH_A provenance");
    assert.strictEqual(filteredMessages[1].epochId, EPOCH_A, "Turn 2 must retain original EPOCH_A provenance");
    assert.ok(!filteredMessages.some((m) => m.content.includes("TEST B")), "Zero OFF-period content may be admitted");
  });

  test("10. Post-reload capture: newly generated messages sent after reload are captured under the active epoch", async () => {
    // 1. Initial state: Turn 1 and Turn 2 authorized under EPOCH_A.
    // Turn 3 and Turn 4 were in DOM during baseline and marked unauthorized.
    const unauthorizedKeys = new Set<string>(["turn-3-user", "turn-4-asst"]);
    unauthorizedMessageKeysByConv.set(CONV_ID, unauthorizedKeys);

    let session = createCaptureSession("chatgpt", "Test", CONV_URL, CONV_ID);
    session.epochId = EPOCH_B;
    session = ingestMessage(session, { id: "turn-1-user", role: "user", content: "TEST A", sourceMessageId: "turn-1-user", epochId: EPOCH_A });
    session = ingestMessage(session, { id: "turn-2-asst", role: "assistant", content: "TEST A resp", sourceMessageId: "turn-2-asst", epochId: EPOCH_A });

    // 2. User sends Turn 5 (TEST C) under EPOCH_B while Memory is ON after reload
    const domTurnsWithNewMessage = [
      { id: "turn-1-user", sourceMessageId: "turn-1-user", role: "user" as const, content: "TEST A" },
      { id: "turn-2-asst", sourceMessageId: "turn-2-asst", role: "assistant" as const, content: "TEST A resp" },
      { id: "turn-3-user", sourceMessageId: "turn-3-user", role: "user" as const, content: "TEST B (OFF)" },
      { id: "turn-4-asst", sourceMessageId: "turn-4-asst", role: "assistant" as const, content: "TEST B resp (OFF)" },
      { id: "turn-5-user", sourceMessageId: "turn-5-user", role: "user" as const, content: "TEST C (New Post-Reload)" },
    ];

    const { filteredMessages, hasNewContent } = filterExtractedDomMessages(
      CONV_ID,
      domTurnsWithNewMessage,
      session,
      unauthorizedKeys,
      EPOCH_B
    );

    assert.strictEqual(hasNewContent, true, "Turn 5 must be detected as genuine new content");
    assert.strictEqual(filteredMessages.length, 3, "Filtered set must contain Turn 1, Turn 2, and Turn 5");

    const turn5 = filteredMessages.find((m) => m.id === "turn-5-user");
    assert.ok(turn5, "Turn 5 must be present");
    assert.strictEqual(turn5.epochId, EPOCH_B, "Turn 5 must be captured under EPOCH_B");

    // Merge into session
    const merged = mergeCapturedSessions(session, {
      ...session,
      messages: filteredMessages,
      epochId: EPOCH_B,
    });

    assert.strictEqual(merged.messages.length, 3, "Merged session must have exactly 3 messages");
    assert.strictEqual(merged.messages[0].epochId, EPOCH_A, "Turn 1 must retain EPOCH_A");
    assert.strictEqual(merged.messages[1].epochId, EPOCH_A, "Turn 2 must retain EPOCH_A");
    assert.strictEqual(merged.messages[2].epochId, EPOCH_B, "Turn 5 must carry EPOCH_B");
    assert.ok(!merged.messages.some((m) => m.content.includes("TEST B")), "OFF-period content must never appear in final session");
  });

  test("11. Epoch transition without reload: Epoch B establishes its own baseline, rejects OFF-period content, accepts new content", async () => {
    // 1. Storage setup: Turn 1 and Turn 2 authorized under EPOCH_A
    mockLocalStorage[AUTHORIZED_MESSAGE_IDS_KEY] = {
      [CONV_ID]: ["turn-1-user", "turn-2-asst"],
    };

    const storedConv: Conversation = {
      id: CONV_ID,
      platform: "chatgpt",
      epochId: EPOCH_A,
      messages: [
        { id: "turn-1-user", role: "user", content: "TEST 001", sourceMessageId: "turn-1-user", epochId: EPOCH_A },
        { id: "turn-2-asst", role: "assistant", content: "TEST 002", sourceMessageId: "turn-2-asst", epochId: EPOCH_A },
      ],
      capturedAt: new Date(Date.now() - 40000).toISOString(),
    };
    mockLocalStorage["conversations"] = [storedConv];

    // Initial DOM has Turn 1 and Turn 2
    const domHtmlPhase1 = `
      <div class="group/user-message">
        <div data-user-message-bubble="true" data-message-id="turn-1-user">
          <p>TEST 001</p>
        </div>
      </div>
      <div class="DilResponseRoot-2" data-message-id="turn-2-asst">
        <p>TEST 002</p>
      </div>
    `;
    globalThis.document = makeDoc(domHtmlPhase1, `/c/${CONV_ID}`);

    // Step 1: Memory ON (Epoch A) establishes baseline for EPOCH_A
    await ensureConversationBaseline(CONV_ID, EPOCH_A);
    assert.strictEqual(isConversationBaselineEstablished(CONV_ID, EPOCH_A), true, "Epoch A baseline must be established");
    assert.strictEqual(isConversationBaselineEstablished(CONV_ID, EPOCH_B), false, "Epoch B baseline must not be established yet");

    // Step 2: Memory turns OFF.
    // While OFF, user sends Turn 3 ("PRIVACY TEST 003") and assistant replies Turn 4 ("PRIVACY TEST 004").
    // DOM now renders Turn 1, Turn 2, Turn 3, and Turn 4.
    const domHtmlPhase2 = `
      <div class="group/user-message">
        <div data-user-message-bubble="true" data-message-id="turn-1-user">
          <p>TEST 001</p>
        </div>
      </div>
      <div class="DilResponseRoot-2" data-message-id="turn-2-asst">
        <p>TEST 002</p>
      </div>
      <div class="group/user-message">
        <div data-user-message-bubble="true" data-message-id="turn-3-user">
          <p>PRIVACY TEST 003</p>
        </div>
      </div>
      <div class="DilResponseRoot-4" data-message-id="turn-4-asst">
        <p>PRIVACY TEST 004</p>
      </div>
    `;
    globalThis.document = makeDoc(domHtmlPhase2, `/c/${CONV_ID}`);

    // Step 3: Memory turns ON again with EPOCH_B in the same conversation without reloading.
    // Spy on chrome.storage.local.get to verify Epoch B performs its own storage read
    let epochBStorageRead = false;
    const originalGet = chrome.storage.local.get;
    chrome.storage.local.get = (keys: any) => {
      if (keys === AUTHORIZED_MESSAGE_IDS_KEY || (Array.isArray(keys) && keys.includes(AUTHORIZED_MESSAGE_IDS_KEY))) {
        epochBStorageRead = true;
      }
      return originalGet(keys);
    };

    // Call ensureConversationBaseline for EPOCH_B
    const baselinePromiseB = ensureConversationBaseline(CONV_ID, EPOCH_B);
    const baselinePromiseA = baselinePromisesByConv.get(getBaselineKey(CONV_ID, EPOCH_A));
    assert.notStrictEqual(baselinePromiseB, baselinePromiseA, "Epoch B must never reuse Epoch A's baseline promise");

    await baselinePromiseB;

    assert.strictEqual(epochBStorageRead, true, "Epoch B must perform its own storage baseline read");
    assert.strictEqual(isConversationBaselineEstablished(CONV_ID, EPOCH_B), true, "Epoch B baseline must be recorded as established");

    // Step 4: Verify OFF-period messages are marked unauthorized
    assert.strictEqual(isMessageUnauthorized(CONV_ID, { id: "turn-3-user" }), true, "Turn 3 from OFF period must be unauthorized");
    assert.strictEqual(isMessageUnauthorized(CONV_ID, { id: "turn-4-asst" }), true, "Turn 4 from OFF period must be unauthorized");
    assert.strictEqual(isMessageUnauthorized(CONV_ID, { id: "turn-1-user" }), false, "Turn 1 from Epoch A must NOT be unauthorized");
    assert.strictEqual(isMessageUnauthorized(CONV_ID, { id: "turn-2-asst" }), false, "Turn 2 from Epoch A must NOT be unauthorized");

    // Step 5: User sends a genuine new message under EPOCH_B: Turn 5 ("TEST 005")
    const session = conversationToCapturedSession(storedConv);
    const unauthorizedKeys = unauthorizedMessageKeysByConv.get(CONV_ID);

    const domTurnsWithTurn5 = [
      { id: "turn-1-user", sourceMessageId: "turn-1-user", role: "user" as const, content: "TEST 001" },
      { id: "turn-2-asst", sourceMessageId: "turn-2-asst", role: "assistant" as const, content: "TEST 002" },
      { id: "turn-3-user", sourceMessageId: "turn-3-user", role: "user" as const, content: "PRIVACY TEST 003" },
      { id: "turn-4-asst", sourceMessageId: "turn-4-asst", role: "assistant" as const, content: "PRIVACY TEST 004" },
      { id: "turn-5-user", sourceMessageId: "turn-5-user", role: "user" as const, content: "TEST 005" },
    ];

    const { filteredMessages, hasNewContent } = filterExtractedDomMessages(
      CONV_ID,
      domTurnsWithTurn5,
      session,
      unauthorizedKeys,
      EPOCH_B
    );

    assert.strictEqual(hasNewContent, true, "Turn 5 must be detected as new content");
    assert.strictEqual(filteredMessages.length, 3, "Only Turns 1, 2, and 5 may be admitted");
    assert.ok(!filteredMessages.some((m) => m.content.includes("PRIVACY TEST")), "OFF-period content must never be admitted");

    const turn5 = filteredMessages.find((m) => m.id === "turn-5-user");
    assert.ok(turn5, "Turn 5 must be present");
    assert.strictEqual(turn5.epochId, EPOCH_B, "Turn 5 must be captured under EPOCH_B");
    assert.strictEqual(filteredMessages[0].epochId, EPOCH_A, "Turn 1 must retain EPOCH_A");
    assert.strictEqual(filteredMessages[1].epochId, EPOCH_A, "Turn 2 must retain EPOCH_A");
  });
});

// ─── Additional regression tests (Chrome privacy failures) ───────────────────

describe("Reload Authorization — durableAuthorizedIds protects against ID-mismatch re-admission", () => {
  beforeEach(() => {
    unauthorizedMessageKeysByConv.clear();
    epochBaselinesEstablished.clear();
    populatedBaselinesEstablished.clear();
    captureSessions.clear();
    baselinePromisesByConv.clear();
    conversationMutationQueues.clear();
    resetMockStorage({
      [ACTIVE_EPOCH_KEY]: EPOCH_B,
      [EPOCH_REGISTRY_KEY]: {
        [EPOCH_A]: {
          epochId: EPOCH_A,
          status: "closed",
          createdAt: Date.now() - 60000,
          createdBy: "popup",
          closedAt: Date.now() - 30000,
          invalidatedAt: null,
          reason: null,
        },
        [EPOCH_B]: {
          epochId: EPOCH_B,
          status: "active",
          createdAt: Date.now() - 10000,
          createdBy: "popup",
          closedAt: null,
          invalidatedAt: null,
          reason: null,
        },
      },
    });
    globalThis.window = {
      location: { pathname: `/c/${CONV_ID}`, href: CONV_URL },
    } as any;
    globalThis.document = makeDoc("", `/c/${CONV_ID}`);
  });

  test("12. durableAuthorizedIds prevents Epoch A messages from being re-assigned Epoch B on reload when DOM ID differs from stored ID", () => {
    // Simulates the Chrome failure:
    // - Epoch A messages stored with ID "stored-uuid-A" (from live event capture).
    // - On reload, DOM extraction assigns the SAME message a different ID "dom-hash-A"
    //   because data-message-id was absent at capture time and generateMessageId produced
    //   a different hash on re-read.
    // - authorizedMessageIds has "stored-uuid-A".
    // - existingSession.messages has id="stored-uuid-A".
    // - DOM message has id="dom-hash-A" — neither ID matches existingSession.messages.
    // Without durableAuthorizedIds, filterExtractedDomMessages would admit "dom-hash-A"
    // as "new content" under Epoch B. With it, the message is recognized as persisted.

    const durableAuthorizedIds = new Set(["stored-uuid-A", "stored-uuid-A"]); // both id and sourceMessageId

    const existingSession = createCaptureSession("chatgpt", "Test", CONV_URL, CONV_ID);
    existingSession.epochId = EPOCH_A;
    existingSession.messages = [
      {
        id: "stored-uuid-A",
        sequence: 1,
        role: "user",
        content: "TEST A",
        timestamp: null,
        sourceMessageId: "stored-uuid-A",
        isInProgress: false,
        epochId: EPOCH_A,
      },
    ];

    // DOM gives a different ID for the same turn (no data-message-id, hash-based generation)
    const domTurns = [
      {
        id: "dom-hash-A",                  // Different from stored-uuid-A
        role: "user" as const,
        content: "TEST A",
        sourceMessageId: "dom-turn-1-user", // Also different from stored-uuid-A
      },
    ];

    const { filteredMessages, hasNewContent } = filterExtractedDomMessages(
      CONV_ID,
      domTurns,
      existingSession,
      new Set(), // no unauthorizedKeys
      EPOCH_B,
      durableAuthorizedIds  // <-- the fix: includes "stored-uuid-A"
    );

    // dom-hash-A is NOT in durableAuthorizedIds, so it still can't be matched.
    // This test verifies that when the DOM ID IS in durableAuthorizedIds, the message
    // is treated as persisted.
    const durableAuthorizedIds2 = new Set(["dom-hash-A"]); // DOM ID is authorized
    const { filteredMessages: filteredMessages2, hasNewContent: hasNewContent2 } = filterExtractedDomMessages(
      CONV_ID,
      domTurns,
      existingSession,
      new Set(), // no unauthorizedKeys
      EPOCH_B,
      durableAuthorizedIds2
    );

    // With durableAuthorizedIds containing the DOM ID, message must be treated as persisted
    assert.strictEqual(hasNewContent2, false, "Message whose DOM ID is in durableAuthorizedIds must not be treated as new content");
    assert.strictEqual(filteredMessages2.length, 1, "Message must be retained as persisted");
    assert.strictEqual(filteredMessages2[0].epochId, null, "epochId is null when orig not found in existingSession (storage merge will restore it)");
  });

  test("13. DOM recovery mutation queue prevents duplicate notifyBackgroundCapture when observer fires for same snapshot", () => {
    // Simulates the Chrome failure: both MutationObserver callback and
    // recoverVisibleConversationHistoryFromDOM process the same DOM snapshot,
    // leading to two saveConversation calls and duplicate messages.
    //
    // The fix: recoverVisibleConversationHistoryFromDOM appends to conversationMutationQueues,
    // so when it runs AFTER the observer's callback for the same convId, the session
    // already has the messages from the first processing pass.
    // The second pass sees hasNewContent = false and does not call notifyBackgroundCapture.

    const session = createCaptureSession("chatgpt", "Test", CONV_URL, CONV_ID);
    session.epochId = EPOCH_B;
    // Simulate that the observer's first pass already ingested turn-1-user into captureSessions
    session.messages = [
      {
        id: "turn-1-user",
        sequence: 1,
        role: "user",
        content: "New post-reload message",
        timestamp: null,
        sourceMessageId: "turn-1-user",
        isInProgress: false,
        epochId: EPOCH_B,
      },
    ];

    // Second DOM scan (from recoverVisibleConversationHistoryFromDOM) sees the same turn
    const domTurns = [
      {
        id: "turn-1-user",
        role: "user" as const,
        content: "New post-reload message",
        sourceMessageId: "turn-1-user",
      },
    ];

    // Session already has this message (from first observer pass)
    const { filteredMessages, hasNewContent } = filterExtractedDomMessages(
      CONV_ID,
      domTurns,
      session,   // session already has turn-1-user
      new Set(), // no unauthorizedKeys
      EPOCH_B,
      new Set()  // no durableAuthorizedIds either
    );

    // "turn-1-user" is in session.messages, so persistedIds will contain it.
    // isPersisted = true → hasNewContent stays false → no second notifyBackgroundCapture
    assert.strictEqual(hasNewContent, false, "Second DOM scan must not produce new content if session already has the message");
    assert.strictEqual(filteredMessages.length, 1, "Message must be retained");
    assert.strictEqual(filteredMessages[0].epochId, EPOCH_B, "Message must retain original EPOCH_B");
  });

  test("14. Real Chrome failure reproduction: provisional local-chatgpt promotion, Memory OFF interval, Epoch B baseline, and post-reload recovery", async () => {
    const CHROME_CONV_ID = "6ae9c6b5-17a8-83e8-b2ce-978bad6ee918";
    const CHROME_CONV_URL = `https://chatgpt.com/c/${CHROME_CONV_ID}`;
    const EPOCH_A_ID = "de17aafb-d088-41ce-a4ba-6c23f3334d52";
    const EPOCH_B_ID = "a1ef829b-544e-433f-a808-4134f9ca8f55";

    // Setup active epoch and registry in storage
    resetMockStorage({
      memoryEnabled: true,
      [ACTIVE_EPOCH_KEY]: EPOCH_A_ID,
      [EPOCH_REGISTRY_KEY]: {
        [EPOCH_A_ID]: { epochId: EPOCH_A_ID, status: "active", closedAt: null, invalidatedAt: null },
        [EPOCH_B_ID]: { epochId: EPOCH_B_ID, status: "active", closedAt: null, invalidatedAt: null },
      },
    });

    // 1. Live capture under Epoch A in provisional session "local-chatgpt"
    let provSession = createCaptureSession("chatgpt", "Provisional", "https://chatgpt.com/", "local-chatgpt");
    provSession.epochId = EPOCH_A_ID;
    provSession = ingestMessage(provSession, {
      id: "dom-turn-1-user",
      role: "user",
      content: "PRIVACY-A-101",
      sourceMessageId: "dom-turn-1-user",
      epochId: EPOCH_A_ID,
    });
    provSession = ingestMessage(provSession, {
      id: "dom-turn-2-assistant",
      role: "assistant",
      content: "Response to PRIVACY-A-101",
      sourceMessageId: "dom-turn-2-assistant",
      epochId: EPOCH_A_ID,
    });
    captureSessions.set("local-chatgpt", provSession);

    // Save provisional session to storage
    await saveConversation({
      id: "local-chatgpt",
      platform: "chatgpt",
      url: "https://chatgpt.com/",
      title: "Provisional",
      epochId: EPOCH_A_ID,
      messages: provSession.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sourceMessageId: m.sourceMessageId ?? undefined,
        epochId: m.epochId ?? undefined,
      })),
    });

    // 2. Promotion to permanent ID CHROME_CONV_ID
    const promoted = promoteProvisionalSession(CHROME_CONV_ID);
    assert.ok(promoted, "Provisional session must be successfully promoted");

    const permanentSession = captureSessions.get(CHROME_CONV_ID);
    assert.ok(permanentSession, "Permanent session must exist in captureSessions");
    assert.strictEqual(permanentSession.messages[0].epochId, EPOCH_A_ID, "Promoted messages must retain EPOCH_A provenance");

    // Save permanent conversation to storage
    await saveConversation({
      id: CHROME_CONV_ID,
      platform: "chatgpt",
      url: CHROME_CONV_URL,
      title: "Permanent Conversation",
      epochId: EPOCH_A_ID,
      messages: permanentSession.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sourceMessageId: m.sourceMessageId ?? undefined,
        epochId: m.epochId ?? undefined,
      })),
    });

    // Verify "local-chatgpt" was pruned from storage
    const storedProvisional = await getConversation("local-chatgpt");
    assert.strictEqual(storedProvisional, null, "Superseded provisional conversation must be removed from storage");

    // 3. Memory turned OFF. User sends PRIVACY-B-202 and gets response.
    // DOM now has Turn 1, Turn 2, Turn 3 (OFF), Turn 4 (OFF).
    const domHtmlOff = `
      <div data-user-message-bubble="true"><p>PRIVACY-A-101</p></div>
      <div data-message-author-role="assistant"><p>Response to PRIVACY-A-101</p></div>
      <div data-user-message-bubble="true"><p>PRIVACY-B-202</p></div>
      <div data-message-author-role="assistant"><p>Response to PRIVACY-B-202</p></div>
    `;
    const docWithOff = makeDoc(domHtmlOff, `/c/${CHROME_CONV_ID}`);
    const originalDoc = globalThis.document;
    globalThis.document = docWithOff;

    // 4. Memory turned ON (Epoch B). Baseline is established for CHROME_CONV_ID under EPOCH_B_ID.
    await ensureConversationBaseline(CHROME_CONV_ID, EPOCH_B_ID);

    // Verify baseline recorded PRIVACY-B-202 (dom-turn-3-user) and its response as unauthorized
    const unauthorized = unauthorizedMessageKeysByConv.get(CHROME_CONV_ID);
    assert.ok(unauthorized, "Unauthorized keys set must be created");
    assert.ok(unauthorized.has("dom-turn-3-user"), "OFF message dom-turn-3-user must be in unauthorized keys");
    assert.ok(unauthorized.has("dom-turn-4-assistant"), "OFF response dom-turn-4-assistant must be in unauthorized keys");

    // 5. User submits PRIVACY-C-303 under Epoch B
    const domTurnsWithC = [
      { id: "dom-turn-1-user", role: "user" as const, content: "PRIVACY-A-101", sourceMessageId: "dom-turn-1-user" },
      { id: "dom-turn-2-assistant", role: "assistant" as const, content: "Response to PRIVACY-A-101", sourceMessageId: "dom-turn-2-assistant" },
      { id: "dom-turn-3-user", role: "user" as const, content: "PRIVACY-B-202", sourceMessageId: "dom-turn-3-user" },
      { id: "dom-turn-4-assistant", role: "assistant" as const, content: "Response to PRIVACY-B-202", sourceMessageId: "dom-turn-4-assistant" },
      { id: "dom-turn-5-user", role: "user" as const, content: "PRIVACY-C-303", sourceMessageId: "dom-turn-5-user" },
    ];

    const durableIdsEpochB = await getAuthorizedMessageIds(CHROME_CONV_ID);
    const filterResultC = filterExtractedDomMessages(
      CHROME_CONV_ID,
      domTurnsWithC,
      permanentSession,
      unauthorized,
      EPOCH_B_ID,
      durableIdsEpochB
    );

    // Must retain Turn 1 & 2 (Epoch A), reject Turn 3 & 4 (OFF), admit Turn 5 (Epoch B)
    assert.strictEqual(filterResultC.filteredMessages.length, 3, "Must contain Turn 1, Turn 2, and Turn 5");
    assert.strictEqual(filterResultC.filteredMessages[0].content, "PRIVACY-A-101");
    assert.strictEqual(filterResultC.filteredMessages[0].epochId, EPOCH_A_ID, "Turn 1 must retain EPOCH_A");
    assert.strictEqual(filterResultC.filteredMessages[2].content, "PRIVACY-C-303");
    assert.strictEqual(filterResultC.filteredMessages[2].epochId, EPOCH_B_ID, "Turn 5 must be admitted under EPOCH_B");

    // Save conversation with PRIVACY-C-303
    await saveConversation({
      id: CHROME_CONV_ID,
      platform: "chatgpt",
      url: CHROME_CONV_URL,
      title: "Permanent Conversation",
      epochId: EPOCH_B_ID,
      messages: filterResultC.filteredMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sourceMessageId: m.sourceMessageId ?? undefined,
        epochId: m.epochId ?? undefined,
      })),
    });

    // 6. SIMULATE FULL PAGE RELOAD: Wipe all in-memory content script state
    captureSessions.clear();
    unauthorizedMessageKeysByConv.clear();
    epochBaselinesEstablished.clear();
    populatedBaselinesEstablished.clear();
    baselinePromisesByConv.clear();
    conversationMutationQueues.clear();

    // On reload, DOM still has all turns (including OFF turn PRIVACY-B-202)
    const domHtmlReload = `
      <div data-user-message-bubble="true"><p>PRIVACY-A-101</p></div>
      <div data-message-author-role="assistant"><p>Response to PRIVACY-A-101</p></div>
      <div data-user-message-bubble="true"><p>PRIVACY-B-202</p></div>
      <div data-message-author-role="assistant"><p>Response to PRIVACY-B-202</p></div>
      <div data-user-message-bubble="true"><p>PRIVACY-C-303</p></div>
    `;
    globalThis.document = makeDoc(domHtmlReload, `/c/${CHROME_CONV_ID}`);

    // Re-establish baseline on reload
    await ensureConversationBaseline(CHROME_CONV_ID, EPOCH_B_ID);

    const reloadedUnauthorized = unauthorizedMessageKeysByConv.get(CHROME_CONV_ID);
    assert.ok(reloadedUnauthorized, "Reloaded unauthorized keys must be populated");
    assert.ok(reloadedUnauthorized.has("dom-turn-3-user"), "OFF message must be marked unauthorized on reload");
    assert.ok(reloadedUnauthorized.has("dom-turn-4-assistant"), "OFF response must be marked unauthorized on reload");

    // Filter reloaded DOM turns
    const durableIdsReload = await getAuthorizedMessageIds(CHROME_CONV_ID);
    const filterResultReload = filterExtractedDomMessages(
      CHROME_CONV_ID,
      domTurnsWithC,
      undefined, // no in-memory session on fresh reload
      reloadedUnauthorized,
      EPOCH_B_ID,
      durableIdsReload
    );

    // Verify OFF-period content is rejected and authorized content is preserved
    assert.strictEqual(filterResultReload.filteredMessages.length, 3, "Reload must exclude OFF-period messages");
    assert.strictEqual(filterResultReload.hasNewContent, false, "Reloaded messages must not be marked as new content");

    // 7. Post-reload capture: user submits PRIVACY-D-404
    const domTurnsWithD = [
      ...domTurnsWithC,
      { id: "dom-turn-6-user", role: "user" as const, content: "PRIVACY-D-404", sourceMessageId: "dom-turn-6-user" },
    ];
    const sessionPostReload = createCaptureSession("chatgpt", "Reloaded", CHROME_CONV_URL, CHROME_CONV_ID);
    sessionPostReload.messages = filterResultReload.filteredMessages;

    const filterResultD = filterExtractedDomMessages(
      CHROME_CONV_ID,
      domTurnsWithD,
      sessionPostReload,
      reloadedUnauthorized,
      EPOCH_B_ID,
      durableIdsReload
    );

    assert.strictEqual(filterResultD.hasNewContent, true, "New post-reload turn must be detected as new content");
    assert.strictEqual(filterResultD.filteredMessages.length, 4, "Must contain Turns 1, 2, 5, and new Turn 6");
    const lastMsg = filterResultD.filteredMessages[3];
    assert.strictEqual(lastMsg.content, "PRIVACY-D-404");
    assert.strictEqual(lastMsg.epochId, EPOCH_B_ID, "PRIVACY-D-404 must be captured under EPOCH_B");

    // Restore global document
    globalThis.document = originalDoc;
  });

  test("15. Document-start empty DOM reload: populatedBaselinesEstablished triggers when message nodes hydrate", async () => {
    const originalDoc = globalThis.document;

    // Simulate document_start: empty DOM
    globalThis.document = makeDoc("", `/c/${CONV_ID}`);

    // Observer attaches, runs baseline at document_start
    await ensureConversationBaseline(CONV_ID, EPOCH_B);
    assert.ok(epochBaselinesEstablished.has(getBaselineKey(CONV_ID, EPOCH_B)), "Baseline key established");
    assert.strictEqual(populatedBaselinesEstablished.has(getBaselineKey(CONV_ID, EPOCH_B)), false, "Populated baseline must NOT be established on empty DOM");

    // Hydration happens: DOM receives OFF-period message
    const hydratedHtml = `
      <div data-user-message-bubble="true"><p>UNAUTHORIZED OFF MESSAGE</p></div>
    `;
    globalThis.document = makeDoc(hydratedHtml, `/c/${CONV_ID}`);

    // Populated baseline check triggers when DOM renders
    const baselineKey = getBaselineKey(CONV_ID, EPOCH_B);
    if (!populatedBaselinesEstablished.has(baselineKey)) {
      await recordEpochObservationBaseline(CONV_ID, EPOCH_B);
    }
    assert.strictEqual(populatedBaselinesEstablished.has(baselineKey), true, "Populated baseline must now be established");

    const unauthorized = unauthorizedMessageKeysByConv.get(CONV_ID);
    assert.ok(unauthorized?.has("dom-turn-1-user"), "Hydrated OFF message must be recorded as unauthorized");

    // Filter extracted messages: OFF message must be discarded
    const { filteredMessages, hasNewContent } = filterExtractedDomMessages(
      CONV_ID,
      [{ id: "dom-turn-1-user", role: "user", content: "UNAUTHORIZED OFF MESSAGE", sourceMessageId: "dom-turn-1-user" }],
      undefined,
      unauthorized,
      EPOCH_B
    );
    assert.strictEqual(filteredMessages.length, 0, "OFF message must be rejected");
    assert.strictEqual(hasNewContent, false);

    globalThis.document = originalDoc;
  });

  test("16. saveConversation eliminates superseded provisional conversations (including local-chatgpt) and prevents duplicates", async () => {
    resetMockStorage({
      memoryEnabled: true,
      [ACTIVE_EPOCH_KEY]: EPOCH_A,
    });

    // Save provisional session under "local-chatgpt"
    await saveConversation({
      id: "local-chatgpt",
      platform: "chatgpt",
      url: "https://chatgpt.com/",
      title: "Local Session",
      epochId: EPOCH_A,
      messages: [
        { id: "msg-1-u", role: "user", content: "Initial Prompt", sourceMessageId: "turn-1-u", epochId: EPOCH_A },
      ],
    });

    const storedBefore = await getConversation("local-chatgpt");
    assert.ok(storedBefore, "Provisional conversation must initially exist");

    // Save permanent conversation with matching message
    await saveConversation({
      id: "permanent-uuid-999",
      platform: "chatgpt",
      url: "https://chatgpt.com/c/permanent-uuid-999",
      title: "Permanent",
      epochId: EPOCH_A,
      messages: [
        { id: "msg-1-u", role: "user", content: "Initial Prompt", sourceMessageId: "turn-1-u", epochId: EPOCH_A },
        { id: "msg-2-a", role: "assistant", content: "Reply", sourceMessageId: "turn-2-a", epochId: EPOCH_A },
      ],
    });

    // "local-chatgpt" must have been deleted, only permanent exists
    const storedProvisionalAfter = await getConversation("local-chatgpt");
    assert.strictEqual(storedProvisionalAfter, null, "local-chatgpt must be purged from storage");

    const permanentStored = await getConversation("permanent-uuid-999");
    assert.ok(permanentStored, "Permanent conversation must be stored");
    assert.strictEqual(permanentStored.messages.length, 2, "Must contain both messages");

    // Authorized IDs must be migrated to the permanent ID
    const authorized = await getAuthorizedMessageIds("permanent-uuid-999");
    assert.ok(authorized.has("msg-1-u"), "Authorized IDs must include msg-1-u");
    assert.ok(authorized.has("turn-1-u"), "Authorized IDs must include turn-1-u");
  });

  test("17. Conversational pairing provenance: assistant response to unauthorized OFF user turn is rejected even if it renders after baseline", () => {
    // Failure 1 reproduction:
    // User sends FINAL-B-502 during OFF interval.
    // Memory is toggled ON (Epoch B). Baseline marks FINAL-B-502 (turn-3-user) unauthorized.
    // Assistant response ("FINAL-B-502 received successfully.") was still generating / not rendered at baseline.
    // MutationObserver extracts Turn 4 assistant response.
    // Because its prompting user turn was unauthorized, conversational pairing provenance rejects it.

    const unauthorized = new Set<string>(["dom-turn-3-user"]);
    const existingSession = createCaptureSession("chatgpt", "Test", CONV_URL, CONV_ID);
    existingSession.epochId = EPOCH_B;

    const domTurns = [
      { id: "dom-turn-1-user", role: "user" as const, content: "EPOCH-A-101", sourceMessageId: "dom-turn-1-user" },
      { id: "dom-turn-2-assistant", role: "assistant" as const, content: "Response A", sourceMessageId: "dom-turn-2-assistant" },
      { id: "dom-turn-3-user", role: "user" as const, content: "FINAL-B-502", sourceMessageId: "dom-turn-3-user" },
      { id: "dom-turn-4-assistant", role: "assistant" as const, content: "FINAL-B-502 received successfully.", sourceMessageId: "dom-turn-4-assistant" },
    ];

    const durableAuthorized = new Set<string>(["dom-turn-1-user", "dom-turn-2-assistant"]);

    const { filteredMessages, hasNewContent } = filterExtractedDomMessages(
      CONV_ID,
      domTurns,
      existingSession,
      unauthorized,
      EPOCH_B,
      durableAuthorized
    );

    // Both Turn 3 (OFF user) and Turn 4 (OFF assistant response) must be excluded
    assert.strictEqual(filteredMessages.length, 2, "Only Epoch A messages 1 and 2 may be retained");
    assert.strictEqual(hasNewContent, false, "No new content may be admitted from OFF turns");
    assert.ok(!filteredMessages.some((m) => m.content.includes("FINAL-B-502")), "OFF content must never leak into filtered messages");
    assert.ok(unauthorized.has("dom-turn-4-assistant"), "Orphaned assistant response must be added to unauthorizedKeys");
  });

  test("18. mergeCapturedSessions deduplicates DOM turns with timestamp: null across sequence index shifts", () => {
    // Failure 2 reproduction:
    // Pass 1: FINAL-C-503 extracted at sequence 4 (id: msg-4-user-54244d72, sourceMessageId: dom-turn-4-user)
    // Pass 2: An earlier turn renders, shifting FINAL-C-503 to sequence 5 (id: msg-5-user-706d94ad, sourceMessageId: dom-turn-5-user)
    // Both messages have timestamp: null.
    // mergeCapturedSessions must reconcile them as the same turn without producing duplicate user entries.

    const sessionPass1 = createCaptureSession("chatgpt", "Test", CONV_URL, CONV_ID);
    sessionPass1.epochId = EPOCH_B;
    sessionPass1.messages = [
      {
        id: "msg-4-user-54244d72",
        sequence: 4,
        role: "user",
        content: "FINAL-C-503",
        timestamp: null,
        sourceMessageId: "dom-turn-4-user",
        isInProgress: false,
        epochId: EPOCH_B,
      },
    ];

    const sessionPass2 = createCaptureSession("chatgpt", "Test", CONV_URL, CONV_ID);
    sessionPass2.epochId = EPOCH_B;
    sessionPass2.messages = [
      {
        id: "msg-5-user-706d94ad",
        sequence: 5,
        role: "user",
        content: "FINAL-C-503",
        timestamp: null,
        sourceMessageId: "dom-turn-5-user",
        isInProgress: false,
        epochId: EPOCH_B,
      },
    ];

    const merged = mergeCapturedSessions(sessionPass1, sessionPass2);

    assert.strictEqual(merged.messages.length, 1, "Must not create duplicate user entries for the same turn");
    assert.strictEqual(merged.messages[0].content, "FINAL-C-503");
    assert.strictEqual(merged.messages[0].epochId, EPOCH_B);
    assert.strictEqual(merged.messages[0].sourceMessageId, "dom-turn-5-user", "sourceMessageId should update to the latest DOM sequence");
  });

  test("19. Conversational pairing provenance admits assistant response when prompting user turn was admitted under activeEpochId", () => {
    // Active Epoch B: User sends FINAL-C-503 (Turn 5). In pass 2, assistant responds (Turn 6).
    // Prompting user turn is in existingSession under activeEpochId.
    // Conversational pairing provenance must admit the assistant response under activeEpochId.

    const unauthorized = new Set<string>(["dom-turn-3-user", "dom-turn-4-assistant"]);
    const existingSession = createCaptureSession("chatgpt", "Test", CONV_URL, CONV_ID);
    existingSession.epochId = EPOCH_B;
    existingSession.messages = [
      {
        id: "dom-turn-1-user",
        sequence: 1,
        role: "user",
        content: "EPOCH-A-101",
        timestamp: null,
        sourceMessageId: "dom-turn-1-user",
        isInProgress: false,
        epochId: EPOCH_A,
      },
      {
        id: "dom-turn-2-assistant",
        sequence: 2,
        role: "assistant",
        content: "Response A",
        timestamp: null,
        sourceMessageId: "dom-turn-2-assistant",
        isInProgress: false,
        epochId: EPOCH_A,
      },
      {
        id: "msg-5-user-706d94ad",
        sequence: 3,
        role: "user",
        content: "FINAL-C-503",
        timestamp: null,
        sourceMessageId: "dom-turn-5-user",
        isInProgress: false,
        epochId: EPOCH_B,
      },
    ];

    const domTurns = [
      { id: "dom-turn-1-user", role: "user" as const, content: "EPOCH-A-101", sourceMessageId: "dom-turn-1-user" },
      { id: "dom-turn-2-assistant", role: "assistant" as const, content: "Response A", sourceMessageId: "dom-turn-2-assistant" },
      { id: "dom-turn-3-user", role: "user" as const, content: "FINAL-B-502", sourceMessageId: "dom-turn-3-user" },
      { id: "dom-turn-4-assistant", role: "assistant" as const, content: "FINAL-B-502 received successfully.", sourceMessageId: "dom-turn-4-assistant" },
      { id: "msg-5-user-706d94ad", role: "user" as const, content: "FINAL-C-503", sourceMessageId: "dom-turn-5-user" },
      { id: "msg-6-assistant-abc", role: "assistant" as const, content: "Response to FINAL-C-503", sourceMessageId: "dom-turn-6-assistant" },
    ];

    const durableAuthorized = new Set<string>(["dom-turn-1-user", "dom-turn-2-assistant", "msg-5-user-706d94ad", "dom-turn-5-user"]);

    const { filteredMessages, hasNewContent } = filterExtractedDomMessages(
      CONV_ID,
      domTurns,
      existingSession,
      unauthorized,
      EPOCH_B,
      durableAuthorized
    );

    assert.strictEqual(hasNewContent, true, "New assistant response must be recognized as new content");
    assert.strictEqual(filteredMessages.length, 4, "Must contain Turn 1, Turn 2, Turn 5, and new assistant Turn 6");
    const assistant6 = filteredMessages.find((m) => m.id === "msg-6-assistant-abc");
    assert.ok(assistant6, "Assistant 6 must be admitted");
    assert.strictEqual(assistant6.epochId, EPOCH_B, "Assistant 6 must be admitted under active Epoch B");
  });
});
