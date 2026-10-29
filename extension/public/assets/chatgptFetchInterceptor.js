/**
 * chatgptFetchInterceptor.js
 *
 * PAGE-CONTEXT SCRIPT
 *
 * Intercepts ChatGPT's own fetch requests without supplying,
 * reading, logging, or storing authentication credentials.
 *
 * Handles:
 * 1. /backend-api/conversations/{id}/messages -> History pagination
 * 2. /backend-api/conversation & /backend-api/f/conversation -> Live conversation streaming
 *
 * The original Response is ALWAYS returned unchanged to ChatGPT.
 */

(function installAIMemoryFetchInterceptor() {
    const GUARD_KEY = "__AI_MEMORY_FETCH_INTERCEPTOR_INSTALLED__";

    if (window[GUARD_KEY] === true) {
        return;
    }

    window[GUARD_KEY] = true;

    const originalFetch = window.fetch.bind(window);

    function getRequestUrl(input) {
        if (typeof input === "string") {
            return input;
        }
        if (input instanceof URL) {
            return input.href;
        }
        return input.url;
    }

    function postToContentScript(type, payload) {
        window.postMessage(
            {
                source: "AI_MEMORY",
                type,
                payload,
            },
            window.location.origin
        );
    }

    function interceptMessagesResponse(url, response) {
        const clonedResponse = response.clone();
        clonedResponse
            .json()
            .then((data) => {
                postToContentScript(
                    "AI_MEMORY_CHATGPT_MESSAGES_RESPONSE",
                    {
                        url,
                        data,
                    }
                );
            })
            .catch(() => {});
    }

    function extractConversationId(data) {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            return null;
        }
        const directConversationId = data.conversation_id;
        if (typeof directConversationId === "string" && directConversationId.length > 0) {
            return directConversationId;
        }
        const value = data.v;
        if (value && typeof value === "object" && !Array.isArray(value)) {
            const nestedConversationId = value.conversation_id;
            if (typeof nestedConversationId === "string" && nestedConversationId.length > 0) {
                return nestedConversationId;
            }
        }
        return null;
    }

    function processSSEBlock(block, url, streamState) {
        const lines = block.split(/\r?\n/);
        let eventName = null;
        const dataLines = [];

        for (const line of lines) {
            if (line.startsWith("event:")) {
                eventName = line.slice("event:".length).trim();
            } else if (line.startsWith("data:")) {
                dataLines.push(line.slice("data:".length).trim());
            }
        }

        if (dataLines.length === 0) {
            return;
        }

        const dataText = dataLines.join("\n");

        if (dataText === "[DONE]") {
            console.log("AI Memory: LIVE SSE stream completed");
            if (!streamState.completed && streamState.hasReceivedContent && streamState.conversationId) {
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
                    }
                );
            }
            streamState.conversationId = null;
            return;
        }

        let data;
        try {
            data = JSON.parse(dataText);
        } catch {
            return;
        }

        const eventType = data && typeof data === "object" ? data.type : undefined;

        if (eventName === "delta" || eventType === "input_message") {
            streamState.hasReceivedContent = true;
        }

        if (eventType === "message_stream_complete") {
            streamState.completed = true;
        }

        const eventConversationId = extractConversationId(data);

        if (eventConversationId) {
            const wasNull = !streamState.conversationId;
            streamState.conversationId = eventConversationId;

            if (wasNull) {
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
                    }
                );

                if (streamState.pendingUserMessage) {
                    postToContentScript(
                        "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
                        {
                            url,
                            event: "input_message",
                            data: {
                                type: "input_message",
                                input_message: streamState.pendingUserMessage,
                                conversation_id: eventConversationId,
                            },
                            conversationId: eventConversationId,
                        }
                    );
                    streamState.pendingUserMessage = null;
                }
            }

            console.log("AI Memory: LIVE conversation ID established", {
                conversationId: eventConversationId,
            });
        }

        console.log("AI Memory: LIVE SSE event parsed", {
            event: eventName,
            type: data && typeof data === "object" ? data.type : undefined,
            conversationId: streamState.conversationId,
        });

        if (eventName === "delta") {
            console.log("AI Memory: FULL LIVE DELTA PAYLOAD", JSON.stringify(data, null, 2));
        }

        postToContentScript(
            "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
            {
                url,
                event: eventName,
                data,
                conversationId: streamState.conversationId,
            }
        );
    }

    function interceptConversationResponse(url, response, init) {
        const clonedResponse = response.clone();

        if (!clonedResponse.body) {
            console.warn("AI Memory: LIVE conversation response has no body");
            return;
        }

        let reqPayload = null;
        try {
            if (typeof init?.body === "string") {
                reqPayload = JSON.parse(init.body);
            }
        } catch {
            // Ignore non-JSON
        }

        const urlConvIdMatch = window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
        const urlConvId = urlConvIdMatch ? urlConvIdMatch[1] : null;

        const reqConvId =
            typeof reqPayload?.conversation_id === "string" &&
            reqPayload.conversation_id.length > 0
                ? reqPayload.conversation_id
                : null;

        const initialConvId = reqConvId || urlConvId || null;

        const streamState = {
            conversationId: initialConvId,
            completed: false,
            hasReceivedContent: false,
            pendingUserMessage: null,
        };

        if (
            reqPayload &&
            Array.isArray(reqPayload.messages) &&
            reqPayload.messages.length > 0
        ) {
            const rawUserMsg = reqPayload.messages[0];
            if (rawUserMsg) {
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
                        }
                    );
                } else {
                    streamState.pendingUserMessage = rawUserMsg;
                }
            }
        }

        console.log("AI Memory: LIVE conversation stream reader started");

        const reader = clonedResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        async function readStream() {
            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) {
                        buffer += decoder.decode();

                        const finalBlocks = buffer.split(/\r?\n\r?\n/);
                        for (const block of finalBlocks) {
                            if (block.trim().length > 0) {
                                processSSEBlock(block, url, streamState);
                            }
                        }

                        if (streamState.pendingUserMessage && streamState.conversationId) {
                            postToContentScript(
                                "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
                                {
                                    url,
                                    event: "input_message",
                                    data: {
                                        type: "input_message",
                                        input_message: streamState.pendingUserMessage,
                                        conversation_id: streamState.conversationId,
                                    },
                                    conversationId: streamState.conversationId,
                                }
                            );
                            streamState.pendingUserMessage = null;
                        }

                        if (
                            !streamState.completed &&
                            streamState.hasReceivedContent &&
                            streamState.conversationId
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
                                }
                            );
                        }

                        console.log("AI Memory: LIVE conversation stream reader completed", {
                            conversationId: streamState.conversationId,
                        });

                        streamState.conversationId = null;
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    const blocks = buffer.split(/\r?\n\r?\n/);
                    buffer = blocks.pop() ?? "";

                    for (const block of blocks) {
                        if (block.trim().length === 0) {
                            continue;
                        }
                        processSSEBlock(block, url, streamState);
                    }
                }
            } catch (error) {
                console.warn("AI Memory: LIVE conversation stream reader failed", error);

                if (!streamState.completed && streamState.conversationId) {
                    postToContentScript(
                        "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
                        {
                            url,
                            event: "stream_error",
                            data: {
                                type: "message_stream_error",
                                error: error instanceof Error ? error.message : "Stream read error",
                                conversation_id: streamState.conversationId,
                            },
                            conversationId: streamState.conversationId,
                        }
                    );
                }
            } finally {
                try {
                    reader.releaseLock();
                } catch {}
                streamState.conversationId = null;
            }
        }

        void readStream();
    }

    window.fetch = async function interceptedFetch(input, init) {
        const response = await originalFetch(input, init);
        const url = getRequestUrl(input);

        const isMessagesEndpoint =
            url.includes("/backend-api/conversations/") &&
            url.includes("/messages");

        if (isMessagesEndpoint) {
            interceptMessagesResponse(url, response);
            return response;
        }

        const isConversationEndpoint =
            (url.includes("/backend-api/f/conversation") ||
             url.includes("/backend-api/conversation")) &&
            !url.includes("/backend-api/conversation/prepare") &&
            !url.includes("/backend-api/f/conversation/prepare") &&
            !url.includes("/messages");

        if (isConversationEndpoint) {
            console.log("AI Memory: LIVE conversation endpoint intercepted", url);
            interceptConversationResponse(url, response, init);
            return response;
        }

        return response;
    };

    console.log("AI Memory: Page-context fetch interceptor installed");
})();
