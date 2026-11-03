import { detectConversationPage } from "./conversationDetector";
// pageScriptInjector removed — Part A of Milestone 1 (safe capture refactor)

import {
    addConversationPage,
    addConversationMessages,
    getAccumulatedMessageCount,
} from "../connectors/conversationAccumulator";

import type {
    Conversation,
    ConversationMessage,
} from "../connectors/types";

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
} from "../continuity/captureLifecycle";
import type { MessageRole } from "../continuity/archiveSchema";

import {
    type CapturedConversation,
    type LifecyclePingResponse,
    PRIVACY_CUTOFF_SENTINEL,
} from "../continuity/captureTypes";
import {
    saveActiveCaptureSession,
    getActiveCaptureSession,
    getConversations,
    ACTIVE_EPOCH_KEY,
} from "../storage/conversationStorage";
import {
    ContentScriptLifecycle,
    isExtensionContextInvalidatedError,
    preservePendingSessionInDOM,
    recoverPendingSessionsFromDOM,
    CONTENT_SCRIPT_REINIT_EVENT,
} from "../continuity/contentScriptLifecycle";
import { extractVisibleConversationFromDOM } from "../connectors/domConversationExtractor";

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

const captureSessions =
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
        captureSessions.set(conversationId, session);
    } else {
        session.url = window.location.href;
        if (document.title && document.title !== "ChatGPT" && (!session.title || session.title === "ChatGPT conversation")) {
            session.title = document.title;
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
        messages: session.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp ?? undefined,
            sourceMessageId: m.sourceMessageId ?? undefined,
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
function promoteProvisionalSession(newConvId: string): CapturedConversation | null {
    if (!newConvId || newConvId === PROVISIONAL_SESSION_ID || newConvId === "new-chat") {
        return null;
    }

    const provisional =
        captureSessions.get(PROVISIONAL_SESSION_ID) ||
        captureSessions.get("new-chat");

    if (!provisional) {
        return null;
    }

    captureSessions.delete(PROVISIONAL_SESSION_ID);
    captureSessions.delete("new-chat");

    let targetSession = captureSessions.get(newConvId);
    if (!targetSession) {
        targetSession = createCaptureSession(
            "chatgpt",
            document.title && document.title !== "ChatGPT" ? document.title : provisional.title || "ChatGPT conversation",
            window.location.href,
            newConvId
        );
    }

    // Merge provisional messages into target session maintaining chronological order and stable IDs
    for (const msg of provisional.messages) {
        targetSession = ingestMessage(targetSession, {
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            sourceMessageId: msg.sourceMessageId || msg.id,
        });
    }

    // Defect A Fix: Migrate assistant message ID mapping from provisional keys to newConvId
    const provAssistantId =
        activeAssistantMessageIds.get(PROVISIONAL_SESSION_ID) ||
        activeAssistantMessageIds.get("new-chat");
    if (provAssistantId) {
        activeAssistantMessageIds.set(newConvId, provAssistantId);
        activeAssistantMessageIds.delete(PROVISIONAL_SESSION_ID);
        activeAssistantMessageIds.delete("new-chat");
        console.log(`[VZ-CAPTURE-DEBUG] Migrated active assistant message ID ${provAssistantId} to ${newConvId}`);
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
        ((data as Record<string, unknown>)?.[ "conversation_id" ] as string) ||
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

function recoverVisibleConversationHistoryFromDOM(): void {
    if (!memoryEnabled || !lifecycle.isAlive()) {
        return;
    }

    try {
        const domResult = extractVisibleConversationFromDOM(document);
        if (domResult.messages.length === 0) {
            return;
        }

        const convId =
            domResult.conversationId ||
            (typeof window !== "undefined" && window.location?.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)?.[1]);

        if (!convId) {
            return;
        }

        let session = getOrCreateCaptureSession(convId);
        if (domResult.title && (!session.title || session.title === "ChatGPT conversation")) {
            session.title = domResult.title;
        }

        const eligibilityContext: CaptureEligibilityContext = {
            isCaptureCurrentlyEnabled: memoryEnabled,
            intervals: captureEligibilityIntervals,
            persistedMessageIds: new Set(session.messages.map((m) => m.id)),
        };

        let newMessagesAdded = 0;
        for (const domMsg of domResult.messages) {
            if (!isMessageEligibleForCapture(domMsg, eligibilityContext)) {
                console.log("[VZ-CAPTURE-DEBUG] DOM message excluded by privacy boundary", {
                    id: domMsg.id,
                    timestamp: domMsg.timestamp,
                });
                continue;
            }

            const alreadyExists = session.messages.some(
                (m) =>
                    m.id === domMsg.id ||
                    (m.sourceMessageId && m.sourceMessageId === domMsg.id) ||
                    (m.role === domMsg.role && m.content.trim() === domMsg.content.trim())
            );

            if (!alreadyExists) {
                session = ingestMessage(session, {
                    id: domMsg.id,
                    role: domMsg.role,
                    content: domMsg.content,
                    timestamp: domMsg.timestamp,
                    sourceMessageId: domMsg.sourceMessageId || domMsg.id,
                });
                newMessagesAdded++;
            }
        }

        if (newMessagesAdded > 0) {
            session.completenessStatus = "partial";
            session.isComplete = false;
            session = recordCheckpoint(session);
            captureSessions.set(convId, session);
            notifyBackgroundCapture(session);

            console.log("[VZ-CAPTURE-DEBUG] Visible conversation history recovered from DOM", {
                conversationId: convId,
                newMessagesAdded,
                totalSessionMessages: session.messages.length,
            });
        }
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
}

/**
 * Attach a new MutationObserver for the given epoch.
 * Single-Observer Invariant: disconnects any existing observer first.
 * Returns true if the observer was successfully attached.
 */
function attachObserver(epochId: string): boolean {
    // Step 1 of invariant: disconnect any existing observer unconditionally
    disconnectActiveObserver("replaced by new epoch " + epochId);

    // Step 2: attach new observer
    try {
        const observer = new MutationObserver((_mutations) => {
            if (!memoryEnabled || activeObserverEpochId !== epochId) {
                // Epoch mismatch — stale write guard
                return;
            }
            // DOM mutation handling — re-scan visible conversation
            const extracted = extractVisibleConversationFromDOM();
            if (extracted && extracted.messages.length > 0) {
                const convId = extracted.conversationId || PROVISIONAL_SESSION_ID;
                let existing = captureSessions.get(convId);
                if (!existing) {
                    existing = createCaptureSession(
                        "chatgpt",
                        extracted.title || document.title || "ChatGPT conversation",
                        window.location.href,
                        convId
                    );
                }
                const merged = mergeCapturedSessions(existing, {
                    ...existing,
                    messages: extracted.messages,
                    epochId,
                });
                captureSessions.set(convId, merged);
                notifyBackgroundCapture(merged);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: false,
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

                            // Single-Observer Invariant: disconnects existing observer inside attachObserver()
                            const attached = attachObserver(epochId);
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

        // Reattach exactly one observer for the authorized epoch
        const attached = attachObserver(storedEpochId);
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
    recoverVisibleConversationHistoryFromDOM();

    // Listen for client-side navigation (popstate / route changes)
    const onRouteChanged = () => {
        storageHydrationPromise = null;
        void ensureStorageHydrated().then(() => {
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

void main();
