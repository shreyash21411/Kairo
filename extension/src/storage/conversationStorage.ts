import type { Conversation } from "../connectors/types";
import type { CapturedConversation } from "../continuity/captureTypes";

const CONVERSATIONS_KEY = "conversations";
const LATEST_CONVERSATION_KEY = "latestConversation";
const LATEST_NEW_MESSAGES_KEY = "latestNewMessages";
const ACTIVE_CAPTURE_SESSION_KEY = "activeCaptureSession";

/**
 * Get all stored conversations.
 */
export async function getConversations(): Promise<Conversation[]> {
    const result = await chrome.storage.local.get(
        CONVERSATIONS_KEY
    );

    const conversations = result[CONVERSATIONS_KEY];

    if (!Array.isArray(conversations)) {
        return [];
    }

    return conversations as Conversation[];
}

/**
 * Get a single conversation by its ID.
 */
export async function getConversation(
    conversationId: string
): Promise<Conversation | null> {
    const conversations = await getConversations();

    return (
        conversations.find(
            (conversation) =>
                conversation.id === conversationId
        ) ?? null
    );
}

/**
 * Get all conversations belonging to a project.
 */
export async function getConversationsByProject(
    projectId: string
): Promise<Conversation[]> {
    const conversations = await getConversations();

    return conversations.filter(
        (conversation) =>
            conversation.projectId === projectId
    );
}

/**
 * In-memory serialization queue for storage writes.
 * Prevents concurrent read-modify-write races within this execution context.
 * Note: Cross-context coordination is achieved by delegating writes through background.ts.
 */
let storageLock: Promise<unknown> = Promise.resolve();

export function serializeStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = storageLock.then(operation, operation);
    // Never allow a rejection to permanently poison the lock chain
    storageLock = next.catch(() => {});
    return next;
}

/**
 * Save a conversation.
 *
 * If the conversation does not exist:
 *      - Add it
 *      - Treat all its messages as new
 *
 * If the conversation already exists:
 *      - Compare message IDs
 *      - Detect only genuinely new messages
 *      - Replace the stored conversation with the latest snapshot
 *
 * Operations are strictly serialized via an internal queue to prevent
 * lost updates during concurrent writes.
 */
export async function saveConversation(
    conversation: Conversation
): Promise<{
    conversations: Conversation[];
    newMessages: Conversation["messages"];
    isNewConversation: boolean;
}> {
    return serializeStorageOperation(async () => {
        if (!conversation || !Array.isArray(conversation.messages)) {
            throw new Error("Invalid conversation: messages array is required.");
        }

        const conversations = await getConversations();

        const existingIndex = conversations.findIndex(
            (existingConversation) =>
                existingConversation.id === conversation.id
        );

        let updatedConversations: Conversation[];
        let newMessages: Conversation["messages"];

        /*
         * EXISTING CONVERSATION
         */
        if (existingIndex >= 0) {
            const existingConversation =
                conversations[existingIndex];

            /*
             * Build a Set containing all message IDs
             * that we have already stored.
             */
            const existingMessageIds = new Set(
                existingConversation.messages.map(
                    (message) => message.id
                )
            );

            /*
             * Only messages whose IDs do not already
             * exist are considered new.
             */
            newMessages = conversation.messages.filter(
                (message) =>
                    !existingMessageIds.has(message.id)
            );

            /*
             * Replace the old conversation with
             * the latest conversation snapshot.
             */
            updatedConversations = conversations.map(
                (existingConversation, index) =>
                    index === existingIndex
                        ? conversation
                        : existingConversation
            );

            console.log(
                "AI Memory updated existing conversation:",
                conversation.id
            );

            console.log(
                "AI Memory new messages detected:",
                newMessages
            );
        }

        /*
         * NEW CONVERSATION
         */
        else {
            updatedConversations = [
                ...conversations,
                conversation,
            ];

            /*
             * Every message is new because we have
             * never stored this conversation before.
             */
            newMessages = conversation.messages;

            console.log(
                "AI Memory added new conversation:",
                conversation.id
            );

            console.log(
                "AI Memory initial messages:",
                newMessages
            );
        }

        /*
         * Persist everything in one storage operation with error handling.
         */
        try {
            await chrome.storage.local.set({
                [CONVERSATIONS_KEY]: updatedConversations,

                [LATEST_CONVERSATION_KEY]: conversation,

                [LATEST_NEW_MESSAGES_KEY]: newMessages,
            });
        } catch (error) {
            console.error("AI Memory storage quota or write failure:", error);
            throw new Error(
                `Failed to save conversation to local storage: ${
                    error instanceof Error ? error.message : "Storage error"
                }`,
                { cause: error }
            );
        }

        console.log(
            "AI Memory conversations stored:",
            updatedConversations
        );

        console.log(
            "AI Memory new message count:",
            newMessages.length
        );

        return {
            conversations: updatedConversations,
            newMessages,
            isNewConversation: existingIndex < 0,
        };
    });
}

/**
 * Get the latest stored conversation snapshot.
 */
export async function getLatestConversation(): Promise<Conversation | null> {
    const result = await chrome.storage.local.get(LATEST_CONVERSATION_KEY);
    const conv = result[LATEST_CONVERSATION_KEY];
    return conv && typeof conv === "object" ? (conv as Conversation) : null;
}

/**
 * Save active capture session state for continuity and recovery across navigation/popups.
 */
export async function saveActiveCaptureSession(
    session: CapturedConversation
): Promise<void> {
    try {
        await chrome.storage.local.set({
            [ACTIVE_CAPTURE_SESSION_KEY]: session,
        });
    } catch (error) {
        console.error("AI Memory failed to save active capture session:", error);
    }
}

/**
 * Get active capture session state if one exists.
 */
export async function getActiveCaptureSession(): Promise<CapturedConversation | null> {
    try {
        const result = await chrome.storage.local.get(ACTIVE_CAPTURE_SESSION_KEY);
        const session = result[ACTIVE_CAPTURE_SESSION_KEY];
        return session && typeof session === "object" ? (session as CapturedConversation) : null;
    } catch {
        return null;
    }
}

/**
 * Clear the active capture session state.
 */
export async function clearActiveCaptureSession(): Promise<void> {
    try {
        await chrome.storage.local.remove(ACTIVE_CAPTURE_SESSION_KEY);
    } catch (error) {
        console.error("AI Memory failed to clear active capture session:", error);
    }
}
