import { detectConversationPage } from "./conversationDetector";
import { injectPageScript } from "../connectors/pageScriptInjector";

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
    startAssistantStream,
    appendAssistantChunk,
    completeAssistantStream,
    interruptStream,
    recordCheckpoint,
    completeCapture,
} from "../continuity/captureLifecycle";

import type { CapturedConversation } from "../continuity/captureTypes";
import { saveActiveCaptureSession } from "../storage/conversationStorage";

/**
 * ============================================================
 * MESSAGE LISTENER STATE
 * ============================================================
 */

let isMessageListenerActive = false;

/**
 * ============================================================
 * MEMORY STATE
 * ============================================================
 */

let memoryEnabled = false;

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
            if (chrome.runtime.lastError) {
                // Safe ignore disconnected ports
            }
        });
    } catch {
        // Extension context might be invalidated
    }

    void saveActiveCaptureSession(session);
}

/**
 * ============================================================
 * LOAD MEMORY STATE
 * ============================================================
 */

async function loadMemoryState(): Promise<void> {

    try {

        const result =
            await chrome.storage.local.get(
                "memoryEnabled"
            );

        memoryEnabled =
            result.memoryEnabled === true;

    } catch (error) {

        console.error(
            "AI Memory: Failed to load memory state",
            error
        );

        memoryEnabled = false;
    }
}

/**
 * ============================================================
 * WATCH MEMORY STATE CHANGES
 * ============================================================
 */

function startMemoryStateListener(): void {

    chrome.storage.onChanged.addListener(
        (
            changes,
            areaName
        ) => {

            if (
                areaName !== "local"
            ) {
                return;
            }

            const change =
                changes["memoryEnabled"];

            if (!change) {
                return;
            }

            memoryEnabled =
                change.newValue === true;

            console.log(
                "AI Memory: Memory state changed",
                {
                    enabled:
                        memoryEnabled,
                }
            );

            /**
             * If Memory is turned OFF, stop the
             * current live capture.
             */

            if (!memoryEnabled) {

                activeAssistantMessageIds.clear();

                liveAssistantMessages.clear();

                console.log(
                    "AI Memory: Live capture state cleared because Memory is OFF"
                );
            }
        }
    );
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
    rawMessage: unknown
): ConversationMessage | null {

    if (
        !rawMessage ||
        typeof rawMessage !== "object"
    ) {
        return null;
    }

    const raw =
        rawMessage as Record<string, unknown>;

    const id =
        raw["id"];

    if (
        typeof id !== "string"
    ) {
        return null;
    }

    const author =
        raw["author"] as
        Record<string, unknown> | undefined;

    const role =
        author?.["role"];

    if (
        role !== "user" &&
        role !== "assistant"
    ) {
        return null;
    }

    const content =
        raw["content"] as
        Record<string, unknown> | undefined;

    const parts =
        content?.["parts"];

    if (!Array.isArray(parts)) {
        return null;
    }

    const text =
        parts
            .filter(
                (
                    part
                ): part is string =>
                    typeof part === "string"
            )
            .join("\n");

    if (!text || text.trim().length === 0) {
        return null;
    }

    const createTime =
        raw["create_time"];

    return {
        id,

        role,

        content: text,

        timestamp:
            typeof createTime === "number"
                ? new Date(
                    createTime * 1000
                ).toISOString()
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

    return null;
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

    const conversationId =
        getConversationIdFromLiveEvent(
            data,
            fallbackConversationId
        );

    if (!conversationId) {
        return;
    }

    const rawInputMessage =
        data["input_message"];

    const message =
        normalizeMessage(
            rawInputMessage
        );

    if (!message) {

        console.warn(
            "AI Memory: Unable to normalize live user message",
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

    const inputSession = getOrCreateCaptureSession(conversationId);
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
        "AI Memory: Live user message captured",
        {
            conversationId,

            messageId:
                message.id,

            content:
                message.content,
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

    const conversationId =
        getConversationIdFromLiveEvent(
            data,
            fallbackConversationId
        );

    if (!conversationId) {
        return;
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
    void saveActiveCaptureSession(updatedAsstSession);

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

    const assistantMessageId =
        activeAssistantMessageIds.get(
            conversationId
        );

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

    const conversationId =
        getConversationIdFromLiveEvent(
            data,
            fallbackConversationId
        );

    if (!conversationId) {

        console.warn(
            "AI Memory: Stream completed without conversation ID"
        );

        return;
    }

    const assistantMessageId =
        activeAssistantMessageIds.get(
            conversationId
        );

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

    const completedSession = captureSessions.get(conversationId);
    if (completedSession) {
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
        void saveActiveCaptureSession(updated);
    }
}

/**
 * ============================================================
 * LIVE CONVERSATION EVENT ROUTER
 * ============================================================
 */

function handleLiveConversationEvent(
    eventPayload: unknown
): void {

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

    const eventName =
        payload["event"];

    if (
        eventName !== "delta"
    ) {
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
 * HISTORICAL /messages RESPONSE
 * ============================================================
 */

async function handleMessagesResponse(
    payload: unknown
): Promise<void> {

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
            .map(normalizeMessage)
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
    let currentHist = histSession;
    for (const msg of messages) {
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
 * PAGE MESSAGE LISTENER
 * ============================================================
 */

function startMessageListener(): void {

    if (
        isMessageListenerActive
    ) {
        return;
    }

    isMessageListenerActive = true;

    window.addEventListener(
        "message",
        (
            event: MessageEvent
        ) => {

            /**
             * Only accept messages originating
             * from the ChatGPT page itself.
             */

            if (
                event.source !== window
            ) {
                return;
            }

            const message =
                event.data as
                Record<string, unknown> | null;

            if (!message) {
                return;
            }

            if (
                message["source"] !==
                "AI_MEMORY"
            ) {
                return;
            }

            const messageType =
                message["type"];

            /**
             * ----------------------------------------------------
             * LIVE CONVERSATION
             * ----------------------------------------------------
             */

            if (
                messageType ===
                "AI_MEMORY_CHATGPT_CONVERSATION_EVENT"
            ) {

                if (!memoryEnabled) {

                    console.log(
                        "AI Memory: Memory is OFF — live conversation ignored"
                    );

                    return;
                }

                /**
                 * Keep processing synchronous.
                 */
                handleLiveConversationEvent(
                    message["payload"]
                );

                return;
            }

            /**
             * ----------------------------------------------------
             * HISTORICAL MESSAGES
             * ----------------------------------------------------
             */

            if (
                messageType ===
                "AI_MEMORY_CHATGPT_MESSAGES_RESPONSE"
            ) {

                if (!memoryEnabled) {

                    console.log(
                        "AI Memory: Memory is OFF — historical conversation ignored"
                    );

                    return;
                }

                void handleMessagesResponse(
                    message["payload"]
                );
            }
        }
    );

    console.log(
        "AI Memory: postMessage listener active"
    );
}

/**
 * ============================================================
 * MAIN
 * ============================================================
 */

async function main(): Promise<void> {

    console.log(
        "AI Memory content script loaded"
    );

    /**
     * Load Memory state BEFORE starting capture.
     */

    await loadMemoryState();

    /**
     * Watch future ON/OFF changes.
     */

    startMemoryStateListener();

    /**
     * Inject page-context interceptor.
     */

    injectPageScript();

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
        window.location.hostname !==
        "chatgpt.com"
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

    window.addEventListener("beforeunload", () => {
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
    });
}

void main();