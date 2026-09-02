import type { ConversationMessage } from "./types";

export interface ChatGPTPageInfo {
    start_cursor: string | null;
    end_cursor: string | null;
    has_previous_page: boolean;
    has_next_page: boolean;
}

interface ConversationState {
    messages: Map<string, ConversationMessage>;

    startCursor: string | null;
    endCursor: string | null;

    hasPreviousPage: boolean;
    hasNextPage: boolean;
}

const conversations = new Map<
    string,
    ConversationState
>();

/**
 * Add one page of messages received from
 * ChatGPT's /messages endpoint.
 */
export function addConversationPage(
    conversationId: string,
    messages: ConversationMessage[],
    pageInfo: ChatGPTPageInfo
): void {

    let state = conversations.get(
        conversationId
    );

    /*
     * First page for this conversation.
     */
    if (!state) {

        state = {
            messages: new Map(),

            startCursor: null,
            endCursor: null,

            hasPreviousPage: false,
            hasNextPage: false,
        };

        conversations.set(
            conversationId,
            state
        );
    }

    /*
     * Store messages using the real ChatGPT
     * message ID.
     *
     * Map automatically prevents duplicates.
     */
    for (const message of messages) {

        state.messages.set(
            message.id,
            message
        );
    }

    /*
     * Save pagination information.
     */
    state.startCursor =
        pageInfo.start_cursor;

    state.endCursor =
        pageInfo.end_cursor;

    state.hasPreviousPage =
        pageInfo.has_previous_page;

    state.hasNextPage =
        pageInfo.has_next_page;

    console.log(
        "AI Memory: Conversation page added:",
        {
            conversationId,

            pageMessageCount:
                messages.length,

            totalMessageCount:
                state.messages.size,

            startCursor:
                state.startCursor,

            endCursor:
                state.endCursor,

            hasPreviousPage:
                state.hasPreviousPage,

            hasNextPage:
                state.hasNextPage,
        }
    );
}

/**
 * Add live conversation messages without modifying
 * pagination state.
 *
 * Used for newly created user/assistant messages
 * received from ChatGPT's /conversation SSE stream.
 */
export function addConversationMessages(
    conversationId: string,
    messages: ConversationMessage[]
): void {

    let state = conversations.get(
        conversationId
    );

    if (!state) {

        state = {
            messages: new Map(),

            startCursor: null,
            endCursor: null,

            hasPreviousPage: false,
            hasNextPage: false,
        };

        conversations.set(
            conversationId,
            state
        );
    }

    for (const message of messages) {

        state.messages.set(
            message.id,
            message
        );
    }

    console.log(
        "AI Memory: Live messages added:",
        {
            conversationId,

            addedMessageCount:
                messages.length,

            totalMessageCount:
                state.messages.size,
        }
    );
}

/**
 * Returns whether older history still exists.
 */
export function hasMoreHistory(
    conversationId: string
): boolean {

    const state =
        conversations.get(
            conversationId
        );

    if (!state) {
        return false;
    }

    return state.hasPreviousPage;
}

/**
 * Returns the cursor required to request
 * the next older page.
 */
export function getNextCursor(
    conversationId: string
): string | null {

    const state =
        conversations.get(
            conversationId
        );

    if (!state) {
        return null;
    }

    if (!state.hasPreviousPage) {
        return null;
    }

    return state.startCursor;
}

/**
 * Returns all currently accumulated messages.
 */
export function getAccumulatedMessages(
    conversationId: string
): ConversationMessage[] {

    const state =
        conversations.get(
            conversationId
        );

    if (!state) {
        return [];
    }

    return Array.from(
        state.messages.values()
    );
}

/**
 * Returns the number of unique messages
 * currently accumulated.
 */
export function getAccumulatedMessageCount(
    conversationId: string
): number {

    const state =
        conversations.get(
            conversationId
        );

    if (!state) {
        return 0;
    }

    return state.messages.size;
}

/**
 * Returns true when ChatGPT says that
 * there are no more older pages.
 */
export function isConversationComplete(
    conversationId: string
): boolean {

    const state =
        conversations.get(
            conversationId
        );

    if (!state) {
        return false;
    }

    return state.hasPreviousPage === false;
}

/**
 * Clears all accumulated data for a conversation.
 */
export function clearConversation(
    conversationId: string
): void {

    conversations.delete(
        conversationId
    );

    console.log(
        "AI Memory: Conversation accumulator cleared:",
        conversationId
    );
}