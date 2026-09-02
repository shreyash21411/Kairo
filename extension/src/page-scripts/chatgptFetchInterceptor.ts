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
 * 1. /backend-api/conversations/{id}/messages
 *    -> Existing conversation/history pagination
 *
 * 2. /backend-api/f/conversation
 *    -> Live conversation streaming
 *
 * The original Response is ALWAYS returned unchanged to ChatGPT.
 */

(function installAIMemoryFetchInterceptor() {

    /*
     * ------------------------------------------------------------
     * Install guard
     * ------------------------------------------------------------
     */

    const GUARD_KEY =
        "__AI_MEMORY_FETCH_INTERCEPTOR_INSTALLED__";

    if (
        (window as unknown as Record<string, unknown>)[GUARD_KEY]
        === true
    ) {
        return;
    }

    (window as unknown as Record<string, unknown>)[GUARD_KEY] =
        true;

    /*
     * ------------------------------------------------------------
     * Capture ChatGPT's existing fetch implementation.
     *
     * We wrap ChatGPT's existing fetch instead of replacing
     * its authentication behavior.
     *
     * We NEVER inspect request headers, cookies, or tokens.
     * ------------------------------------------------------------
     */

    const originalFetch =
        window.fetch.bind(window);

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
     * Relay data to content script.
     *
     * No authentication information is included.
     * ------------------------------------------------------------
     */

    function postToContentScript(
        type: string,
        payload: unknown
    ): void {

        window.postMessage(
            {
                source: "AI_MEMORY",
                type,
                payload,
            },
            window.location.origin
        );
    }

    /*
     * ------------------------------------------------------------
     * Historical /messages endpoint.
     *
     * This endpoint returns normal JSON.
     * ------------------------------------------------------------
     */

    function interceptMessagesResponse(
        url: string,
        response: Response
    ): void {

        const clonedResponse =
            response.clone();

        clonedResponse
            .json()
            .then((data: unknown) => {

                postToContentScript(
                    "AI_MEMORY_CHATGPT_MESSAGES_RESPONSE",
                    {
                        url,
                        data,
                    }
                );

            })
            .catch(() => {

                /*
                 * Ignore parsing failures.
                 */

            });
    }

    /*
     * ============================================================
     * LIVE STREAM STATE
     * ============================================================
     *
     * IMPORTANT:
     *
     * ChatGPT does NOT include conversation_id in every SSE
     * delta event.
     *
     * Example:
     *
     * input_message
     *     -> conversation_id exists
     *
     * delta
     *     -> conversation_id may NOT exist
     *
     * delta
     *     -> conversation_id may NOT exist
     *
     * patch
     *     -> conversation_id may NOT exist
     *
     * Therefore we remember the conversation ID for the
     * lifetime of this stream and attach it to every event
     * sent to content.ts.
     *
     * Each /conversation request gets its own local state,
     * so multiple simultaneous streams cannot overwrite each
     * other's conversation IDs.
     * ============================================================
     */

    interface LiveStreamState {
        conversationId: string | null;
    }

    /*
     * ------------------------------------------------------------
     * Extract conversation ID from an SSE event.
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

        /*
         * Most ChatGPT live events expose it here:
         *
         * {
         *     conversation_id: "..."
         * }
         */

        const directConversationId =
            object["conversation_id"];

        if (
            typeof directConversationId === "string" &&
            directConversationId.length > 0
        ) {

            return directConversationId;
        }

        /*
         * Some events can contain the useful object
         * inside v.
         */

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

        return null;
    }

    /*
     * ------------------------------------------------------------
     * Parse one completed SSE block.
     *
     * Example:
     *
     * event: delta
     * data: {"p":"/message/content/parts/0","o":"append","v":"Hi"}
     *
     * OR:
     *
     * data: {"type":"input_message",...}
     * ------------------------------------------------------------
     */

    function processSSEBlock(
        block: string,
        url: string,
        streamState: LiveStreamState
    ): void {

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

            console.log(
                "AI Memory: LIVE SSE stream completed"
            );

            /*
             * Clear stream state.
             */
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

            /*
             * Ignore malformed/non-JSON SSE data.
             */

            return;
        }

        /*
         * --------------------------------------------------------
         * Extract conversation ID if this event contains one.
         *
         * Once found, remember it for all future events.
         * --------------------------------------------------------
         */

        const eventConversationId =
            extractConversationId(
                data
            );

        if (
            eventConversationId
        ) {

            streamState.conversationId =
                eventConversationId;

            console.log(
                "AI Memory: LIVE conversation ID established",
                {
                    conversationId:
                        eventConversationId,
                }
            );
        }

        /*
         * Diagnostic event log.
         *
         * We deliberately do not log authentication data.
         */

        console.log(
            "AI Memory: LIVE SSE event parsed",
            {
                event:
                    eventName,

                type:
                    data &&
                        typeof data === "object"
                        ? (
                            data as Record<
                                string,
                                unknown
                            >
                        )["type"]
                        : undefined,

                conversationId:
                    streamState.conversationId,
            }
        );

        /*
         * --------------------------------------------------------
         * TEMPORARY ASSISTANT DELTA DIAGNOSTIC
         * --------------------------------------------------------
         *
         * Keep this for testing.
         *
         * It lets us verify that the assistant message creation,
         * normal text deltas, and patch operations are all
         * reaching content.ts.
         *
         * We can remove this after the capture pipeline is
         * confirmed.
         * --------------------------------------------------------
         */

        if (
            eventName === "delta"
        ) {

            console.log(
                "AI Memory: FULL LIVE DELTA PAYLOAD",
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );
        }

        /*
         * --------------------------------------------------------
         * Relay event to content.ts.
         *
         * IMPORTANT:
         *
         * conversationId is now supplied independently of the
         * original ChatGPT SSE payload.
         *
         * This solves the exact issue where later delta events
         * contain only:
         *
         * {
         *     p: "...",
         *     o: "append",
         *     v: "..."
         * }
         *
         * and no conversation_id.
         * --------------------------------------------------------
         */

        postToContentScript(
            "AI_MEMORY_CHATGPT_CONVERSATION_EVENT",
            {
                url,

                event:
                    eventName,

                data,

                conversationId:
                    streamState.conversationId,
            }
        );
    }

    /*
     * ============================================================
     * STREAMING /conversation INTERCEPTOR
     * ============================================================
     */

    function interceptConversationResponse(
        url: string,
        response: Response
    ): void {

        const clonedResponse =
            response.clone();

        /*
         * A streaming response must expose a body.
         */

        if (!clonedResponse.body) {

            console.warn(
                "AI Memory: LIVE conversation response has no body"
            );

            return;
        }

        /*
         * --------------------------------------------------------
         * IMPORTANT:
         *
         * This state belongs ONLY to this response stream.
         *
         * If two conversations are streamed at the same time,
         * their IDs remain independent.
         * --------------------------------------------------------
         */

        const streamState:
            LiveStreamState = {
            conversationId: null,
        };

        console.log(
            "AI Memory: LIVE conversation stream reader started"
        );

        const reader =
            clonedResponse.body.getReader();

        const decoder =
            new TextDecoder();

        let buffer = "";

        /*
         * --------------------------------------------------------
         * Read the stream incrementally.
         * --------------------------------------------------------
         */

        async function readStream(): Promise<void> {

            try {

                while (true) {

                    const {
                        done,
                        value,
                    } =
                        await reader.read();

                    /*
                     * ------------------------------------------------
                     * Flush remaining decoder bytes.
                     * ------------------------------------------------
                     */

                    if (done) {

                        buffer +=
                            decoder.decode();

                        /*
                         * Process a final SSE block
                         * if one exists.
                         */

                        const finalBlocks =
                            buffer.split(
                                /\r?\n\r?\n/
                            );

                        for (
                            const block
                            of finalBlocks
                        ) {

                            if (
                                block.trim()
                                    .length > 0
                            ) {

                                processSSEBlock(
                                    block,
                                    url,
                                    streamState
                                );
                            }
                        }

                        console.log(
                            "AI Memory: LIVE conversation stream reader completed",
                            {
                                conversationId:
                                    streamState.conversationId,
                            }
                        );

                        /*
                         * Clear stream state after the stream ends.
                         */

                        streamState.conversationId =
                            null;

                        break;
                    }

                    /*
                     * ------------------------------------------------
                     * Decode this chunk.
                     *
                     * stream:true is important because UTF-8
                     * characters can span chunks.
                     * ------------------------------------------------
                     */

                    buffer +=
                        decoder.decode(
                            value,
                            {
                                stream: true,
                            }
                        );

                    /*
                     * ------------------------------------------------
                     * SSE events are separated by a blank line.
                     * ------------------------------------------------
                     */

                    const blocks =
                        buffer.split(
                            /\r?\n\r?\n/
                        );

                    /*
                     * Keep the final incomplete block
                     * for the next chunk.
                     */

                    buffer =
                        blocks.pop() ?? "";

                    /*
                     * ------------------------------------------------
                     * Process every complete block.
                     * ------------------------------------------------
                     */

                    for (
                        const block
                        of blocks
                    ) {

                        if (
                            block.trim()
                                .length === 0
                        ) {
                            continue;
                        }

                        processSSEBlock(
                            block,
                            url,
                            streamState
                        );
                    }
                }

            } catch (error) {

                console.warn(
                    "AI Memory: LIVE conversation stream reader failed",
                    error
                );

            } finally {

                try {
                    reader.releaseLock();
                } catch {
                    /*
                     * Ignore release errors.
                     */
                }

                /*
                 * Always clear stream state.
                 */

                streamState.conversationId =
                    null;
            }
        }

        /*
         * Start reading asynchronously.
         *
         * We deliberately do NOT await this function.
         *
         * ChatGPT must receive its original response
         * immediately.
         */

        void readStream();
    }

    /*
     * ============================================================
     * REPLACE window.fetch
     * ============================================================
     */

    window.fetch =
        async function interceptedFetch(
            input: RequestInfo | URL,
            init?: RequestInit
        ): Promise<Response> {

            /*
             * ALWAYS call ChatGPT's original fetch.
             */

            const response =
                await originalFetch(
                    input,
                    init
                );

            const url =
                getRequestUrl(input);

            /*
             * ----------------------------------------------------
             * Historical conversation messages.
             * ----------------------------------------------------
             */

            const isMessagesEndpoint =
                url.includes(
                    "/backend-api/conversations/"
                ) &&
                url.includes(
                    "/messages"
                );

            if (
                isMessagesEndpoint
            ) {

                interceptMessagesResponse(
                    url,
                    response
                );

                return response;
            }

            /*
             * ----------------------------------------------------
             * LIVE conversation endpoint.
             *
             * Match:
             *
             * /backend-api/f/conversation
             *
             * Exclude:
             *
             * /backend-api/f/conversation/prepare
             * ----------------------------------------------------
             */

            const isConversationEndpoint =
                url.includes(
                    "/backend-api/f/conversation"
                ) &&
                !url.includes(
                    "/backend-api/f/conversation/prepare"
                );

            if (
                isConversationEndpoint
            ) {

                console.log(
                    "AI Memory: LIVE conversation endpoint intercepted",
                    url
                );

                interceptConversationResponse(
                    url,
                    response
                );

                return response;
            }

            /*
             * ----------------------------------------------------
             * Every other request passes through untouched.
             * ----------------------------------------------------
             */

            return response;
        };

    console.log(
        "AI Memory: Page-context fetch interceptor installed"
    );

})();