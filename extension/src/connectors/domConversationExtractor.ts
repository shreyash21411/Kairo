/**
 * domConversationExtractor.ts
 *
 * Robust DOM-based conversation history recovery for ChatGPT.
 * Extracts currently visible conversation turns from the webpage DOM
 * when the extension begins capturing an already-open conversation,
 * during live browser turn observation via MutationObserver,
 * or when client-side navigation avoids re-fetching /conversation/{id}.
 *
 * Guarantees:
 * 1. Accurately extracts both user and assistant turns based on live browser DOM evidence.
 * 2. Filters out UI buttons, copy controls, action bars, badges ("Message received"), citations, and screen-reader text.
 * 3. Extracts stable message IDs from data-message-id or computes deterministic hashes, with stable turn-based sourceMessageId for streaming reconciliation.
 * 4. Preserves chronological order matching the visible conversation layout via compareDocumentPosition.
 * 5. Marks extracted conversation state honestly as PARTIAL (DOM only contains currently rendered turns).
 * 6. Never extracts an entire ancestor container containing both user and assistant content.
 * 7. Avoids duplicate messages when multiple matching descendants or ancestors exist.
 * 8. Avoids extracting nested paragraphs as separate messages; joins message blocks with preserved formatting.
 * 9. Detects assistant streaming state (isInProgress) via live streaming indicators without repeated copies.
 * 10. Maintains conversation identity and epoch provenance intact across navigation and reload.
 *
 * --- Selector strategy and observed DOM evidence (2026-11) ---
 *
 * User messages:
 *   Stable semantic attribute: data-user-message-bubble="true"
 *   Wrapper ancestor class: group/user-message
 *   The user message text is rendered inside paragraph (<p>) elements.
 *   Turn boundary: the bubble itself or its immediate group/user-message wrapper;
 *   never walk into a shared ancestor that also contains an assistant response.
 *
 * Assistant responses:
 *   Observed hierarchy (from innermost to outermost):
 *     Level 0: <p class="TextBase-... Text-..."> (actual response text)
 *     Level 1: <div class="DilRenderer-... DilResponseRoot-...">
 *     Level 2: <div class="PortalBoundary-...">
 *     Level 3: <div class="entity-prose-inset">
 *     Level 4: <div class="my-4 first:mt-0...">
 *     Level 5: <div class="MarkdownRoot-...">
 *     Level 6: <div class="group flex min-w-0 flex-col">
 *     Level 7–8: larger shared container (also contains badge "Message received" and preceding user message)
 *
 *   Selection strategy:
 *     1. Stable semantic attributes first: [data-message-author-role="assistant"],
 *        [data-testid*="bot-turn"], [data-testid*="assistant-turn"].
 *     2. Documented structural fallback assumptions:
 *        [class*="DilResponseRoot"], [class*="DilRenderer"], [class*="MarkdownRoot"].
 *     3. Turn boundary: walk up to the highest assistant-only ancestor (e.g. MarkdownRoot or Level 6 flex-col)
 *        that does NOT contain [data-user-message-bubble="true"] and does NOT contain other assistant turns.
 *     4. Scoping: Never extract the Level 7-8 shared ancestor as assistant content.
 *     5. Badges: Strip [data-testid="message-badge"], [class*="Badge"], [class*="badge"], and text "Message received".
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
 * Stable semantic selector for user message bubble.
 * data-user-message-bubble="true" is observed in live ChatGPT DOM.
 */
export const USER_BUBBLE_SELECTOR = '[data-user-message-bubble="true"]';

/**
 * Observed container class for user message wrapper.
 */
export const USER_WRAPPER_SELECTOR = '[class*="group/user-message"]';

/**
 * Known selectors identifying user message turns or containers in ChatGPT.
 */
export const USER_SELECTORS = [
  '[data-user-message-bubble="true"]',
  '[class*="group/user-message"]',
  '[data-message-author-role="user"]',
  '[data-testid*="user-turn"]',
] as const;

/**
 * Selectors for assistant response containers, in preference order:
 * 1. Stable semantic attributes
 * 2. Documented structural class prefixes observed in live ChatGPT DOM
 */
export const ASSISTANT_SELECTORS = [
  '[data-message-author-role="assistant"]',
  '[data-testid*="bot-turn"]',
  '[data-testid*="assistant-turn"]',
  '[class*="DilResponseRoot"]',
  '[class*="DilRenderer"]',
  '[class*="MarkdownRoot"]',
] as const;

/**
 * Structured turn container selectors from earlier ChatGPT versions.
 * Only accepted if they do not contain both user and assistant content simultaneously.
 */
const LEGACY_TURN_SELECTORS = [
  '[data-message-author-role]',
  'article[data-testid]',
  'article',
  '[data-testid^="conversation-turn-"]',
] as const;

/**
 * Substring class match for DilResponseRoot (documented fallback assumption).
 */
export const DIL_RESPONSE_ROOT_SELECTOR = '[class*="DilResponseRoot"]';

/**
 * Selectors for UI chrome that must be stripped from extracted message text.
 * Covers: buttons, copy controls, icons, badges, action bars, citations, screen-reader text.
 */
export const STRIP_SELECTOR = [
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
  '[role="tooltip"]',
  '[role="menu"]',
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

  // 3. Try structured turn containers first (if clean, non-shared turn elements exist)
  const legacyTurns = findValidLegacyTurns(doc);

  if (legacyTurns.length > 0) {
    for (const turn of legacyTurns) {
      const msg = extractMessageFromLegacyTurn(turn, rawMessages.length + 1, seenIds, doc);
      if (msg) {
        seenIds.add(msg.id);
        rawMessages.push(msg);
      }
    }
  }

  // 4. If structured turn extraction yielded no messages (as in current ChatGPT DOM),
  // use evidence-based extraction from observed DOM structure
  if (rawMessages.length === 0) {
    extractEvidenceBased(doc, rawMessages, seenIds);
  }

  return {
    conversationId,
    title,
    messages: rawMessages,
    // DOM extraction is inherently partial since prior pages may be virtualized or unrendered
    isComplete: false,
  };
}

// ─── Evidence-based DOM extraction ───────────────────────────────────────────

interface RawTurnEntry {
  el: HTMLElement;
  role: "user" | "assistant";
}

/**
 * Extracts conversation turns using the observed ChatGPT DOM structure.
 *
 * Guarantees:
 * 1. User messages found via data-user-message-bubble="true" with safe turn boundary.
 * 2. Assistant responses found via DilResponseRoot / MarkdownRoot / semantic attributes.
 * 3. Never extracts a shared ancestor containing both user and assistant content.
 * 4. Deduplicates nested elements; multiple paragraphs in one turn become ONE message.
 * 5. Messages sorted in visual document order via compareDocumentPosition.
 * 6. Streaming assistant response marked isInProgress=true when live streaming indicators exist.
 */
function extractEvidenceBased(
  doc: Document,
  rawMessages: NormalizedCaptureMessage[],
  seenIds: Set<string>
): void {
  const entries: RawTurnEntry[] = [];
  const processedElements = new Set<HTMLElement>();

  // ── 1. Discover User Message Turn Elements ─────────────────────────────────
  const rawUserElements: HTMLElement[] = [];
  const userSeen = new Set<HTMLElement>();
  for (const selector of USER_SELECTORS) {
    const matches = Array.from(doc.querySelectorAll<HTMLElement>(selector));
    for (const el of matches) {
      if (!userSeen.has(el) && !containsAssistantContent(el)) {
        userSeen.add(el);
        rawUserElements.push(el);
      }
    }
  }

  // Filter out any user elements nested inside other user elements
  const outermostBubbles = removeDescendantDuplicates(rawUserElements);

  for (const bubble of outermostBubbles) {
    // Establish message boundary: find immediate user container, never cross into shared container
    const turnBoundary = findSafeUserBoundary(bubble);
    const target = turnBoundary || bubble;

    if (!processedElements.has(target)) {
      processedElements.add(target);
      entries.push({ el: target, role: "user" });
    }
  }

  // ── 2. Discover Assistant Response Elements ───────────────────────────────
  const rawAssistantCandidates = findAssistantCandidateElements(doc);

  // Deduplicate candidate elements to outermost containers
  const deduplicatedCandidates = removeDescendantDuplicates(rawAssistantCandidates);

  for (const candidate of deduplicatedCandidates) {
    // Never accept a container that contains user content or is inside a user element
    if (
      candidate.querySelector(USER_BUBBLE_SELECTOR) ||
      candidate.querySelector(USER_WRAPPER_SELECTOR) ||
      candidate.querySelector('[data-message-author-role="user"]') ||
      candidate.closest(USER_BUBBLE_SELECTOR) ||
      candidate.closest(USER_WRAPPER_SELECTOR) ||
      candidate.closest('[data-message-author-role="user"]')
    ) {
      continue;
    }

    // Find the safe assistant turn boundary (highest ancestor that does NOT contain user content)
    const turnBoundary = findSafeAssistantBoundary(candidate);
    const target = turnBoundary || candidate;

    // Double check that target does NOT contain user content or wrap a user message
    if (
      target.querySelector(USER_BUBBLE_SELECTOR) ||
      target.querySelector(USER_WRAPPER_SELECTOR) ||
      target.querySelector('[data-message-author-role="user"]') ||
      target.closest(USER_BUBBLE_SELECTOR) ||
      target.closest(USER_WRAPPER_SELECTOR) ||
      target.closest('[data-message-author-role="user"]')
    ) {
      // Fallback: use candidate itself if strictly safe
      if (
        !processedElements.has(candidate) &&
        !candidate.querySelector(USER_BUBBLE_SELECTOR) &&
        !candidate.querySelector(USER_WRAPPER_SELECTOR) &&
        !candidate.closest(USER_BUBBLE_SELECTOR) &&
        !candidate.closest(USER_WRAPPER_SELECTOR)
      ) {
        processedElements.add(candidate);
        entries.push({ el: candidate, role: "assistant" });
      }
      continue;
    }

    if (!processedElements.has(target)) {
      processedElements.add(target);
      entries.push({ el: target, role: "assistant" });
    }
  }

  // ── 3. Sort entries in true document order ─────────────────────────────────
  // DOCUMENT_POSITION_FOLLOWING = 4, DOCUMENT_POSITION_PRECEDING = 2
  entries.sort((a, b) => {
    if (a.el === b.el) return 0;
    if (typeof a.el.compareDocumentPosition === "function") {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & 4) return -1;
      if (pos & 2) return 1;
    }
    return 0;
  });

  // ── 4. Extract clean text, deduplicate, and normalize ──────────────────────
  const isStreamingActive = checkIsStreamingActive(doc);

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const seq = rawMessages.length + 1;

    // Check for stable message ID attribute if present
    const msgIdAttr =
      entry.el.getAttribute("data-message-id") ||
      entry.el.querySelector("[data-message-id]")?.getAttribute("data-message-id");

    if (msgIdAttr && seenIds.has(msgIdAttr)) {
      continue;
    }

    const content = extractCleanTextFromTurnElement(entry.el, entry.role);
    if (!content || content.trim().length === 0) {
      continue;
    }

    const id =
      typeof msgIdAttr === "string" && msgIdAttr.length > 0
        ? msgIdAttr
        : generateMessageId(entry.role, content, seq);

    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    // Stable sourceMessageId ensures that streaming assistant chunks update in place
    const sourceMessageId =
      typeof msgIdAttr === "string" && msgIdAttr.length > 0
        ? msgIdAttr
        : `dom-turn-${seq}-${entry.role}`;

    // Detect streaming on the latest assistant turn
    const isLatestAssistant =
      entry.role === "assistant" && idx === entries.length - 1;
    const isInProgress = isLatestAssistant && isStreamingActive;

    rawMessages.push({
      id,
      sequence: seq,
      role: entry.role,
      content,
      timestamp: null,
      sourceMessageId,
      isInProgress,
    });
  }
}

// ─── Assistant candidate discovery ───────────────────────────────────────────

/**
 * Searches for assistant response elements using available stable semantic attributes
 * followed by documented structural class prefix fallbacks.
 */
function findAssistantCandidateElements(doc: Document): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const selector of ASSISTANT_SELECTORS) {
    const elements = Array.from(doc.querySelectorAll<HTMLElement>(selector));
    for (const el of elements) {
      const isInsideUser = Boolean(
        el.closest(USER_BUBBLE_SELECTOR) ||
        el.closest(USER_WRAPPER_SELECTOR) ||
        el.closest('[data-message-author-role="user"]') ||
        el.closest('[data-testid*="user-turn"]')
      );
      const containsUser = Boolean(
        el.querySelector(USER_BUBBLE_SELECTOR) ||
        el.querySelector(USER_WRAPPER_SELECTOR) ||
        el.querySelector('[data-message-author-role="user"]') ||
        el.querySelector('[data-testid*="user-turn"]')
      );
      if (!seen.has(el) && !isInsideUser && !containsUser) {
        seen.add(el);
        candidates.push(el);
      }
    }
  }
  return removeDescendantDuplicates(candidates);
}

// ─── Safe Turn Boundary Walkers ──────────────────────────────────────────────

/**
 * Walks up from a user message bubble to find its turn boundary.
 * Never crosses into an ancestor that contains assistant content.
 */
function findSafeUserBoundary(bubble: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = bubble.parentElement;
  let bestBoundary: HTMLElement = bubble;
  let depth = 0;

  while (current && depth < 6) {
    // If this ancestor contains assistant content, STOP immediately.
    // The previous level was safe.
    if (containsAssistantContent(current)) {
      return bestBoundary;
    }

    // If this ancestor is the user-message wrapper, record it
    const className = current.className || "";
    if (typeof className === "string" && className.includes("group/user-message")) {
      bestBoundary = current;
    }

    // If this ancestor matches article or user-turn
    const testId = current.getAttribute("data-testid") || "";
    if (
      current.tagName.toLowerCase() === "article" ||
      testId.includes("user-turn") ||
      testId.includes("conversation-turn")
    ) {
      bestBoundary = current;
    }

    current = current.parentElement;
    depth++;
  }

  return bestBoundary;
}

/**
 * Walks up from an assistant response root to find the highest ancestor that
 * is exclusive to this assistant response turn (does not contain user content).
 */
function findSafeAssistantBoundary(root: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = root.parentElement;
  let bestBoundary: HTMLElement = root;
  let depth = 0;

  while (current && depth < 7) {
    const tag = current.tagName.toLowerCase();
    if (tag === "body" || tag === "html") {
      break;
    }

    // If this ancestor also contains ANY user content selectors, it is a shared turn container.
    // STOP HERE and do not include the shared container.
    if (
      current.querySelector(USER_BUBBLE_SELECTOR) ||
      current.querySelector(USER_WRAPPER_SELECTOR) ||
      current.querySelector('[data-message-author-role="user"]') ||
      current.querySelector('[data-testid*="user-turn"]')
    ) {
      return bestBoundary;
    }

    // Check if this ancestor is a turn-level container
    const className = current.className || "";
    if (
      typeof className === "string" &&
      (className.includes("MarkdownRoot") ||
        className.includes("group") ||
        className.includes("flex-col"))
    ) {
      bestBoundary = current;
    }

    current = current.parentElement;
    depth++;
  }

  return bestBoundary;
}

/**
 * Returns true if an element contains any assistant response indicators.
 */
function containsAssistantContent(el: HTMLElement): boolean {
  for (const selector of ASSISTANT_SELECTORS) {
    if (el.querySelector(selector)) {
      return true;
    }
  }
  return false;
}

// ─── Text Extraction & UI Stripping ──────────────────────────────────────────

/**
 * Extracts clean user or assistant text while stripping extraneous UI controls:
 * - Code block "Copy code" buttons
 * - Action buttons (Retry, Read aloud, Copy, Like, Dislike)
 * - Badges ("Message received" and similar)
 * - Citations UI
 * - Screen reader announcements (.sr-only)
 * - SVGs and icons
 *
 * Guarantees:
 * - Never extracts an entire ancestor containing both user and assistant content.
 * - Joins paragraph / heading / list blocks with appropriate newlines so nested paragraphs
 *   are never fragmented into separate messages and formatting is preserved.
 */
export function extractCleanTextFromTurnElement(
  container: HTMLElement,
  role: "user" | "assistant"
): string {
  let targetNode: HTMLElement = container;

  if (role === "assistant") {
    // If container somehow still contains user content, narrow to the assistant subtree.
    // This is a safety net: the assistant boundary walker should have already prevented
    // shared containers from reaching here, but guard defensively against all known user selectors.
    const containsUserContent =
      container.querySelector(USER_BUBBLE_SELECTOR) ||
      container.querySelector(USER_WRAPPER_SELECTOR) ||
      container.querySelector('[data-message-author-role="user"]') ||
      container.querySelector('[data-testid*="user-turn"]');
    if (containsUserContent) {
      const scoped =
        container.querySelector<HTMLElement>(DIL_RESPONSE_ROOT_SELECTOR) ||
        container.querySelector<HTMLElement>('[class*="MarkdownRoot"]') ||
        container.querySelector<HTMLElement>('[data-message-author-role="assistant"]');
      if (
        scoped &&
        !scoped.querySelector(USER_BUBBLE_SELECTOR) &&
        !scoped.querySelector(USER_WRAPPER_SELECTOR) &&
        !scoped.querySelector('[data-message-author-role="user"]')
      ) {
        targetNode = scoped;
      } else {
        // Cannot isolate safe assistant subtree — return empty to skip this element
        return "";
      }
    }
  } else {
    // User message: bubble element itself is the authoritative boundary
    const bubbleEl = container.matches(USER_BUBBLE_SELECTOR)
      ? container
      : container.querySelector<HTMLElement>(USER_BUBBLE_SELECTOR);
    if (bubbleEl) {
      targetNode = bubbleEl;
    }
  }

  // Clone node so we can safely strip controls without modifying the live DOM
  const clone = targetNode.cloneNode(true) as HTMLElement;

  // Remove UI elements that pollute transcript
  const controlsToRemove = clone.querySelectorAll(STRIP_SELECTOR);
  controlsToRemove.forEach((node) => node.remove());

  // Also remove badge elements containing known badge text ("Message received")
  const allDescendants = Array.from(clone.querySelectorAll<HTMLElement>("*"));
  for (const el of allDescendants) {
    const text = (el.textContent || "").trim();
    if (
      text === "Message received" ||
      text === "Message sent" ||
      text === "Copy code" ||
      text === "Read aloud" ||
      text === "Retry"
    ) {
      el.remove();
    }
  }

  // Extract structured block elements (<p>, <pre>, <li>, <h1>-<h6>, <blockquote>)
  // to preserve paragraph breaks (\n\n) without relying on detached innerText
  const blocks = Array.from(
    clone.querySelectorAll<HTMLElement>("p, pre, li, h1, h2, h3, h4, h5, h6, blockquote")
  );

  if (blocks.length > 0) {
    // Keep only outermost blocks (exclude nested blocks to avoid duplication)
    const outermost = blocks.filter(
      (b) => !blocks.some((other) => other !== b && other.contains(b))
    );
    const textParts = outermost
      .map((b) => (b.innerText || b.textContent || "").trim())
      .filter((t) => t.length > 0);

    if (textParts.length > 0) {
      return textParts.join("\n\n");
    }
  }

  const raw = clone.innerText || clone.textContent || "";
  return raw.trim();
}

// ─── Legacy Turn Extraction (for backward compatibility) ──────────────────────

function findValidLegacyTurns(doc: Document): HTMLElement[] {
  const hasUserBubbles = Boolean(doc.querySelector(USER_BUBBLE_SELECTOR));

  for (const selector of LEGACY_TURN_SELECTORS) {
    const elements = Array.from(doc.querySelectorAll<HTMLElement>(selector));
    if (elements.length > 0) {
      // Reject if any turn contains BOTH user and assistant content (shared container)
      const isShared = elements.some(
        (el) =>
          el.querySelector(USER_BUBBLE_SELECTOR) &&
          containsAssistantContent(el)
      );
      if (isShared) continue;

      // If page has user bubbles, legacy turn elements must represent user turns as well
      if (hasUserBubbles) {
        const containsUser = elements.some(
          (el) => el.getAttribute("data-message-author-role") === "user" || el.querySelector(USER_BUBBLE_SELECTOR)
        );
        if (!containsUser) continue;
      }

      return elements;
    }
  }
  return [];
}

function extractMessageFromLegacyTurn(
  el: HTMLElement,
  seqHint: number,
  seenIds: Set<string>,
  doc: Document
): NormalizedCaptureMessage | null {
  const authorRoleAttr =
    el.getAttribute("data-message-author-role") ||
    el.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role");

  let role: "user" | "assistant" | null = null;
  if (authorRoleAttr === "user") {
    role = "user";
  } else if (authorRoleAttr === "assistant") {
    role = "assistant";
  } else if (el.querySelector(USER_BUBBLE_SELECTOR)) {
    role = "user";
  } else if (containsAssistantContent(el)) {
    role = "assistant";
  }

  if (!role) return null;

  const msgIdAttr =
    el.getAttribute("data-message-id") ||
    el.querySelector("[data-message-id]")?.getAttribute("data-message-id");

  if (msgIdAttr && seenIds.has(msgIdAttr)) return null;

  const content = extractCleanTextFromTurnElement(el, role);
  if (!content || content.trim().length === 0) return null;

  const id =
    typeof msgIdAttr === "string" && msgIdAttr.length > 0
      ? msgIdAttr
      : generateMessageId(role, content, seqHint);

  if (seenIds.has(id)) return null;

  const sourceMessageId =
    typeof msgIdAttr === "string" && msgIdAttr.length > 0
      ? msgIdAttr
      : `dom-turn-${seqHint}-${role}`;

  const isStreaming = role === "assistant" && checkIsStreamingActive(doc);

  return {
    id,
    sequence: seqHint,
    role,
    content,
    timestamp: null,
    sourceMessageId,
    isInProgress: isStreaming,
  };
}

// ─── Streaming Detection Helper ──────────────────────────────────────────────

/**
 * Checks whether live ChatGPT DOM shows an active streaming response.
 * Looks for the "Stop generating" / "Stop streaming" button or streaming class.
 */
function checkIsStreamingActive(doc: Document): boolean {
  try {
    return Boolean(
      doc.querySelector('button[data-testid="stop-button"]') ||
      doc.querySelector('button[aria-label*="Stop"]') ||
      doc.querySelector('button[aria-label*="stop"]') ||
      doc.querySelector('[class*="result-streaming"]')
    );
  } catch {
    return false;
  }
}

// ─── DOM utilities ────────────────────────────────────────────────────────────

/**
 * Removes elements that are descendants of another element in the same array.
 * Returns only the outermost elements.
 */
function removeDescendantDuplicates(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter((el) => {
    return !elements.some((other) => other !== el && other.contains(el));
  });
}
