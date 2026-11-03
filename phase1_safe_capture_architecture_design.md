# VOIDZONE Phase 1 — Safe Capture Architecture Specification
## Document Revision: 2.14.1 (Final Predicate & Invalidation Verification Corrections)

> **Status:** ARCHITECTURE DESIGN SPECIFICATION — REVISION 2.14.1
> **Platform Target:** ChatGPT Web Application (`https://chatgpt.com/*`) Exclusively
> **Observation Paradigm:** Passive DOM Mutation Observer in Isolated Content Script World (Zero Network Interception)
> **Preceding Revisions:** 2.0 (Audit Baseline) through 2.14 (Final Consistency Audit Corrections)
> **Scope Authorization:** Strict Design-Only. Implementation frozen pending explicit human authorization.
> **Preserved Artifacts:** `extension/src/App.css.pre-continuity.bak`, `extension/src/App.tsx.pre-continuity.bak`

---

## 1. Executive Summary & Architectural Charter

VOIDZONE delivers verifiable, privacy-conscious conversation capture and continuity for AI platform interactions. User privacy and capture integrity are absolute architectural invariants. When the user disables Memory, capture terminates immediately and fail-closed.

Revision 2.12 delivers the final lifecycle, record integrity, and write-ownership audit, resolving the following open issues from Revision 2.11:

1. **Strict `EpochRecord` Integrity Validation:** Adds a comprehensive predicate validating every field in a registry entry — key-to-ID consistency, timestamp validity, `closedAt` nullability constraints, and optional field types. Documents what this validation proves and what it does not.
2. **Explicit Message Provenance Model:** Defines exactly which component stamps `epochId` onto a captured message, when stamping occurs, and what trust boundary limits provenance assurance.
3. **Popup Lifecycle Coordinator Re-Evaluation:** Exhaustively models 11 failure scenarios (popup close mid-transition, duplicates, concurrency, storage failure, timeout) to determine whether the Popup can realistically remain the sole `epochRegistry` mutator; recommends a minimal safe design change; and provides a formal lifecycle state machine.
4. **Comprehensive Storage Writer Matrix:** Re-audits W1–W9 with explicit race, cutoff eligibility, and queue-isolation analysis, enforcing that one JavaScript queue cannot serialize writes from a different execution context.
5. **Reworked PAUSING Privacy Boundary:** Precisely distinguishes seven sequential events from user click to final cutoff snapshot; describes the propagation interval as an unavoidable residual risk rather than a bounded promise; defines what content may and may not enter the interrupted snapshot.
6. **Storage Reset, Migration & Corruption Behavior:** Defines fail-closed rules for 8 degraded states including cleared storage, partial reset, corrupt registry, and quota exhaustion.
7. **12 Concrete Acceptance Scenarios:** Step-by-step event sequences with expected storage state, authorization result, and persistence eligibility.

---

## 2. Scope Freeze & Network Isolation Mandate

### 2.1 Prohibited Mechanisms
* **NO Main World Injection.** The extension must never execute scripts in ChatGPT's page context (`"world": "MAIN"`).
* **NO Network Interception.** No wrapping of `window.fetch`, `XMLHttpRequest`, `WebSocket`, or `EventSource`.
* **NO Private Endpoint Snooping.** No inspection of `/backend-api/*` endpoints.
* **NO Stream Cloning or Reader Manipulation.** `chatgptFetchInterceptor.ts` is permanently removed.
* **NO External Platforms.** Scope frozen exclusively to `https://chatgpt.com/*`.

### 2.2 Approved Observation Paradigm
Capture operates exclusively via passive `MutationObserver` and DOM tree inspection inside the Content Script's isolated world. The observer is an external, passive bystander of ChatGPT's rendered output.

### 2.3 Cross-Context Execution Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                CHATGPT PAGE CONTEXT (MAIN WORLD)                    │
│  ChatGPT React App — completely untouched & unmonitored             │
│  • Native fetch, streaming, React reconciler                        │
│  • Renders turns into DOM: [data-message-author-role]               │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ Passive DOM rendering only
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│            CONTENT SCRIPT ISOLATED WORLD  [content.ts]              │
│  • Sole Active Capture Domain Owner                                 │
│  • Passive MutationObserver                                         │
│  • Trusted Browser Event Filter (isTrusted gate)                    │
│  • FIFO Pending Submission Queue                                     │
│  • In-Memory Lifecycle State Machine                                │
│  • Serialized In-Process Commit Queue                               │
│  • READS epochRegistry; NEVER WRITES it                             │
└──────────────────▲─────────────────────────────┬────────────────────┘
                   │ chrome.tabs.sendMessage      │ Serialized W2,W4,W5
                   │ (Request/Response protocol)  ▼
┌──────────────────┴──────────────┐  ┌────────────────────────────────┐
│  EXTENSION POPUP  [App.tsx]     │  │  CHROME STORAGE IPC            │
│  • User Privacy Toggle          │  │  chrome.storage.local          │
│  • Lifecycle State Machine      │  │  • ACTIVE_CAPTURE_SESSION_KEY  │
│  • SOLE MUTATOR of epochRegistry│  │    (Content Script writes;     │
│  • Emergency Eviction Agent     │  │     Popup emergency evicts)    │
│  • Persistent-Pending Queue     │  │  • CONVERSATIONS_KEY           │
│    (survives popup close)       │  │    (Background Worker writes)  │
│  • W6,W7,W8 direct settings     │  │  • epochRegistry (Popup writes)│
└─────────────────────────────────┘  └──────────────────▲─────────────┘
                                                        │
                                     ┌──────────────────┴─────────────┐
                                     │  BACKGROUND SERVICE WORKER     │
                                     │  • Archive Store W1, W9        │
                                     │  • Reads epochRegistry only    │
                                     │  • Per-message provenance gate │
                                     └────────────────────────────────┘
```

---

## 3. Strict `EpochRecord` Integrity Predicate (Resolving Issue 1)

### 3.1 `EpochRecord` Schema

```typescript
export type EpochStatus = "active" | "closed" | "invalidated";

export interface EpochRecord {
  readonly epochId: string;
  readonly status: EpochStatus;
  readonly createdAt: number;
  readonly closedAt: number | null;
  readonly reason?: string;
}
```

### 3.2 Validation Predicate

```typescript
const EPOCH_ID_REGEX = /^epoch_[0-9]{13,15}_[0-9a-f-]{36}$/i;
const MAX_REASON_LENGTH = 128;
const MIN_CREATED_AT = 1_700_000_000_000; // Nov 2023; before extension existed

export function isValidEpochRecord(
  registryKey: string,
  value: unknown
): value is EpochRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;

  // Field 1: epochId format
  if (typeof r.epochId !== "string" || !EPOCH_ID_REGEX.test(r.epochId)) return false;

  // Field 2: registry key must exactly match record's own epochId
  if (registryKey !== r.epochId) return false;

  // Field 3: status is exactly one of three known values
  if (r.status !== "active" && r.status !== "closed" && r.status !== "invalidated") return false;

  // Field 4: createdAt is a finite number within plausible range
  if (
    typeof r.createdAt !== "number" ||
    !isFinite(r.createdAt) ||
    r.createdAt < MIN_CREATED_AT
  ) return false;

  // Field 5: closedAt nullability constraint
  if (r.status === "active") {
    if (r.closedAt !== null) return false; // active records must have null closedAt
  } else {
    // closed or invalidated must have a valid finite timestamp
    if (
      typeof r.closedAt !== "number" ||
      !isFinite(r.closedAt) ||
      r.closedAt < r.createdAt
    ) return false;
  }

  // Field 6: optional reason field — must be string if present, bounded size
  if ("reason" in r) {
    if (typeof r.reason !== "string") return false;
    if (r.reason.length > MAX_REASON_LENGTH) return false;
  }

  // Field 7: no unknown extra fields with conflicting semantics
  // (Extra fields are tolerated but ignored to allow forward-compatibility;
  //  they do NOT extend or override the authorization decision.)

  return true;
}
```

### 3.3 What This Validation Proves and Does Not Prove

| Claim | Proved? | Explanation |
|---|---|---|
| The record is structurally well-formed | ✅ Yes | Format, types, ranges, and nullability all checked. |
| The registry key and `epochId` agree | ✅ Yes | Direct equality check. |
| No field is silently missing or mistyped | ✅ Yes | Every mandatory field type is verified. |
| The epoch was actually created by this extension instance | ❌ No | No cryptographic signature exists; an attacker with storage write access could forge a record. |
| The `createdAt` timestamp reflects the actual ON event | ❌ No | Timestamps are supplied by the same process; a corrupted or malicious context could supply any value. Timestamps remain diagnostic metadata only. |
| The record accurately reflects the content captured under it | ❌ No | The registry record does not contain message hashes or content commitments. |

**Key Trust Boundary:** `isValidEpochRecord` verifies structural coherence against the expected schema. It does **not** constitute proof of authentic capture provenance, human intent, or tamper-resistance. The extension operates within a cooperative trust model: it protects against accidental corruption and cross-context races, not against a user or process that has direct access to extension storage.

---

## 4. Message Provenance Model (Resolving Issue 2)

### 4.1 Which Component Assigns `epochId`

The **Content Script** (`content.ts`) is the sole component that stamps `epochId` onto captured messages. The Background Worker and Popup **never create or re-stamp** message epoch IDs.

### 4.2 When and How Assignment Occurs

Assignment follows this strict sequence:

```
1. Popup generates newEpochId and writes to storage:
   { activeEpoch: newEpochId, memoryEnabled: true, epochRegistry[newEpochId]: {status:"active",...} }

2. Popup sends START_CAPTURE_SESSION message to Content Script:
   { type: "START_CAPTURE_SESSION", epochId: newEpochId }

3. Content Script receives message and validates:
   - epochId passes isValidEpochId()
   - chrome.storage.local confirms activeEpoch === epochId AND epochRegistry[epochId].status === "active"
   - Content Script sets in-process currentStorageEpoch = epochId

4. Every message admitted into capture is stamped at admission time:
   message.epochId = currentStorageEpoch  (the value at the moment of admission)

5. The stamped epochId cannot be updated, overwritten, or inherited by a later epoch.
```

### 4.3 Trust Boundaries & What Cannot Be Proven

| Provenance Claim | Verifiable? | Trust Boundary |
|---|---|---|
| `message.epochId` was stamped by the Content Script | ✅ Within the cooperative trust model | Any code with storage write access could inject a record; the extension does not protect against that. |
| The message was admitted during an authorized ON epoch | ✅ Verified by positive `epochRegistry` lookup | Does not prove the content is accurate or untampered. |
| The DOM content faithfully reflects what ChatGPT generated | ❌ Cannot be proven | DOM observation is passive; page-level JS could alter DOM content before observation. |
| The user intended for this exact content to be captured | ❌ Cannot be proven | Human intent is not verifiable from DOM events. |

### 4.4 Protection Against Unrelated Epoch Inheritance

* **In-Process Guard:** The Content Script holds `currentStorageEpoch` in memory. When `currentStorageEpoch` changes (e.g., due to an OFF event received via `chrome.storage.onChanged`), the new value is set synchronously before any subsequent message admission.
* **Already-Existing Messages:** When a new epoch begins, messages in storage from previous epochs retain their original `epochId`. They are neither re-stamped nor deleted. Each is evaluated independently by `isArchivedMessageAuthorized`.

### 4.5 Duplicate and Late Message Events

* **Duplicate DOM mutations** for the same turn content are deduplicated by `turnId` in the in-memory capture buffer before any storage write.
* **Late admission events** (e.g., a React re-render delivering the same assistant text after the user clicks OFF) arrive in a disconnected observer with `currentStorageEpoch === null`; the in-process check immediately aborts.
* **The archive predicate does not treat an existing `epochId` alone as proof of legitimate capture.** The `epochId` must positively resolve in `epochRegistry` with an authorized status. An attacker who writes a forged `message.epochId` matching a real epoch can only produce a record that reads as authorized within the cooperative trust model.

---

## 5. Popup Lifecycle Coordinator Re-Evaluation (Resolving Issue 3)

### 5.1 The Problem: Popup Is Transient

The browser extension popup closes whenever the user clicks elsewhere. Any lifecycle operation that requires the Popup to be open for its full duration can silently fail mid-transition.

### 5.2 Exhaustive Failure Scenario Analysis

| Scenario ID | Event | Current Design Behavior | Required Behavior |
|---|---|---|---|
| **F1** | Popup closes immediately after writing ON state, before `START_CAPTURE_SESSION` is sent. | Content Script never receives the epoch. Capture never starts. `epochRegistry` shows `active` indefinitely. | Detect via content-script probe on next popup open; if no active capture responding, mark epoch `closed`. |
| **F2** | Popup closes during Memory OFF (after `PRIVACY_CUTOFF_REQUEST` sent, before acknowledgement received). | `epochRegistry` may remain `active`. Cutoff write may succeed in Content Script but Popup never updates registry. | Persist pending lifecycle transition to storage before popup closes. On next popup open, complete the transition. |
| **F3** | User opens popup twice (two windows). Concurrent ON requests submitted. | Both contexts attempt to write `epochRegistry` with different epoch IDs. One write can be overwritten. | Treat multiple concurrent popup windows as an error condition; second popup reads current state and shows it; it does not initiate a new lifecycle transition. |
| **F4** | Duplicate ON request (user clicks ON twice rapidly). | Second write generates a new epoch, abandoning the first in `active` state. | Before writing ON, check if `activeEpoch` is already non-null. If so, treat as idempotent; do not generate a new epoch. |
| **F5** | Duplicate OFF request (user clicks OFF twice rapidly). | Second OFF finds `activeEpoch: null`; sends `PRIVACY_CUTOFF_REQUEST` to non-existent session. | Before initiating OFF, check `memoryEnabled === true`. If already false, treat as idempotent; do not re-send. |
| **F6** | Content Script unavailable (tab closed) during OFF. | 500ms timeout; Popup transitions to `UNAVAILABLE`. Storage sealed. | Correct behavior. Epoch marked `invalidated` in registry by Popup fallback. |
| **F7** | Background Worker restarts (Service Worker evicted). | Worker holds no in-memory state; reads storage from scratch on wake. | Worker always reads `epochRegistry` from storage at message handler entry; no in-memory state is trusted. |
| **F8** | Storage write failure during ON (registry write fails). | `epochRegistry` is missing the new epoch; subsequent write gate rejects all Content Script writes. | Popup must propagate the storage write error to UI; transition fails closed — system remains in `OFF`. |
| **F9** | Acknowledgement timeout during OFF (Content Script slow). | 500ms timeout triggers `UNAVAILABLE`. | Correct behavior. Defined in Section 8. |
| **F10** | User closes ChatGPT tab during cutoff. | Content Script context is destroyed. No acknowledgement arrives. 500ms timeout fires. | Same as F6 — Popup transitions to `UNAVAILABLE`, seals storage fail-closed. |
| **F11** | Delayed or reordered IPC messages. | Old `START_CAPTURE_SESSION` arrives after OFF. | Content Script validates received `epochId` against current `storage.activeEpoch`; rejects if mismatch. |

### 5.3 Persistent-Pending Lifecycle Transition Queue (Option B — Popup-Only Clearing)

The Popup cannot be assumed to remain open for the full duration of any lifecycle transition. The smallest safe design change is a **Persistent-Pending Lifecycle Transition Queue** stored in `chrome.storage.local`:

```typescript
export interface PendingLifecycleTransition {
  readonly transitionId: string;
  readonly type: "start_capture" | "stop_capture" | "emergency_seal";
  readonly targetEpochId: string;
  readonly initiatedAt: number;
  readonly expiresAt: number; // initiatedAt + 30_000ms
}
```

**Clearing Authority — Option B (Popup-Only):**

* When the Popup initiates any lifecycle transition, it writes a `pendingLifecycleTransition` record **before** sending any IPC.
* When the Popup receives a successful Content Script acknowledgement **while still open**, it immediately clears `pendingLifecycleTransition` from storage and advances the lifecycle state.
* If the Popup closes **before** the acknowledgement is received, the `pendingLifecycleTransition` record remains in storage. The Background Worker is **not** involved in clearing it.
* When the Popup next opens, it reads `pendingLifecycleTransition` and must determine whether the transition has already completed or is genuinely still pending:

  **`start_capture` recovery predicate — all of P1–P6 must hold to confirm completion:**
  - **P1:** `ACTIVE_CAPTURE_SESSION_KEY` is present in storage.
  - **P2:** `session.epochId === pendingLifecycleTransition.targetEpochId`.
  - **P3:** `storage.activeEpoch === pendingLifecycleTransition.targetEpochId`.
  - **P4:** `epochRegistry[targetEpochId]` exists and passes `isValidEpochRecord`.
  - **P5:** `epochRegistry[targetEpochId].status === "active"`.
  - **P6 (Session Structural Integrity):** `session` must pass session-integrity validation against the `CapturedConversation` schema.
    - *Codebase Validator Inspection:* An audit of `extension/src/continuity/` and `extension/src/storage/` confirms that no dedicated runtime validator function exists for active `CapturedConversation` sessions (the codebase possesses `isValidEpochRecord` for epoch records in §3.1/§8.1 and `validateArchive` in `archiveValidator.ts` for exported archives, while `getActiveCaptureSession()` only performs a basic `typeof session === "object"` check).
    - *Required Validation Contract (Documented Specification without schema invention):* In accordance with the constraint not to invent arbitrary implementation functions or schemas, the architecture explicitly documents the mandatory structural integrity validation that the session entity retrieved from `ACTIVE_CAPTURE_SESSION_KEY` must satisfy to pass P6:
      1. `session` must be a non-null, non-array object.
      2. `session.id` must be a valid, non-empty string (authoritative conversation UUID or provisional ID).
      3. `session.platform` must be a string equal to `"chatgpt"`.
      4. `session.state` must be a valid member of `CaptureLifecycleState` (`"idle"` | `"capturing"` | `"response_in_progress"` | `"checkpoint_available"` | `"interrupted"` | `"completed"` | `"failed"`).
      5. `session.messages` must be a valid `Array` of `NormalizedCaptureMessage` objects (each message possessing a non-empty string `id`, integer `sequence`, valid role `"user"` | `"assistant"` | `"system"`, string `content`, and nullable string `timestamp`).
      6. `session.capturedAt` must be a valid ISO-8601 timestamp string.
      7. `session.epochId` must be a valid non-empty string matching `EPOCH_ID_REGEX`.
      8. `session.hasMoreHistory` and `session.isComplete` must be booleans.
    Any corrupted, truncated, or structurally malformed session entity fails P6.

  If P1–P6 all hold: the transition is confirmed complete. Clear the `pendingLifecycleTransition` record and advance to `ON` **without** resending `START_CAPTURE_SESSION`.

  If P1, P2, or P6 fail while P3–P5 hold (epoch is valid and active in registry):
  - *If session is absent or epochId does not match (P1 or P2 fail) and no corrupted session is present:* The transition is genuinely still pending. Resume: send `START_CAPTURE_SESSION`, apply the 500ms timeout, and follow standard failure paths.
  - *If session is present and epochId matches, but fails session integrity (P6 fails):* The active session data in storage is corrupted. The system cannot safely resume or confirm capture. The Popup must attempt to mark `targetEpochId` as `"invalidated"`. If invalidation cannot be committed and verified: retain `pendingLifecycleTransition` and fail closed to `UNAVAILABLE` (see Unverified Invalidation Invariant). If invalidation is committed and verified: remove `pendingLifecycleTransition` and fail closed to `UNAVAILABLE`.

  If P3, P4, or P5 fail (epoch superseded, corrupted, or invalidated):
  The Popup must attempt to mark `targetEpochId` as `"invalidated"` in `epochRegistry`.
  - *Verification Gate:* Re-read `epochRegistry` to confirm `epochRegistry[targetEpochId].status === "invalidated"`.
  - *If invalidation cannot be committed or cannot be verified:* The system **must retain `pendingLifecycleTransition`** in storage and **fail closed to `UNAVAILABLE`**. It must **never** remove recovery information or announce `OFF` based on an unverified invalidation.
  - *Only if invalidation is successfully committed and verified* (or if `targetEpochId` was already confirmed `"invalidated"`): Remove `pendingLifecycleTransition` and advance to `OFF` fail-closed. Do **not** resend `START_CAPTURE_SESSION` for an invalidated epoch.

  For all other ambiguous states (e.g., P4 fails due to registry corruption, or storage read errors occur):
  The Popup must attempt to mark `targetEpochId` as `"invalidated"`.
  - If invalidation cannot be committed and verified: The system **must retain `pendingLifecycleTransition`** and **fail closed to `UNAVAILABLE`**. It must **never** remove recovery information or advance to `OFF` based on an unverified invalidation.
  - Only if invalidation is committed and verified may `pendingLifecycleTransition` be removed and the system advance to `OFF` (or `UNAVAILABLE` depending on corruption severity).

  **`stop_capture` recovery predicate — Q1 and Q2 must both hold to confirm completion:**
  - **Q1 (session proof):** Either:
    - `ACTIVE_CAPTURE_SESSION_KEY` is absent **and** `epochRegistry[targetEpochId].status` is `"closed"` or `"invalidated"`, OR
    - `ACTIVE_CAPTURE_SESSION_KEY` is present **and** `session.epochId === targetEpochId` **and** `isCutoffSnapshot(session)` is true (i.e., `session.state === "interrupted"` AND `session.error === PRIVACY_CUTOFF_SENTINEL`).
  - **Q2 (epoch proof):** `epochRegistry[targetEpochId].status` is `"closed"` or `"invalidated"`.

  An absent `ACTIVE_CAPTURE_SESSION_KEY` alone does **not** confirm completion. An interrupted session whose `epochId` does not match `targetEpochId` does **not** confirm completion. An interrupted session without the `PRIVACY_CUTOFF_SENTINEL` does **not** confirm completion.

  If Q1 holds but Q2 does not (CS completed the cutoff snapshot but registry was not updated before popup closed): write `epochRegistry[targetEpochId].status = "closed"`, verify the write, then clear the `pendingLifecycleTransition` record, then advance to `OFF`. If the registry write or verification fails: retain `pendingLifecycleTransition` and fail closed to `UNAVAILABLE`.

  If Q1 does not hold but the session key is absent and registry is still `"active"`: the cutoff did not complete. Advance to `UNAVAILABLE`, attempt emergency invalidation (`epochRegistry[targetEpochId].status = "invalidated"`), and evict `ACTIVE_CAPTURE_SESSION_KEY`.
  - *Verification Gate:* Re-read `epochRegistry` to confirm `epochRegistry[targetEpochId].status === "invalidated"`.
  - *If invalidation cannot be committed or cannot be verified:* The system **must retain `pendingLifecycleTransition`** and remain in `UNAVAILABLE`. It must **never** remove recovery information or announce `OFF` based on an unverified invalidation.
  - *Only if invalidation is committed and verified:* Clear `pendingLifecycleTransition` and remain in `UNAVAILABLE` (preserving the distinction from a Content Script-confirmed cutoff).

  If the session key is present with `epochId !== targetEpochId` (unrelated session): the cutoff did not complete. Treat as above: advance to `UNAVAILABLE`, attempt emergency invalidation of `targetEpochId`, and evict `ACTIVE_CAPTURE_SESSION_KEY`.
  - If invalidation cannot be committed or cannot be verified: Retain `pendingLifecycleTransition` and remain in `UNAVAILABLE`. Never remove recovery information or announce `OFF` on an unverified invalidation.
  - Only if invalidation is committed and verified: Clear `pendingLifecycleTransition`, remain in `UNAVAILABLE`, and emit an alert that the original cutoff was unconfirmed.

  For all ambiguous states: do not advance to `OFF`. Fail closed to `UNAVAILABLE`. Do not mark an epoch `"closed"` based on inference alone. If invalidation is attempted and cannot be committed and verified, retain `pendingLifecycleTransition` and remain in `UNAVAILABLE`.

* The Popup **never blindly resends** a lifecycle message without first inspecting storage state to confirm the transition is still pending.
* The Background Worker plays **no role** in clearing or reading `pendingLifecycleTransition`.

**Expired Transition Handling — Privacy-First Ordering:**

Expired transitions must establish all privacy-critical storage state **before** removing the `pendingLifecycleTransition` record. The record must survive as a recovery signal until every required write is verifiable. All steps are designed to be idempotent: if the Popup crashes and re-opens, it re-reads the still-present record, re-detects expiry, and re-executes from the first step without side effects.

*For expired `start_capture`:*
1. Write `epochRegistry[targetEpochId].status = "invalidated"`. If this write fails: retain `pendingLifecycleTransition`, show storage-failure error, and fail closed to `UNAVAILABLE`. Do **not** advance to `OFF` or remove recovery information. Do not proceed.
2. Verify the invalidation committed (re-read registry; if status is not `"invalidated"`: retain `pendingLifecycleTransition`, fail closed to `UNAVAILABLE`. Do **not** advance to `OFF` or remove recovery information).
3. Remove `pendingLifecycleTransition`. If this write fails: tolerate — the epoch is already verified invalidated; next popup open re-executes from step 1 as an idempotent no-op.
4. Advance system to `OFF` (only reachable after invalidation has been committed and verified in storage).

*For expired `stop_capture`:*
1. Write `epochRegistry[targetEpochId].status = "invalidated"`. If this write fails: retain `pendingLifecycleTransition`, show storage-failure error, and fail closed to `UNAVAILABLE`. Do **not** remove recovery information. Do not proceed.
2. Verify the invalidation committed (re-read registry; if status is not `"invalidated"`: retain `pendingLifecycleTransition`, fail closed to `UNAVAILABLE`).
3. Evict `ACTIVE_CAPTURE_SESSION_KEY` (emergency eviction). If this write fails: tolerate — the epoch is already verified invalidated; any session bearing this `epochId` will fail authorization on next read.
4. Verify the resulting privacy state: confirm `epochRegistry[targetEpochId].status` is `"invalidated"`. If not: retain `pendingLifecycleTransition`, fail closed to `UNAVAILABLE`.
5. Remove `pendingLifecycleTransition`. If this write fails: tolerate (idempotent on re-entry; step 1 is a no-op because epoch is already verified invalidated).
6. Advance system to `UNAVAILABLE`.

**The `pendingLifecycleTransition` record is never removed before all required privacy-critical writes have been committed and verified.**

**Unverified Invalidation Invariant (Mandatory Fail-Closed to UNAVAILABLE):**
Every recovery path that attempts epoch invalidation must explicitly verify that the invalidation write was committed to `epochRegistry` (by re-reading the registry and confirming `epochRegistry[targetEpochId].status === "invalidated"`).
- If invalidation cannot be committed, or if verification fails, the system **must retain `pendingLifecycleTransition` in storage** and **fail closed to `UNAVAILABLE`**.
- The system **must never remove recovery information** (`pendingLifecycleTransition`) based on an unverified or failed invalidation.
- The system **must never announce or advance to `OFF` or `ON`** based on an unverified invalidation.
- Retaining the pending transition record ensures that crash recovery or retry will re-execute on the next popup open without silent loss of privacy or authorization invariants.

**Storage Failure Invariant:** If the pending transition record itself cannot be written due to a storage failure, the transition fails closed: the system does not advance to `ON`, and no epoch is created.

### 5.4 Formal Lifecycle State Machine

```
States: OFF | TRANSITION_TO_ON | ON | TRANSITION_TO_OFF | UNAVAILABLE

Transitions:
  OFF
    ─── User clicks ON ──────────────────────────────► TRANSITION_TO_ON
    ─── Duplicate ON click (activeEpoch not null) ───► OFF (idempotent, no-op)

  TRANSITION_TO_ON
    ─── Popup writes epoch + pendingTransition ───────► (intermediate)
    ─── START_CAPTURE_SESSION sent + ack received ───► ON (Popup clears pendingTransition)
    ─── START_CAPTURE_SESSION sent, no ack (500ms) ──► OFF (fail closed; epoch marked invalidated)
    ─── Storage write failure ────────────────────────► OFF (fail closed)
    ─── Popup closes before ack ──────────────────────► Resumable on next popup open (see §5.3)

  ON
    ─── User clicks OFF ──────────────────────────────► TRANSITION_TO_OFF
    ─── Duplicate OFF click (activeEpoch null) ───────► OFF (idempotent, no-op)

  TRANSITION_TO_OFF
    ─── Popup writes pendingTransition ──────────────► (intermediate)
    ─── PRIVACY_CUTOFF_REQUEST sent + ack received ──► OFF (Popup clears pendingTransition)
    ─── PRIVACY_CUTOFF_REQUEST sent, no ack (500ms) ─► UNAVAILABLE
    ─── Storage write failure ────────────────────────► UNAVAILABLE (fail closed)
    ─── Popup closes before ack ──────────────────────► Resumable on next popup open (see §5.3)

  UNAVAILABLE
    ─── User opens popup ─────────────────────────────► shows UNAVAILABLE banner
    ─── User initiates new ON ────────────────────────► Popup sends LIFECYCLE_PING to tab first
    ─── LIFECYCLE_PING succeeds ──────────────────────► TRANSITION_TO_ON (fresh epoch)
    ─── LIFECYCLE_PING fails or times out ────────────► remains UNAVAILABLE

Failure invariant: any transition that does not complete successfully leaves
the system in OFF or UNAVAILABLE; it never leaves the system partially in ON.
```

**LIFECYCLE_PING Protocol:**

Before transitioning from `UNAVAILABLE` to `TRANSITION_TO_ON`, the Popup must confirm the Content Script is reachable:

1. **Sender:** Popup, via `chrome.tabs.sendMessage(tabId, { type: "LIFECYCLE_PING" })`.
2. **Receiver:** Content Script in the active ChatGPT tab.
3. **Response shape:** `{ alive: true, epochId: string | null }` where `epochId` is the Content Script's current in-memory `currentStorageEpoch` value (or `null` if the CS has no active epoch).
4. **Timeout:** 500ms. If no response is received within 500ms, the Popup treats the ping as failed.
5. **On success:** The Popup reads storage to confirm the current epoch state, then proceeds to `TRANSITION_TO_ON` with a freshly generated epoch, following the standard ON lifecycle.
6. **On failure (no response or timeout):** The system remains in `UNAVAILABLE`. The Popup displays the `UNAVAILABLE` banner and takes no further action.
7. **The LIFECYCLE_PING response does not constitute authorization.** The Popup always performs a storage read after a successful ping before generating a new epoch.

---

## 6. Complete Storage Writer & Queue Audit (Resolving Issue 4)

### 6.1 Critical Principles
A JavaScript `Promise` queue in one execution context serializes only the writes dispatched from **that same context**. It provides zero serialization for writes originating from another process. Any design claiming otherwise is incorrect.

**Privacy Authorization Gate — Mandatory Check Form:**
Every component that gates a storage write or IPC dispatch on capture authorization **must** use the positive authorization form:

```typescript
if (result.memoryEnabled !== true) { /* reject */ }
```

The negative rejection form `=== false` is **prohibited** throughout the codebase because it passes silently when `memoryEnabled` is `undefined`, which occurs on first install, after storage is cleared (Section 9), after quota eviction, and during extension migration. A storage write that succeeds when `memoryEnabled` is `undefined` violates the fail-closed privacy invariant. This applies to all writers W1–W9, all read paths RP1–RP4, and any future component added to the architecture.

**Sole Exception — W2 PrivacyCutoffToken Write:**
The only exception to the `!== true` gate is the cutoff snapshot write inside W2 (`saveActiveCaptureSession`). This exception is **narrowly bounded** and is defined in full in §7 (PrivacyCutoffToken Definition). In summary:
- The exception applies only when **both** the two-condition PrivacyCutoffToken predicate is satisfied **and** the session's `epochId` matches the specific epoch being closed and that epoch is not invalidated or superseded by a newer active epoch.
- The exception does **not** apply to W1 (`saveConversation`), W9 (`CONVERSATION_CAPTURED` handler), ordinary capture writes, archive writes, unrelated interrupted sessions, or sessions from a different epoch.
- If either condition of the exception cannot be positively verified, the write is rejected under the standard gate.
- No other writer, read path, or future component may claim this exception.

### 6.2 Complete Storage Writer Matrix

| Writer ID | Source & File | Execution Context | Storage Keys Written | Uses In-Context Queue? | Can Race With | Can Write After Cutoff? | Fail-Closed Behavior |
|---|---|---|---|---|---|---|---|
| **W1** | `saveConversation()` `conversationStorage.ts:309` | Background Worker | `CONVERSATIONS_KEY`, `LATEST_CONVERSATION_KEY` | Yes (Worker queue) | W9 (same context), W6 (diff context) | Yes (in-flight after OFF) | `memoryEnabled !== true` check; reader-side epoch authorization strips unauthorized messages |
| **W2** | `saveActiveCaptureSession()` `conversationStorage.ts:463` | Content Script | `ACTIVE_CAPTURE_SESSION_KEY` | Yes (Content Script queue) | W3 (emergency fallback only), W6 (diff context) | Yes (in-flight after OFF) | In-process `currentStorageEpoch` check; pre-commit storage gate; cutoff write overwrites |
| **W3** | `clearActiveCaptureSession()` (CS normal via `serializeStorageOperation` wrapper; Popup emergency only) | Content Script (normal); Popup (emergency fallback) | `ACTIVE_CAPTURE_SESSION_KEY` | **No** — function does not call `serializeStorageOperation` internally; **caller must wrap at every CS call site** | W2 if caller omits wrapper | No (clear operation) | Emergency fallback only when CS unreachable; epoch marked `invalidated` first. CS call sites must use `serializeStorageOperation(() => clearActiveCaptureSession())`. Popup emergency eviction exempt (CS confirmed unreachable). |
| **W4** | `loadMemoryState()` `content.ts:271` | Content Script | `captureEligibilityIntervals` | **No** — direct `void chrome.storage.local.set`; not inside `serializeStorageOperation` | W5 (intra-context only; bounded risk) | No (only writes at ON boundary) | Skipped if `activeEpoch` invalid. Unordered intra-context writes possible; bounded by single-context exclusive ownership; no cross-context race. |
| **W5** | `onStorageChanged` listener `content.ts:421` | Content Script | `captureEligibilityIntervals` | **No** — direct `void chrome.storage.local.set` from event handler; not inside `serializeStorageOperation` | W4 (intra-context only; bounded risk) | No (closes interval — correct intended behavior) | Skipped if interval already closed. Unordered intra-context writes possible; bounded by single-context exclusive ownership; no cross-context race. |
| **W6** | `handleMemoryChange()` `App.tsx:44` | Popup | `memoryEnabled`, `activeEpoch`, `epochRegistry`, `lastCutoffAt`, `pendingLifecycleTransition` | No (direct write) | W1 (different context), W2 (different context) | Yes (is the cutoff initiator) | Any storage failure leaves state in prior condition; transition fails closed |
| **W7** | `handleProjectChange()` `App.tsx:52` | Popup | `selectedProject` | No (direct write) | None | N/A | No capture dependency |
| **W8** | `handleThemeChange()` `App.tsx:59` | Popup | `vzTheme` | No (direct write) | None | N/A | No capture dependency |
| **W9** | `onMessage("CONVERSATION_CAPTURED")` `background.ts:73` | Background Worker | Dispatches to W1 | Yes (via W1 queue) | W1 (same context) | Yes (in-flight after OFF) | Gated by `memoryEnabled !== true` check before dispatch |

### 6.3 Authoritative Write Path for Active-Session Data

There is **one authoritative write path** for `ACTIVE_CAPTURE_SESSION_KEY`:

1. **Normal lifecycle:** Content Script → in-process serialized queue → `chrome.storage.local.set`.
2. **Emergency eviction:** Popup (only when Content Script unreachable) → direct `chrome.storage.local.remove` after epoch is `invalidated` in registry.

No other context may write to `ACTIVE_CAPTURE_SESSION_KEY`. Enforcing this requires:
- Popup routes all normal mutations through `CLEAR_ACTIVE_CAPTURE_REQUEST` message protocol.
- Background Worker never touches `ACTIVE_CAPTURE_SESSION_KEY`.

**`clearActiveCaptureSession()` Serialization Requirement:**
`clearActiveCaptureSession()` calls `chrome.storage.local.remove` directly and does **not** internally call `serializeStorageOperation`. It cannot enforce its own serialization. This means:
- Any Content Script call to `clearActiveCaptureSession()` **must** be dispatched inside `serializeStorageOperation` at the call site.
- Calling `clearActiveCaptureSession()` directly from the Content Script — without wrapping it in `serializeStorageOperation` — produces an unordered remove that races with any concurrent in-flight W2 write, which can overwrite the cutoff snapshot with a stale in-progress state.
- This is a **calling-convention invariant**, not a function-level invariant. All Content Script call sites in the implementation must wrap the call:
```typescript
// Correct
await serializeStorageOperation(() => clearActiveCaptureSession());

// PROHIBITED — bypasses the queue
await clearActiveCaptureSession();
```
- The Popup's emergency eviction call to `clearActiveCaptureSession()` is exempt from this requirement because it only executes when the Content Script is confirmed unreachable (after the 500ms timeout), making a Content Script queue race impossible.

**Limitation explicitly stated:** Chrome storage does not enforce exclusive key ownership. If a bug caused the Popup to write `ACTIVE_CAPTURE_SESSION_KEY` directly while the Content Script queue is active, no OS-level lock would prevent the interleaving. The architecture relies on design discipline and code review, not a platform-level mutex.

---

## 7. Reworked PAUSING Extraction Boundary (Resolving Issue 5)

### 7.1 Seven Sequential Events from User Click to Final Cutoff Snapshot

```
Event 1: USER CLICKS OFF (Popup)
  • Popup immediately disables capture locally: all popup-originated capture
    triggers are blocked from this instant.
  • No cross-context guarantee exists at this moment.

Event 2: POPUP WRITES PENDING TRANSITION + AUTHORIZATION METADATA
  • Popup writes: { pendingLifecycleTransition: {...}, memoryEnabled: false, activeEpoch: null }
    to chrome.storage.local.
  • NOTE: This write is dispatched to Chrome's C++ IPC.
  • Guarantee: After this write completes, subsequent storage reads by any
    context will see memoryEnabled: false. But reads already in flight may
    see the old value.

Event 3: POPUP SENDS PRIVACY_CUTOFF_REQUEST (chrome.tabs.sendMessage)
  • The IPC message enters Chrome's inter-process message bus.

[PROPAGATION INTERVAL — unavoidable residual risk]
  • Duration: unspecified and unbounded in theory; practically milliseconds
    to low seconds under normal conditions, but no fixed bound can be promised.
  • During this interval:
    - ChatGPT's React engine may continue rendering new tokens into the DOM.
    - The Content Script MutationObserver (still connected) delivers these
      mutations to its handler.
    - The Content Script may admit and buffer these tokens into its in-memory
      capture state.
    - The Content Script queue may dispatch storage writes for this content.

Event 4: CONTENT SCRIPT RECEIVES PRIVACY_CUTOFF_REQUEST
  • Content Script executes the following synchronously:
    a. observer.disconnect()  — no further mutations will be delivered
    b. observer.takeRecords() — any queued but undelivered mutations are discarded
    c. currentStorageEpoch = null  — blocks all future in-process queue commits

Event 5: IN-PROCESS QUEUE DRAINS AND ABORTS PENDING COMMITS
  • Any operations already enqueued in the Content Script's Promise queue
    reach their turn and find currentStorageEpoch === null.
  • They return { success: false, error: "in-process epoch cleared" }
    without dispatching a Chrome storage IPC.
  • Exception: One operation may already have passed the in-process check
    and dispatched its IPC before Event 4. That write is in flight and
    CANNOT be recalled (see Event 6).

Event 6: IN-FLIGHT CHROME STORAGE IPC COMMITS
  • If a write was dispatched before Event 4, Chrome's C++ browser process
    commits it to LevelDB regardless. JavaScript cannot abort it.
  • The committed session may contain content extracted during the propagation
    interval (between Events 1 and 4).
  • This is an unavoidable residual risk. The content is associated with the
    prior authorized epoch. It is not newly extracted post-OFF content.

Event 7: CONTENT SCRIPT ENQUEUES AND COMMITS CUTOFF SNAPSHOT
  • The Content Script marks the active turn as state: "interrupted" and
    sets session.error to the PrivacyCutoffToken sentinel (see below).
  • It enqueues Op_cutoff inside serializeStorageOperation with isCutoff: true.
  • The serialized queue guarantees Op_cutoff executes after the in-flight
    normal write (Event 6). The cutoff snapshot overwrites whatever the
    normal write committed.
  • Content Script sends acknowledgement to Popup.
  • Popup updates epochRegistry[epochId].status = "closed".
  • Popup clears pendingLifecycleTransition from storage.
  • Popup transitions UI to OFF.

PrivacyCutoffToken Definition:
  The PrivacyCutoffToken is NOT a typed field or a structured object.
  It is a two-condition predicate evaluated on a CapturedConversation:

    Condition A: session.state === "interrupted"
                 AND session.error === PRIVACY_CUTOFF_SENTINEL

    Condition B: session.epochId is the specific epoch being closed,
                 AND that epoch is not superseded by a newer active epoch,
                 AND epochRegistry[session.epochId].status is "active" or "closed"
                 (never "invalidated" or absent).

  BOTH conditions (A and B) must be true simultaneously.

  The string "Capture was paused by user." is a FROZEN SENTINEL.
  • It must not be localized, abbreviated, or generalized.
  • It must not be changed without simultaneously updating every
    predicate site in saveActiveCaptureSession() that reads it.
  • Implementations must define it as a named constant:

    const PRIVACY_CUTOFF_SENTINEL = "Capture was paused by user." as const;

  W2 Exception — Write Admission Gate:
  The PrivacyCutoffToken exception permits W2 (saveActiveCaptureSession) to
  write the cutoff snapshot even when memoryEnabled !== true, subject to both
  Condition A and Condition B being verifiable at the time of the write.

  isCutoffSnapshot(session) is shorthand for Condition A only:
    session.state === "interrupted" AND session.error === PRIVACY_CUTOFF_SENTINEL

  Full cutoff write authorization requires Condition A AND Condition B.
  isCutoffSnapshot alone is not sufficient to authorize the write.

  The token is used by saveActiveCaptureSession() to:
  1. Permit the cutoff snapshot to write even when memoryEnabled !== true
     (W2 sole exception — see §6.1).
  2. Reject stale in-progress stream writes that arrive after the cutoff
     snapshot has been committed (stale write rejection predicate —
     Condition A only is sufficient for rejection, since the cutoff
     snapshot is already the authoritative final state).

  Any other interrupted session (e.g., network error, tab navigation) that
  happens to set state: "interrupted" but uses a different error string
  is NOT a privacy cutoff and must not be granted cutoff privileges.

  A cutoff snapshot whose session.epochId does not match the epoch being
  closed (Condition B fails) must be rejected by the standard gate.
  If Condition B cannot be positively verified, reject the write.
```

### 7.2 What May Appear in the Interrupted Cutoff Snapshot

Content extracted from DOM mutations delivered **before Event 4** (observer disconnect) may appear in the interrupted cutoff snapshot. This content:
* Was observed and buffered while the Content Script was still authorized under the active epoch.
* Carries `epochId` of the terminating epoch.
* Is preserved in the `interrupted` snapshot as a **partial** record.
* Is **not** added to a normal archive; it is sealed as an interrupted session.

Content extracted from DOM mutations that arrive **after Event 4** cannot enter any storage path, because the observer is disconnected and `currentStorageEpoch === null`.

### 7.3 Conservative Rule
No DOM content **first observed by the Content Script after the user's OFF action** (Event 1) may be committed to a normal archive. Content observed during the propagation interval (Events 1–4) is an unavoidable residual and may appear only in the sealed interrupted cutoff snapshot, clearly marked `state: "interrupted"`, `completeness: "partial"`. It is never promoted to a completed or fully-authorized session.

---

## 8. Archive Authorization Predicates (Final Forms)

### 8.1 EpochRecord Validation

```typescript
export function isValidEpochRecord(
  registryKey: string,
  value: unknown
): value is EpochRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (typeof r.epochId !== "string" || !EPOCH_ID_REGEX.test(r.epochId)) return false;
  if (registryKey !== r.epochId) return false;
  if (r.status !== "active" && r.status !== "closed" && r.status !== "invalidated") return false;
  if (typeof r.createdAt !== "number" || !isFinite(r.createdAt) || r.createdAt < MIN_CREATED_AT) return false;
  if (r.status === "active") {
    if (r.closedAt !== null) return false;
  } else {
    if (typeof r.closedAt !== "number" || !isFinite(r.closedAt) || r.closedAt < r.createdAt) return false;
  }
  if ("reason" in r) {
    if (typeof r.reason !== "string" || r.reason.length > MAX_REASON_LENGTH) return false;
  }
  return true;
}
```

### 8.2 Active-Session Authorization Predicate

```typescript
export function isSessionAuthorized(
  session: unknown,
  storage: { memoryEnabled?: unknown; activeEpoch?: unknown; epochRegistry?: unknown } | undefined
): boolean {
  if (!storage || typeof storage !== "object" || !session || typeof session !== "object") return false;
  if (storage.memoryEnabled !== true) return false;
  if (!isValidEpochId(storage.activeEpoch)) return false;
  const sessionEpochId = (session as { epochId?: unknown }).epochId;
  if (!isValidEpochId(sessionEpochId)) return false;
  if (sessionEpochId !== storage.activeEpoch) return false;
  const registry = storage.epochRegistry;
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) return false;
  const record = (registry as Record<string, unknown>)[sessionEpochId as string];
  if (!isValidEpochRecord(sessionEpochId as string, record)) return false;
  if ((record as EpochRecord).status !== "active") return false;
  return true;
}
```

### 8.3 Archived Message Authorization Predicate

```typescript
export function isArchivedMessageAuthorized(
  msg: unknown,
  storage: { epochRegistry?: unknown } | undefined
): boolean {
  if (!msg || typeof msg !== "object") return false;
  const msgEpochId = (msg as { epochId?: unknown }).epochId;
  if (!isValidEpochId(msgEpochId)) return false;
  if (!storage || typeof storage !== "object") return false;
  const registry = storage.epochRegistry;
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) return false;
  const record = (registry as Record<string, unknown>)[msgEpochId as string];
  if (!isValidEpochRecord(msgEpochId as string, record)) return false;
  const status = (record as EpochRecord).status;
  return status === "closed" || status === "active";
}
```

---

## 9. Storage Reset, Migration & Corruption Behavior (Resolving Issue 6)

| Scenario | Detected By | Required Behavior |
|---|---|---|
| **User clears all extension storage** | Popup reads `epochRegistry === undefined`; `CONVERSATIONS_KEY === undefined` | All in-memory capture halts. Content Script receives `onChanged` with `activeEpoch: undefined`; sets `currentStorageEpoch = null`. Popup displays OFF. Historical archives no longer readable (no registry to authorize them). User is informed that clearing storage erases authorization history. |
| **Registry missing while archives remain** | Reader finds `epochRegistry === undefined` | Every archived message fails `isArchivedMessageAuthorized` (registry check fails closed). Archives are quarantined and not displayed. No reconstruction from archive contents or timestamps is attempted. |
| **Partial storage reset** (only `epochRegistry` cleared) | Same as above | Same as above. Quarantine all archives. |
| **Registry corruption** (non-object, array, or unparseable) | `typeof epochRegistry !== "object"` or `Array.isArray` | Treat as missing registry. All authorization fails closed. Do not attempt repair. |
| **Extension update / migration** | `epochRegistry` may contain records from prior schema version | Migration script (run at extension install/update event) must validate each record via `isValidEpochRecord`; invalid records are removed, not migrated. Removal causes messages referencing those epochs to fail closed. |
| **Storage quota exceeded** | `chrome.runtime.lastError` on any write | Any write that fails due to quota is treated as a storage failure. The lifecycle transition or data write that triggered the failure fails closed. UI displays: `"Storage write failed; capture transition aborted."`. The system does not silently advance state. |
| **Registry write succeeds; archive write fails** | `chrome.runtime.lastError` on archive write | The epoch record in registry is already `closed` or `active`. The archive write failure means the captured messages are lost. No partial archive is stored. The epoch record remains as-is, representing an authorized session with no surviving archive. |
| **Archive write succeeds; registry write fails** | `chrome.runtime.lastError` on registry write | This is the dangerous case. Archive records exist referencing an epoch not in the registry. These messages fail `isArchivedMessageAuthorized` (registry lookup fails closed). They are quarantined. No data is displayed. A recovery prompt may be shown to the user. |

---

## 10. Complete Archive Read-Path Authorization Matrix

| Read Path | Consumer | Purpose | Authorization Predicate | Behavior When OFF | Behavior During UNAVAILABLE |
|---|---|---|---|---|---|
| **RP1** Popup Continuity View | `Continuity.tsx:112` | Display captured history | `isArchivedMessageAuthorized` per message | **READABLE** — past authorized history | **READABLE** — past authorized history |
| **RP2** Prompt Context Injector | `content.ts:299` | Inject memory into prompt | `isArchivedMessageAuthorized` + `memoryEnabled === true` | **DISABLED** | **DISABLED** |
| **RP3** Export Handler | `App.tsx` | Export to JSON/Markdown | `isArchivedMessageAuthorized` per message | **READABLE/EXPORTABLE** | **READABLE/EXPORTABLE** |
| **RP4** Storage Deduplication | `conversationStorage.ts:135` | Merge before archive write | `memoryEnabled === true && activeEpoch === op.epochId` | **ABORTED** | **ABORTED** |

---

## 11. Storage Writer Classification (W1–W9)

| ID | Source | Context | Keys | Serialized | Can Race | Post-Cutoff Write? | Fail-Closed |
|---|---|---|---|---|---|---|---|
| W1 | `saveConversation()` | Background | CONVERSATIONS_KEY | Yes (Worker queue) | W6 (diff context) | Yes (in-flight) | Gate: `memoryEnabled !== true` (must use `!== true`, not `=== false`); reader epoch auth strips unauthorized |
| W2 | `saveActiveCaptureSession()` | Content Script | ACTIVE_CAPTURE_SESSION_KEY | Yes (CS queue) | W6 (diff context) | Yes (in-flight) | In-process epoch null check; storage pre-commit gate (`!== true`) |
| W3 | `clearActiveCaptureSession()` | CS (normal via `serializeStorageOperation` wrapper) / Popup (emergency only) | ACTIVE_CAPTURE_SESSION_KEY | **No** (function does not call `serializeStorageOperation`; **caller must wrap**) | W2 if caller omits wrapper | No (clear operation) | Emergency only when CS unreachable; epoch marked invalidated first. CS call sites must use `serializeStorageOperation(() => clearActiveCaptureSession())`. |
| W4 | `loadMemoryState()` | Content Script | captureEligibilityIntervals | **No** (direct `void chrome.storage.local.set`; not inside `serializeStorageOperation`) | W5 (intra-context only; bounded risk) | No | Skipped if activeEpoch invalid. Unordered intra-context writes possible; bounded by single-context exclusive ownership; no cross-context race. |
| W5 | `onStorageChanged` listener | Content Script | captureEligibilityIntervals | **No** (direct `void chrome.storage.local.set` from event handler; not inside `serializeStorageOperation`) | W4 (intra-context only; bounded risk) | No (closes interval — correct intended behavior) | Skipped if interval already closed. Unordered intra-context writes possible; bounded by single-context exclusive ownership; no cross-context race. |
| W6 | `handleMemoryChange()` | Popup | memoryEnabled, activeEpoch, epochRegistry, lastCutoffAt, pendingLifecycleTransition | No (direct write) | W1, W2 (diff contexts) | Yes (cutoff initiator) | Storage failure leaves prior state; transition fails closed |
| W7 | `handleProjectChange()` | Popup | selectedProject | No | None | N/A | No capture dependency |
| W8 | `handleThemeChange()` | Popup | vzTheme | No | None | N/A | No capture dependency |
| W9 | `onMessage("CONVERSATION_CAPTURED")` | Background | dispatches to W1 | Yes (via W1 queue) | W6 (diff context) | Yes (in-flight) | Gate: `memoryEnabled !== true` (must use `!== true`, not `=== false`); admits `undefined` if `=== false` is used — prohibited |

---

## 12. Concrete Acceptance Scenarios (12 Required)

### Scenario 1: Normal ON → Capture → OFF
**Initial state:** `memoryEnabled: false`, `activeEpoch: null`, registry empty.
**Events:** User clicks ON → Popup writes epoch_A as active → sends `START_CAPTURE_SESSION` → CS confirms → user prompts → turns captured → user clicks OFF → CS acknowledges → Popup marks epoch_A closed.
**Storage state:** `memoryEnabled: false`, `activeEpoch: null`, `epochRegistry: { epoch_A: { status:"closed" } }`, `CONVERSATIONS_KEY` contains messages with `epochId: "epoch_A"`.
**Authorization result:** Messages accepted by `isArchivedMessageAuthorized`. History visible in RP1 and RP3.
**Persistence:** Authorized. Clean capture.

---

### Scenario 2: Popup Closes After ON Before `START_CAPTURE_SESSION` Sent (F1)
**Initial state:** OFF.
**Events:** Popup writes `{ activeEpoch: epoch_A, memoryEnabled: true, epochRegistry: { epoch_A: {status:"active"} }, pendingLifecycleTransition: {type:"start_capture", targetEpochId:"epoch_A", expiresAt: T+30s} }` → Popup closes before sending `START_CAPTURE_SESSION`.
**Storage state:** `memoryEnabled: true`, `activeEpoch: epoch_A`, but CS has no active observer.
**Authorization result:** CS is not capturing. No data collected.
**On next popup open:** Popup reads `pendingLifecycleTransition`. Sends `START_CAPTURE_SESSION` to CS. If CS responds, capture begins. If not (tab closed), Popup marks epoch_A `invalidated`.
**Persistence:** No content during gap. Normal capture after recovery.

---

### Scenario 3: Popup Closes During OFF Transition (F2)
**Initial state:** ON, epoch_A active.
**Events:** Popup writes `{ pendingLifecycleTransition: {type:"stop_capture",...} }` → sends `PRIVACY_CUTOFF_REQUEST` → CS disconnects observer and enqueues cutoff snapshot → Popup closes before receiving acknowledgement.
**Storage state:** CS has sealed and committed the interrupted snapshot. CS acknowledgement never reached popup. `epochRegistry` may still show epoch_A as `active`.
**On next popup open:** Reads `pendingLifecycleTransition`. Reads `ACTIVE_CAPTURE_SESSION_KEY` — if it shows `state: "interrupted"`, confirms cutoff was completed. Updates `epochRegistry[epoch_A].status = "closed"`. Clears pending transition.
**Authorization result:** Cutoff snapshot is preserved and authorized.

---

### Scenario 4: Stale Write Commits After OFF (Adversarial Race)
**Initial state:** ON, epoch_A active.
**Events:** CS dispatches write op_101 to Chrome IPC → Popup writes OFF state → CS receives cutoff → op_101 commits to LevelDB → CS cutoff snapshot commits immediately after.
**Storage state:** `ACTIVE_CAPTURE_SESSION_KEY` ends up as interrupted cutoff snapshot (op_cutoff overwrote op_101).
**Authorization result:** Cutoff snapshot is authorized under epoch_A (now closed). Stale partial write is not the final value.
**Persistence:** Interrupted session preserved; no unauthorized content.

---

### Scenario 5: Unregistered Epoch ID in Archive Message
**Initial state:** OFF, `epochRegistry: { epoch_A: {status:"closed"} }`.
**Events:** A message with `epochId: "epoch_UNKNOWN"` is found in `CONVERSATIONS_KEY`.
**Authorization result:** `isArchivedMessageAuthorized` performs positive registry lookup for `epoch_UNKNOWN` — key not found → **REJECTED fail-closed**.
**Persistence:** Message quarantined. Not displayed or exported.

---

### Scenario 6: Invalidated Epoch (Emergency Recovery)
**Initial state:** ON, epoch_A active. CS tab is closed mid-session.
**Events:** Popup sends `PRIVACY_CUTOFF_REQUEST` → no response within 500ms → Popup transitions to `UNAVAILABLE` → Popup marks `epochRegistry[epoch_A].status = "invalidated"` → Popup evicts `ACTIVE_CAPTURE_SESSION_KEY`.
**Storage state:** `memoryEnabled: false`, `activeEpoch: null`, epoch_A invalidated.
**Authorization result:** Any messages in archive with `epochId: "epoch_A"` fail `isArchivedMessageAuthorized` (status is `invalidated`) → **REJECTED**.
**Persistence:** Content from unreachable tab is not persisted.

---

### Scenario 7: Duplicate ON Request
**Initial state:** ON, epoch_A active.
**Events:** User clicks ON again (e.g., double-click).
**Popup checks:** `activeEpoch` is already non-null → treats as idempotent. **No new epoch generated.** No new `START_CAPTURE_SESSION` sent.
**Storage state:** Unchanged.
**Authorization result:** Ongoing capture under epoch_A continues normally.

---

### Scenario 8: Duplicate OFF Request
**Initial state:** OFF, `memoryEnabled: false`.
**Events:** User clicks OFF again.
**Popup checks:** `memoryEnabled !== true` → treats as idempotent. **No cutoff request sent.**
**Storage state:** Unchanged.
**Authorization result:** System remains in OFF. No action taken.

---

### Scenario 9: Registry Missing While Archives Exist
**Initial state:** User manually clears `epochRegistry` via browser dev tools. `CONVERSATIONS_KEY` still contains messages with `epochId: "epoch_A"`.
**Events:** Popup opens; user views Continuity history.
**Authorization result:** `isArchivedMessageAuthorized` reads `storage.epochRegistry === undefined` → fails closed → **ALL messages rejected**. No history displayed.
**Recovery:** User must accept loss of authorization history. Data is quarantined, not deleted; if registry is restored manually, it would need valid records to re-authorize.
**Persistence:** No new data persisted until registry is restored.

---

### Scenario 10: Storage Quota Exceeded During Archive Write
**Initial state:** ON, epoch_A active.
**Events:** CS sends `CONVERSATION_CAPTURED` with large conversation → W1 attempts `chrome.storage.local.set(...)` → receives `chrome.runtime.lastError: QUOTA_BYTES_PER_ITEM exceeded`.
**Storage state:** `CONVERSATIONS_KEY` unchanged (write failed). `epochRegistry` unchanged. Active session may still be in progress.
**Authorization result:** Message content is not persisted. `epochRegistry[epoch_A]` remains `active`. Capture can continue but this turn is lost.
**UI:** Error logged. Optional user-facing warning: `"Storage write failed; captured turn was not saved."`.

---

### Scenario 11: Content Extracted During PAUSING Propagation Interval
**Initial state:** ON, epoch_A active. ChatGPT is streaming an assistant response.
**Events:** User clicks OFF (Event 1) → Popup disables locally → CS still observing streaming tokens → after variable propagation delay, CS receives cutoff (Event 4) → CS disconnects observer, purges queue, seals cutoff snapshot.
**Storage state:** Cutoff snapshot contains tokens observed before Event 4. Snapshot is `state: "interrupted"`, `completeness: "partial"`. `epochId: "epoch_A"`, now closed.
**Authorization result:** `isArchivedMessageAuthorized` finds epoch_A as `closed` → content is authorized as a historical partial record from epoch_A.
**Persistence:** Interrupted session snapshot preserved. Clearly marked partial. Not promoted to completed archive.

---

### Scenario 12: Two Concurrent Popup Windows
**Initial state:** OFF.
**Events:** User opens popup in window A and window B simultaneously. Window A clicks ON → writes epoch_A, sets pendingLifecycleTransition. Window B, slightly later, also attempts ON.
**Window B check:** Reads `activeEpoch` — it is now `epoch_A` (non-null). Window B treats this as idempotent — **no second epoch generated**.
**Storage state:** Single epoch_A. Single `START_CAPTURE_SESSION` sent.
**Authorization result:** Clean single epoch. No duplicate or conflicting registry entries.
**Note:** This relies on the second popup reading storage after the first popup's write has completed. If both writes interleave before either reads, the last write wins and one epoch is abandoned as `active` indefinitely. The pending transition recovery mechanism (Scenario 2) resolves this on next popup open.

---

## 13. Conservative Six-State Completion Semantics

Under the passive DOM-observer paradigm with zero network interception, **`completion_candidate` is NEVER promoted to `completed`**.

| State | Entry Evidence | Message Status | Preservation Rule |
|---|---|---|---|
| **`streaming`** | Active mutations OR streaming cursor visible | `isInProgress: true` | Tokens appended to buffer |
| **`rendering_stopped`** | No mutations for 1000ms AND cursor gone | `isInProgress: true` (provisional) | Content frozen |
| **`completion_candidate`** | Stop button gone, Send restored, Copy button mounted, no error | `isInProgress: false` | Content preserved; NOT promoted |
| **`completed`** | Full token receipt proof — **unattainable from DOM** | `isInProgress: false` | Never set by DOM observer |
| **`interrupted`** | Stop clicked, Memory OFF mid-stream, or tab navigated | `isInProgress: false` | Content preserved up to interrupt |
| **`unverified`** | Ambiguous DOM signals or error banner | `isInProgress: false` | Content preserved; barred from `completed` |

---

## 14. Rigorous Separation of Verification Claims

```
┌───────────────────────────────────┬───────────────────────────────────┐
│ Verification Category             │ Status in Revision 2.12           │
├───────────────────────────────────┼───────────────────────────────────┤
│ Design review completed           │ COMPLETE (Revisions 2.0 – 2.12)   │
│ Static source inventory           │ COMPLETE (W1–W9 mapped)           │
│ Test specifications written       │ COMPLETE (T1–T15 + scenarios 1–12)│
│ Automated tests executed          │ ZERO EXECUTED — implementation    │
│                                   │ frozen by design-only constraint  │
│ Browser integration tests         │ ZERO EXECUTED                     │
│ Runtime behavior verified         │ NOT VERIFIED — design only        │
└───────────────────────────────────┴───────────────────────────────────┘
```

No claim in this document constitutes proof that any behavior has been tested, observed, or validated at runtime.

---

## 15. Remaining Architectural Limitations

| Limitation | Mechanism | Mitigation | Residual Risk |
|---|---|---|---|
| **L1: Propagation interval** | Variable IPC delay between popup OFF click and CS receipt | Observer disconnect + takeRecords() on receipt | Mutations rendered before disconnect may enter interrupted snapshot |
| **L2: In-flight IPC non-cancelability** | Chrome C++ storage write cannot be aborted | Cutoff snapshot overwrites; reader epoch gate quarantines | LevelDB briefly contains stale snapshot before overwrite |
| **L3: Chrome storage non-atomicity** | No CAS; no multi-key transactions | Popup sole mutator of registry; pending transition queue for crash recovery | Concurrent popup windows can interleave; mitigated by idempotency checks |
| **L4: DOM completion ambiguity** | No network access means no server-side completion proof | completion_candidate never promoted to completed | Partial captures cannot be certified complete |
| **L5: Submission-to-mount latency** | React rendering delay; 3000ms FIFO window | Strict timeout; fail closed on expiry | Background throttling can cause authentic submissions to fail closed |
| **L6: DOM structure volatility** | ChatGPT UI changes can break selectors | Fail-closed on missing selectors | Capture halts until selectors are updated |
| **L7: Cooperative trust model** | No cryptographic protection of storage | Design discipline and code review are the enforcement mechanism | A process with direct storage access could forge records; this is outside the extension's threat model |
| **L8: Popup transience** | Popup closes during lifecycle transitions | Persistent pending transition queue + recovery on reopen | Gap between popup closure and recovery window (bounded by transition expiry, default 30s) |

---

## 16. Summary of Revision Changes & Implementation Status

### Changes in Revision 2.12
1. Added strict `isValidEpochRecord` predicate validating all fields including key-to-ID consistency, `closedAt` nullability, and bounded `reason` length.
2. Defined the message provenance model: Content Script is sole stamper; stamping occurs at admission under `currentStorageEpoch`; trust boundaries documented.
3. Analyzed 11 Popup lifecycle failure scenarios; recommended Persistent-Pending Lifecycle Transition Queue; defined formal lifecycle state machine with explicit transitions and failure behavior.
4. Re-audited W1–W9 with race analysis, queue isolation, and post-cutoff write eligibility; explicitly stated Chrome storage cannot enforce exclusive key ownership.
5. Replaced "5–35ms bound" with "unavoidable residual risk of unspecified duration"; defined the 7-event PAUSING boundary sequence; clarified content appearing in interrupted snapshots.
6. Defined fail-closed behavior for 8 storage degradation scenarios including missing registry, quota exceeded, and partial write pairs.
7. Provided 12 concrete acceptance scenarios covering normal flow, popup closure, duplicate requests, stale messages, concurrency, missing registry, malformed records, in-flight writes, storage failure, and partial reset.

### Changes in Revision 2.13 (Narrowly Scoped Audit Corrections)

1. **§5.3 — Pending-Transition Clearing (Item 1):** Replaced the Background Worker clearing claim with the canonical Option B: Popup clears on successful acknowledgement receipt; if closed before receipt, the next popup open inspects storage state and clears the record idempotently without blindly resending lifecycle messages. Detailed recovery logic defined for both `start_capture` and `stop_capture` transitions. Background Worker plays no role in clearing.

2. **§5.3 — Expired Transition Cleanup (Item 5):** Defined the action for expired records: Popup removes the record on open; expired `start_capture` transitions mark the epoch `invalidated` and advance to `OFF`; expired `stop_capture` transitions mark the epoch `invalidated`, perform emergency eviction of `ACTIVE_CAPTURE_SESSION_KEY`, and advance to `UNAVAILABLE`.

3. **§5.4 — LIFECYCLE_PING Protocol (Item 2):** Defined the full ping protocol for the `UNAVAILABLE → TRANSITION_TO_ON` path: message type `LIFECYCLE_PING` sent by Popup via `chrome.tabs.sendMessage`; Content Script responds `{ alive: true, epochId: string | null }`; 500ms timeout; failure leaves the system `UNAVAILABLE`; ping success does not constitute authorization — a storage read always follows.

4. **§6.1 — Privacy Gate Requirement (Item 4):** Declared that every privacy authorization gate must use `memoryEnabled !== true` (not `=== false`). Documented the exact failure mode of `=== false`: passes silently when `memoryEnabled` is `undefined`, which occurs on first install, after storage clear, after quota eviction, and during migration. Applies to W1–W9, RP1–RP4, and all future components.

5. **§6.3 — `clearActiveCaptureSession()` Serialization (Item 3):** Declared that `clearActiveCaptureSession()` does not internally call `serializeStorageOperation`. Defined this as a calling-convention invariant: all Content Script call sites must wrap the call inside `serializeStorageOperation`. Popup emergency eviction is exempt. Provided correct and prohibited call-site patterns.

6. **§7 Event 7 — PrivacyCutoffToken (Item 7):** Defined `PrivacyCutoffToken` as a two-condition predicate. Declared the error string a frozen sentinel. Required implementations to define it as a named constant. Documented its two uses: cutoff write admission and stale write rejection.

7. **§11 W3/W4/W5 — Serialization Corrections (Item 6):** Corrected W3/W4/W5 serialization claims.

### Changes in Revision 2.14 (Final Consistency Audit Corrections)

1. **§5.3 — Expired-Transition Cleanup Ordering (Finding 1):** Reversed the unsafe cleanup ordering. The `pendingLifecycleTransition` record is now removed **last**, after all privacy-critical writes have been committed and verified. For `stop_capture`: (1) invalidate epoch, (2) verify invalidation, (3) evict session, (4) verify privacy state, (5) remove record, (6) advance to UNAVAILABLE. For `start_capture`: (1) invalidate epoch, (2) verify, (3) remove record, (4) advance to OFF. All steps are idempotent. A crash between any step leaves the record in storage, causing re-execution on next popup open. Write failures retain the record and fail closed.

2. **§6.1 and §7 — Narrow Cutoff Exception with Epoch-Match (Finding 2):** Added Condition B to the PrivacyCutoffToken predicate: `session.epochId` must match the specific epoch being closed, and that epoch must not be invalidated or superseded by a newer active epoch. Defined `isCutoffSnapshot(session)` as shorthand for Condition A only; full write admission requires both Condition A and Condition B. Updated §6.1 to name W2 as the sole exception holder and explicitly exclude W1, W9, ordinary capture, archive writes, unrelated interrupted sessions, and different-epoch sessions from the exception. If either condition cannot be positively verified, the write is rejected under the standard gate.

3. **§5.3 — `start_capture` Recovery Predicate (Finding 3-A):** Replaced the single-condition completion check with the full P1–P5 predicate: active session present (P1), `session.epochId === targetEpochId` (P2), `storage.activeEpoch === targetEpochId` (P3), registry record valid per `isValidEpochRecord` (P4), registry status `"active"` (P5). Defined distinct failure paths: P3/P4/P5 failure → invalidate and fail to OFF without resending; P1/P2 failure with valid epoch → transition still pending, resume normally. Ambiguous states fail closed to OFF.

4. **§5.3 — `stop_capture` Recovery Predicate (Finding 3-B):** Replaced the broad `absent OR interrupted` rule with the full Q1–Q2 predicate. Q1 (session proof) requires either: session absent AND epoch `"closed"`/`"invalidated"`, OR session present with `epochId === targetEpochId` AND `isCutoffSnapshot(session)`. Q2 (epoch proof) requires `epochRegistry[targetEpochId].status` to be `"closed"` or `"invalidated"`. An unrelated interrupted session cannot confirm completion. An absent session key alone is not proof. Defined four outcome paths: Q1+Q2 hold (complete), Q1 holds but Q2 doesn't (complete registry update, advance to OFF), Q1 fails with absent session (UNAVAILABLE + invalidate), Q1 fails with unrelated session (UNAVAILABLE + invalidate). Preserved the distinction between CS-confirmed cutoff and emergency epoch invalidation.

5. **§6.2 W3/W4/W5 — Serialization Descriptions (Finding 4):** Corrected the detailed writer matrix (§6.2) to match §11. W3 now states the function has no internal serialization and caller must wrap. W4 and W5 now state direct void-fired writes from event handlers with intra-context-only risk and single-context exclusive ownership. Eliminates the internal contradiction between §6.2 and §11 introduced in Revision 2.12.

### Changes in Revision 2.14.1 (Final Predicate & Invalidation Verification Corrections)

1. **§5.3 — `start_capture` Session-Integrity Predicate (P6):** Added an explicit session-integrity predicate to the `start_capture` recovery predicate (now P1–P6). Documented that audit of the existing codebase (`extension/src/continuity/` and `storage/`) revealed no runtime validator function for active `CapturedConversation` sessions (unlike `isValidEpochRecord` for epochs and `validateArchive` in `archiveValidator.ts` for exported archives). In strict adherence to the constraint not to invent functions or schemas, documented the required structural integrity validation contract directly (checking non-null object, valid ID, platform `"chatgpt"`, valid `CaptureLifecycleState`, valid messages array, timestamps, and epoch ID) that any session entity under `ACTIVE_CAPTURE_SESSION_KEY` must satisfy before a `start_capture` transition can be confirmed complete. Formulated explicit failure behavior for session integrity failure: treat as corrupt data, attempt epoch invalidation with verification, and fail closed to `UNAVAILABLE`.

2. **§5.3 — Unverified Invalidation Invariant Across All Recovery Paths:** Enforced that every recovery path attempting epoch invalidation (`start_capture` recovery, `stop_capture` recovery, ambiguous states, and expired-transition procedures) must verify that the invalidation write was committed to `epochRegistry`. If invalidation cannot be committed or cannot be verified, the system must retain `pendingLifecycleTransition` in storage and fail closed to `UNAVAILABLE`. It is strictly forbidden to remove recovery information or announce `ON` or `OFF` based on an unverified invalidation. Corrected expired `start_capture` steps 1 and 2 to fail closed to `UNAVAILABLE` (instead of remaining in `OFF`) upon write or verification failure. Added the formal Unverified Invalidation Invariant statement.

### Implementation Status
**NO IMPLEMENTATION WAS PERFORMED.**

Zero source code, tests, manifests, dependencies, or schemas were modified.  
Both `.bak` files remain intact.  
Git tree: no commits, pushes, stashes, resets, or branch switches.

**Revision 2.14.1 is the definitive design specification. Awaiting explicit implementation authorization.**
