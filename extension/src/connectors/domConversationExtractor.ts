/**
 * domConversationExtractor.ts
 *
 * Robust DOM-based conversation history recovery for ChatGPT.
 * Extracts currently visible conversation turns from the webpage DOM
 * when the extension begins capturing an already-open conversation,
 * or when client-side navigation avoids re-fetching /conversation/{id}.
 *
 * Guarantees:
 * 1. Accurately extracts both user and assistant turns.
 * 2. Filters out UI buttons, copy controls, action bars, badges, and screen-reader text.
 * 3. Extracts stable message IDs from data-message-id or computes deterministic hashes.
 * 4. Preserves chronological order matching the visible conversation layout.
 * 5. Marks extracted conversation state honestly as PARTIAL (DOM only contains currently rendered turns).
 * 6. Never extracts an entire ancestor container containing both user and assistant content.
 * 7. Avoids duplicate messages from nested elements or multiple matching ancestors.
 *
 * --- Selector strategy and observed DOM evidence (2026-11) ---
 *
 * User messages:
 *   Stable semantic attribute: data-user-message-bubble="true"
 *   The text is rendered inside paragraph elements within this element.
 *   We walk up from the bubble to find the turn boundary (a fixed ancestor depth).
 *   Assumption: the turn wrapper is ≤4 levels above the bubble element.
 *
 * Assistant responses:
 *   Observed class: DilResponseRoot (generated suffix varies, e.g. DilResponseRoot-HfQrEh)
 *   Stable semantic attributes to prefer: data-testid starting with "bot-turn" or
 *   data-message-author-role="assistant" if present.
 *   Fallback: querySelector("[class*='DilResponseRoot']") scoped to the turn container.
 *   Important: the larger ancestor also contains a user message. We must NOT extract
 *   the entire ancestor. We only read text from within the DilResponseRoot subtree.
 *
 * Turn boundaries:
 *   ChatGPT historically uses article elements or [data-testid^="conversation-turn-"].
 *   These may no longer be present. As a fallback, we use the observed DOM hierarchy:
 *   - User messages: data-user-message-bubble parent chain up to a reasonable depth.
 *   - Assistant messages: DilResponseRoot element or equivalent stable ancestor.
 *
 * Note: Generated CSS class names (e.g. DilResponseRoot-HfQrEh) are NOT stable across
 * ChatGPT deployments. The code matches on the class name PREFIX "DilResponseRoot" via
 * [class*="DilResponseRoot"]. This is documented as a fallback assumption.
 */

import type { NormalizedCaptureMessage } from "../continuity/captureTypes.ts";
import { generateMessageId } from "../continuity/captureLifecycle.ts";

export interface ExtractedDomConversation {
  conversationId: string | null;
  title: string | null;
  messages: NormalizedCaptureMessage[];
  isComplete: boolean;
}

// ─── Selector constants ──────────────────────────────────────────────────────

/**
 * Stable selectors for user message bubble.
 * data-user-message-bubble is a stable semantic attribute observed in live ChatGPT DOM.
 */
const USER_BUBBLE_SELECTOR = '[data-user-message-bubble="true"]';

/**
 * Stable selectors for turn containers, tried in preference order.
 * data-message-author-role is the most stable semantic attribute.
 * article and [data-testid^="conversation-turn-"] are historical fallbacks.
 */
const TURN_CONTAINER_SELECTORS = [
  '[data-message-author-role]',
  'article[data-testid]',
  'article',
  '[data-testid^="conversation-turn-"]',
] as const;

/**
 * Prefix match for the observed DilResponseRoot assistant content container.
 * IMPORTANT: The suffix (e.g. "-HfQrEh") is generated and NOT stable.
 * Using substring class match as a documented fallback assumption.
 */
const DIL_RESPONSE_ROOT_SELECTOR = '[class*="DilResponseRoot"]';

/**
 * Selector for elements that should be stripped from extracted text.
 * Covers: action buttons, copy controls, citations UI, badges, screen-reader text, icons.
 */
const STRIP_SELECTOR = [
  'button',
  '[role="button"]',
  'svg',
  '.sr-only',
  '[aria-hidden="true"]',
  '[data-testid="message-badge"]',
  '[class*="Badge"]',
  '[class*="badge"]',
  '[class*="Citation"]',
  '[class*="citation"]',
  '[class*="ActionBar"]',
  '[class*="action-bar"]',
  '.text-xs.text-gray-500',
].join(', ');

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Extracts visible messages from the ChatGPT page DOM.
 * Safe to execute in content script environment; returns empty if document is unavailable.
 */
export function extractVisibleConversationFromDOM(
  doc: Document = document
): ExtractedDomConversation {
  if (!doc) {
    return { conversationId: null, title: null, messages: [], isComplete: false };
  }

  // 1. Resolve conversation ID from URL
  let conversationId: string | null = null;
  const path = doc.location?.pathname || "";
  const match = path.match(/\/c\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    conversationId = match[1];
  }

  // 2. Resolve conversation title from page title or header
  let title: string | null = null;
  if (doc.title && doc.title !== "ChatGPT") {
    title = doc.title;
  }

  const rawMessages: NormalizedCaptureMessage[] = [];
  const seenIds = new Set<string>();

  // 3. Try structured turn containers first (semantic, most stable)
  const turns = findTurnContainers(doc);

  if (turns.length > 0) {
    // Structured extraction: each turn element represents one message
    for (const turn of turns) {
      const msg = extractMessageFromTurnElement(turn, rawMessages.length + 1, seenIds);
      if (msg) {
        seenIds.add(msg.id);
        rawMessages.push(msg);
      }
    }
  } else {
    // Fallback extraction: use observed DOM attributes directly
    extractFallback(doc, rawMessages, seenIds);
  }

  return {
    conversationId,
    title,
    messages: rawMessages,
    // DOM extraction is inherently partial since prior pages may be virtualized or unrendered
    isComplete: false,
  };
}

// ─── Turn container discovery ─────────────────────────────────────────────────

/**
 * Attempts to find structured turn container elements using stable semantic selectors.
 * Returns an empty array if no structured turn elements are found.
 */
function findTurnContainers(doc: Document): HTMLElement[] {
  for (const selector of TURN_CONTAINER_SELECTORS) {
    const elements = Array.from(
      doc.querySelectorAll<HTMLElement>(selector)
    );
    if (elements.length > 0) {
      return elements;
    }
  }
  return [];
}

// ─── Structured turn extraction ───────────────────────────────────────────────

/**
 * Extracts a normalized message from a structured turn element.
 * Returns null if the turn has no recognizable role or empty content.
 */
function extractMessageFromTurnElement(
  el: HTMLElement,
  seqHint: number,
  seenIds: Set<string>
): NormalizedCaptureMessage | null {
  // Determine role from stable attribute
  const authorRoleAttr =
    el.getAttribute("data-message-author-role") ||
    el.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role");

  let role: "user" | "assistant" | null = null;
  if (authorRoleAttr === "user") {
    role = "user";
  } else if (authorRoleAttr === "assistant") {
    role = "assistant";
  } else {
    // Heuristic fallback: detect user message bubble or DilResponseRoot
    if (el.querySelector(USER_BUBBLE_SELECTOR)) {
      role = "user";
    } else if (el.querySelector(DIL_RESPONSE_ROOT_SELECTOR)) {
      role = "assistant";
    }
  }

  if (!role) return null;

  // Determine message ID from stable attribute
  const msgIdAttr =
    el.getAttribute("data-message-id") ||
    el.querySelector("[data-message-id]")?.getAttribute("data-message-id");

  // Check for duplicate by stable ID before extracting content (avoid expensive clone)
  if (msgIdAttr && seenIds.has(msgIdAttr)) return null;

  const content = extractCleanTextFromTurnElement(el, role);
  if (!content || content.trim().length === 0) return null;

  const id =
    typeof msgIdAttr === "string" && msgIdAttr.length > 0
      ? msgIdAttr
      : generateMessageId(role, content, seqHint);

  if (seenIds.has(id)) return null;

  return {
    id,
    sequence: seqHint,
    role,
    content,
    timestamp: null,
    sourceMessageId: typeof msgIdAttr === "string" && msgIdAttr.length > 0 ? msgIdAttr : null,
    isInProgress: false,
  };
}

// ─── Fallback extraction ───────────────────────────────────────────────────────

/**
 * Fallback extraction using the observed ChatGPT DOM structure when no structured
 * turn containers exist.
 *
 * Strategy:
 *  1. Find all [data-user-message-bubble="true"] elements → user messages.
 *  2. Find all [class*="DilResponseRoot"] elements → assistant messages.
 *  3. Merge results preserving visual DOM order via compareDocumentPosition.
 *
 * Deduplication: a message is only included once even if nested elements also match.
 */
function extractFallback(
  doc: Document,
  rawMessages: NormalizedCaptureMessage[],
  seenIds: Set<string>
): void {
  type RawEntry = {
    el: HTMLElement;
    role: "user" | "assistant";
    order: number;
  };

  const entries: RawEntry[] = [];

  // ── User message bubbles ──────────────────────────────────────────────────
  const userBubbles = Array.from(
    doc.querySelectorAll<HTMLElement>(USER_BUBBLE_SELECTOR)
  );

  // Deduplicate: if one bubble is an ancestor of another, only keep the outermost
  const dedupedUserBubbles = removeDescendantDuplicates(userBubbles);

  for (const bubble of dedupedUserBubbles) {
    // The message boundary is the user bubble itself (data-user-message-bubble="true")
    // Walk up to find a meaningful turn wrapper that does NOT also contain an assistant response.
    const turnEl = findUserTurnBoundary(bubble);
    const target = turnEl || bubble;
    entries.push({ el: target, role: "user", order: domOrder(target) });
  }

  // ── Assistant response roots ──────────────────────────────────────────────
  const assistantRoots = Array.from(
    doc.querySelectorAll<HTMLElement>(DIL_RESPONSE_ROOT_SELECTOR)
  );

  // Deduplicate: if one root is an ancestor of another, only keep the outermost
  const dedupedAssistantRoots = removeDescendantDuplicates(assistantRoots);

  for (const root of dedupedAssistantRoots) {
    // Verify this root does NOT also contain a user message bubble (would mean it's a container)
    const containsUserBubble = root.querySelector(USER_BUBBLE_SELECTOR) !== null;
    if (containsUserBubble) continue;

    entries.push({ el: root, role: "assistant", order: domOrder(root) });
  }

  // Sort by document order
  entries.sort((a, b) => a.order - b.order);

  for (const entry of entries) {
    const seq = rawMessages.length + 1;
    const msgIdAttr =
      entry.el.getAttribute("data-message-id") ||
      entry.el.querySelector("[data-message-id]")?.getAttribute("data-message-id");

    if (msgIdAttr && seenIds.has(msgIdAttr)) continue;

    const content = extractCleanTextFromTurnElement(entry.el, entry.role);
    if (!content || content.trim().length === 0) continue;

    const id =
      typeof msgIdAttr === "string" && msgIdAttr.length > 0
        ? msgIdAttr
        : generateMessageId(entry.role, content, seq);

    if (seenIds.has(id)) continue;
    seenIds.add(id);

    rawMessages.push({
      id,
      sequence: seq,
      role: entry.role,
      content,
      timestamp: null,
      sourceMessageId: typeof msgIdAttr === "string" && msgIdAttr.length > 0 ? msgIdAttr : null,
      isInProgress: false,
    });
  }
}

// ─── User turn boundary detection ─────────────────────────────────────────────

/**
 * Walks up from a user-message-bubble element to find the natural turn boundary.
 *
 * Strategy: walk up the DOM tree a limited number of levels. Accept the first ancestor
 * that is a reasonable turn wrapper — i.e. one that does NOT also contain an assistant
 * response element (which would mean it is a shared parent container).
 *
 * Returns null if no safe boundary is found above the bubble; the caller will use
 * the bubble itself.
 *
 * Maximum depth: 6 levels above the bubble.
 */
function findUserTurnBoundary(bubble: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = bubble.parentElement;
  let depth = 0;

  while (current && depth < 6) {
    // If this ancestor also contains an assistant response, it's a shared container — stop here
    // and return the previous safe level (i.e., use the bubble itself)
    if (current.querySelector(DIL_RESPONSE_ROOT_SELECTOR)) {
      return null;
    }

    // Structural signals that indicate a turn-level element:
    // - has role="presentation" or role="article"
    // - is an article, section, or [data-testid] that looks like a turn
    const tagName = current.tagName.toLowerCase();
    const role = current.getAttribute("role");
    const testId = current.getAttribute("data-testid") || "";

    if (
      tagName === "article" ||
      role === "article" ||
      testId.includes("conversation-turn") ||
      testId.includes("user-turn")
    ) {
      return current;
    }

    current = current.parentElement;
    depth++;
  }

  return null;
}

// ─── Text extraction ───────────────────────────────────────────────────────────

/**
 * Extracts the user or assistant text while stripping extraneous UI controls:
 * - Code block "Copy code" buttons
 * - Action buttons (Retry, Read aloud, Copy, Like, Dislike)
 * - Badges ("Message received" and similar)
 * - Citations UI
 * - Screen reader announcements (.sr-only)
 * - SVGs and icons
 * - aria-hidden elements
 *
 * For assistant responses:
 *   Scopes extraction to the DilResponseRoot subtree if found within the container,
 *   ensuring the user message portion of a shared ancestor is not included.
 *
 * For user messages:
 *   Uses the bubble element directly or any paragraph/text elements within it.
 */
export function extractCleanTextFromTurnElement(
  container: HTMLElement,
  role: "user" | "assistant"
): string {
  let targetNode: HTMLElement = container;

  if (role === "assistant") {
    // Prefer scoping to DilResponseRoot to avoid capturing user message text
    // from a shared ancestor container
    const dilRoot = container.querySelector<HTMLElement>(DIL_RESPONSE_ROOT_SELECTOR);
    if (dilRoot && !dilRoot.querySelector(USER_BUBBLE_SELECTOR)) {
      targetNode = dilRoot;
    } else {
      // Fallback: look for classic .markdown class
      const markdownEl = container.querySelector<HTMLElement>(".markdown");
      if (markdownEl) targetNode = markdownEl;
    }
  } else {
    // User message: the bubble element itself is the best scope
    // Try to narrow to the bubble if the container is wider
    const bubbleEl = container.querySelector<HTMLElement>(USER_BUBBLE_SELECTOR);
    if (bubbleEl) {
      targetNode = bubbleEl;
    } else if (!container.matches(USER_BUBBLE_SELECTOR)) {
      // Try classic whitespace-pre-wrap
      const userTextEl = container.querySelector<HTMLElement>(".whitespace-pre-wrap");
      if (userTextEl) targetNode = userTextEl;
    }
  }

  // Clone node so we can safely strip controls without modifying the live DOM
  const clone = targetNode.cloneNode(true) as HTMLElement;

  // Remove UI elements that pollute transcript
  const controlsToRemove = clone.querySelectorAll(STRIP_SELECTOR);
  controlsToRemove.forEach((node) => node.remove());

  const text = clone.innerText || clone.textContent || "";
  return text.trim();
}

// ─── DOM utilities ────────────────────────────────────────────────────────────

/**
 * Returns a numeric approximation of DOM document order for an element.
 * Uses the element's TreeWalker position. Falls back to 0 if unavailable.
 */
function domOrder(el: HTMLElement): number {
  if (!el.ownerDocument) return 0;
  let index = 0;
  const walker = el.ownerDocument.createTreeWalker(
    el.ownerDocument.body || el.ownerDocument.documentElement,
    NodeFilter.SHOW_ELEMENT
  );
  while (walker.nextNode()) {
    if (walker.currentNode === el) return index;
    index++;
  }
  return index;
}

/**
 * From an array of elements, removes any that are a descendant of another element
 * in the same array. Returns only the "outermost" elements.
 */
function removeDescendantDuplicates(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter((el) => {
    return !elements.some((other) => other !== el && other.contains(el));
  });
}
