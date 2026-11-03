/**
 * chatgptFetchInterceptor.ts
 *
 * PAGE-CONTEXT SCRIPT
 *
 * Intercepts ChatGPT's own fetch requests without supplying,
 * reading, logging, or storing authentication credentials.
 *
 * Handles:
 *
 * 1. GET /backend-api/conversation/{id}
 *    -> Existing conversation history recovery (mapping DAG)
 *
 * 2. GET /backend-api/conversations/{id}/messages
 *    -> Existing conversation/history pagination
 *
 * 3. POST /backend-api/f/conversation & POST /backend-api/conversation
 *    -> Live conversation streaming
 *
 * The original Response is ALWAYS returned unchanged to ChatGPT.
 */

/**
 * Pure extraction logic for outgoing ChatGPT /conversation requests.
 * Extracts user messages, tracks deduplication against already-emitted IDs,
 * supports multiple payload shapes (messages array, message object, prompt, input),
 * supports rich multimodal text parts, and preserves chronological ordering.
 */
export function extractMessagesFromFetchPayload(
    reqPayload: unknown,
    emittedMessageIds?: Set<string>
): {
    messagesToEmit: Record<string, unknown>[];
    conversationId: string | null;
    diagnosticReason?: string;
} {
    if (!reqPayload || typeof reqPayload !== "object" || Array.isArray(reqPayload)) {
        return {
            messagesToEmit: [],
            conversationId: null,
            diagnosticReason: "Request payload was empty, invalid, or non-object",
        };
    }

    const payload = reqPayload as Record<string, unknown>;
    const conversationId =
        typeof payload["conversation_id"] === "string" && payload["conversation_id"].length > 0
            ? payload["conversation_id"]
            : typeof payload["conversationId"] === "string" && payload["conversationId"].length > 0
            ? payload["conversationId"]
            : null;

    const rawCandidates: Record<string, unknown>[] = [];

    // Form 1: Array of messages (standard ChatGPT request body)
    if (Array.isArray(payload["messages"])) {
        for (const rawMsg of payload["messages"]) {
            if (rawMsg && typeof rawMsg === "object" && !Array.isArray(rawMsg)) {
                rawCandidates.push(rawMsg as Record<string, unknown>);
            }
        }
    } else if (payload["message"] && typeof payload["message"] === "object" && !Array.isArray(payload["message"])) {
        // Form 2: Singular message object
        rawCandidates.push(payload["message"] as Record<string, unknown>);
    } else if (typeof payload["prompt"] === "string" && payload["prompt"].trim().length > 0) {
        // Form 3: Prompt string
        rawCandidates.push({
            id: `prompt-${Date.now()}`,
            author: { role: "user" },
            role: "user",
            content: { content_type: "text", parts: [payload["prompt"]] },
        });
    } else if (typeof payload["input"] === "string" && payload["input"].trim().length > 0) {
        // Form 4: Input string
        rawCandidates.push({
            id: `input-${Date.now()}`,
            author: { role: "user" },
            role: "user",
            content: { content_type: "text", parts: [payload["input"]] },
        });
    }

    if (rawCandidates.length === 0) {
        return {
            messagesToEmit: [],
            conversationId,
            diagnosticReason: "No recognized message fields (messages, message, prompt, input) found in payload",
        };
    }

    const messagesToEmit: Record<string, unknown>[] = [];
    for (let idx = 0; idx < rawCandidates.length; idx++) {
        const msgObj = { ...rawCandidates[idx] };

        // Ensure role defaults to "user" for outgoing request payloads if not specified
        const author = msgObj["author"] as Record<string, unknown> | undefined;
        if (!author && !msgObj["role"]) {
            msgObj["author"] = { role: "user" };
            msgObj["role"] = "user";
        } else if (author && !author["role"] && !msgObj["role"]) {
            author["role"] = "user";
            msgObj["role"] = "user";
        } else if (!author && msgObj["role"]) {
            msgObj["author"] = { role: msgObj["role"] };
        }

        // Normalize text content if needed to ensure valid string extraction
        let textLen = 0;
        const content = msgObj["content"];
        if (typeof content === "string") {
            textLen = content.trim().length;
        } else if (content && typeof content === "object") {
            const contentObj = content as Record<string, unknown>;
            if (Array.isArray(contentObj["parts"])) {
                const combined = contentObj["parts"]
                    .map((p) => {
                        if (typeof p === "string") return p;
                        if (p && typeof p === "object" && "text" in p) {
                            return String((p as Record<string, unknown>).text);
                        }
                        return "";
                    })
                    .filter(Boolean)
                    .join("\n");
                textLen = combined.trim().length;
            } else if (typeof contentObj["text"] === "string") {
                textLen = contentObj["text"].trim().length;
            }
        } else if (typeof msgObj["text"] === "string") {
            textLen = msgObj["text"].trim().length;
        }

        if (textLen === 0 && (!msgObj["parts"] || !Array.isArray(msgObj["parts"]))) {
            continue;
        }

        const msgId =
            typeof msgObj["id"] === "string" && msgObj["id"].length > 0
                ? msgObj["id"]
                : `usr-req-${idx + 1}-${Date.now()}`;

        msgObj["id"] = msgId;

        if (emittedMessageIds?.has(msgId)) {
            // Previously emitted message in this conversation - skip re-emission
            continue;
        }
        if (emittedMessageIds) {
            emittedMessageIds.add(msgId);
        }
        messagesToEmit.push(msgObj);
    }

    return {
        messagesToEmit,
        conversationId,
        diagnosticReason:
            messagesToEmit.length === 0
                ? "All candidate messages had empty text content or were already emitted"
                : undefined,
    };
}

export interface InterceptorTargetWindow {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    postMessage: (message: unknown, targetOrigin?: string, transfer?: Transferable[]) => void;
    location?: { origin?: string; pathname?: string };
    addEventListener?: (type: string, listener: (e: Event) => void) => void;
    [key: string]: unknown;
}

export interface InterceptorTargetDocument {
    documentElement?: {
        dataset?: Record<string, string | undefined>;
    };
    [key: string]: unknown;
}

export interface InterceptorEnvironment {
    window: InterceptorTargetWindow;
    document: InterceptorTargetDocument;
}

export function installAIMemoryFetchInterceptor(customEnv?: InterceptorEnvironment) {
    const rawTargetWindow =
        customEnv?.window || (typeof window !== "undefined" ? (window as unknown as InterceptorTargetWindow) : undefined);
    const rawTargetDocument =
        customEnv?.document || (typeof document !== "undefined" ? (document as unknown as InterceptorTargetDocument) : undefined);

    if (!rawTargetWindow || !rawTargetDocument) {
        return null;
    }

    const targetWindow: InterceptorTargetWindow = rawTargetWindow;
    const targetDocument: InterceptorTargetDocument = rawTargetDocument;

    /*
     * ------------------------------------------------------------
     * Install guard
     * ------------------------------------------------------------
     */

    const GUARD_KEY =
        "__AI_MEMORY_FETCH_INTERCEPTOR_INSTALLED__";

    if (!customEnv) {
        if (
            (targetWindow as unknown as Record<string, unknown>)[GUARD_KEY]
            === true
        ) {
            return null;
        }

        (targetWindow as unknown as Record<string, unknown>)[GUARD_KEY] =
            true;
    }

    const emittedMessageIds = new Set<string>();

    /*
     * ------------------------------------------------------------
     * Capture ChatGPT's existing fetch implementation.
     * We wrap ChatGPT's existing fetch instead of replacing
     * its authentication behavior.
     * We NEVER inspect request headers, cookies, or tokens.
     * ------------------------------------------------------------
     */

    const originalFetch =
        targetWindow.fetch.bind(targetWindow);

    /*
     * ------------------------------------------------------------
     * Resolve request URL.
     * ------------------------------------------------------------
     */

    function getRequestUrl(
        input: RequestInfo | URL
    ): string {
        if (typeof input === "string") {
            return input;
        }
        if (input instanceof URL) {
            return input.href;
        }
        return input.url;
    }

    /*
     * ------------------------------------------------------------
     * Privacy Boundary Gate: Fail-Closed Capture State & Epochs
     * ------------------------------------------------------------
     */

    function getCaptureEpoch(): string | null {
        if (!targetDocument || !targetDocument.documentElement) {
            return null;
        }
        const epoch = targetDocument.documentElement.dataset?.vzCaptureEpoch;
        return typeof epoch === "string" && epoch.length > 0 ? epoch : null;
    }

    function isCaptureActive(): boolean {
        if (!targetDocument || !targetDocument.documentElement) {
            return false;
        }
        const active = targetDocument.documentElement.dataset?.vzCaptureActive === "true";
        const epoch = getCaptureEpoch();
        return active && epoch !== null;
    }

    function isStreamEpochValid(startingEpoch: string): boolean {
        if (!isCaptureActive()) {
            return false;
        }
        const currentEpoch = getCaptureEpoch();
        return currentEpoch !== null && currentEpoch === startingEpoch;
    }

    const activeStreamReaders = new Set<ReadableStreamDefaultReader<Uint8Array>>();

    function abortAllActiveStreams(): void {
        for (const reader of activeStreamReaders) {
            try {
                reader.cancel().catch(() => {});
            } catch {
                // Ignore cancel error on cloned reader
            }
        }
        activeStreamReaders.clear();
    }

    if (targetWindow.addEventListener) {
        targetWindow.addEventListener("AI_MEMORY_CAPTURE_STATE_CHANGED", (e: Event) => {
            const customEvent = e as CustomEvent<{ active?: boolean; epoch?: number }>;
            if (customEvent?.detail && customEvent.detail.active === false) {
                abortAllActiveStreams();
            }
        });
    }

    /*
     * ------------------------------------------------------------
     * Decision 1: Filter hidden reasoning & private chain-of-thought
     * ------------------------------------------------------------
     */

    function isThoughtOrReasoningPayload(data: unknown): boolean {
        if (!data || typeof data !== "object") return false;
        const obj = data as Record<string, unknown>;

        if (obj["recipient"] === "thought" || obj["channel"] === "thought") return true;

        const msg = (obj["message"] || (obj["v"] && typeof obj["v"] === "object" && !Array.isArray(obj["v"]) ? (obj["v"] as Record<string, unknown>)["message"] : undefined)) as Record<string, unknown> | undefined;
        if (msg && typeof msg === "object") {
            if (msg["recipient"] === "thought" || msg["channel"] === "thought") return true;
            const metadata = msg["metadata"] as Record<string, unknown> | undefined;
            if (metadata && (metadata["is_thought"] === true || metadata["thought"] === true)) return true;
            const content = msg["content"] as Record<string, unknown> | undefined;
            if (content && typeof content === "object" && content["content_type"] === "thoughts") return true;
        }

        if (typeof obj["p"] === "string" && (obj["p"].includes("/channel") || obj["p"].includes("/recipient") || obj["p"].includes("thought"))) {
            if (typeof obj["v"] === "string" && obj["v"].includes("thought")) return true;
        }

        return false;
    }

    /*
     * ------------------------------------------------------------
     * Relay data to content script.
     * No authentication information is included.
     * ------------------------------------------------------------
     */

    function postToContentScript(
        type: string,
        payload: unknown,
        requiredEpoch?: string
    ): void {
        if (!isCaptureActive()) {
            return;
        }
        if (requiredEpoch && !isStreamEpochValid(requiredEpoch)) {
            return;
        }

        targetWindow.postMessage(
            {
                source: "AI_MEMORY",
                type,
                payload,
            },
            targetWindow.location?.origin || "*"
        );
    }

    /*
     * ------------------------------------------------------------
     * Historical conversation recovery (mapping DAG format).
     * Endpoint: GET /backend-api/conversation/<uuid>
     * ------------------------------------------------------------
     */

    function interceptConversationHistoryResponse(
        url: string,
        response: Response,
        conversationId: string | null,
        epoch?: string
    ): void {
        if (epoch && !isStreamEpochValid(epoch)) {
            return;
        }

        console.log("[VZ-CAPTURE-DEBUG] Historical recovery intercepted", {
            endpoint: url,
            status: response.status,
            conversationId,
        });

        const cloned = response.clone();
        cloned
            .json()
            .then((data: unknown) => {
                if (epoch && !isStreamEpochValid(epoch)) {
                    return;
                }
                postToContentScript(
                    "AI_MEMORY_CHATGPT_CONVERSATION_HISTORY",
                    {
                        url,
                        data,
                        conversationId,
                        captureEpoch: epoch,
                    },
                    epoch
                );
            })
            .catch((err) => {
                console.warn("[VZ-CAPTURE-DEBUG] Historical conversation JSON parse failed", {
                    endpoint: url,
                    error: err instanceof Error ? err.message : String(err),
                });
            });
    }

    /*
     * ------------------------------------------------------------
     * Historical /messages endpoint (pagination format).
     * Endpoint: GET /backend-api/conversations/{id}/messages
     * ------------------------------------------------------------
     */

    function interceptMessagesResponse(
        url: string,
        response: Response,
        epoch?: string
    ): void {
        if (epoch && !isStreamEpochValid(epoch)) {
            return;
        }

        console.log("[VZ-CAPTURE-DEBUG] Historical messages pagination intercepted", {
            endpoint: url,
            status: response.status,
        });

        const clonedResponse =
            response.clone();

        clonedResponse
            .json()
            .then((data: unknown) => {
                if (epoch && !isStreamEpochValid(epoch)) {
                    return;
                }
                postToContentScript(
                    "AI_MEMORY_CHATGPT_MESSAGES_RESPONSE",
                    {
                        url,
                        data,
                        captureEpoch: epoch,
                    },
                    epoch
                );
            })
            .catch(() => {
                // Ignore parsing failures
            });
    }

    /*
     * ============================================================
     * LIVE STREAM STATE
     * ============================================================
     */

    interface LiveStreamState {
        conversationId: string | null;
        completed: boolean;
        hasReceivedContent: boolean;
        pendingUserMessages: Record<string, unknown>[];
    }

    /*
     * ------------------------------------------------------------
     * Extract conversation ID from an SSE event or JSON patch.
     * ------------------------------------------------------------
     */

    function extractConversationId(
        data: unknown
    ): string | null {
        if (
            !data ||
            typeof data !== "object" ||
            Array.isArray(data)
        ) {
            return null;
        }

        const object =
            data as Record<string, unknown>;

        // 1. Direct conversation_id
        const directConversationId =
            object["conversation_id"] || object["conversationId"];

        if (
            typeof directConversationId === "string" &&
            directConversationId.length > 0
        ) {
            return directConversationId;
        }

        // 2. JSON patch format: {"p": "/conversation_id", "v": "..."}
        if (
            typeof object["p"] === "string" &&
            object["p"].includes("conversation_id") &&
            typeof object["v"] === "string" &&
            object["v"].length > 0
        ) {
            return object["v"];
        }

        // 3. Nested inside v
        const value =
            object["v"];

        if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value)
        ) {
            const valueObject =
                value as Record<string, unknown>;

            const nestedConversationId =
                valueObject["conversation_id"] || valueObject["conversationId"];

            if (
                typeof nestedConversationId === "string" &&
                nestedConversationId.length > 0
            ) {
                return nestedConversationId;
            }

            const nestedMsg = valueObject["message"];
            if (nestedMsg && typeof nestedMsg === "object" && !Array.isArray(nestedMsg)) {
                const msgObj = nestedMsg as Record<string, unknown>;
                const msgConvId = msgObj["conversation_id"] || msgObj["conversationId"];
                if (typeof msgConvId === "string" && msgConvId.length > 0) {
                    return msgConvId;
                }
            }
        }

        // 4. Nested inside message
        const directMessage = object["message"];
        if (directMessage && typeof directMessage === "object" && !Array.isArray(directMessage)) {
            const msgObj = directMessage as Record<string, unknown>;
            const msgConvId = msgObj["conversation_id"] || msgObj["conversationId"];
            if (typeof msgConvId === "string" && msgConvId.length > 0) {
                return msgConvId;
            }
        }

        // 5. Active browser pathname check
        if (targetWindow.location?.pathname) {
            const pathMatch = targetWindow.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
            if (pathMatch && pathMatch[1]) {
                return pathMatch[1];
            }
        }

        return null;
    }

    /*
     * ------------------------------------------------------------
     * Parse one completed SSE block.
     * ------------------------------------------------------------
     */

    function isRecognizedStreamPayload(payload: unknown, eventName?: string | null): boolean {
        if (eventName === "delta") return true;
        if (!payload || typeof payload !== "object") return false;
        const obj = payload as Record<string, unknown>;

        // 1. Text chunk: { v: "..." }
        if (typeof obj["v"] === "string" && obj["v"].length > 0) return true;

        // 2. Message object: { v: { message: ... } } or { message: ... }
        const vObj = obj["v"];
        if (vObj && typeof vObj === "object" && !Array.isArray(vObj)) {
            const vRec = vObj as Record<string, unknown>;
            if (vRec["message"] && typeof vRec["message"] === "object") return true;
        }
        if (obj["message"] && typeof obj["message"] === "object") return true;

        // 3. Patch array: { v: [ { p: "/message/content/parts/...", o: "append", v: "..." } ] }
        if (Array.isArray(vObj) && vObj.length > 0) {
            return vObj.some((patch) => {
                if (!patch || typeof patch !== "object") return false;
                const p = patch as Record<string, unknown>;
                return (
                    typeof p["p"] === "string" &&
                    p["p"].startsWith("/message/content/parts/") &&
                    typeof p["v"] === "string"
                );
            });
        }

        // 4. Direct patch: { p: "/message/content/parts/...", o: "append", v: "..." }
        if (
            typeof obj["p"] === "string" &&
            obj["p"].startsWith("/message/content/parts/") &&
            typeof obj["v"] === "string"
        ) {
            return true;
        }

        return false;
    }

    function processSSEBlock(
        block: string,
        url: string,
        streamState: LiveStreamState,
        startingEpoch: string
    ): void {
        if (!isStreamEpochValid(startingEpoch)) {
            return;
        }

        const lines =
            block.split(/\r?\n/);

        let eventName:
            string | null = null;

        const dataLines:
            string[] = [];

        for (const line of lines) {
            if (
                line.startsWith("event:")
            ) {
                eventName =
                    line
                        .slice("event:".length)
                        .trim();
                continue;
            }

            if (
                line.startsWith("data:")
            ) {
                dataLines.push(
                    line
                        .slice("data:".length)
                        .trim()
                );
            }
        }

        if (
            dataLines.length === 0
        ) {
            return;
        }

        const dataText =
            dataLines.join("\n");

        /*
         * --------------------------------------------------------
         * Final SSE marker.
         * --------------------------------------------------------
         */

        if (
            dataText === "[DONE]"
        ) {
            if (!isStreamEpochValid(startingEpoch)) {
                streamState.conversationId = null;
                return;
            }

            console.log(
                "[VZ-CAPTURE-DEBUG] Live SSE stream completed marker received"
            );

            // If pending user messages remain, attempt final URL fallback flush
            if (!streamState.conversationId && targetWindow.location?.pathname) {
                const pathMatch = targetWindow.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
                if (pathMatch && pathMatch[1]) {
                    streamState.conversationId = pathMatch[1];
                }
            }

            if (streamState.pendingUserMessages.length > 0) {
                const targetId = streamState.conversationId || "new-chat";
                for (const pendingMsg of streamState.pendingUserMessages) {
                    if (!isStreamEpochValid(startingEpoch)) break;
                    postToContentScript(
                        "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
                        {
                            url,
                            event: "input_message",
                            data: {
                                type: "input_message",
                                input_message: pendingMsg,
                                conversation_id: targetId,
                            },
                            conversationId: targetId,
                            captureEpoch: startingEpoch,
                        },
                        startingEpoch
                    );
                    console.log("[VZ-CAPTURE-DEBUG] Flushed pending user message on DONE", {
                        conversationId: targetId,
                    });
                }
                streamState.pendingUserMessages = [];
            }

            if (
                !streamState.completed &&
                streamState.hasReceivedContent &&
                streamState.conversationId &&
                isStreamEpochValid(startingEpoch)
            ) {
                streamState.completed = true;

                postToContentScript(
                    "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
                    {
                        url,
                        event: "done",
                        data: {
                            type: "message_stream_complete",
                            conversation_id: streamState.conversationId,
                        },
                        conversationId: streamState.conversationId,
                        captureEpoch: startingEpoch,
                    },
                    startingEpoch
                );
            }

            streamState.conversationId =
                null;

            return;
        }

        let data: unknown;

        try {
            data =
                JSON.parse(
                    dataText
                );
        } catch {
            return;
        }

        if (isThoughtOrReasoningPayload(data)) {
            // Decision 1: Do not capture hidden reasoning, private chain-of-thought, or internal thought blocks
            return;
        }

        const eventType =
            data && typeof data === "object"
                ? (data as Record<string, unknown>)["type"]
                : undefined;

        if (
            eventName === "delta" ||
            eventType === "input_message" ||
            isRecognizedStreamPayload(data, eventName)
        ) {
            streamState.hasReceivedContent = true;
        }

        if (eventType === "message_stream_complete") {
            streamState.completed = true;
        }

        /*
         * Extract conversation ID if this event contains one.
         */

        const eventConversationId =
            extractConversationId(
                data
            );

        if (
            eventConversationId
        ) {
            const wasNull = !streamState.conversationId;
            streamState.conversationId =
                eventConversationId;

            if (wasNull) {
                console.log("[VZ-CAPTURE-DEBUG] Live conversation ID resolved via SSE", {
                    conversationId: eventConversationId,
                    pendingCount: streamState.pendingUserMessages.length,
                });

                postToContentScript(
                    "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
                    {
                        url,
                        event: "conversation_id_updated",
                        data: {
                            type: "conversation_id_updated",
                            conversation_id: eventConversationId,
                        },
                        conversationId: eventConversationId,
                        captureEpoch: startingEpoch,
                    },
                    startingEpoch
                );

                if (streamState.pendingUserMessages && streamState.pendingUserMessages.length > 0) {
                    for (const pendingMsg of streamState.pendingUserMessages) {
                        if (!isStreamEpochValid(startingEpoch)) break;
                        postToContentScript(
                            "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
                            {
                                url,
                                event: "input_message",
                                data: {
                                    type: "input_message",
                                    input_message: pendingMsg,
                                    conversation_id: eventConversationId,
                                },
                                conversationId: eventConversationId,
                                captureEpoch: startingEpoch,
                            },
                            startingEpoch
                        );
                        console.log("[VZ-CAPTURE-DEBUG] Event dispatched: flushed input_message", {
                            conversationId: eventConversationId,
                            messageId: pendingMsg["id"],
                        });
                    }
                    streamState.pendingUserMessages = [];
                }
            }
        }

        postToContentScript(
            "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
            {
                url,
                event: eventName,
                data,
                conversationId: streamState.conversationId,
                captureEpoch: startingEpoch,
            },
            startingEpoch
        );
    }

    /*
     * ============================================================
     * STREAMING /conversation INTERCEPTOR
     * ============================================================
     */

    function interceptConversationResponse(
        url: string,
        response: Response,
        requestBodyText?: string | null,
        init?: RequestInit,
        startingEpoch?: string
    ): void {
        const streamEpoch = startingEpoch || getCaptureEpoch();
        if (!streamEpoch || !isStreamEpochValid(streamEpoch)) {
            return;
        }
        const activeStreamEpoch: string = streamEpoch;

        const clonedResponse =
            response.clone();

        if (!clonedResponse.body) {
            console.warn(
                "[VZ-CAPTURE-DEBUG] Live conversation response has no body"
            );
            return;
        }

        let reqPayload: Record<string, unknown> | null = null;
        try {
            if (requestBodyText) {
                reqPayload = JSON.parse(requestBodyText);
            } else if (typeof init?.body === "string") {
                reqPayload = JSON.parse(init.body);
            }
        } catch {
            // Ignore non-JSON
        }

        const urlConvIdMatch = targetWindow.location?.pathname?.match(/\/c\/([a-zA-Z0-9_-]+)/);
        const urlConvId = urlConvIdMatch ? urlConvIdMatch[1] : null;

        const reqConvId =
            typeof reqPayload?.["conversation_id"] === "string" &&
            reqPayload["conversation_id"].length > 0
                ? (reqPayload["conversation_id"] as string)
                : typeof reqPayload?.["conversationId"] === "string" &&
                  reqPayload["conversationId"].length > 0
                ? (reqPayload["conversationId"] as string)
                : null;

        const initialConvId = reqConvId || urlConvId || null;

        const streamState: LiveStreamState = {
            conversationId: initialConvId,
            completed: false,
            hasReceivedContent: false,
            pendingUserMessages: [],
        };

        const { messagesToEmit } = extractMessagesFromFetchPayload(
            reqPayload,
            emittedMessageIds
        );

        console.log("[VZ-CAPTURE-DEBUG] Live conversation request intercepted", {
            url,
            initialConvId,
            messagesFound: messagesToEmit.length,
            hasBody: !!requestBodyText,
            activeStreamEpoch,
        });

        for (const rawUserMsg of messagesToEmit) {
            if (!isStreamEpochValid(activeStreamEpoch)) break;

            let charCount = 0;
            const content = rawUserMsg["content"];
            if (typeof content === "string") {
                charCount = content.length;
            } else if (content && typeof content === "object" && Array.isArray((content as Record<string, unknown>)["parts"])) {
                charCount = ((content as Record<string, unknown>)["parts"] as unknown[])
                    .map((p) => (typeof p === "string" ? p : (p as Record<string, unknown>)?.["text"] || ""))
                    .join("").length;
            }

            console.log("[VZ-CAPTURE-DEBUG] User message found", {
                messageId: rawUserMsg["id"],
                conversationId: streamState.conversationId,
                characterCount: charCount,
                willBuffer: !streamState.conversationId,
            });

            if (streamState.conversationId) {
                postToContentScript(
                    "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
                    {
                        url,
                        event: "input_message",
                        data: {
                            type: "input_message",
                            input_message: rawUserMsg,
                            conversation_id: streamState.conversationId,
                        },
                        conversationId: streamState.conversationId,
                        captureEpoch: activeStreamEpoch,
                    },
                    activeStreamEpoch
                );
                console.log("[VZ-CAPTURE-DEBUG] Event dispatched: input_message", {
                    conversationId: streamState.conversationId,
                });
            } else {
                streamState.pendingUserMessages.push(rawUserMsg);
            }
        }

        const reader =
            clonedResponse.body.getReader();

        const decoder =
            new TextDecoder();

        let buffer = "";

        async function readStream(): Promise<void> {
            activeStreamReaders.add(reader);
            try {
                while (true) {
                    if (!isStreamEpochValid(activeStreamEpoch)) {
                        console.log("[VZ-CAPTURE-DEBUG] Stream reader aborted: capture invalid or epoch changed");
                        try {
                            await reader.cancel();
                        } catch {
                            // Ignore cancel error on cloned reader
                        }
                        break;
                    }

                    const {
                        done,
                        value,
                    } =
                        await reader.read();

                    if (!isStreamEpochValid(activeStreamEpoch)) {
                        try {
                            await reader.cancel();
                        } catch {
                            // Ignore cancel error on cloned reader
                        }
                        break;
                    }

                    if (done) {
                        if (!isStreamEpochValid(activeStreamEpoch)) {
                            break;
                        }

                        buffer +=
                            decoder.decode();

                        const finalBlocks =
                            buffer.split(
                                /\r?\n\r?\n/
                            );

                        for (
                            const block
                            of finalBlocks
                        ) {
                            if (!isStreamEpochValid(activeStreamEpoch)) break;
                            if (
                                block.trim()
                                    .length > 0
                            ) {
                                processSSEBlock(
                                    block,
                                    url,
                                    streamState,
                                    activeStreamEpoch
                                );
                            }
                        }

                        if (!isStreamEpochValid(activeStreamEpoch)) {
                            break;
                        }

                        // Final check: flush any remaining pending user messages
                        if (streamState.pendingUserMessages.length > 0) {
                            const fallbackId =
                                streamState.conversationId ||
                                (targetWindow.location?.pathname?.match(/\/c\/([a-zA-Z0-9_-]+)/)?.[1]) ||
                                "new-chat";
                            for (const pendingMsg of streamState.pendingUserMessages) {
                                if (!isStreamEpochValid(activeStreamEpoch)) break;
                                postToContentScript(
                                    "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
                                    {
                                        url,
                                        event: "input_message",
                                        data: {
                                            type: "input_message",
                                            input_message: pendingMsg,
                                            conversation_id: fallbackId,
                                        },
                                        conversationId: fallbackId,
                                        captureEpoch: activeStreamEpoch,
                                    },
                                    activeStreamEpoch
                                );
                                console.log("[VZ-CAPTURE-DEBUG] Stream reader completed: flushed pending message", {
                                    conversationId: fallbackId,
                                });
                            }
                            streamState.pendingUserMessages = [];
                        }

                        if (
                            !streamState.completed &&
                            streamState.hasReceivedContent &&
                            streamState.conversationId &&
                            isStreamEpochValid(activeStreamEpoch)
                        ) {
                            streamState.completed = true;

                            postToContentScript(
                                "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
                                {
                                    url,
                                    event: "stream_done",
                                    data: {
                                        type: "message_stream_complete",
                                        conversation_id: streamState.conversationId,
                                    },
                                    conversationId: streamState.conversationId,
                                    captureEpoch: activeStreamEpoch,
                                },
                                activeStreamEpoch
                            );
                        }

                        streamState.conversationId =
                            null;

                        break;
                    }

                    buffer +=
                        decoder.decode(
                            value,
                            {
                                stream: true,
                            }
                        );

                    const blocks =
                        buffer.split(
                            /\r?\n\r?\n/
                        );

                    buffer =
                        blocks.pop() ?? "";

                    for (
                        const block
                        of blocks
                    ) {
                        if (!isStreamEpochValid(activeStreamEpoch)) break;
                        if (
                            block.trim()
                                .length === 0
                        ) {
                            continue;
                        }

                        processSSEBlock(
                            block,
                            url,
                            streamState,
                            activeStreamEpoch
                        );
                    }
                }

            } catch (error) {
                console.warn(
                    "[VZ-CAPTURE-DEBUG] Live conversation stream reader failed",
                    error
                );

                if (!streamState.completed && streamState.conversationId && isStreamEpochValid(activeStreamEpoch)) {
                    postToContentScript(
                        "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
                        {
                            url,
                            event: "stream_error",
                            data: {
                                type: "message_stream_error",
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : "Stream read error",
                                conversation_id: streamState.conversationId,
                            },
                            conversationId: streamState.conversationId,
                            captureEpoch: activeStreamEpoch,
                        },
                        activeStreamEpoch
                    );
                }

            } finally {
                activeStreamReaders.delete(reader);
                try {
                    reader.releaseLock();
                } catch {
                    // Ignore release errors
                }

                streamState.conversationId =
                    null;
            }
        }

        void readStream();
    }

    /*
     * ============================================================
     * REPLACE targetWindow.fetch
     * ============================================================
     */

    targetWindow.fetch =
        async function interceptedFetch(
            input: RequestInfo | URL,
            init?: RequestInit
        ): Promise<Response> {

            // FAIL CLOSED: if capture is not active, immediately return original fetch without ANY inspection
            if (!isCaptureActive()) {
                return originalFetch(input, init);
            }

            const fetchEpoch = getCaptureEpoch();
            if (!fetchEpoch) {
                return originalFetch(input, init);
            }

            const url =
                getRequestUrl(input);

            const method = (
                init?.method ||
                (input instanceof Request ? input.method : "GET")
            ).toUpperCase();

            // 1. Historical conversation mapping endpoint: GET /backend-api/conversation/<uuid>
            const historyMatch = url.match(/\/backend-api\/conversation\/([a-zA-Z0-9_-]+)/);
            const isHistoryMappingEndpoint =
                method === "GET" &&
                Boolean(historyMatch && historyMatch[1] && !historyMatch[1].includes("prepare"));

            // 2. Historical conversation pagination endpoint: GET /backend-api/conversations/<uuid>/messages
            const isMessagesEndpoint =
                url.includes(
                    "/backend-api/conversations/"
                ) &&
                url.includes(
                    "/messages"
                );

            // 3. LIVE conversation streaming endpoint: POST /backend-api/f/conversation or POST /backend-api/conversation
            const isLiveConversationEndpoint =
                method === "POST" &&
                (url.includes("/backend-api/f/conversation") ||
                 url.match(/\/backend-api\/conversation(?:\?|\/|$)/) !== null) &&
                !url.includes("/conversation/prepare") &&
                !url.includes("/messages");

            // Pure pass-through for non-conversation endpoints without inspecting body or cloning
            if (!isHistoryMappingEndpoint && !isMessagesEndpoint && !isLiveConversationEndpoint) {
                return originalFetch(input, init);
            }

            // Extract request body ONLY for eligible conversation endpoints
            let requestBodyText: string | null = null;
            if (typeof init?.body === "string") {
                requestBodyText = init.body;
            } else if (init?.body instanceof Blob) {
                try {
                    requestBodyText = await init.body.text();
                } catch {
                    // Ignore blob read error
                }
            } else if (init?.body instanceof ArrayBuffer || ArrayBuffer.isView(init?.body)) {
                try {
                    requestBodyText = new TextDecoder().decode(init.body as ArrayBuffer);
                } catch {
                    // Ignore buffer decode error
                }
            } else if (input instanceof Request) {
                try {
                    const clonedRequest = input.clone();
                    requestBodyText = await clonedRequest.text();
                } catch {
                    // Ignore request clone error
                }
            }

            console.log("[VZ-CAPTURE-DEBUG] Request intercepted", {
                url,
                method,
                bodyType: init?.body ? typeof init.body : (input instanceof Request ? "Request" : "none"),
                charCount: requestBodyText ? requestBodyText.length : 0,
            });

            // PRE-FLIGHT CAPTURE: Extract and dispatch outgoing user messages BEFORE waiting for network response!
            if (isLiveConversationEndpoint && requestBodyText && isStreamEpochValid(fetchEpoch)) {
                try {
                    const reqPayload = JSON.parse(requestBodyText);
                    const { messagesToEmit, conversationId: reqConvId, diagnosticReason } =
                        extractMessagesFromFetchPayload(reqPayload, emittedMessageIds);

                    if (messagesToEmit.length > 0 && isStreamEpochValid(fetchEpoch)) {
                        const urlConvIdMatch = targetWindow.location?.pathname?.match(/\/c\/([a-zA-Z0-9_-]+)/);
                        const initialConvId = reqConvId || (urlConvIdMatch ? urlConvIdMatch[1] : null);

                        for (const rawUserMsg of messagesToEmit) {
                            if (!isStreamEpochValid(fetchEpoch)) break;
                            postToContentScript(
                                "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
                                {
                                    url,
                                    event: "input_message",
                                    data: {
                                        type: "input_message",
                                        input_message: rawUserMsg,
                                        conversation_id: initialConvId,
                                        isPreFlight: true,
                                    },
                                    conversationId: initialConvId,
                                    captureEpoch: fetchEpoch,
                                },
                                fetchEpoch
                            );
                            console.log("[VZ-CAPTURE-DEBUG] Immediate user prompt dispatched before network response", {
                                conversationId: initialConvId,
                                messageId: rawUserMsg["id"],
                            });
                        }
                    } else if (diagnosticReason) {
                        console.warn("[VZ-CAPTURE-DEBUG] Outgoing user message extraction notice", {
                            url,
                            reason: diagnosticReason,
                        });
                    }
                } catch (err) {
                    console.warn("[VZ-CAPTURE-DEBUG] Pre-flight request body parse error", {
                        url,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }

            // Call original fetch
            const response =
                await originalFetch(
                    input,
                    init
                );

            // Re-check capture state and epoch validity after network round-trip before inspecting response (anti-race)
            if (!isStreamEpochValid(fetchEpoch)) {
                return response;
            }

            if (isHistoryMappingEndpoint && historyMatch) {
                interceptConversationHistoryResponse(
                    url,
                    response,
                    historyMatch[1],
                    fetchEpoch
                );
                return response;
            }

            if (
                isMessagesEndpoint
            ) {
                interceptMessagesResponse(
                    url,
                    response,
                    fetchEpoch
                );
                return response;
            }

            if (
                isLiveConversationEndpoint
            ) {
                console.log(
                    "[VZ-CAPTURE-DEBUG] Live conversation endpoint intercepted",
                    url
                );

                interceptConversationResponse(
                    url,
                    response,
                    requestBodyText,
                    init,
                    fetchEpoch
                );

                return response;
            }

            return response;
        };

    console.log(
        "[VZ-CAPTURE-DEBUG] Page-context fetch interceptor installed"
    );

    return {
        originalFetch,
        isCaptureActive,
        getCaptureEpoch,
        getActiveStreamCount: () => activeStreamReaders.size,
        abortAllActiveStreams,
    };
}

if (typeof window !== "undefined") {
    installAIMemoryFetchInterceptor();
}
