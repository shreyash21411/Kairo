import { detectConversationPage } from "./conversationDetector.ts";
// pageScriptInjector removed — Part A of Milestone 1 (safe capture refactor)

import {
    addConversationPage,
    addConversationMessages,
    getAccumulatedMessageCount,
} from "../connectors/conversationAccumulator.ts";

import type {
    Conversation,
    ConversationMessage,
} from "../connectors/types.ts";

import {
    createCaptureSession,
    startCapture,
    ingestMessage,
    generateMessageId,
    startAssistantStream,
    appendAssistantChunk,
    completeAssistantStream,
    interruptStream,
    recordCheckpoint,
    completeCapture,
    extractMessagesFromConversationHistory,
    mergeCapturedSessions,
    conversationToCapturedSession,
    isMessageEligibleForCapture,
    isRecognizedStreamChunk,
    type CaptureEligibilityInterval,
    type CaptureEligibilityContext,
} from "../continuity/captureLifecycle.ts";
import type { MessageRole } from "../continuity/archiveSchema.ts";

import {
    type CapturedConversation,
    type NormalizedCaptureMessage,
    type LifecyclePingResponse,
    PRIVACY_CUTOFF_SENTINEL,
} from "../continuity/captureTypes.ts";
import {
    saveActiveCaptureSession,
    getActiveCaptureSession,
    getConversations,
    ACTIVE_EPOCH_KEY,
    getAuthorizedMessageIds,
} from "../storage/conversationStorage.ts";
import {
    ContentScriptLifecycle,
    isExtensionContextInvalidatedError,
    preservePendingSessionInDOM,
    recoverPendingSessionsFromDOM,
    CONTENT_SCRIPT_REINIT_EVENT,
} from "../continuity/contentScriptLifecycle.ts";
import { extractVisibleConversationFromDOM } from "../connectors/domConversationExtractor.ts";

/**
 * ============================================================
 * LIFECYCLE & DISPOSAL GUARD
 * ============================================================
 */

const lifecycle = new ContentScriptLifecycle("chatgpt-content");

/**
 * ============================================================
 * MESSAGE LISTENER STATE
 * ============================================================
 */

let isMessageListenerActive = false;
let messageEventListener: ((event: MessageEvent) => void) | null = null;

/**
 * ============================================================
 * MEMORY STATE
 * ============================================================
 */

let memoryEnabled = false;
let captureEligibilityIntervals: CaptureEligibilityInterval[] = [];

/**
 * ============================================================
 * LIVE ASSISTANT STATE
 * ============================================================
 *
 * conversationId -> assistant message ID
 */

const activeAssistantMessageIds =
    new Map<string, string>();

/**
 * Temporary assistant message reconstructed while
 * ChatGPT is streaming.
 */

interface LiveAssistantMessage {
    id: string;

    role: "assistant";

    content: string;

    timestamp?: string;
}

const liveAssistantMessages =
    new Map<string, LiveAssistantMessage>();

export const captureSessions =
    new Map<string, CapturedConversation>();

function getOrCreateCaptureSession(conversationId: string): CapturedConversation {
    let session = captureSessions.get(conversationId);
    if (!session) {
        session = createCaptureSession(
            "chatgpt",
            document.title && document.title !== "ChatGPT" ? document.title : "ChatGPT conversation",
            window.location.href,
            conversationId
        );
        if (activeObserverEpochId) {
            session.epochId = activeObserverEpochId;
        }
        captureSessions.set(conversationId, session);
    } else {
        session.url = window.location.href;
        if (document.title && document.title !== "ChatGPT" && (!session.title || session.title === "ChatGPT conversation")) {
            session.title = document.title;
        }
        if (activeObserverEpochId && !session.epochId) {
            session.epochId = activeObserverEpochId;
        }
    }
    return session;
}

function notifyBackgroundCapture(session: CapturedConversation): void {
    if (!lifecycle.isAlive()) {
        console.warn("[VZ-CAPTURE-DEBUG] Capture event rejected because the context is stale", {
            conversationId: session.id,
            reason: lifecycle.getDisposedReason() || "Context invalidated",
        });
        preservePendingSessionInDOM(session);
        return;
    }

    const conversation: Conversation = {
        id: session.id,
        platform: "chatgpt",
        title: session.title || document.title || "ChatGPT conversation",
        url: window.location.href,
        captureMethod: "supported_connector",
        completeness: session.isComplete ? "complete" : "partial",
        capturedAt: session.capturedAt,
        epochId: session.epochId || activeObserverEpochId || undefined,
        messages: session.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp ?? undefined,
            sourceMessageId: m.sourceMessageId ?? undefined,
            epochId: m.epochId || undefined,
        })),
    };

    try {
        chrome.runtime.sendMessage({
            type: "CONVERSATION_CAPTURED",
            conversation,
        }, () => {
            const lastError = chrome.runtime.lastError;
            if (lastError && isExtensionContextInvalidatedError(lastError)) {
                lifecycle.dispose("Runtime message port disconnected or invalidated");
                preservePendingSessionInDOM(session);
            }
        });
    } catch (err) {
        if (isExtensionContextInvalidatedError(err)) {
            lifecycle.dispose("chrome.runtime.sendMessage threw invalidated context");
            preservePendingSessionInDOM(session);
            return;
        }
    }

    // Only update activeCaptureSession if this session legitimately matches the active tab's route
    const currentTabMatch = typeof window !== "undefined" && window.location?.pathname
        ? window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)
        : null;
    const currentTabConvId = currentTabMatch ? currentTabMatch[1] : null;

    // Safeguard G: If active tab is on an authoritative route, never overwrite it with an unpromoted provisional session
    if (
        currentTabConvId &&
        (session.id === PROVISIONAL_SESSION_ID || session.id === "new-chat")
    ) {
        const promoted = promoteProvisionalSession(currentTabConvId);
        if (promoted) {
            return;
        }
    }

    if (
        currentTabConvId &&
        session.id !== currentTabConvId &&
        session.id !== PROVISIONAL_SESSION_ID &&
        session.id !== "new-chat"
    ) {
        console.log("[VZ-CAPTURE-DEBUG] Stale conversation capture ignored for active tab persistence", {
            sessionId: session.id,
            activeTabConvId: currentTabConvId,
        });
        return;
    }

    void saveActiveCaptureSession(session).then((result) => {
        if (!result.success) {
            if (result.isContextInvalidated) {
                lifecycle.dispose("Storage write encountered invalidated context");
                preservePendingSessionInDOM(session);
            }
            // Do not report successful persistence when the operation failed
            return;
        }

        console.log("[VZ-CAPTURE-DEBUG] Storage write result: active capture session saved", {
            conversationId: session.id,
            messageCount: session.messages.length,
            completeness: session.completenessStatus,
        });
    });
}

/**
 * ============================================================
 * SYNCHRONIZE CAPTURE STATE TO DOM (PHASE 1 PRIVACY GATE)
 * ============================================================
 */

export function syncCaptureStateToDOM(enabled: boolean): void {
    if (typeof document !== "undefined" && document.documentElement) {
        const epoch = Date.now();
        document.documentElement.dataset.vzCaptureActive = enabled ? "true" : "false";
        document.documentElement.dataset.vzCaptureEpoch = String(epoch);
        try {
            window.dispatchEvent(
                new CustomEvent("AI_MEMORY_CAPTURE_STATE_CHANGED", {
                    detail: { active: enabled, epoch },
                })
            );
        } catch {
            // Ignore dispatch errors
        }
    }
}

/**
 * ============================================================
 * LOAD MEMORY STATE
 * ============================================================
 */

async function loadMemoryState(): Promise<void> {
    if (!lifecycle.isAlive()) {
        memoryEnabled = false;
        return;
    }

    try {
        const result =
            await chrome.storage.local.get([
                "memoryEnabled",
                "captureEligibilityIntervals",
            ]);

        memoryEnabled =
            result.memoryEnabled === true;

        if (Array.isArray(result.captureEligibilityIntervals)) {
            captureEligibilityIntervals = result.captureEligibilityIntervals as CaptureEligibilityInterval[];
        } else if (memoryEnabled) {
            captureEligibilityIntervals = [{ start: Date.now(), end: null }];
            void chrome.storage.local.set({ captureEligibilityIntervals });
        }

    } catch (error) {
        if (isExtensionContextInvalidatedError(error)) {
            lifecycle.dispose("loadMemoryState encountered invalidated context");
        } else {
            console.error(
                "AI Memory: Failed to load memory state",
                error
            );
        }
        memoryEnabled = false;
    }
}

async function hydrateFromStorage(): Promise<void> {
    if (!lifecycle.isAlive()) {
        return;
    }

    try {
        const currentTabMatch = typeof window !== "undefined" && window.location?.pathname
            ? window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)
            : null;
        const currentTabConvId = currentTabMatch ? currentTabMatch[1] : null;

        // 1. Hydrate all stored conversations from permanent storage
        const storedConversations = await getConversations();
        for (const conv of storedConversations) {
            if (conv && conv.id) {
                const captured = conversationToCapturedSession(conv);
                const existing = captureSessions.get(conv.id);
                if (existing) {
                    captureSessions.set(conv.id, mergeCapturedSessions(existing, captured));
                } else {
                    captureSessions.set(conv.id, captured);
                }
            }
        }

        // 2. Hydrate active capture session from storage and merge
        const storedActive = await getActiveCaptureSession();
        if (storedActive && storedActive.id) {
            const existing = captureSessions.get(storedActive.id);
            if (existing) {
                const merged = mergeCapturedSessions(existing, storedActive);
                captureSessions.set(storedActive.id, merged);
            } else {
                captureSessions.set(storedActive.id, storedActive);
            }
        }

        // 3. If current tab is on an authoritative route, synchronize active capture session immediately
        if (currentTabConvId && captureSessions.has(currentTabConvId)) {
            const tabSession = captureSessions.get(currentTabConvId)!;
            void saveActiveCaptureSession(tabSession);
            console.log("[VZ-CAPTURE-DEBUG] Synchronized active capture session for current tab route", {
                conversationId: currentTabConvId,
                messageCount: tabSession.messages.length,
            });
        }
    } catch (error) {
        if (isExtensionContextInvalidatedError(error)) {
            lifecycle.dispose("hydrateFromStorage encountered invalidated context");
        }
    }
}

let storageHydrationPromise: Promise<void> | null = null;

export function ensureStorageHydrated(): Promise<void> {
    if (!storageHydrationPromise) {
        storageHydrationPromise = hydrateFromStorage().catch((err) => {
            console.error("AI Memory: Failed to hydrate from storage", err);
        });
    }
    return storageHydrationPromise;
}

/**
 * ============================================================
 * WATCH MEMORY STATE CHANGES
 * ============================================================
 */

function startMemoryStateListener(): void {
    if (!lifecycle.isAlive()) return;

    const onStorageChanged = (
        changes: { [key: string]: chrome.storage.StorageChange },
        areaName: string
    ) => {
        if (!lifecycle.isAlive() || areaName !== "local") {
            return;
        }

        if (changes["conversations"] && Array.isArray(changes["conversations"].newValue)) {
            for (const conv of changes["conversations"].newValue as Conversation[]) {
                if (conv && conv.id) {
                    const captured = conversationToCapturedSession(conv);
                    const existing = captureSessions.get(conv.id);
                    if (existing) {
                        captureSessions.set(conv.id, mergeCapturedSessions(existing, captured));
                    } else {
                        captureSessions.set(conv.id, captured);
                    }
                }
            }
        }

        if (changes["captureEligibilityIntervals"] && Array.isArray(changes["captureEligibilityIntervals"].newValue)) {
            captureEligibilityIntervals = changes["captureEligibilityIntervals"].newValue as CaptureEligibilityInterval[];
        }

        const change =
            changes["memoryEnabled"];

        if (!change) {
            return;
        }

        memoryEnabled =
            change.newValue === true;

        syncCaptureStateToDOM(memoryEnabled);

        console.log(
            "AI Memory: Memory state changed",
            {
                enabled:
                    memoryEnabled,
            }
        );

        /**
         * Privacy boundary enforcement:
         * If Memory is turned OFF, immediately stop accepting new content,
         * interrupt in-progress streams, and close the eligible capture interval.
         */
        if (!memoryEnabled) {
            disconnectActiveObserver("Memory turned OFF in storage");
            const now = Date.now();
            let intervalsChanged = false;
            for (const interval of captureEligibilityIntervals) {
                if (interval.end === null || interval.end === undefined) {
                    interval.end = now;
                    intervalsChanged = true;
                }
            }
            if (intervalsChanged) {
                void chrome.storage.local.set({ captureEligibilityIntervals });
            }

            // Active assistant streams are interrupted at the opt-out boundary
            for (const [id, s] of captureSessions.entries()) {
                if (s.state === "response_in_progress") {
                    const interrupted = interruptStream(s, "Capture was paused by user.");
                    captureSessions.set(id, interrupted);
                    void saveActiveCaptureSession(interrupted);
                }
            }

            activeAssistantMessageIds.clear();
            liveAssistantMessages.clear();
            console.log(
                "AI Memory: Live capture state cleared and active streams interrupted because Memory is OFF"
            );
        } else {
            // Re-enabling capture starts a new eligible capture interval
            const now = Date.now();
            captureEligibilityIntervals.push({ start: now, end: null });
            void chrome.storage.local.set({ captureEligibilityIntervals });

            void ensureStorageHydrated();
        }
    };

    try {
        chrome.storage.onChanged.addListener(onStorageChanged);
        lifecycle.onTeardown(() => {
            try {
                chrome.storage.onChanged.removeListener(onStorageChanged);
            } catch {
                // Stale context
            }
        });
    } catch (err) {
        if (isExtensionContextInvalidatedError(err)) {
            lifecycle.dispose("startMemoryStateListener encountered invalidated context");
        }
    }
}

/**
 * ============================================================
 * HISTORICAL CONVERSATION ID
 * ============================================================
 */

function getConversationIdFromUrl(
    url: string
): string | null {

    const match =
        url.match(
            /\/backend-api\/conversations\/([^/]+)\/messages/
        );

    if (!match) {
        return null;
    }

    return match[1];
}

/**
 * ============================================================
 * NORMALIZE CHATGPT MESSAGE
 * ============================================================
 */

function normalizeMessage(
    rawMessage: unknown,
    sequence?: number,
    defaultRole?: "user" | "assistant"
): ConversationMessage | null {

    if (
        !rawMessage ||
        typeof rawMessage !== "object"
    ) {
        return null;
    }

    const raw =
        rawMessage as Record<string, unknown>;

    const author =
        raw["author"] as
        Record<string, unknown> | undefined;

    const role =
        (author?.["role"] || raw["role"] || defaultRole) as string | undefined;

    if (
        role !== "user" &&
        role !== "assistant"
    ) {
        return null;
    }

    // Decision 1: Do not capture hidden reasoning, private chain-of-thought, or internal thought blocks
    if (
        raw["recipient"] === "thought" ||
        raw["channel"] === "thought" ||
        (raw["metadata"] &&
            typeof raw["metadata"] === "object" &&
            ((raw["metadata"] as Record<string, unknown>)["is_thought"] === true ||
                (raw["metadata"] as Record<string, unknown>)["thought"] === true))
    ) {
        return null;
    }

    if (raw["content"] && typeof raw["content"] === "object") {
        const contentObj = raw["content"] as Record<string, unknown>;
        if (contentObj["content_type"] === "thoughts") {
            return null;
        }
    }

    let text = "";
    if (typeof raw["content"] === "string") {
        text = raw["content"];
    } else if (raw["content"] && typeof raw["content"] === "object") {
        const contentObj = raw["content"] as Record<string, unknown>;
        if (Array.isArray(contentObj["parts"])) {
            text = contentObj["parts"]
                .map((part) => {
                    if (typeof part === "string") return part;
                    if (part && typeof part === "object" && "text" in part) {
                        return String((part as Record<string, unknown>).text);
                    }
                    return "";
                })
                .filter(Boolean)
                .join("\n");
        } else if (typeof contentObj["text"] === "string") {
            text = contentObj["text"];
        }
    } else if (typeof raw["text"] === "string") {
        text = raw["text"];
    }

    if (!text || text.trim().length === 0) {
        return null;
    }

    const seq = typeof sequence === "number" && sequence > 0 ? sequence : 1;
    const id =
        typeof raw["id"] === "string" && raw["id"].length > 0
            ? raw["id"]
            : typeof raw["message_id"] === "string" && raw["message_id"].length > 0
                ? raw["message_id"]
                : generateMessageId(role as MessageRole, text, seq);

    const createTime =
        raw["create_time"] ?? raw["timestamp"];

    return {
        id,

        role: role as "user" | "assistant",

        content: text,

        timestamp:
            typeof createTime === "number"
                ? new Date(
                    createTime * 1000
                ).toISOString()
                : typeof createTime === "string"
                    ? createTime
                    : undefined,
    };
}

/**
 * ============================================================
 * GET CONVERSATION ID FROM LIVE EVENT
 * ============================================================
 *
 * First try the actual ChatGPT event.
 *
 * The interceptor now also supplies a conversationId separately
 * because later SSE delta events don't always contain one.
 */

function getConversationIdFromLiveEvent(
    data: Record<string, unknown>,
    fallbackConversationId?: string | null
): string | null {

    const conversationId =
        data["conversation_id"];

    if (
        typeof conversationId === "string" &&
        conversationId.length > 0
    ) {

        return conversationId;
    }

    const value =
        data["v"];

    if (
        value &&
        typeof value === "object"
    ) {

        const valueObject =
            value as Record<string, unknown>;

        const nestedConversationId =
            valueObject[
            "conversation_id"
            ];

        if (
            typeof nestedConversationId === "string" &&
            nestedConversationId.length > 0
        ) {

            return nestedConversationId;
        }
    }

    /**
     * IMPORTANT:
     *
     * Later delta events may not contain conversation_id.
     *
     * In that case use the ID supplied by the interceptor.
     */

    if (
        typeof fallbackConversationId === "string" &&
        fallbackConversationId.length > 0
    ) {

        return fallbackConversationId;
    }

    if (typeof window !== "undefined" && window.location && window.location.pathname) {
        const urlMatch = window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
        if (urlMatch && urlMatch[1]) {
            return urlMatch[1];
        }
    }

    return null;
}

const PROVISIONAL_SESSION_ID = "provisional-tab";

/**
 * Promotes a provisional or temporary session to an authoritative conversation UUID.
 * Preserves all buffered user messages and maintains strict chronological sequence.
 */
export function promoteProvisionalSession(newConvId: string): CapturedConversation | null {
    if (!newConvId || newConvId === PROVISIONAL_SESSION_ID || newConvId === "new-chat" || newConvId === "local-chatgpt") {
        return null;
    }

    const provisional =
        captureSessions.get(PROVISIONAL_SESSION_ID) ||
        captureSessions.get("new-chat") ||
        captureSessions.get("local-chatgpt");

    if (!provisional) {
        return null;
    }

    captureSessions.delete(PROVISIONAL_SESSION_ID);
    captureSessions.delete("new-chat");
    captureSessions.delete("local-chatgpt");

    let targetSession = captureSessions.get(newConvId);
    if (!targetSession) {
        targetSession = createCaptureSession(
            "chatgpt",
            document.title && document.title !== "ChatGPT" ? document.title : provisional.title || "ChatGPT conversation",
            window.location.href,
            newConvId
        );
        targetSession.epochId = provisional.epochId || activeObserverEpochId || undefined;
    } else if (!targetSession.epochId) {
        targetSession.epochId = provisional.epochId || activeObserverEpochId || undefined;
    }

    // Merge provisional messages into target session maintaining chronological order and stable IDs
    for (const msg of provisional.messages) {
        targetSession = ingestMessage(targetSession, {
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            sourceMessageId: msg.sourceMessageId || msg.id,
            epochId: msg.epochId || provisional.epochId,
        });
    }

    // Defect A Fix: Migrate assistant message ID mapping from provisional keys to newConvId
    const provAssistantId =
        activeAssistantMessageIds.get(PROVISIONAL_SESSION_ID) ||
        activeAssistantMessageIds.get("new-chat") ||
        activeAssistantMessageIds.get("local-chatgpt");
    if (provAssistantId) {
        activeAssistantMessageIds.set(newConvId, provAssistantId);
        activeAssistantMessageIds.delete(PROVISIONAL_SESSION_ID);
        activeAssistantMessageIds.delete("new-chat");
        activeAssistantMessageIds.delete("local-chatgpt");
        console.log(`[VZ-CAPTURE-DEBUG] Migrated active assistant message ID ${provAssistantId} to ${newConvId}`);
    }

    // Migrate unauthorized baseline keys from provisional to newConvId
    const provUnauthorized =
        unauthorizedMessageKeysByConv.get(PROVISIONAL_SESSION_ID) ||
        unauthorizedMessageKeysByConv.get("new-chat") ||
        unauthorizedMessageKeysByConv.get("local-chatgpt");
    if (provUnauthorized && provUnauthorized.size > 0) {
        let targetSet = unauthorizedMessageKeysByConv.get(newConvId);
        if (!targetSet) {
            targetSet = new Set<string>();
            unauthorizedMessageKeysByConv.set(newConvId, targetSet);
        }
        for (const k of provUnauthorized) {
            targetSet.add(k);
        }
    }
    // Transfer baseline tracking so newConvId does not re-run baseline for this active epoch
    for (const key of Array.from(epochBaselinesEstablished)) {
        if (key.startsWith(`${PROVISIONAL_SESSION_ID}:::`) || key.startsWith("new-chat:::") || key.startsWith("local-chatgpt:::")) {
            const epochPart = key.split(":::")[1];
            epochBaselinesEstablished.add(getBaselineKey(newConvId, epochPart));
        }
    }
    for (const [key, promise] of Array.from(baselinePromisesByConv.entries())) {
        if (key.startsWith(`${PROVISIONAL_SESSION_ID}:::`) || key.startsWith("new-chat:::") || key.startsWith("local-chatgpt:::")) {
            const epochPart = key.split(":::")[1];
            const newKey = getBaselineKey(newConvId, epochPart);
            if (!baselinePromisesByConv.has(newKey)) {
                baselinePromisesByConv.set(newKey, promise);
            }
        }
    }

    if (provisional.state === "response_in_progress") {
        targetSession.state = "response_in_progress";
    }

    targetSession.url = window.location.href;
    targetSession.lastCheckpointAt = new Date().toISOString();
    captureSessions.set(newConvId, targetSession);
    notifyBackgroundCapture(targetSession);

    console.log(`[VZ-CAPTURE-DEBUG] Promoted provisional session to ${newConvId} (${targetSession.messages.length} messages preserved)`);
    return targetSession;
}

/**
 * ============================================================
 * USER MESSAGE
 * ============================================================
 */

function handleLiveInputMessage(
    data: Record<string, unknown>,
    fallbackConversationId?: string | null
): void {
    let conversationId =
        getConversationIdFromLiveEvent(
            data,
            fallbackConversationId
        );

    // If conversationId is not yet established, attempt active window pathname match or bind to PROVISIONAL_SESSION_ID
    if (!conversationId) {
        if (typeof window !== "undefined" && window.location?.pathname) {
            const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
            if (match && match[1]) {
                conversationId = match[1];
            }
        }
    }
    if (!conversationId) {
        conversationId = PROVISIONAL_SESSION_ID;
    } else if (conversationId !== PROVISIONAL_SESSION_ID && conversationId !== "new-chat") {
        promoteProvisionalSession(conversationId);
    }

    const rawInputMessage =
        data["input_message"];

    const inputSession = getOrCreateCaptureSession(conversationId);
    const nextSeq = inputSession.messages.length + 1;

    const message =
        normalizeMessage(
            rawInputMessage,
            nextSeq,
            "user"
        );

    console.log("[VZ-CAPTURE-DEBUG] Event received by content script: input_message", {
        conversationId,
        hasMessage: !!message,
        messageId: message?.id,
        charCount: message?.content.length ?? 0,
    });

    if (!message) {
        console.warn(
            "[VZ-CAPTURE-DEBUG] Lifecycle ingestion: user message rejected (normalization failed)",
            {
                conversationId,
            }
        );
        return;
    }

    addConversationMessages(
        conversationId,
        [message]
    );

    const updatedInputSession = ingestMessage(startCapture(inputSession), {
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        sourceMessageId: message.id,
    });
    captureSessions.set(conversationId, updatedInputSession);
    notifyBackgroundCapture(updatedInputSession);

    console.log(
        "[VZ-CAPTURE-DEBUG] Lifecycle ingestion: user message accepted",
        {
            conversationId,
            messageId: message.id,
            totalMessages: updatedInputSession.messages.length,
        }
    );
}

/**
 * ============================================================
 * ASSISTANT MESSAGE CREATED
 * ============================================================
 */

function handleAssistantMessageAdded(
    data: Record<string, unknown>,
    fallbackConversationId?: string | null
): void {

    let conversationId =
        getConversationIdFromLiveEvent(
            data,
            fallbackConversationId
        );

    if (conversationId && conversationId !== PROVISIONAL_SESSION_ID && conversationId !== "new-chat") {
        promoteProvisionalSession(conversationId);
    }

    if (!conversationId) {
        if (typeof window !== "undefined" && window.location?.pathname) {
            const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
            if (match && match[1]) {
                conversationId = match[1];
                promoteProvisionalSession(conversationId);
            }
        }
    }

    if (!conversationId) {
        conversationId = PROVISIONAL_SESSION_ID;
    }

    const value =
        data["v"];

    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        return;
    }

    const valueObject =
        value as Record<string, unknown>;

    const rawMessage =
        valueObject["message"];

    if (
        !rawMessage ||
        typeof rawMessage !== "object" ||
        Array.isArray(rawMessage)
    ) {
        return;
    }

    const messageObject =
        rawMessage as Record<string, unknown>;

    const author =
        messageObject["author"];

    if (
        !author ||
        typeof author !== "object" ||
        Array.isArray(author)
    ) {
        return;
    }

    const authorObject =
        author as Record<string, unknown>;

    if (
        authorObject["role"] !==
        "assistant"
    ) {
        return;
    }

    const assistantId =
        messageObject["id"];

    if (
        typeof assistantId !== "string"
    ) {
        return;
    }

    const normalized =
        normalizeMessage(
            messageObject
        );

    /**
     * Establish the assistant state immediately.
     */

    if (activeAssistantMessageIds.get(conversationId) === assistantId) {
        return;
    }

    activeAssistantMessageIds.set(
        conversationId,
        assistantId
    );

    liveAssistantMessages.set(
        assistantId,
        {
            id:
                assistantId,

            role:
                "assistant",

            content:
                normalized?.content ?? "",

            timestamp:
                normalized?.timestamp,
        }
    );

    const asstSession = getOrCreateCaptureSession(conversationId);
    const updatedAsstSession = startAssistantStream(
        asstSession,
        assistantId,
        normalized?.content ?? "",
        normalized?.timestamp
    );
    captureSessions.set(conversationId, updatedAsstSession);
    if (lifecycle.isAlive()) {
        void saveActiveCaptureSession(updatedAsstSession).then((result) => {
            if (!result.success && result.isContextInvalidated) {
                lifecycle.dispose("saveActiveCaptureSession in handleAssistantMessageAdded encountered invalidated context");
                preservePendingSessionInDOM(updatedAsstSession);
            }
        });
    } else {
        preservePendingSessionInDOM(updatedAsstSession);
    }

    console.log(
        "AI Memory: Assistant stream started",
        {
            conversationId,

            messageId:
                assistantId,
        }
    );
}

/**
 * ============================================================
 * APPEND ASSISTANT TEXT
 * ============================================================
 */

function appendAssistantText(
    conversationId: string,
    text: string
): void {

    if (!text) {
        return;
    }

    let assistantMessageId =
        activeAssistantMessageIds.get(
            conversationId
        );

    // Defect A Fix: Fallback for promotional race condition: check provisional mappings
    if (!assistantMessageId) {
        assistantMessageId =
            activeAssistantMessageIds.get(PROVISIONAL_SESSION_ID) ||
            activeAssistantMessageIds.get("new-chat");
        if (assistantMessageId) {
            activeAssistantMessageIds.set(conversationId, assistantMessageId);
        }
    }

    if (!assistantMessageId) {

        console.warn(
            "AI Memory: Assistant text received without active assistant message",
            {
                conversationId,

                text,
            }
        );

        return;
    }

    const assistantMessage =
        liveAssistantMessages.get(
            assistantMessageId
        );

    if (!assistantMessage) {

        console.warn(
            "AI Memory: Assistant text received but message state was not found",
            {
                conversationId,

                assistantMessageId,
            }
        );

        return;
    }

    assistantMessage.content +=
        text;

    const streamSession = captureSessions.get(conversationId);
    if (streamSession) {
        const updatedStreamSession = appendAssistantChunk(streamSession, text);
        captureSessions.set(conversationId, updatedStreamSession);
    }

    console.log(
        "AI Memory: Assistant text appended",
        {
            conversationId,

            messageId:
                assistantMessageId,

            chunkLength:
                text.length,

            totalContentLength:
                assistantMessage.content.length,
        }
    );
}

/**
 * ============================================================
 * ASSISTANT TEXT DELTA
 * ============================================================
 *
 * Handles:
 *
 * {
 *   v: "hello"
 * }
 *
 * AND:
 *
 * {
 *   p: "/message/content/parts/0",
 *   o: "append",
 *   v: "hello"
 * }
 */

function handleAssistantTextDelta(
    data: Record<string, unknown>,
    fallbackConversationId?: string | null
): void {

    const conversationId =
        getConversationIdFromLiveEvent(
            data,
            fallbackConversationId
        );

    if (!conversationId) {

        console.warn(
            "AI Memory: Assistant delta has no conversation ID"
        );

        return;
    }

    const value =
        data["v"];

    if (
        typeof value !== "string"
    ) {
        return;
    }

    appendAssistantText(
        conversationId,
        value
    );
}

/**
 * ============================================================
 * ASSISTANT PATCH
 * ============================================================
 */

function handleAssistantPatch(
    data: Record<string, unknown>,
    fallbackConversationId?: string | null
): void {

    const conversationId =
        getConversationIdFromLiveEvent(
            data,
            fallbackConversationId
        );

    if (!conversationId) {

        console.warn(
            "AI Memory: Assistant patch has no conversation ID"
        );

        return;
    }

    const patchValue =
        data["v"];

    if (
        !Array.isArray(patchValue)
    ) {
        return;
    }

    for (
        const patch of patchValue
    ) {

        if (
            !patch ||
            typeof patch !== "object" ||
            Array.isArray(patch)
        ) {
            continue;
        }

        const patchObject =
            patch as Record<
                string,
                unknown
            >;

        const path =
            patchObject["p"];

        const operation =
            patchObject["o"];

        const value =
            patchObject["v"];

        /**
         * Only append actual assistant content.
         */

        if (
            typeof path === "string" &&
            path.startsWith(
                "/message/content/parts/"
            ) &&
            operation === "append" &&
            typeof value === "string"
        ) {

            appendAssistantText(
                conversationId,
                value
            );
        }
    }
}

/**
 * ============================================================
 * ASSISTANT STREAM COMPLETE
 * ============================================================
 */

function handleMessageStreamComplete(
    data: Record<string, unknown>,
    fallbackConversationId?: string | null
): void {

    let conversationId =
        getConversationIdFromLiveEvent(
            data,
            fallbackConversationId
        );

    if (conversationId && conversationId !== PROVISIONAL_SESSION_ID && conversationId !== "new-chat") {
        promoteProvisionalSession(conversationId);
    }

    if (!conversationId) {
        if (typeof window !== "undefined" && window.location?.pathname) {
            const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
            if (match && match[1]) {
                conversationId = match[1];
                promoteProvisionalSession(conversationId);
            }
        }
    }

    if (!conversationId) {
        conversationId = PROVISIONAL_SESSION_ID;
    }

    let assistantMessageId =
        activeAssistantMessageIds.get(
            conversationId
        );

    // Defect A Fix: Fallback for promotional race condition: check provisional mappings
    if (!assistantMessageId) {
        assistantMessageId =
            activeAssistantMessageIds.get(PROVISIONAL_SESSION_ID) ||
            activeAssistantMessageIds.get("new-chat");
        if (assistantMessageId) {
            activeAssistantMessageIds.set(conversationId, assistantMessageId);
        }
    }

    if (!assistantMessageId) {

        console.warn(
            "AI Memory: Stream completed without active assistant message",
            {
                conversationId,
            }
        );

        return;
    }

    const assistantMessage =
        liveAssistantMessages.get(
            assistantMessageId
        );

    if (!assistantMessage) {

        console.warn(
            "AI Memory: Stream completed but assistant message state was not found",
            {
                conversationId,

                assistantMessageId,
            }
        );

        activeAssistantMessageIds.delete(
            conversationId
        );

        return;
    }

    /**
     * Do not store an empty assistant message.
     */

    if (
        assistantMessage.content.trim().length === 0
    ) {

        console.warn(
            "AI Memory: Assistant stream completed with empty content",
            {
                conversationId,

                messageId:
                    assistantMessageId,
            }
        );

        liveAssistantMessages.delete(
            assistantMessageId
        );

        activeAssistantMessageIds.delete(
            conversationId
        );

        return;
    }

    const completedMessage:
        ConversationMessage = {

        id:
            assistantMessage.id,

        role:
            "assistant",

        content:
            assistantMessage.content,

        timestamp:
            assistantMessage.timestamp,
    };

    /**
     * Store the complete assistant message ONCE,
     * after the stream has finished.
     */

    addConversationMessages(
        conversationId,
        [completedMessage]
    );

    // Defect C Fix: Reconcile assistantMessage.content into completedSession.messages before final completion
    let completedSession = captureSessions.get(conversationId);
    if (completedSession) {
        const activeIdx = completedSession.messages.findIndex(
            (m) => m.id === assistantMessage.id || (m.isInProgress && m.role === "assistant")
        );
        if (activeIdx >= 0) {
            const updatedMsgs = [...completedSession.messages];
            updatedMsgs[activeIdx] = {
                ...updatedMsgs[activeIdx],
                id: assistantMessage.id,
                content: assistantMessage.content,
                timestamp: assistantMessage.timestamp ?? updatedMsgs[activeIdx].timestamp,
                sourceMessageId: assistantMessage.id,
                isInProgress: false,
            };
            completedSession = { ...completedSession, messages: updatedMsgs };
        } else {
            completedSession = ingestMessage(completedSession, {
                id: assistantMessage.id,
                role: "assistant",
                content: assistantMessage.content,
                timestamp: assistantMessage.timestamp,
                sourceMessageId: assistantMessage.id,
            });
        }

        const updatedCompletedSession = recordCheckpoint(
            completeAssistantStream(completedSession)
        );
        captureSessions.set(conversationId, updatedCompletedSession);
        notifyBackgroundCapture(updatedCompletedSession);
    }

    console.log(
        "AI Memory: Assistant message captured",
        {
            conversationId,

            messageId:
                completedMessage.id,

            content:
                completedMessage.content,

            contentLength:
                completedMessage.content.length,
        }
    );

    /**
     * Clean live state.
     */

    liveAssistantMessages.delete(
        assistantMessageId
    );

    activeAssistantMessageIds.delete(
        conversationId
    );

    console.log(
        "AI Memory: Live conversation turn complete",
        {
            conversationId,

            totalMessageCount:
                getAccumulatedMessageCount(
                    conversationId
                ),
        }
    );
}

/**
 * ============================================================
 * ASSISTANT STREAM ERROR / ABORTED
 * ============================================================
 */

function handleMessageStreamError(
    data: Record<string, unknown>,
    fallbackConversationId?: string | null
): void {
    const conversationId =
        getConversationIdFromLiveEvent(
            data,
            fallbackConversationId
        );

    if (!conversationId) {
        return;
    }

    const assistantMessageId =
        activeAssistantMessageIds.get(
            conversationId
        );

    if (assistantMessageId) {
        liveAssistantMessages.delete(
            assistantMessageId
        );
        activeAssistantMessageIds.delete(
            conversationId
        );
    }

    const error =
        typeof data["error"] === "string"
            ? data["error"]
            : "Assistant stream was aborted or interrupted by an error.";

    console.warn("AI Memory: Assistant stream error received", {
        conversationId,
        error,
    });

    const session = captureSessions.get(conversationId);
    if (session) {
        const updated = interruptStream(session, error);
        captureSessions.set(conversationId, updated);
        if (lifecycle.isAlive()) {
            void saveActiveCaptureSession(updated).then((res) => {
                if (!res.success && res.isContextInvalidated) {
                    lifecycle.dispose("saveActiveCaptureSession in handleMessageStreamError encountered invalidated context");
                    preservePendingSessionInDOM(updated);
                }
            });
        } else {
            preservePendingSessionInDOM(updated);
        }
    }
}

/**
 * ============================================================
 * LIVE CONVERSATION EVENT ROUTER
 * ============================================================
 */

async function handleLiveConversationEvent(
    eventPayload: unknown
): Promise<void> {
    await ensureStorageHydrated();

    if (
        !eventPayload ||
        typeof eventPayload !== "object"
    ) {
        return;
    }

    const payload =
        eventPayload as Record<
            string,
            unknown
        >;

    /**
     * --------------------------------------------------------
     * IMPORTANT:
     *
     * The interceptor sends:
     *
     * {
     *     data,
     *     conversationId
     * }
     *
     * We MUST preserve both.
     * --------------------------------------------------------
     */

    const data =
        payload["data"];

    if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data)
    ) {
        return;
    }

    const eventData =
        data as Record<
            string,
            unknown
        >;

    /**
     * This is the conversation ID remembered by
     * chatgptFetchInterceptor.ts.
     *
     * It is the fallback for SSE events that don't
     * contain conversation_id themselves.
     */

    const fallbackConversationId =
        typeof payload["conversationId"] === "string"
            ? payload["conversationId"]
            : null;

    const type =
        eventData["type"];

    /**
     * --------------------------------------------------------
     * CONVERSATION ID ESTABLISHED / UPDATED
     * --------------------------------------------------------
     */

    if (type === "conversation_id_updated") {
        const newConvId = (eventData["conversation_id"] as string) || fallbackConversationId;
        console.log("[VZ-CAPTURE-DEBUG] conversation_id_updated received", { newConvId });
        if (newConvId) {
            promoteProvisionalSession(newConvId);
        }
        return;
    }

    /**
     * --------------------------------------------------------
     * USER MESSAGE
     * --------------------------------------------------------
     */

    if (
        type === "input_message"
    ) {

        handleLiveInputMessage(
            eventData,
            fallbackConversationId
        );

        return;
    }

    /**
     * --------------------------------------------------------
     * STREAM COMPLETE
     * --------------------------------------------------------
     */

    if (
        type === "message_stream_complete"
    ) {

        handleMessageStreamComplete(
            eventData,
            fallbackConversationId
        );

        return;
    }

    if (
        type === "message_stream_error"
    ) {

        handleMessageStreamError(
            eventData,
            fallbackConversationId
        );

        return;
    }

    /**
     * --------------------------------------------------------
     * Only process delta events below this point.
     * --------------------------------------------------------
     */

    // Defect B Fix: Inspect payload structure and accept recognized streaming content or explicit delta events
    const eventName =
        payload["event"] as string | null | undefined;

    const isDelta = eventName === "delta";
    const isRecognized = isDelta || isRecognizedStreamChunk(eventData, eventName);

    if (!isRecognized) {
        return;
    }

    const value =
        eventData["v"];

    /**
     * --------------------------------------------------------
     * ASSISTANT MESSAGE CREATION
     * --------------------------------------------------------
     */

    if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    ) {

        const valueObject =
            value as Record<
                string,
                unknown
            >;

        const message =
            valueObject["message"];

        if (
            message &&
            typeof message === "object" &&
            !Array.isArray(message)
        ) {

            const messageObject =
                message as Record<
                    string,
                    unknown
                >;

            const author =
                messageObject[
                "author"
                ];

            if (
                author &&
                typeof author === "object" &&
                !Array.isArray(author)
            ) {

                const authorObject =
                    author as Record<
                        string,
                        unknown
                    >;

                if (
                    authorObject[
                    "role"
                    ] === "assistant"
                ) {

                    handleAssistantMessageAdded(
                        eventData,
                        fallbackConversationId
                    );

                    return;
                }
            }
        }
    }

    /**
     * --------------------------------------------------------
     * PATCH
     * --------------------------------------------------------
     */

    if (
        value &&
        Array.isArray(value)
    ) {

        handleAssistantPatch(
            eventData,
            fallbackConversationId
        );

        return;
    }

    /**
     * --------------------------------------------------------
     * NORMAL ASSISTANT TEXT DELTA
     * --------------------------------------------------------
     */

    handleAssistantTextDelta(
        eventData,
        fallbackConversationId
    );
}

/**
 * ============================================================
 * HISTORICAL CONVERSATION HISTORY (GET /backend-api/conversation/<uuid>)
 * ============================================================
 */

async function handleConversationHistory(
    payload: unknown
): Promise<void> {
    await ensureStorageHydrated();
    const payloadObject =
        payload as Record<string, unknown> | undefined;

    if (!payloadObject) return;

    const data = payloadObject["data"];
    const conversationId =
        (payloadObject["conversationId"] as string) ||
        getConversationIdFromUrl(String(payloadObject["url"])) ||
        ((data as Record<string, unknown>)?.["conversation_id"] as string) ||
        (typeof window !== "undefined" && window.location?.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)?.[1]);

    console.log("[VZ-CAPTURE-DEBUG] Historical recovery processing", {
        conversationId,
        endpoint: payloadObject["url"],
    });

    if (!conversationId) {
        console.warn("[VZ-CAPTURE-DEBUG] Historical recovery skipped: missing conversationId");
        return;
    }

    const extraction = extractMessagesFromConversationHistory(data);
    console.log("[VZ-CAPTURE-DEBUG] Historical recovery messages discovered", {
        conversationId,
        discoveredCount: extraction.messages.length,
        isComplete: extraction.isComplete,
    });

    if (extraction.messages.length === 0) return;

    let session = getOrCreateCaptureSession(conversationId);
    if (extraction.title && (!session.title || session.title === "ChatGPT conversation")) {
        session.title = extraction.title;
    }

    const eligibilityContext: CaptureEligibilityContext = {
        isCaptureCurrentlyEnabled: memoryEnabled,
        intervals: captureEligibilityIntervals,
        persistedMessageIds: new Set(session.messages.map((m) => m.id)),
    };

    for (const msg of extraction.messages) {
        if (!isMessageEligibleForCapture(msg, eligibilityContext)) {
            console.log("[VZ-CAPTURE-DEBUG] Historical message excluded by privacy boundary", {
                id: msg.id,
                timestamp: msg.timestamp,
            });
            continue;
        }

        session = ingestMessage(session, {
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            sourceMessageId: msg.id,
        });
    }

    if (extraction.isComplete) {
        session.isComplete = true;
        session.completenessStatus = "complete";
        session.hasMoreHistory = false;
    } else {
        session.isComplete = false;
        session.completenessStatus = "partial";
        session.hasMoreHistory = true;
    }

    session = recordCheckpoint(session);
    captureSessions.set(conversationId, session);
    notifyBackgroundCapture(session);

    console.log("[VZ-CAPTURE-DEBUG] Historical recovery ingested successfully", {
        conversationId,
        totalMessagesInSession: session.messages.length,
        completeness: session.completenessStatus,
    });
}

/**
 * ============================================================
 * HISTORICAL /messages RESPONSE
 * ============================================================
 */

async function handleMessagesResponse(
    payload: unknown
): Promise<void> {
    await ensureStorageHydrated();

    const payloadObject =
        payload as
        Record<string, unknown> | undefined;

    if (!payloadObject) {
        return;
    }

    const url =
        payloadObject["url"];

    const data =
        payloadObject["data"] as
        Record<string, unknown> | undefined;

    if (
        typeof url !== "string" ||
        !data
    ) {
        return;
    }

    const conversationId =
        getConversationIdFromUrl(
            url
        );

    if (!conversationId) {
        return;
    }

    const rawMessages =
        data["messages"];

    if (!Array.isArray(rawMessages)) {

        console.warn(
            "AI Memory: ChatGPT response does not contain messages"
        );

        return;
    }

    const rawPageInfo =
        data["page_info"];

    if (
        !rawPageInfo ||
        typeof rawPageInfo !== "object" ||
        Array.isArray(rawPageInfo)
    ) {

        console.warn(
            "AI Memory: ChatGPT response does not contain page_info"
        );

        return;
    }

    const pageInfo =
        rawPageInfo as Record<
            string,
            unknown
        >;

    const messages:
        ConversationMessage[] =
        rawMessages
            .map((m, idx) => normalizeMessage(m, idx + 1))
            .filter(
                (
                    message
                ): message is ConversationMessage =>
                    message !== null
            );

    const startCursor =
        typeof pageInfo[
            "start_cursor"
        ] === "string"
            ? pageInfo[
            "start_cursor"
            ]
            : null;

    const endCursor =
        typeof pageInfo[
            "end_cursor"
        ] === "string"
            ? pageInfo[
            "end_cursor"
            ]
            : null;

    const hasPreviousPage =
        pageInfo[
        "has_previous_page"
        ] === true;

    const hasNextPage =
        pageInfo[
        "has_next_page"
        ] === true;

    addConversationPage(
        conversationId,

        messages,

        {
            start_cursor:
                startCursor,

            end_cursor:
                endCursor,

            has_previous_page:
                hasPreviousPage,

            has_next_page:
                hasNextPage,
        }
    );

    const histSession = getOrCreateCaptureSession(conversationId);
    const eligibilityContext: CaptureEligibilityContext = {
        isCaptureCurrentlyEnabled: memoryEnabled,
        intervals: captureEligibilityIntervals,
        persistedMessageIds: new Set(histSession.messages.map((m) => m.id)),
    };

    let currentHist = histSession;
    for (const msg of messages) {
        if (!isMessageEligibleForCapture(msg, eligibilityContext)) {
            console.log("[VZ-CAPTURE-DEBUG] Paginated message excluded by privacy boundary", {
                id: msg.id,
                timestamp: msg.timestamp,
            });
            continue;
        }

        currentHist = ingestMessage(currentHist, {
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            sourceMessageId: msg.id,
        });
    }
    const isBoundedFullHistory =
        messages.length > 0 &&
        hasPreviousPage === false &&
        hasNextPage === false;

    if (isBoundedFullHistory) {
        currentHist = completeCapture(currentHist, {
            hasMoreHistory: false,
            hasPreviousPage: false,
            hasNextPage: false,
        });
    } else {
        currentHist = recordCheckpoint(currentHist);
        currentHist.hasMoreHistory = hasPreviousPage || hasNextPage;
        currentHist.isComplete = false;
    }
    captureSessions.set(conversationId, currentHist);
    notifyBackgroundCapture(currentHist);

    console.log(
        "AI Memory: Conversation history page captured",
        {
            conversationId,

            pageMessageCount:
                messages.length,

            totalMessageCount:
                getAccumulatedMessageCount(
                    conversationId
                ),
        }
    );
}

/**
 * ============================================================
 * DOM VISIBLE CONVERSATION RECOVERY (INVESTIGATION D)
 * ============================================================
 */

async function recoverVisibleConversationHistoryFromDOM(): Promise<void> {
    if (!memoryEnabled || !lifecycle.isAlive()) {
        return;
    }

    try {
        const domResult = extractVisibleConversationFromDOM(document);
        if (domResult.messages.length === 0) {
            return;
        }

        const currentTabMatch = typeof window !== "undefined" && window.location?.pathname
            ? window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)
            : null;
        const currentTabConvId = currentTabMatch ? currentTabMatch[1] : null;

        if (currentTabConvId && captureSessions.has(PROVISIONAL_SESSION_ID)) {
            promoteProvisionalSession(currentTabConvId);
        }

        const convId =
            domResult.conversationId ||
            currentTabConvId ||
            PROVISIONAL_SESSION_ID;

        if (activeObserverEpochId) {
            await ensureConversationBaseline(convId, activeObserverEpochId);
            if (!memoryEnabled) return;

            const baselineKey = getBaselineKey(convId, activeObserverEpochId);
            if (!populatedBaselinesEstablished.has(baselineKey)) {
                await recordEpochObservationBaseline(convId, activeObserverEpochId);
                if (!memoryEnabled) return;
            }
        }

        // Load durable authorized IDs from storage. These survive page reload and handle the case where
        // a DOM-extracted message ID doesn't exactly match the stored ID (e.g., content hash changed during
        // streaming). Any message whose ID or sourceMessageId is in durableAuthorizedIds is treated as
        // "previously persisted" and must not be re-assigned the current epoch.
        const durableAuthorizedIds = await getAuthorizedMessageIds(convId);

        if (!memoryEnabled || !lifecycle.isAlive()) return;

        // Serialize with the MutationObserver queue for this conversation.
        // This prevents a race where both the observer's initial callback and this function
        // process the same DOM snapshot concurrently, producing duplicate notifyBackgroundCapture calls.
        const captureEpochId = activeObserverEpochId;
        const prevQueue = conversationMutationQueues.get(convId) || Promise.resolve();
        const nextQueue = prevQueue.then(async () => {
            if (!memoryEnabled || !lifecycle.isAlive()) return;
            // Re-check: if epoch changed while waiting in queue, skip this stale recovery.
            if (captureEpochId && activeObserverEpochId !== captureEpochId) return;

            let session = getOrCreateCaptureSession(convId);
            if (captureEpochId && !session.epochId) {
                session.epochId = captureEpochId;
            }
            if (domResult.title && (!session.title || session.title === "ChatGPT conversation")) {
                session.title = domResult.title;
            }

            const unauthorizedKeys = unauthorizedMessageKeysByConv.get(convId);
            const { filteredMessages, hasNewContent } = filterExtractedDomMessages(
                convId,
                domResult.messages,
                session,
                unauthorizedKeys,
                captureEpochId || session.epochId || "unknown-epoch",
                durableAuthorizedIds
            );

            // Also trigger a save when streaming completes (isInProgress: true → false).
            // Without this, the stored assistant record stays isInProgress: true indefinitely.
            const wasStreaming = session.messages.some((m) => m.isInProgress);
            const isNowStreaming = filteredMessages.some((m) => m.isInProgress);
            const streamingCompleted = wasStreaming && !isNowStreaming;

            if (hasNewContent || streamingCompleted) {
                session = mergeCapturedSessions(session, {
                    ...session,
                    messages: filteredMessages,
                    epochId: captureEpochId || session.epochId,
                });
                session.completenessStatus = "partial";
                session.isComplete = false;
                session = recordCheckpoint(session);
                captureSessions.set(convId, session);
                notifyBackgroundCapture(session);

                console.log("[VZ-CAPTURE-DEBUG] Visible conversation history recovered from DOM", {
                    conversationId: convId,
                    totalSessionMessages: session.messages.length,
                    streamingCompleted,
                });
            }
        }).catch((err) => {
            console.warn("[VZ-CAPTURE-DEBUG] DOM history recovery notice", err);
        });
        conversationMutationQueues.set(convId, nextQueue);

        // Await the queued work so callers can await this function.
        await nextQueue;
    } catch (err) {
        console.warn("[VZ-CAPTURE-DEBUG] DOM history recovery notice", err);
    }
}

/**
 * ============================================================
 * PAGE MESSAGE LISTENER
 * ============================================================
 */

function startMessageListener(): void {
    if (isMessageListenerActive) {
        return;
    }

    isMessageListenerActive = true;

    const onWindowMessage = (event: MessageEvent) => {
        if (!lifecycle.isAlive()) {
            console.warn("[VZ-CAPTURE-DEBUG] Capture event rejected because the context is stale", {
                reason: lifecycle.getDisposedReason() || "Context invalidated",
            });
            return;
        }

        /**
         * Only accept messages originating
         * from the ChatGPT page itself.
         */
        if (event.source !== window) {
            return;
        }

        const message =
            event.data as Record<string, unknown> | null;

        if (!message) {
            return;
        }

        if (message["source"] !== "AI_MEMORY") {
            return;
        }

        const messageType = message["type"];

        /**
         * ----------------------------------------------------
         * LIVE CONVERSATION
         * ----------------------------------------------------
         */
        if (messageType === "AI_MEMORY_CHATGPT_CONVERSATION_EVENT") {
            if (!memoryEnabled) {
                console.log(
                    "AI Memory: Memory is OFF — live conversation ignored"
                );
                return;
            }

            const payload = message["payload"] as Record<string, unknown> | undefined;
            if (payload && typeof payload === "object") {
                const eventEpoch = (payload as Record<string, unknown>)["captureEpoch"];
                if (typeof eventEpoch === "string" && typeof document !== "undefined" && document.documentElement) {
                    const currentEpoch = document.documentElement.dataset.vzCaptureEpoch;
                    if (currentEpoch && eventEpoch !== currentEpoch) {
                        console.log("[VZ-CAPTURE-DEBUG] Dropping live event from stale capture epoch", {
                            eventEpoch,
                            currentEpoch,
                        });
                        return;
                    }
                }
            }

            handleLiveConversationEvent(message["payload"]);
            return;
        }

        /**
         * ----------------------------------------------------
         * HISTORICAL MESSAGES
         * ----------------------------------------------------
         */
        if (messageType === "AI_MEMORY_CHATGPT_CONVERSATION_HISTORY") {
            if (!memoryEnabled) {
                console.log("[VZ-CAPTURE-DEBUG] Memory OFF: historical conversation ignored");
                return;
            }
            void handleConversationHistory(message["payload"]);
            return;
        }

        if (messageType === "AI_MEMORY_CHATGPT_MESSAGES_RESPONSE") {
            if (!memoryEnabled) {
                console.log(
                    "AI Memory: Memory is OFF — historical conversation ignored"
                );
                return;
            }

            void handleMessagesResponse(message["payload"]);
        }
    };

    messageEventListener = onWindowMessage;
    window.addEventListener("message", onWindowMessage);

    lifecycle.onTeardown(() => {
        if (messageEventListener) {
            window.removeEventListener("message", messageEventListener);
            messageEventListener = null;
        }
        isMessageListenerActive = false;
    });

    console.log(
        "AI Memory: postMessage listener active"
    );
}

/**
 * ============================================================
 * SINGLE-OBSERVER INVARIANT + LIFECYCLE IPC
 * ============================================================
 *
 * The content script exposes three IPC messages from the Popup:
 *
 *   START_CAPTURE_SESSION  — attach MutationObserver (single-observer invariant)
 *   PRIVACY_CUTOFF_REQUEST — disconnect observer, seal cutoff snapshot, ack
 *   LIFECYCLE_PING         — report observer state without side-effects
 *
 * Invariant: at most one MutationObserver is active at any time.
 * START_CAPTURE_SESSION always disconnects any existing observer BEFORE
 * validating the new epoch and attaching a new observer.
 */

/** Map of conversation ID -> Set of message identifiers that existed in DOM during OFF intervals without authorization. */
export const unauthorizedMessageKeysByConv = new Map<string, Set<string>>();

/** Track conversation IDs whose observation baseline has been established under the currently active observer epoch. */
export const epochBaselinesEstablished = new Set<string>();

/** Tracks (convId:::epochId) pairs whose baseline has successfully scanned a populated (non-empty) DOM. */
export const populatedBaselinesEstablished = new Set<string>();

/** Per-conversation baseline initialization promise to prevent concurrent race conditions during asynchronous storage reads. */
export const baselinePromisesByConv = new Map<string, Promise<void>>();

/** Per-conversation mutation processing queue to serialize DOM processing during baseline loading. */
export const conversationMutationQueues = new Map<string, Promise<void>>();

/**
 * Checks whether a candidate message was observed in the DOM during an unauthorized interval (Memory OFF).
 * Strictest security check: only stable primary ID and sourceMessageId are valid proof.
 * Content-based comparison is NEVER used for authorization.
 */
export function isMessageUnauthorized(
    convId: string,
    msg: { id?: string; sourceMessageId?: string | null; role?: MessageRole; content?: string }
): boolean {
    const unauthorizedKeys = unauthorizedMessageKeysByConv.get(convId);
    if (!unauthorizedKeys || unauthorizedKeys.size === 0) {
        return false;
    }
    if (msg.id && unauthorizedKeys.has(msg.id)) return true;
    if (msg.sourceMessageId && unauthorizedKeys.has(msg.sourceMessageId)) return true;
    return false;
}

/**
 * Establishes the observation baseline for a conversation at the moment an observer attaches
 * or when a conversation is first encountered under an active epoch.
 *
 * Any messages already present in the DOM that are NOT in storage (session.messages) AND NOT
 * in the durable authorizedMessageIds set were created outside authorization (while Memory was
 * OFF or before capture was enabled). They are recorded as unauthorized and must NEVER be
 * admitted into storage or assigned the active epoch.
 *
 * Strictly uses stable identity (primary message ID and sourceMessageId).
 */
export async function recordEpochObservationBaseline(convId: string, epochId: string): Promise<boolean> {
    const existing = captureSessions.get(convId);
    const persistedIds = new Set<string>();

    if (existing && existing.messages) {
        for (const m of existing.messages) {
            if (m.id) persistedIds.add(m.id);
            if (m.sourceMessageId) persistedIds.add(m.sourceMessageId);
        }
    }

    // Stale epoch guard: If a newer epoch has already attached or if this epoch was superseded/disconnected,
    // discard stale asynchronous baseline execution to prevent cross-epoch pollution.
    if (
        (activeObserverEpochId !== null && activeObserverEpochId !== epochId) ||
        (lastDisconnectedEpochId === epochId && activeObserverEpochId !== epochId)
    ) {
        console.warn("[VZ-PRIVACY-GATE] Discarding stale baseline from superseded or disconnected epoch", {
            staleEpochId: epochId,
            currentActiveEpochId: activeObserverEpochId,
            lastDisconnectedEpochId,
            convId,
        });
        return false;
    }

    // Load durable authorized IDs from storage (survives page reload) in a single storage read
    const queryConvIds = (convId !== PROVISIONAL_SESSION_ID && convId !== "new-chat" && convId !== "local-chatgpt")
        ? [convId, PROVISIONAL_SESSION_ID, "new-chat", "local-chatgpt"]
        : [convId];
    const durableAuthorizedIds = await getAuthorizedMessageIds(queryConvIds);

    for (const id of durableAuthorizedIds) {
        persistedIds.add(id);
    }

    // RACE-CONDITION GUARD: Also include any messages already held in the in-memory capture
    // session for this conversation. If the user sends a message right as Memory turns ON and
    // the live-event ingest runs concurrently with baseline establishment, the message may be
    // in the in-memory session but not yet committed to storage. Without this, the baseline
    // would mark it unauthorized because durableAuthorizedIds has not yet been written.
    const inMemorySession = captureSessions.get(convId);
    if (inMemorySession) {
        for (const m of inMemorySession.messages) {
            if (m.id) persistedIds.add(m.id);
            if (m.sourceMessageId) persistedIds.add(m.sourceMessageId);
        }
    }
    // Also check all provisional aliases in case provisional session was not yet promoted
    for (const provisionalId of [PROVISIONAL_SESSION_ID, "new-chat", "local-chatgpt"]) {
        const provSession = captureSessions.get(provisionalId);
        if (provSession) {
            for (const m of provSession.messages) {
                if (m.id) persistedIds.add(m.id);
                if (m.sourceMessageId) persistedIds.add(m.sourceMessageId);
            }
        }
    }

    const domResult = extractVisibleConversationFromDOM();
    const baselineKey = getBaselineKey(convId, epochId);
    if (!domResult || domResult.messages.length === 0) {
        return true;
    }
    populatedBaselinesEstablished.add(baselineKey);

    let unauthorizedKeys = unauthorizedMessageKeysByConv.get(convId);
    if (!unauthorizedKeys) {
        unauthorizedKeys = new Set<string>();
        unauthorizedMessageKeysByConv.set(convId, unauthorizedKeys);
    }

    for (const msg of domResult.messages) {
        const isPersisted =
            (msg.id && persistedIds.has(msg.id)) ||
            (msg.sourceMessageId && persistedIds.has(msg.sourceMessageId));

        if (!isPersisted) {
            if (msg.id) unauthorizedKeys.add(msg.id);
            if (msg.sourceMessageId) unauthorizedKeys.add(msg.sourceMessageId);
            console.log("[VZ-PRIVACY-GATE] Recorded unauthorized OFF-period message baseline", {
                convId,
                epochId,
                role: msg.role,
                contentPreview: msg.content.slice(0, 40),
            });
        }
    }
    return true;
}

/**
 * Scopes baseline tracking to both conversation ID and epoch ID.
 * Guarantees a new epoch never reuses an earlier epoch's baseline.
 */
export function getBaselineKey(convId: string, epochId: string): string {
    return `${convId}:::${epochId}`;
}

/**
 * Checks whether the baseline for a specific (convId, epochId) pair has been established.
 */
export function isConversationBaselineEstablished(convId: string, epochId: string): boolean {
    return epochBaselinesEstablished.has(getBaselineKey(convId, epochId));
}

/**
 * Ensures baseline initialization has completed for a conversation under a specific epoch
 * before any extracted DOM messages are evaluated or admitted. Deduplicates concurrent in-flight requests.
 */
export function ensureConversationBaseline(convId: string, epochId: string): Promise<void> {
    const key = getBaselineKey(convId, epochId);
    if (epochBaselinesEstablished.has(key)) {
        return Promise.resolve();
    }
    let pending = baselinePromisesByConv.get(key);
    if (!pending) {
        pending = recordEpochObservationBaseline(convId, epochId).then((established) => {
            // Only mark established if baseline was successfully recorded for this epoch
            if (established && (
                activeObserverEpochId === epochId ||
                (activeObserverEpochId === null && lastDisconnectedEpochId !== epochId)
            )) {
                epochBaselinesEstablished.add(key);
            } else {
                // Baseline was not established (e.g. empty DOM on page reload before rendering).
                // Allow retry on next mutation by clearing the pending promise.
                baselinePromisesByConv.delete(key);
            }
        });
        baselinePromisesByConv.set(key, pending);
    }
    return pending;
}

export interface DomMessageFilterResult {
    filteredMessages: NormalizedCaptureMessage[];
    hasNewContent: boolean;
}

/**
 * Pure authorization filter: applies strict identity-based authorization rules to extracted DOM turns.
 * 1. Previously persisted messages (matching id or sourceMessageId) retain their original epoch provenance.
 *    This includes messages matched via durableAuthorizedIds from storage (survives page reload).
 * 2. Messages observed in the baseline during an OFF interval are discarded.
 * 3. Newly generated messages created after observer attachment are assigned activeEpochId.
 * No content-matching is permitted for authorization decisions.
 */
export function filterExtractedDomMessages(
    convId: string,
    extractedMessages: Array<{
        id: string;
        role: MessageRole;
        content: string;
        sourceMessageId?: string | null;
        timestamp?: string | null;
        isInProgress?: boolean;
    }>,
    existingSession: CapturedConversation | undefined,
    unauthorizedKeys: Set<string> | undefined,
    activeEpochId: string,
    durableAuthorizedIds?: Set<string>
): DomMessageFilterResult {
    void convId;
    const persistedIds = new Set<string>();
    // Include durable authorized IDs from storage so that messages whose DOM-assigned ID
    // differs from the stored ID (e.g. due to streaming hash change) are still recognized
    // as previously persisted on reload rather than treated as new Epoch B content.
    if (durableAuthorizedIds) {
        for (const id of durableAuthorizedIds) persistedIds.add(id);
    }
    if (existingSession && existingSession.messages) {
        for (const m of existingSession.messages) {
            if (m.id) persistedIds.add(m.id);
            if (m.sourceMessageId) persistedIds.add(m.sourceMessageId);
        }
    }

    const filteredMessages: NormalizedCaptureMessage[] = [];
    let hasNewContent = false;
    let lastUserTurnProvenance: "persisted" | "unauthorized" | "active_epoch" | null = null;

    for (const domMsg of extractedMessages) {
        const isPersisted =
            (domMsg.id && persistedIds.has(domMsg.id)) ||
            (domMsg.sourceMessageId && persistedIds.has(domMsg.sourceMessageId));

        if (isPersisted) {
            // Look up the original message to preserve its epoch provenance and stable identity.
            const orig = existingSession?.messages.find(
                (m) =>
                    m.id === domMsg.id ||
                    (m.sourceMessageId && m.sourceMessageId === domMsg.id) ||
                    (domMsg.sourceMessageId && m.id === domMsg.sourceMessageId) ||
                    (domMsg.sourceMessageId && m.sourceMessageId && m.sourceMessageId === domMsg.sourceMessageId)
            );
            if (domMsg.role === "user") {
                const origEpochId = orig?.epochId;
                if (origEpochId && origEpochId === activeEpochId) {
                    lastUserTurnProvenance = "active_epoch";
                } else {
                    lastUserTurnProvenance = "persisted";
                }
            }
            filteredMessages.push({
                id: orig?.id || domMsg.id,
                sequence: filteredMessages.length + 1,
                role: domMsg.role,
                content: domMsg.content,
                timestamp: domMsg.timestamp ?? orig?.timestamp ?? null,
                sourceMessageId: orig?.sourceMessageId || domMsg.sourceMessageId || domMsg.id,
                isInProgress: Boolean(domMsg.isInProgress),
                epochId: orig?.epochId || null,
            });
            continue;
        }

        const isUnauthorized = unauthorizedKeys
            ? (Boolean(domMsg.id && unauthorizedKeys.has(domMsg.id)) ||
                Boolean(domMsg.sourceMessageId && unauthorizedKeys.has(domMsg.sourceMessageId)))
            : false;

        if (isUnauthorized) {
            if (domMsg.role === "user") {
                lastUserTurnProvenance = "unauthorized";
            }
            console.log("[VZ-PRIVACY-GATE] Discarded unauthorized OFF-period message during DOM mutation", {
                id: domMsg.id,
                role: domMsg.role,
                contentPreview: domMsg.content.slice(0, 40),
            });
            continue;
        }

        // Conversational Pairing Provenance:
        // An assistant response cannot be admitted into activeEpochId unless the user prompt
        // it responds to was also authorized under activeEpochId. If the preceding user prompt
        // occurred during an OFF interval (unauthorized) or belonged to a prior epoch,
        // the assistant response belongs to that interval/epoch and must not be admitted under activeEpochId.
        if (domMsg.role === "assistant" && lastUserTurnProvenance !== "active_epoch") {
            console.log("[VZ-PRIVACY-GATE] Discarded orphaned/OFF-period assistant response without active-epoch user turn", {
                id: domMsg.id,
                role: domMsg.role,
                lastUserTurnProvenance,
                contentPreview: domMsg.content.slice(0, 40),
            });
            if (unauthorizedKeys) {
                if (domMsg.id) unauthorizedKeys.add(domMsg.id);
                if (domMsg.sourceMessageId) unauthorizedKeys.add(domMsg.sourceMessageId);
            }
            continue;
        }

        // Genuine newly generated turn under active epoch
        if (domMsg.role === "user") {
            lastUserTurnProvenance = "active_epoch";
        }
        hasNewContent = true;
        filteredMessages.push({
            id: domMsg.id,
            sequence: filteredMessages.length + 1,
            role: domMsg.role,
            content: domMsg.content,
            timestamp: domMsg.timestamp ?? null,
            sourceMessageId: domMsg.sourceMessageId || domMsg.id,
            isInProgress: Boolean(domMsg.isInProgress),
            epochId: activeEpochId,
        });
    }

    return { filteredMessages, hasNewContent };
}

/** Currently active MutationObserver. null means observer is not attached. */
let activeDOMObserver: MutationObserver | null = null;
/** Epoch ID bound to the currently active observer. */
let activeObserverEpochId: string | null = null;
/** Epoch ID of the most recently disconnected observer (for LIFECYCLE_PING). */
let lastDisconnectedEpochId: string | null = null;

/**
 * Disconnect the active MutationObserver and clear the epoch binding.
 * Safe to call when no observer is active.
 */
function disconnectActiveObserver(reason: string): void {
    if (activeDOMObserver !== null) {
        try {
            activeDOMObserver.disconnect();
        } catch {
            // Tolerate — observer may already be garbage-collected
        }
        console.log("[VZ-LIFECYCLE-CS] Observer disconnected", {
            previousEpochId: activeObserverEpochId,
            reason,
        });
        lastDisconnectedEpochId = activeObserverEpochId;
        activeDOMObserver = null;
        activeObserverEpochId = null;
    }
    epochBaselinesEstablished.clear();
    populatedBaselinesEstablished.clear();
    baselinePromisesByConv.clear();
    conversationMutationQueues.clear();
}

/**
 * Attach a new MutationObserver for the given epoch.
 * Single-Observer Invariant: disconnects any existing observer first.
 * Returns a Promise that resolves to true if the observer was successfully attached.
 * The promise resolves only after the initial baseline has been durably established.
 */
async function attachObserver(epochId: string): Promise<boolean> {
    // Step 1 of invariant: disconnect any existing observer unconditionally
    disconnectActiveObserver("replaced by new epoch " + epochId);

    // Step 2: establish durable baseline for current conversation before attaching observer
    const currentTabMatch = typeof window !== "undefined" && window.location?.pathname
        ? window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)
        : null;
    const currentTabConvId = currentTabMatch ? currentTabMatch[1] : PROVISIONAL_SESSION_ID;

    await ensureConversationBaseline(currentTabConvId, epochId);

    // Step 3: attach new observer
    try {
        const observer = new MutationObserver((_mutations) => {
            if (!memoryEnabled || activeObserverEpochId !== epochId) {
                // Epoch mismatch — stale write guard
                return;
            }

            const currentTabMatch = typeof window !== "undefined" && window.location?.pathname
                ? window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)
                : null;
            const currentTabConvId = currentTabMatch ? currentTabMatch[1] : null;

            if (currentTabConvId && captureSessions.has(PROVISIONAL_SESSION_ID)) {
                promoteProvisionalSession(currentTabConvId);
            }

            const convId = currentTabConvId || PROVISIONAL_SESSION_ID;

            // Enqueue processing for this conversation to prevent race conditions during baseline loading
            const prevQueue = conversationMutationQueues.get(convId) || Promise.resolve();
            const nextQueue = prevQueue.then(async () => {
                if (!memoryEnabled || activeObserverEpochId !== epochId) return;

                // Ensure baseline has been established before evaluating any DOM messages
                await ensureConversationBaseline(convId, epochId);

                if (!memoryEnabled || activeObserverEpochId !== epochId) return;

                const baselineKey = getBaselineKey(convId, epochId);
                if (!populatedBaselinesEstablished.has(baselineKey)) {
                    await recordEpochObservationBaseline(convId, epochId);
                    if (!memoryEnabled || activeObserverEpochId !== epochId) return;
                }

                const extracted = extractVisibleConversationFromDOM();
                if (!extracted || extracted.messages.length === 0) return;

                const targetConvId = extracted.conversationId || currentTabConvId || PROVISIONAL_SESSION_ID;
                if (targetConvId !== convId) {
                    await ensureConversationBaseline(targetConvId, epochId);
                    if (!memoryEnabled || activeObserverEpochId !== epochId) return;

                    const targetBaselineKey = getBaselineKey(targetConvId, epochId);
                    if (!populatedBaselinesEstablished.has(targetBaselineKey)) {
                        await recordEpochObservationBaseline(targetConvId, epochId);
                        if (!memoryEnabled || activeObserverEpochId !== epochId) return;
                    }
                }

                let existing = captureSessions.get(targetConvId);
                if (!existing) {
                    existing = createCaptureSession(
                        "chatgpt",
                        extracted.title || document.title || "ChatGPT conversation",
                        window.location.href,
                        targetConvId
                    );
                    existing.epochId = epochId;
                }

                // Load durable authorized IDs from storage so that previously saved messages
                // whose DOM-assigned ID doesn't match the stored ID are still recognized as
                // persisted rather than admitted as new Epoch content.
                const durableAuthorizedIds = await getAuthorizedMessageIds(targetConvId);

                if (!memoryEnabled || activeObserverEpochId !== epochId) return;

                const unauthorizedKeys = unauthorizedMessageKeysByConv.get(targetConvId);
                const { filteredMessages, hasNewContent } = filterExtractedDomMessages(
                    targetConvId,
                    extracted.messages,
                    existing,
                    unauthorizedKeys,
                    epochId,
                    durableAuthorizedIds
                );

                if (filteredMessages.length === 0) return;

                const isNowStreaming = filteredMessages.some((m) => m.isInProgress);
                // Detect streaming-completion transition: an existing in-progress message has now finished.
                // Even if hasNewContent is false, we must persist the completed state.
                const wasStreaming = existing.messages.some((m) => m.isInProgress);
                const streamingCompleted = wasStreaming && !isNowStreaming;

                if (!hasNewContent && !isNowStreaming && !streamingCompleted && filteredMessages.length <= existing.messages.length) {
                    return;
                }

                const merged = mergeCapturedSessions(existing, {
                    ...existing,
                    messages: filteredMessages,
                    epochId,
                });
                merged.epochId = epochId;
                captureSessions.set(targetConvId, merged);
                notifyBackgroundCapture(merged);
            }).catch((err) => {
                console.warn("[VZ-CAPTURE-DEBUG] Error processing DOM mutation queue", err);
            });

            conversationMutationQueues.set(convId, nextQueue);
        });

        const rootNode = (typeof document !== "undefined" && (document.documentElement || document.body)) || null;
        if (!rootNode) {
            console.warn("[VZ-LIFECYCLE-CS] Neither documentElement nor body available to observe");
            return false;
        }

        observer.observe(rootNode, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: false,
        });

        activeDOMObserver = observer;
        activeObserverEpochId = epochId;
        console.log("[VZ-LIFECYCLE-CS] Observer attached", { epochId });
        return true;
    } catch (err) {
        console.error("[VZ-LIFECYCLE-CS] Failed to attach MutationObserver", err);
        activeDOMObserver = null;
        activeObserverEpochId = null;
        return false;
    }
}

/**
 * Result of sealing a cutoff snapshot.
 */
interface SealCutoffResult {
    success: boolean;
    error?: string;
    sealedSession?: CapturedConversation | null;
}

/**
 * Seal a cutoff snapshot for the given epoch.
 * Propagates persistence success or failure.
 */
async function sealCutoffSnapshot(
    epochId: string
): Promise<SealCutoffResult> {
    // Find active session for this epoch
    for (const [, session] of captureSessions.entries()) {
        if (session.epochId === epochId && session.state === "response_in_progress") {
            const cut = interruptStream(session, PRIVACY_CUTOFF_SENTINEL);
            cut.epochId = epochId;
            captureSessions.set(session.id, cut);
            const saveResult = await saveActiveCaptureSession(cut);
            if (!saveResult.success) {
                console.warn("[VZ-LIFECYCLE-CS] Cutoff snapshot save failed", {
                    epochId,
                    conversationId: session.id,
                    error: saveResult.error,
                });
                return {
                    success: false,
                    error: saveResult.error || "Cutoff snapshot persistence failed",
                };
            }
            return { success: true, sealedSession: cut };
        }
    }
    // No in-progress session — observer already disconnected, nothing to seal
    return { success: true, sealedSession: null };
}

/**
 * Register the chrome.runtime.onMessage lifecycle IPC handler.
 * Must be called once during content-script initialization.
 */
function registerLifecycleIPCHandler(): void {
    try {
        chrome.runtime.onMessage.addListener(
            (message: unknown, _sender, sendResponse): boolean => {
                if (!message || typeof message !== "object") {
                    return false;
                }

                const msg = message as Record<string, unknown>;

                // ── START_CAPTURE_SESSION ──────────────────────────────────
                if (msg.type === "START_CAPTURE_SESSION") {
                    const epochId = typeof msg.epochId === "string" ? msg.epochId : null;
                    if (!epochId) {
                        sendResponse({ success: false, error: "Missing epochId" });
                        return true;
                    }

                    // Verify storage authorization BEFORE attaching observer
                    chrome.storage.local
                        .get(["memoryEnabled", ACTIVE_EPOCH_KEY])
                        .then((result) => {
                            if (result.memoryEnabled !== true) {
                                sendResponse({
                                    success: false,
                                    error: "memoryEnabled is not strictly true — storage authorization rejected",
                                });
                                return;
                            }
                            if (result[ACTIVE_EPOCH_KEY] !== epochId) {
                                sendResponse({
                                    success: false,
                                    error: "Epoch mismatch: storage activeEpoch does not match requested epoch",
                                });
                                return;
                            }

                            // Ensure storage is fully hydrated before attaching observer and establishing baseline
                            ensureStorageHydrated()
                                .then(() => {
                                    // Single-Observer Invariant: disconnects existing observer inside attachObserver()
                                    // attachObserver is async (establishes durable baseline from storage)
                                    attachObserver(epochId)
                                        .then((attached) => {
                                            if (!attached) {
                                                sendResponse({
                                                    success: false,
                                                    error: "Failed to attach MutationObserver",
                                                });
                                                return;
                                            }

                                            memoryEnabled = true;
                                            syncCaptureStateToDOM(true);
                                            sendResponse({ success: true, epochId });
                                        })
                                        .catch((err) => {
                                            sendResponse({ success: false, error: String(err) });
                                        });
                                })
                                .catch((err) => {
                                    sendResponse({ success: false, error: String(err) });
                                });
                        })
                        .catch((err) => {
                            sendResponse({ success: false, error: String(err) });
                        });

                    return true; // async response
                }

                // ── PRIVACY_CUTOFF_REQUEST ─────────────────────────────────
                if (msg.type === "PRIVACY_CUTOFF_REQUEST") {
                    const epochId = typeof msg.epochId === "string" ? msg.epochId : null;
                    if (!epochId) {
                        sendResponse({ success: false, error: "Missing epochId" });
                        return true;
                    }

                    // Step 1: Revoke memoryEnabled immediately
                    memoryEnabled = false;
                    syncCaptureStateToDOM(false);

                    // Step 2: Verify epoch matches active observer
                    if (activeObserverEpochId !== epochId) {
                        console.warn("[VZ-LIFECYCLE-CS] PRIVACY_CUTOFF_REQUEST epoch mismatch", {
                            expected: epochId,
                            actual: activeObserverEpochId,
                        });
                        // Still disconnect whatever observer is active (defence-in-depth)
                        disconnectActiveObserver("cutoff epoch mismatch");
                        sendResponse({ success: false, error: "Observer epoch mismatch" });
                        return true;
                    }

                    // Step 3: Disconnect the observer (confirmed disconnection)
                    disconnectActiveObserver("PRIVACY_CUTOFF_REQUEST");

                    // Step 4: Seal cutoff snapshot and verify persistence before acknowledging
                    sealCutoffSnapshot(epochId)
                        .then((result) => {
                            if (!result.success) {
                                console.warn("[VZ-LIFECYCLE-CS] Cutoff persistence unverified — sending failure ack", {
                                    epochId,
                                    error: result.error,
                                });
                                sendResponse({ success: false, error: result.error || "Cutoff persistence unverified" });
                            } else {
                                sendResponse({ success: true });
                            }
                        })
                        .catch((err) => {
                            console.error("[VZ-LIFECYCLE-CS] sealCutoffSnapshot threw", err);
                            sendResponse({ success: false, error: String(err) });
                        });

                    return true; // async response
                }

                // ── LIFECYCLE_PING ─────────────────────────────────────────
                if (msg.type === "LIFECYCLE_PING") {
                    const response: LifecyclePingResponse = {
                        alive: true,
                        observerAttached: activeDOMObserver !== null,
                        state: activeDOMObserver !== null ? "capturing" : "idle",
                        epochId: activeObserverEpochId,
                        lastDisconnectedEpochId,
                    };
                    sendResponse(response);
                    return true;
                }

                return false; // Not handled
            }
        );
    } catch (err) {
        console.error("[VZ-LIFECYCLE-CS] Failed to register IPC handler", err);
    }
}

/**
 * ============================================================
 * OBSERVER RELOAD RECOVERY
 * ============================================================
 *
 * Reattaches the MutationObserver after a page reload when memoryEnabled
 * is already true and a valid active epoch exists in storage.
 *
 * This fixes the confirmed reload defect where the content script is
 * re-injected but no START_CAPTURE_SESSION IPC arrives from the popup.
 */

async function reattachObserverAfterReload(): Promise<void> {
    if (!memoryEnabled || !lifecycle.isAlive()) {
        return;
    }

    // An observer may already be attached from a concurrent path (e.g. popup startup)
    if (activeDOMObserver !== null) {
        console.log("[VZ-LIFECYCLE-CS] Observer already attached on startup — skipping reload reattachment", {
            epochId: activeObserverEpochId,
        });
        return;
    }

    try {
        const result = await chrome.storage.local.get([
            "memoryEnabled",
            ACTIVE_EPOCH_KEY,
            "epochRegistry",
        ]);

        // Re-validate memoryEnabled from storage (fail closed)
        if (result.memoryEnabled !== true) {
            console.log("[VZ-LIFECYCLE-CS] Reload reattachment: memoryEnabled not strictly true in storage — skipping");
            return;
        }

        const storedEpochId = typeof result[ACTIVE_EPOCH_KEY] === "string"
            ? result[ACTIVE_EPOCH_KEY] as string
            : null;

        if (!storedEpochId) {
            console.log("[VZ-LIFECYCLE-CS] Reload reattachment: no active epoch in storage — skipping");
            return;
        }

        // Validate epoch against the epoch registry
        const rawRegistry = result["epochRegistry"];
        if (!rawRegistry || typeof rawRegistry !== "object" || Array.isArray(rawRegistry)) {
            console.log("[VZ-LIFECYCLE-CS] Reload reattachment: missing or invalid epoch registry — skipping");
            return;
        }

        const registry = rawRegistry as Record<string, unknown>;
        const rec = registry[storedEpochId];
        if (
            !rec ||
            typeof rec !== "object" ||
            (rec as Record<string, unknown>)["status"] !== "active" ||
            (rec as Record<string, unknown>)["closedAt"] !== null ||
            (rec as Record<string, unknown>)["invalidatedAt"] !== null
        ) {
            console.log("[VZ-LIFECYCLE-CS] Reload reattachment: epoch not active or already closed/invalidated — skipping", {
                epochId: storedEpochId,
                record: rec,
            });
            return;
        }

        // Idempotent: do not attach if already attached to this epoch
        if (activeObserverEpochId === storedEpochId && activeDOMObserver !== null) {
            console.log("[VZ-LIFECYCLE-CS] Reload reattachment: observer already attached for epoch — idempotent skip", {
                epochId: storedEpochId,
            });
            return;
        }

        await ensureStorageHydrated();

        // Reattach exactly one observer for the authorized epoch
        const attached = await attachObserver(storedEpochId);
        if (attached) {
            console.log("[VZ-LIFECYCLE-CS] Observer reattached after page reload", {
                epochId: storedEpochId,
            });
            syncCaptureStateToDOM(true);
        } else {
            console.warn("[VZ-LIFECYCLE-CS] Reload reattachment: attachObserver returned false");
        }
    } catch (err) {
        if (isExtensionContextInvalidatedError(err)) {
            lifecycle.dispose("reattachObserverAfterReload encountered invalidated context");
        } else {
            console.warn("[VZ-LIFECYCLE-CS] Reload reattachment error (non-fatal)", err);
        }
    }
}

/**
 * ============================================================
 * MAIN
 * ============================================================
 */

async function main(): Promise<void> {
    console.log("[VZ-CAPTURE-DEBUG] New content-script initialization", {
        lifecycleId: lifecycle.lifecycleId,
        url: window.location.href,
    });

    // Notify any previously loaded content script instance in this tab to retire
    try {
        window.dispatchEvent(
            new CustomEvent(CONTENT_SCRIPT_REINIT_EVENT, {
                detail: { lifecycleId: lifecycle.lifecycleId },
            })
        );
    } catch {
        // Ignored
    }

    // Retire this instance if a newer generation initializes
    const onReinit = (event: Event) => {
        const customEvent = event as CustomEvent<{ lifecycleId?: string }>;
        if (
            customEvent.detail &&
            customEvent.detail.lifecycleId !== lifecycle.lifecycleId
        ) {
            lifecycle.dispose("Replaced by newer content script instance");
        }
    };

    window.addEventListener(CONTENT_SCRIPT_REINIT_EVENT, onReinit);
    lifecycle.onTeardown(() => {
        window.removeEventListener(CONTENT_SCRIPT_REINIT_EVENT, onReinit);
    });

    /**
     * Fail closed: initialize capture state as inactive in DOM root before storage is read.
     */
    syncCaptureStateToDOM(false);

    /**
     * Load Memory state BEFORE starting capture.
     */
    await loadMemoryState();

    /**
     * Synchronize loaded memory state to DOM root.
     */
    syncCaptureStateToDOM(memoryEnabled);

    /**
     * Hydrate active capture sessions from storage.
     */
    await ensureStorageHydrated();

    /**
     * Recover any unpersisted sessions preserved in DOM sessionStorage.
     */
    const recovered = recoverPendingSessionsFromDOM();
    if (recovered.length > 0) {
        for (const rec of recovered) {
            console.log("[VZ-CAPTURE-DEBUG] Recovered preserved session from pending cache", {
                conversationId: rec.id,
                messageCount: rec.messages.length,
            });
            captureSessions.set(rec.id, rec);
            notifyBackgroundCapture(rec);
        }
    }

    /**
     * Watch future ON/OFF changes.
     */
    startMemoryStateListener();

    /**
     * Register lifecycle IPC handler (START_CAPTURE_SESSION, PRIVACY_CUTOFF_REQUEST, LIFECYCLE_PING).
     * Must be done before any user interaction can arrive.
     */
    registerLifecycleIPCHandler();

    /**
     * Inject page-context interceptor.
     * REMOVED: Part A of Milestone 1 — unsafe page-script injection removed.
     */
    // injectPageScript() — removed

    /**
     * Start message listener.
     */
    startMessageListener();

    if (!memoryEnabled) {
        console.log(
            "AI Memory: Memory is OFF — conversation capture disabled"
        );
        return;
    }

    console.log(
        "AI Memory: Memory is ON — capture enabled"
    );

    /**
     * Phase 1 currently supports ChatGPT.
     */
    if (
        window.location.hostname !== "chatgpt.com"
    ) {
        return;
    }

    console.log(
        "AI Memory detected ChatGPT"
    );

    /**
     * Check whether this is a conversation page.
     */
    const isConversation =
        detectConversationPage();

    if (!isConversation) {
        console.log(
            "AI Memory: Not a ChatGPT conversation page"
        );
        return;
    }

    console.log(
        "AI Memory detected a ChatGPT conversation page"
    );

    console.log(
        "AI Memory: Capture layer active — waiting for ChatGPT activity..."
    );

    /**
     * ── OBSERVER RELOAD RECOVERY ──────────────────────────────────────────────
     *
     * When ChatGPT reloads while memoryEnabled === true, the content script is
     * re-injected but no MutationObserver is attached (it normally requires a
     * START_CAPTURE_SESSION IPC from the popup).
     *
     * Fix: on startup, if memoryEnabled is already true AND an active epoch
     * exists in storage, reattach the observer for that epoch.
     *
     * Invariants preserved:
     *  1. Re-reads memoryEnabled from storage (already done via loadMemoryState).
     *  2. Validates the epoch from ACTIVE_EPOCH_KEY against the epoch registry.
     *  3. Reattaches exactly one observer (attachObserver disconnects any previous).
     *  4. Does NOT create a new epoch — only uses the existing one.
     *  5. Does NOT reattach if memoryEnabled is false or no valid epoch exists.
     */
    await reattachObserverAfterReload();

    // Initial recovery for visible DOM messages in existing conversation tabs
    await recoverVisibleConversationHistoryFromDOM();

    if (typeof document !== "undefined" && document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            recoverVisibleConversationHistoryFromDOM();
        }, { once: true });
    }

    // Listen for client-side navigation (popstate / route changes)
    const onRouteChanged = () => {
        storageHydrationPromise = null;
        void ensureStorageHydrated().then(() => {
            const currentTabMatch = typeof window !== "undefined" && window.location?.pathname
                ? window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)
                : null;
            const currentTabConvId = currentTabMatch ? currentTabMatch[1] : null;

            if (currentTabConvId && captureSessions.has(PROVISIONAL_SESSION_ID)) {
                promoteProvisionalSession(currentTabConvId);
            }

            recoverVisibleConversationHistoryFromDOM();
        });
    };
    window.addEventListener("popstate", onRouteChanged);
    lifecycle.onTeardown(() => {
        window.removeEventListener("popstate", onRouteChanged);
    });

    let lastObservedUrl = typeof window !== "undefined" ? window.location.href : "";
    const routeObserver = setInterval(() => {
        if (!lifecycle.isAlive()) {
            clearInterval(routeObserver);
            return;
        }
        if (typeof window !== "undefined" && window.location.href !== lastObservedUrl) {
            lastObservedUrl = window.location.href;
            onRouteChanged();
        }
    }, 800);
    lifecycle.onTeardown(() => {
        clearInterval(routeObserver);
    });

    const onBeforeUnload = () => {
        if (!lifecycle.isAlive()) return;
        for (const [id, s] of captureSessions.entries()) {
            if (s.state === "response_in_progress") {
                const interrupted = interruptStream(
                    s,
                    "Page reloaded or navigated during response stream."
                );
                captureSessions.set(id, interrupted);
                void saveActiveCaptureSession(interrupted);
            }
        }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    lifecycle.onTeardown(() => {
        window.removeEventListener("beforeunload", onBeforeUnload);
    });
}

if (typeof window !== "undefined" && typeof document !== "undefined" && window.location?.hostname === "chatgpt.com") {
    void main();
}
