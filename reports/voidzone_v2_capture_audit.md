# VOIDZONE V2 — Capture Layer Engineering, Feasibility & Compliance Audit

> **Audit date:** 2026-10-28 | **Branch:** hackathon/voidzone-continuity
> **Auditor:** Antigravity AI — read-only; no source files were modified.
> **Status:** FINAL — awaiting human approval before implementation begins.

---

## A. Executive Summary

### What currently exists

The repository contains a Manifest V3 browser extension (Vite + CRXJS + React) with two distinct, partially connected subsystems:

**1 — ChatGPT network capture subsystem.** chatgptFetchInterceptor.ts (built as chatgptFetchInterceptor.js), content.ts, an in-memory conversationAccumulator, and a background worker that CAN write to chrome.storage.local.
CRITICAL MISSING LINK: content.ts accumulates messages in memory but NEVER calls chrome.runtime.sendMessage. The background worker CONVERSATION_CAPTURED handler is therefore never triggered. No conversations are ever persisted to storage.

**2 — Manual-paste continuity subsystem.** Continuity.tsx + continuityPackage.ts. Fully self-contained, works locally, no network call. THE ONLY END-TO-END WORKING FLOW IN THE REPOSITORY.

Legacy DOM-scraping connector (chatgpt.ts + chatgptExtractor.ts) and scroll-trigger loader (loadChatGPTHistory.ts) exist but are never called.

### What works end-to-end (verified in source)

| Flow | Status |
|---|---|
| Paste transcript -> createContinuityPackage -> JSON download | WORKS |
| Paste transcript -> createContinuityPackage -> copy prompt | WORKS |
| Page-context interceptor built into dist | BUILT (dist/assets/) |
| Content script injects page script | BUILT (dist/manifest.json) |
| Content script validates postMessage events | Code exists; not tested end-to-end |
| Message accumulator dedup | Code exists; in-memory only |
| Background worker stores to chrome.storage.local | Code exists; NEVER TRIGGERED |
| Popup displays stored conversations | NOT IMPLEMENTED |

### Principal risks

1. Undocumented endpoints — interceptor relies on /backend-api/conversations/ and /backend-api/f/conversation. Not authorized by any published OpenAI policy. HIGHEST RISK.
2. Missing storage link — no chrome.runtime.sendMessage in content.ts; tab close loses everything.
3. No tests — zero test files in extension/.
4. No Claude capture — Claude is the declared hackathon source platform; no Claude code exists.
5. Dead file conflict — chatgptNetworkInterceptor.ts is unreferenced and conflicts with the built interceptor.

### Recommended MVP approach

Explicit user-driven paste/import via the existing Continuity.tsx flow, extended with a Claude transcript parser and source hash. Do not enable automatic network interception until the undocumented-endpoint policy question is resolved.

---

## B. Current-State Architecture

### File-by-file table

| File | Key functions | Responsibility | Status | Evidence |
|---|---|---|---|---|
| manifest.json | — | MV3; storage permission; https://chatgpt.com/*; content script at document_start; WAR for chatgptFetchInterceptor.js | VERIFIED | Direct inspection |
| vite.config.ts | — | CRXJS plugin build | VERIFIED | Direct inspection |
| vite.page-script.config.ts | — | Builds IIFE -> public/assets/chatgptFetchInterceptor.js | VERIFIED | Direct inspection |
| src/page-scripts/chatgptFetchInterceptor.ts | installAIMemoryFetchInterceptor, interceptMessagesResponse, interceptConversationResponse, processSSEBlock | Page-context window.fetch wrapper; intercepts /backend-api/conversations/*/messages (JSON) and /backend-api/f/conversation (SSE); posts AI_MEMORY_CHATGPT_MESSAGES_RESPONSE and AI_MEMORY_CHATGPT_CONVERSATION_EVENT | VERIFIED (built in dist) | Direct inspection + dist listing |
| src/connectors/chatgptNetworkInterceptor.ts | IIFE | Legacy duplicate fetch wrapper; never imported or built | DEAD FILE | grep — zero references |
| src/connectors/pageScriptInjector.ts | injectPageScript | Injects chatgptFetchInterceptor.js via <script src> | VERIFIED | Direct inspection |
| src/content/content.ts | main, startMessageListener, handleLiveConversationEvent, handleMessagesResponse, handleMessageStreamComplete, normalizeMessage | Entry point; injects page script; validates postMessage (source==="AI_MEMORY", event.source===window); accumulates messages | NOT VERIFIED END-TO-END — no sendMessage call | Direct inspection (1450 lines) |
| src/content/conversationDetector.ts | detectConversationPage | Returns true for /c/ paths | VERIFIED | Direct inspection |
| src/connectors/conversationAccumulator.ts | addConversationPage, addConversationMessages, getAccumulatedMessages, isConversationComplete | In-memory Map; dedup by message ID; pagination cursors | VERIFIED (logic only); EPHEMERAL | Direct inspection |
| src/connectors/types.ts | Platform, MessageRole, ConversationMessage, Conversation, AIPlatformConnector | Type definitions | VERIFIED | Direct inspection |
| src/connectors/chatgpt.ts | chatGPTConnector | DOM-scraping connector | EXISTS — NEVER CALLED | Direct inspection |
| src/connectors/chatgptExtractor.ts | extractChatGPTMessages | Reads [data-message-author-role] elements | EXISTS — NEVER CALLED | Direct inspection |
| src/connectors/messageId.ts | createMessageId | DJB2-hash of "role:content" | EXISTS — only in dead extractor | Direct inspection |
| src/connectors/loadChatGPTHistory.ts | loadChatGPTHistory | Scroll-to-top loop for lazy DOM loading | EXISTS — ZERO CALLERS | grep |
| src/connectors/waitForMessages.ts | waitForChatGPTMessages | MutationObserver + timeout | EXISTS — ZERO CALLERS | grep |
| src/connectors/registry.ts | registerConnector, getConnector | Connector registry | EXISTS — NEVER USED | Direct inspection |
| src/background/background.ts | chrome.runtime.onMessage | Receives CONVERSATION_CAPTURED; reads selectedProject; calls saveConversation | EXISTS — NEVER TRIGGERED | Direct inspection + grep |
| src/storage/conversationStorage.ts | getConversations, saveConversation, getConversationsByProject | chrome.storage.local CRUD; dedup by message ID | VERIFIED (logic only) | Direct inspection |
| src/continuity/Continuity.tsx | Continuity | Paste UI: platform, title, textarea, generate/copy/export | ONLY WORKING END-TO-END PATH | Direct inspection |
| src/continuity/continuityPackage.ts | createContinuityPackage | Validates transcript; builds ContinuityPackage | VERIFIED | Direct inspection |
| src/App.tsx | App | Popup root; memory toggle; project selector (hardcoded); Continuity; status | VERIFIED | Direct inspection |
| src/components/MemoryToggle.tsx | MemoryToggle | Toggle with storage persistence | VERIFIED | Directory listing |

### Verified current data flow

```
ChatGPT fetch (/backend-api/f/conversation SSE or /backend-api/conversations/*/messages)
  [page context]
  chatgptFetchInterceptor.js
    clone response -> parse -> window.postMessage (origin-scoped)
  [content script isolated world]
  content.ts startMessageListener()
    validates: event.source===window, message.source==="AI_MEMORY"
    routes to handleLiveConversationEvent or handleMessagesResponse
    conversationAccumulator (in-memory Map, dedup by ID)
    *** MISSING: chrome.runtime.sendMessage("CONVERSATION_CAPTURED") ***
    [background.ts and saveConversation() are never reached]

Manual-paste path (ONLY WORKING PATH):
  User pastes transcript -> Continuity.tsx handleGenerate()
  -> createContinuityPackage() (validate + build template prompt)
  -> setResult(package)
  -> Copy prompt or Export JSON
  [local only; no network; no storage dependency]
```

---

## C. Compliance and Access-Method Assessment

### Method 1 — Official export/import — CONDITIONALLY_FEASIBLE

Claude: No documented structured conversation export confirmed for Claude.ai consumer accounts as of October 2026. Must be verified directly.
ChatGPT: OpenAI provides "Settings -> Data controls -> Export data" producing a conversations.json ZIP. ChatGPT is the receiving platform in this hackathon, not the source.
Bottom line: No official Claude export confirmed. Manual paste is the only verified baseline.

### Method 2 — Explicit user-provided transcript — SUPPORTED_BY_OFFICIAL_DOCUMENTATION

User copies text from Claude UI and pastes into VOIDZONE textarea — exactly what Continuity.tsx implements. Chrome extension docs explicitly support popup UIs that process user input. No special permissions required. Clipboard write from a user gesture does not require the clipboardWrite manifest permission in the popup context. THIS IS THE MOST DEFENSIBLE METHOD AND ALREADY WORKS.

### Method 3 — Documented official APIs — NOT_RECOMMENDED

The Anthropic API (api.anthropic.com) is a model inference API; it does NOT expose endpoints to retrieve historical consumer-chat conversations from claude.ai. OpenAI API is the same. No published official API for either platform retrieves existing consumer conversation history.

### Method 4 — Browser extension DOM read — CONDITIONALLY_FEASIBLE

Chrome content scripts can read DOM of pages matching host_permissions — documented MV3 behavior. Reading visible [data-message-author-role] elements is what the dormant chatgptExtractor.ts does.
Policy caveat: OpenAI ToS prohibits scraping/crawling that harms their systems. This distinction has NOT been evaluated against the current ToS by a legal team. Same caveat for claude.ai.
Technical limitation: ChatGPT uses a virtualized message list; DOM scraping captures only rendered messages.

### Method 5 — Page-context network interception — BLOCKED_PENDING_POLICY_OR_AUTHORIZATION_REVIEW

The existing chatgptFetchInterceptor.ts is technically sound — it uses the documented WAR injection pattern to wrap window.fetch in page context.
CRITICAL PROBLEM: It observes /backend-api/conversations/ and /backend-api/f/conversation — UNDOCUMENTED INTERNAL OPENAI ENDPOINTS not part of any public API. Whether passively observing requests from the user's own session constitutes "automated access" has NOT been established by any cited official documentation. BLOCKED until resolved. Also: internal endpoint paths can change without notice.

### Method 6 — DOM scraping / automated browser control — NOT_RECOMMENDED

loadChatGPTHistory.ts programmatically scrolls the page to force lazy loading — automated browser control without explicit per-action user consent. Depends on fragile CSS selectors, captures only rendered text, hardest to distinguish from automated scraping under ToS review. DO NOT USE FOR HACKATHON MVP.

---

## D. Gap Analysis

| Component | Category | Evidence |
|---|---|---|
| Manual-paste continuity UI | EXISTS_AND_VERIFIED | Source + renders in popup |
| createContinuityPackage() | EXISTS_AND_VERIFIED | Source; unit-testable |
| JSON download / clipboard copy | EXISTS_AND_VERIFIED | Source |
| Page-context interceptor (built) | EXISTS_AND_VERIFIED | dist/assets/chatgptFetchInterceptor.js |
| Page script injection | EXISTS_AND_VERIFIED | Source + built manifest |
| postMessage listener with origin/source validation | EXISTS_AND_VERIFIED | content.ts:1264-1353 |
| SSE stream parsing | EXISTS_BUT_NOT_VERIFIED_END_TO_END | Source only; no tests |
| Historical /messages parsing | EXISTS_BUT_NOT_VERIFIED_END_TO_END | Source only; no tests |
| In-memory accumulator (dedup by ID) | EXISTS_AND_VERIFIED (logic only) | Source; never persisted |
| Content script -> background flush | MISSING | No chrome.runtime.sendMessage in content.ts |
| Popup conversation list | MISSING | App.tsx has no stored-conversation display |
| Capture completeness tracking | MISSING | No completeness field in types |
| Claude capture adapter | MISSING | No claude.ai code anywhere |
| schemaVersion on Conversation | MISSING | Not in types.ts |
| captureMethod field | MISSING | Not in types.ts |
| Source provenance / hash | MISSING | Not in any type or code |
| Tests | MISSING | Zero test files in extension/ |
| chatgptNetworkInterceptor.ts | EXISTS_BUT_NOT_VERIFIED_END_TO_END | Dead file — zero imports |
| loadChatGPTHistory.ts | PARTIALLY_IMPLEMENTED | Logic exists; never called |
| chatgpt.ts DOM connector | PARTIALLY_IMPLEMENTED | Logic exists; never called |
| Background worker storage handler | EXISTS_BUT_NOT_VERIFIED_END_TO_END | Code exists; never triggered |
| ChatGPT handoff (copy prompt + JSON) | PARTIALLY_IMPLEMENTED | Export works; ChatGPT doesn't natively consume this JSON |
| Storage quota/error handling | MISSING | No quota guard in saveConversation |

---

## E. Target Architecture

### Trust boundaries

```
[ChatGPT/Claude page context — UNTRUSTED]
  chatgptFetchInterceptor.js
  postMessage -> origin-scoped

[Content script isolated world — extension]
  content.ts
  validates source, origin, schema
  accumulates in-memory
  -> chrome.runtime.sendMessage [TO BE ADDED]

[Background service worker — extension]
  background.ts
  receives CONVERSATION_CAPTURED
  reads selectedProject
  -> chrome.storage.local.set

[Extension popup — extension]
  App.tsx — display, export, Continuity
```

### Extended conversation model (proposed additions to types.ts)

```typescript
export type CaptureMethod =
    | "manual-paste"
    | "file-import"
    | "network-intercept"   // blocked pending policy review
    | "dom-scrape";         // not recommended

export type CaptureCompleteness =
    | "complete-verified"   // all pages confirmed
    | "partial"
    | "incremental"
    | "unknown"             // manual paste or import
    | "failed";

export interface ConversationMessage {
    id: string;
    role: MessageRole;
    content: string;
    timestamp?: string;       // source timestamp ISO-8601; NEVER invented
    capturedAt: string;       // capture timestamp ISO-8601
    sourceMessageId?: string;
}

export interface Conversation {
    id: string;
    schemaVersion: "1";
    projectId?: string;
    platform: Platform;
    platformConversationId?: string;
    title?: string;
    url?: string;
    captureMethod: CaptureMethod;
    completeness: CaptureCompleteness;
    firstCapturedAt: string;
    lastCapturedAt: string;
    capturedAt: string;
    messages: ConversationMessage[];
    sourceHash?: string;     // SHA-256 hex of canonical source bytes
}
```

### Capture completeness state model

| State | Meaning | When set |
|---|---|---|
| complete-verified | All pages received; hasPreviousPage===false | After last /messages page response |
| partial | Pages received but session ended early | Tab close, navigation, error |
| incremental | Live stream active | During SSE streaming |
| unknown | No pagination info | manual-paste, file-import |
| failed | Exception during capture | Error handler |

RULE: A conversation must never be marked complete-verified because one response parsed successfully. isConversationComplete() (accumulator.ts:259) correctly tests hasPreviousPage===false but is only meaningful after pagination state is established.

---

## F. Exact Implementation Plan

### Task 2 — Extend types [MVP — do first]

Add schemaVersion, captureMethod, completeness, firstCapturedAt, lastCapturedAt, platformConversationId, per-message capturedAt to extension/src/connectors/types.ts. Update all callers.
Acceptance criteria: tsc -b passes. Tests: TypeScript compilation.

### Task 3 — Add sourceHash and completeness to ContinuityPackage [MVP]

Extend extension/src/continuity/continuityPackage.ts and Continuity.tsx. Compute sourceHash using SubtleCrypto.digest("SHA-256", ...). Make createContinuityPackage async. Set completeness:"unknown" for all paste input. Never set complete-verified for paste.
Acceptance criteria: Exported JSON has 64-char hex sourceHash and completeness:"unknown". Hash reproducible.
Tests: T09, T24, T25.

### Task 5 — Claude import adapter [MVP — core hackathon feature]

Create extension/src/continuity/claudeImportAdapter.ts. Update Continuity.tsx and continuityPackage.ts.
Required behavior:
- Accept freeform pasted text
- Attempt split on role labels (Human:, You:, Assistant:, Claude:) at start of line
- On success: produce structured ConversationMessage[] with inferred roles and generated IDs
- Report parse confidence in UI: Structured / Heuristic / Unstructured
- Fallback: treat entire text as one entry with completeness:"unknown"
- Never invent timestamps, IDs, or message boundaries

Acceptance criteria: "Human: hello\nClaude: hi" produces 2 messages with correct roles. Free text produces single entry with warning.
Tests: T01, T02, T03, T12.

### Task 7 — Schema validator for import [MVP]

Create extension/src/continuity/packageValidator.ts. Validate schemaVersion, source.platform, transcript. Reject unknown schema versions. Never silently accept malformed JSON.
Tests: T04, T05, T06, T18.

### Task 4 — Popup conversation list [MVP]

Create extension/src/components/ConversationList.tsx. Update extension/src/App.tsx.
- Read conversations from chrome.storage.local on mount
- Display: platform, title, completeness, message count, last capture time
- Do NOT display raw message content
- Export button per entry
- Subscribe to chrome.storage.onChanged

Tests: T19, T22, T23 (manual).

### Task 6 — Storage quota guard [MVP]

In extension/src/storage/conversationStorage.ts: wrap chrome.storage.local.set in try/catch. Surface quota errors. Validate conversation.messages is an array.
Tests: T13, T14.

### Task 1 — Fix content script -> background flush [MVP — conditional on B1]

Add sendConversationToBackground(conversationId) to extension/src/content/content.ts. Call from handleMessageStreamComplete and handleMessagesResponse.

```typescript
async function sendConversationToBackground(
    conversationId: string
): Promise<void> {
    const messages = getAccumulatedMessages(conversationId);
    if (messages.length === 0) return;
    const conversation: Conversation = {
        id: conversationId,
        schemaVersion: "1",
        platform: "chatgpt",
        captureMethod: "network-intercept",
        completeness: isConversationComplete(conversationId)
            ? "complete-verified" : "partial",
        firstCapturedAt: new Date().toISOString(),
        lastCapturedAt: new Date().toISOString(),
        capturedAt: new Date().toISOString(),
        messages,
        title: document.title,
        url: window.location.href,
        platformConversationId: conversationId,
    };
    try {
        await chrome.runtime.sendMessage({
            type: "CONVERSATION_CAPTURED",
            conversation,
        });
    } catch (error) {
        console.warn("AI Memory: Failed to send to background", error);
    }
}
```

Acceptance criteria: After ChatGPT message completes, chrome.storage.local.conversations contains an entry.
DO NOT MERGE until B1 policy question is resolved.

### Task 8 — Remove dead files [POST]

Delete chatgptNetworkInterceptor.ts (conflicts with built interceptor) or formally deprecate. Mark loadChatGPTHistory.ts, waitForMessages.ts, chatgpt.ts as dormant if kept.

### Task 9 — Add claude.ai host permission [BLOCKED — B3]

If Anthropic policy approved: add "https://claude.ai/*" to host_permissions. Do not implement until B3 resolved.

### Task 10 — Network intercept policy resolution [BLOCKED]

Before enabling chatgptFetchInterceptor.ts in any demo or release, obtain documented confirmation re: OpenAI consumer ToS. If unresolved before November 4, interceptor path stays off.

---

## G. Test Matrix

No tests currently exist. None have been executed. All are proposed.

| # | Test name | Setup | Action | Expected result | Verification | Type |
|---|---|---|---|---|---|---|
| T01 | Structured paste | Transcript with Human:/Claude: delimiters | Generate | Messages with correct count and roles | Assert count + roles | Unit |
| T02 | Unstructured paste | Free-text, no role labels | Generate | completeness:"unknown", single entry | Assert completeness | Unit |
| T03 | Empty input | Transcript field empty | Generate | Button disabled; no package; no error | Button disabled | Unit/Manual |
| T04 | Malformed JSON | File {bad json | File parse | User-visible error; no partial state | Error message | Unit |
| T05 | Unknown schema version | File with schemaVersion:"99.0" | Schema validate | Rejection: "Unsupported schema version" | Error message | Unit |
| T06 | Invalid role | Message with role:"robot" | Normalisation | Message rejected; valid messages preserved | Count assertion | Unit |
| T07 | Duplicate messages | Import identical conversation twice | Import x2 | Second: newMessages.length===0 | Return value | Unit |
| T08 | Incremental import | 3 msgs then same 3 + 2 new | Import x2 | Second: newMessages.length===2 | Return value | Unit |
| T09 | Unknown completeness | Manual paste | Generate | completeness:"unknown" in JSON | JSON assertion | Unit |
| T10 | Edited message | Same ID, different content; second import | Import | Latest content stored; no duplicate | Content after save | Unit |
| T11 | Message ordering | Messages in reverse order | Normalise + accumulate | Insertion order preserved (JS Map) | Order assertion | Unit |
| T12 | Unicode transcript | CJK, emoji, RTL | Generate | All chars preserved; sourceHash computed | Char count + hash | Unit |
| T13 | Large transcript (>500 KB) | Very long paste | Generate | No truncation; quota guard fires if exceeded | Size + storage mock | Unit |
| T14 | Storage write failure | Mock chrome.storage.local.set to reject | Import | Error surfaced; no crash; no partial write | Error UI | Unit |
| T15 | Browser restart | Save conversation; close/reopen popup | Read storage | Previously saved conversation present | Manual reload | Manual |
| T16 | Project isolation | Save projectId:"A"; query "B" | getConversationsByProject("B") | Empty array | Array length | Unit |
| T17 | Export/re-import round trip | Generate -> export JSON -> re-import | Validate + compare | Re-imported matches original | Deep equality | Integration |
| T18 | Missing required field | Import JSON without transcript | Schema validation | Rejected with field-specific error | Error message | Unit |
| T19 | Accurate message count | Store 5 messages | View popup | UI shows "5 messages" | DOM/manual | Manual |
| T20 | No invented timestamps | Paste with no timestamp data | Generate | timestamp===undefined on all messages | Assertion | Unit |
| T21 | No network call | Instrument window.fetch | Paste + generate | Zero outbound fetch calls | Fetch mock | Unit |
| T22 | Memory toggle preserved | Toggle Memory OFF; paste | Generate | Continuity works; ChatGPT capture disabled | Memory state | Manual |
| T23 | Project selector preserved | Select project; generate | — | Project stored; package unaffected | Storage assertion | Manual |
| T24 | Source hash reproducibility | Same transcript, two calls | Generate x2 | Identical sourceHash | Equality | Unit |
| T25 | No false complete-verified | Any manual paste | Generate | completeness !== "complete-verified" | Assertion | Unit |

---

## H. Scope Freeze

### In scope for hackathon

- Manual paste / explicit Claude transcript import (extended Continuity.tsx)
- Provider-neutral normalized conversation records (Tasks 2 + 3)
- Honest capture-completeness: "unknown" for paste; "complete-verified" only when all pagination pages confirmed
- Local-first archive via chrome.storage.local
- Portable JSON archive with source hash and completeness
- Accurate popup UI: conversation list, message counts, completeness, export (Task 4)
- ChatGPT continuation: copy continuation prompt + downloadable JSON
- Existing memory toggle and project selector preserved

### Out of scope unless essential

- Automatic network interception for ChatGPT (blocked — B1)
- Claude content script / claude.ai host permission (blocked — B3)
- Native integration with every AI assistant
- Guaranteed automatic full history capture
- Automatic JSON upload into ChatGPT (not supported natively)
- Hidden DOM scraping or scroll automation
- Tool calls, hidden reasoning, internal metadata
- Cloud storage or new backend
- Standalone app or desktop agent
- AI processing on every keystroke
- Muse Spark integration (post-hackathon intelligence layer)
- Features with no code + test path before November 4

---

## I. Open Questions and Blockers

| # | Question | Why it matters | Evidence needed | Safe fallback | Blocks |
|---|---|---|---|---|---|
| B1 | Does OpenAI consumer ToS permit a user-installed extension to observe /backend-api/f/conversation responses? | Required to enable network interceptor | Official ToS review or policy statement | Manual paste only | ChatGPT automatic capture |
| B2 | Does Claude.ai offer any official structured conversation export? | Would enable clean import schema | Direct check of Claude settings + help center | Freeform paste with heuristic parser | Claude import schema |
| B3 | Does Anthropic consumer ToS permit DOM reading from claude.ai by user-installed extension? | Required before adding claude.ai to host_permissions | Anthropic ToS + official policy | Manual paste only | Claude DOM adapter |
| B4 | What is the current /backend-api/conversations/*/messages response schema? | Normalizer assumes {messages:[], page_info:{...}}; if changed, interceptor silently fails | Human inspection of live request on own account | All intercept captures: completeness:"unknown" | Interceptor reliability |
| B5 | Is SubtleCrypto.digest available in MV3 popup context? | Required for sourceHash in Task 3 | Chrome extension API docs for popup context | Skip hash; sourceHash:undefined | Task 3 |
| B6 | What input format does Muse Spark API require? | Intelligence layer depends on this | Meta Muse Spark API documentation (not yet consulted) | Build clean Conversation boundary | Post-hackathon intelligence layer |
| B7 | Are hardcoded project options ("AI Job Agent", "Test Project") intentional? | If yes, project isolation is limited to two fixed IDs | Product decision | Keep as-is; document as placeholder | Scope only |

---

## J. Audit Evidence

### Files inspected (read-only; no modifications made)

manifest.json, dist/manifest.json, package.json, vite.config.ts, vite.page-script.config.ts (87 lines), src/page-scripts/chatgptFetchInterceptor.ts (813 lines), src/connectors/chatgptNetworkInterceptor.ts, src/connectors/pageScriptInjector.ts, src/connectors/types.ts, src/connectors/chatgpt.ts, src/connectors/chatgptExtractor.ts, src/connectors/messageId.ts, src/connectors/conversationAccumulator.ts (290 lines), src/connectors/loadChatGPTHistory.ts (241 lines), src/connectors/waitForMessages.ts, src/connectors/registry.ts, src/content/content.ts (1450 lines, full read), src/content/conversationDetector.ts, src/background/background.ts (103 lines), src/storage/conversationStorage.ts (183 lines), src/continuity/Continuity.tsx (178 lines), src/continuity/continuityPackage.ts (60 lines), src/App.tsx (145 lines), dist/assets/ (directory listing).

### Commands executed (read-only)

- git status — confirmed branch hackathon/voidzone-continuity; 4 modified + untracked continuity files
- git diff — confirmed exact working-tree changes
- list_dir — all extension subdirectories and dist/assets
- grep_search — saveConversation, CONVERSATION_CAPTURED, chrome.runtime.sendMessage, chatgptNetworkInterceptor, loadChatGPTHistory, waitForChatGPTMessages, getAccumulatedMessages, handleLiveConversationEvent, handleMessagesResponse, addEventListener

### Tests actually executed

NONE. No test framework installed. No test files exist.

### Official sources consulted

| Source | Purpose |
|---|---|
| Chrome Extension MV3 documentation | Content scripts, WAR, messaging, storage |
| Chrome Content Scripts documentation | Isolated worlds, page context injection |
| Web-accessible resources documentation | IIFE injection pattern |
| General knowledge of OpenAI consumer ToS | Method 5 — NOT a primary source citation; ToS must be read directly before enabling intercept |
| General knowledge of Anthropic consumer ToS | Methods 3/4 — same caveat |

### Audit limitations

1. No tests were run. All test-matrix entries are proposed, not executed.
2. Network interceptor not tested against a live ChatGPT session (audit rules prohibit this).
3. OpenAI and Anthropic ToS not fetched with direct quotes. Must be read and cited directly before any automatic capture is implemented.
4. dist/ build does not reflect uncommitted continuity changes (Continuity.tsx, continuityPackage.ts, App.tsx, App.css). Build was done before these working-tree changes.

---

## Conclusion

### Recommended capture method for hackathon MVP

Explicit user-driven paste import — the existing Continuity.tsx extended by Task 5 (Claude transcript parser). The only method that works today, requires no new permissions, has a clear legal basis, and can be demonstrated and tested before November 4.

### First implementation tasks in exact order

1. Task 2 — Extend types (blocks everything else)
2. Task 3 — sourceHash + completeness in ContinuityPackage
3. Task 5 — Claude import adapter (core hackathon feature)
4. Task 7 — Schema validator for JSON import
5. Task 4 — Popup conversation list
6. Task 6 — Storage quota guard
7. Task 1 — Content script -> background flush (only if B1 resolved before November 4)

### Specific risks before enabling automatic capture

| Risk | Required action |
|---|---|
| B1 — OpenAI ToS, undocumented endpoints | Written policy confirmation or legal ToS review |
| B3 — Anthropic ToS for DOM read | Same |
| Missing content->background link | Task 1 implemented + end-to-end tested |
| No storage error handling | Task 6 implemented |
| No tests | T01-T10, T14, T17, T21 passing before any demo |

### Verified / proposed / unsupported

VERIFIED CAPABILITIES: Manual paste -> package -> JSON download; page script injection; postMessage origin validation; in-memory accumulator dedup logic; background storage handler (code exists; never triggered).

PROPOSED CAPABILITIES: Background flush (Task 1); extended types (Task 2); source hash (Task 3); Claude adapter (Task 5); popup list (Task 4).

UNSUPPORTED ASSUMPTIONS: "The interceptor captures all historical messages" — not tested end-to-end. "Accumulator represents a complete conversation" — completeness depends on all pages received; no trigger mechanism exists. "chrome.storage.local protects privacy" — local but not encrypted.

---

Audit complete. No files were modified. Awaiting explicit approval before any implementation begins.
