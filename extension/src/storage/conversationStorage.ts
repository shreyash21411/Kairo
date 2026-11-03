import type { Conversation } from "../connectors/types";
import {
    type CapturedConversation,
    type EpochRecord,
    type EpochRegistry,
    type EpochStatus,
    PRIVACY_CUTOFF_SENTINEL,
} from "../continuity/captureTypes.ts";
import {
    isExtensionContextValid,
    isExtensionContextInvalidatedError,
} from "../continuity/contentScriptLifecycle.ts";
import {
    mergeCapturedSessions,
    isValidEpochRecord,
    isCutoffSnapshot,
    EPOCH_ID_REGEX,
} from "../continuity/captureLifecycle.ts";

const CONVERSATIONS_KEY = "conversations";
const LATEST_CONVERSATION_KEY = "latestConversation";
const LATEST_NEW_MESSAGES_KEY = "latestNewMessages";
const ACTIVE_CAPTURE_SESSION_KEY = "activeCaptureSession";
export const EPOCH_REGISTRY_KEY = "epochRegistry";
export const PENDING_LIFECYCLE_TRANSITION_KEY = "pendingLifecycleTransition";
export const ACTIVE_EPOCH_KEY = "activeEpoch";

export interface StorageSaveResult {
    success: boolean;
    error?: string;
    isContextInvalidated?: boolean;
}

/**
 * Get all stored conversations.
 */
export async function getConversations(): Promise<Conversation[]> {
    if (!isExtensionContextValid()) {
        return [];
    }

    try {
        const result = await chrome.storage.local.get(
            CONVERSATIONS_KEY
        );

        const conversations = result[CONVERSATIONS_KEY];

        if (!Array.isArray(conversations)) {
            return [];
        }

        return conversations as Conversation[];
    } catch (error) {
        if (isExtensionContextInvalidatedError(error)) {
            console.warn("[VZ-CAPTURE-DEBUG] Extension context invalidated during getConversations");
            return [];
        }
        console.error("[VZ-CAPTURE-DEBUG] Storage operation failed: getConversations", error);
        return [];
    }
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

        // Persistence boundary privacy validation:
        // Positive gate: memoryEnabled must be strictly true. === false passes on undefined (first install,
        // storage clear, quota eviction, migration) which is a privacy violation.
        const memState = await chrome.storage.local.get(["memoryEnabled"]);
        if (memState.memoryEnabled !== true) {
            console.warn("[VZ-CAPTURE-DEBUG] Storage persistence rejected at privacy boundary: capture is not strictly ON", {
                conversationId: conversation.id,
                memoryEnabled: memState.memoryEnabled,
            });
            return {
                conversations: await getConversations(),
                newMessages: [],
                isNewConversation: false,
            };
        }

        const conversations = await getConversations();

        // Clean up any earlier provisional conversation superseded by this permanent conversation
        let baseConversations = conversations;
        if (conversation.id !== "provisional-tab" && conversation.id !== "new-chat") {
            const provisionalIdx = conversations.findIndex(
                (c) =>
                    (c.id === "provisional-tab" || c.id === "new-chat") &&
                    c.messages.some((pm) => conversation.messages.some((cm) => cm.id === pm.id))
            );
            if (provisionalIdx >= 0) {
                baseConversations = conversations.filter((_, idx) => idx !== provisionalIdx);
                console.log("[VZ-CAPTURE-DEBUG] Reconciled provisional conversation to permanent ID", {
                    permanentId: conversation.id,
                });
            }
        }

        const existingIndex = baseConversations.findIndex(
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
                baseConversations[existingIndex];

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
             * Merge existing messages with incoming messages by ID so that
             * partial turn snapshots never erase previously stored messages.
             */
            const messageMap = new Map<string, (typeof conversation.messages)[number]>();
            for (const msg of existingConversation.messages) {
                messageMap.set(msg.id, msg);
            }
            for (const msg of conversation.messages) {
                let targetId = msg.id;
                if (!messageMap.has(msg.id)) {
                    for (const [existingId, em] of messageMap.entries()) {
                        if (
                            (msg.sourceMessageId && em.sourceMessageId && msg.sourceMessageId === em.sourceMessageId) ||
                            (msg.sourceMessageId && em.id === msg.sourceMessageId) ||
                            (em.sourceMessageId && em.sourceMessageId === msg.id)
                        ) {
                            targetId = existingId;
                            break;
                        }
                    }
                }
                const existingMsg = messageMap.get(targetId);
                if (
                    existingMsg &&
                    typeof existingMsg.content === "string" &&
                    typeof msg.content === "string" &&
                    existingMsg.content.length > msg.content.length &&
                    existingMsg.content.startsWith(msg.content)
                ) {
                    messageMap.set(targetId, {
                        ...msg,
                        id: targetId,
                        content: existingMsg.content,
                    });
                } else {
                    messageMap.set(targetId, {
                        ...msg,
                        id: targetId,
                    });
                }
            }
            const mergedMessages = Array.from(messageMap.values());

            const mergedConversation: Conversation = {
                ...existingConversation,
                ...conversation,
                messages: mergedMessages,
                title: conversation.title || existingConversation.title,
                url: conversation.url || existingConversation.url,
                completeness:
                    conversation.completeness === "complete" ||
                    existingConversation.completeness === "complete"
                        ? "complete"
                        : conversation.completeness,
            };

            updatedConversations = baseConversations.map(
                (conv, index) =>
                    index === existingIndex
                        ? mergedConversation
                        : conv
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
                ...baseConversations,
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
        if (!isExtensionContextValid()) {
            console.warn("[VZ-CAPTURE-DEBUG] Extension context invalidated before saveConversation", {
                conversationId: conversation.id,
            });
            throw new Error("Extension context invalidated");
        }

        console.log("[VZ-CAPTURE-DEBUG] Storage operation started: saveConversation", {
            conversationId: conversation.id,
            messageCount: conversation.messages.length,
        });

        try {
            const finalSavedConv =
                existingIndex >= 0
                    ? updatedConversations[existingIndex]
                    : conversation;

            await chrome.storage.local.set({
                [CONVERSATIONS_KEY]: updatedConversations,

                [LATEST_CONVERSATION_KEY]: finalSavedConv,

                [LATEST_NEW_MESSAGES_KEY]: newMessages,
            });

            console.log("[VZ-CAPTURE-DEBUG] Storage operation succeeded: saveConversation", {
                conversationId: conversation.id,
                totalStored: updatedConversations.length,
            });
        } catch (error) {
            if (isExtensionContextInvalidatedError(error)) {
                console.warn("[VZ-CAPTURE-DEBUG] Extension context invalidated during saveConversation", {
                    conversationId: conversation.id,
                });
                throw new Error("Extension context invalidated", { cause: error });
            }
            console.error("[VZ-CAPTURE-DEBUG] Storage operation failed: saveConversation", error);
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
 * Serializes writes to prevent race conditions and rejects stale snapshots.
 */
export async function saveActiveCaptureSession(
    session: CapturedConversation
): Promise<StorageSaveResult> {
    return serializeStorageOperation(async () => {
        if (!isExtensionContextValid()) {
            console.warn("[VZ-CAPTURE-DEBUG] Extension context invalidated before saveActiveCaptureSession", {
                conversationId: session.id,
            });
            return {
                success: false,
                error: "Extension context invalidated",
                isContextInvalidated: true,
            };
        }

        console.log("[VZ-CAPTURE-DEBUG] Storage operation started: saveActiveCaptureSession", {
            conversationId: session.id,
            messageCount: session.messages.length,
        });

        try {
            // Positive gate: memoryEnabled must be strictly true.
            // The sole exception: PrivacyCutoffToken Condition A (session is an interrupted cutoff snapshot
            // with PRIVACY_CUTOFF_SENTINEL) AND Condition B (session is an explicitly identified legacy session
            // or an epoch-aware session matching a valid, non-invalidated epoch in epochRegistry).
            const memState = await chrome.storage.local.get([
                "memoryEnabled",
                EPOCH_REGISTRY_KEY,
            ]);
            const isConditionA = isCutoffSnapshot(session);
            let isConditionB = false;

            if (isConditionA) {
                const rawEpochId = session.epochId;
                const hasNonEmptyEpochId = typeof rawEpochId === "string" && rawEpochId.trim().length > 0;

                // Explicit legacy identification:
                // Pre-epoch sessions are identified EXPLICITLY by schemaVersion === "1.0",
                // isLegacySession === true, or legacyMode === "pre_epoch", with no epochId.
                // Missing registry keys NEVER automatically grant legacy authorization.
                const isExplicitLegacy =
                    (session.schemaVersion === "1.0" || session.isLegacySession === true || session.legacyMode === "pre_epoch") &&
                    !hasNonEmptyEpochId;

                if (isExplicitLegacy) {
                    // Genuine explicitly identified legacy sessions retain compatibility behavior
                    isConditionB = true;
                } else if (hasNonEmptyEpochId) {
                    // Epoch-aware session: require valid epochId format and positive non-invalidated registry entry
                    if (EPOCH_ID_REGEX.test(rawEpochId!)) {
                        const rawRegistry = memState[EPOCH_REGISTRY_KEY];
                        if (rawRegistry && typeof rawRegistry === "object" && !Array.isArray(rawRegistry)) {
                            const registry = rawRegistry as EpochRegistry;
                            const rec = registry[rawEpochId!];
                            isConditionB = isValidEpochRecord(rec) &&
                                (rec.status === "active" || rec.status === "closed");
                        } else {
                            // Missing, non-object, or corrupted registry data fails closed
                            isConditionB = false;
                        }
                    } else {
                        // Malformed epochId fails closed
                        isConditionB = false;
                    }
                } else {
                    // Session lacks epochId and is not explicitly identified as legacy:
                    // Missing registry keys or missing epoch IDs NEVER automatically grant authorization.
                    // Must fail closed.
                    isConditionB = false;
                }
            }
            const isPrivacyCutoffException = isConditionA && isConditionB;
            const isInterruptedCutoff = isPrivacyCutoffException;

            if (memState.memoryEnabled !== true && !isPrivacyCutoffException) {
                console.warn("[VZ-CAPTURE-DEBUG] Active capture session persistence rejected: capture not strictly ON and not a verified cutoff snapshot", {
                    conversationId: session.id,
                    memoryEnabled: memState.memoryEnabled,
                    isConditionA,
                    isConditionB,
                });
                return {
                    success: false,
                    error: "Capture is not enabled: active capture session persistence rejected at privacy boundary",
                    isContextInvalidated: false,
                };
            }

            const current = await getActiveCaptureSession();
            let sessionToSave = session;

            if (current) {
                // Stale write rejection: An interrupted cutoff snapshot cannot be overwritten by a stale in-progress stream write
                const isCurrentCutoff =
                    current.state === "interrupted" &&
                    current.error === "Capture was paused by user.";

                if (isCurrentCutoff && session.state === "response_in_progress") {
                    console.log("[VZ-CAPTURE-DEBUG] Stale in-progress stream write rejected: session was interrupted at privacy cutoff", {
                        conversationId: session.id,
                    });
                    return { success: true };
                }

                // Safeguard G: A provisional or new-chat session cannot overwrite an established authoritative session
                if (
                    current.id !== "provisional-tab" &&
                    current.id !== "new-chat" &&
                    (session.id === "provisional-tab" || session.id === "new-chat")
                ) {
                    console.warn("[VZ-CAPTURE-DEBUG] Rejected provisional session write over authoritative active session", {
                        authoritativeId: current.id,
                        provisionalId: session.id,
                    });
                    return { success: true };
                }

                // Safeguard H: If saving to the same conversation ID, prevent delayed writes from rolling back newer state
                if (current.id === session.id) {
                    const currentTime = current.lastCheckpointAt
                        ? Date.parse(current.lastCheckpointAt)
                        : (current.capturedAt ? Date.parse(current.capturedAt) : 0);
                    const incomingTime = session.lastCheckpointAt
                        ? Date.parse(session.lastCheckpointAt)
                        : (session.capturedAt ? Date.parse(session.capturedAt) : 0);

                    if (current.messages.length > session.messages.length && currentTime >= incomingTime && !isInterruptedCutoff) {
                        console.log("[VZ-CAPTURE-DEBUG] Stale active session write ignored (newer snapshot exists)", {
                            currentCount: current.messages.length,
                            incomingCount: session.messages.length,
                        });
                        return { success: true };
                    }

                    // Merge sessions so earlier turns are preserved and deduplicated
                    sessionToSave = mergeCapturedSessions(current, session);
                }
            }

            await chrome.storage.local.set({
                [ACTIVE_CAPTURE_SESSION_KEY]: sessionToSave,
            });

            // Blocker 2: Read-back verification for cutoff snapshot persistence
            if (isPrivacyCutoffException) {
                const readBack = await chrome.storage.local.get([ACTIVE_CAPTURE_SESSION_KEY]);
                const stored = readBack[ACTIVE_CAPTURE_SESSION_KEY] as CapturedConversation | undefined;

                if (!stored || typeof stored !== "object") {
                    console.error("[VZ-CAPTURE-DEBUG] Cutoff snapshot read-back verification failed: record missing in storage");
                    return {
                        success: false,
                        error: "Cutoff snapshot read-back verification failed: record missing in storage",
                        isContextInvalidated: false,
                    };
                }

                // Verify expected session ID
                if (stored.id !== sessionToSave.id) {
                    console.error("[VZ-CAPTURE-DEBUG] Cutoff snapshot read-back verification failed: session ID mismatch", {
                        expected: sessionToSave.id,
                        actual: stored.id,
                    });
                    return {
                        success: false,
                        error: "Cutoff snapshot read-back verification failed: session ID mismatch",
                        isContextInvalidated: false,
                    };
                }

                // Verify expected epoch ID for epoch-aware sessions
                if (sessionToSave.epochId && stored.epochId !== sessionToSave.epochId) {
                    console.error("[VZ-CAPTURE-DEBUG] Cutoff snapshot read-back verification failed: epoch ID mismatch", {
                        expected: sessionToSave.epochId,
                        actual: stored.epochId,
                    });
                    return {
                        success: false,
                        error: "Cutoff snapshot read-back verification failed: epoch ID mismatch",
                        isContextInvalidated: false,
                    };
                }

                // Verify interrupted state and exact privacy cutoff sentinel
                if (stored.state !== "interrupted" || stored.error !== PRIVACY_CUTOFF_SENTINEL) {
                    console.error("[VZ-CAPTURE-DEBUG] Cutoff snapshot read-back verification failed: state or sentinel mismatch", {
                        expectedState: "interrupted",
                        actualState: stored.state,
                        expectedError: PRIVACY_CUTOFF_SENTINEL,
                        actualError: stored.error,
                    });
                    return {
                        success: false,
                        error: "Cutoff snapshot read-back verification failed: state or sentinel mismatch",
                        isContextInvalidated: false,
                    };
                }

                // Verify message array exists and length matches
                if (!Array.isArray(stored.messages) || stored.messages.length !== sessionToSave.messages.length) {
                    console.error("[VZ-CAPTURE-DEBUG] Cutoff snapshot read-back verification failed: message count mismatch", {
                        expected: sessionToSave.messages.length,
                        actual: stored?.messages?.length,
                    });
                    return {
                        success: false,
                        error: "Cutoff snapshot read-back verification failed: message count mismatch",
                        isContextInvalidated: false,
                    };
                }

                // Strengthened verification: Stable content comparison for every message
                for (let i = 0; i < sessionToSave.messages.length; i++) {
                    const expectedM = sessionToSave.messages[i];
                    const storedM = stored.messages[i];
                    if (
                        !storedM ||
                        typeof storedM !== "object" ||
                        storedM.id !== expectedM.id ||
                        storedM.sequence !== expectedM.sequence ||
                        storedM.role !== expectedM.role ||
                        storedM.content !== expectedM.content ||
                        Boolean(storedM.isInProgress) !== Boolean(expectedM.isInProgress)
                    ) {
                        console.error("[VZ-CAPTURE-DEBUG] Cutoff snapshot read-back verification failed: message content mismatch", {
                            index: i,
                            expectedId: expectedM.id,
                            actualId: storedM?.id,
                        });
                        return {
                            success: false,
                            error: `Cutoff snapshot read-back verification failed: message content mismatch at index ${i}`,
                            isContextInvalidated: false,
                        };
                    }
                }
            }

            console.log("[VZ-CAPTURE-DEBUG] Storage operation succeeded: active capture session saved", {
                conversationId: sessionToSave.id,
                messageCount: sessionToSave.messages.length,
                completeness: sessionToSave.completenessStatus,
            });

            return { success: true };
        } catch (error) {
            if (isExtensionContextInvalidatedError(error)) {
                console.warn("[VZ-CAPTURE-DEBUG] Extension context invalidated during active capture session save", {
                    conversationId: session.id,
                    error: error instanceof Error ? error.message : String(error),
                });
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                    isContextInvalidated: true,
                };
            }

            console.error("[VZ-CAPTURE-DEBUG] Storage operation failed: saveActiveCaptureSession", {
                conversationId: session.id,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                success: false,
                error: error instanceof Error ? error.message : "Storage write failed",
                isContextInvalidated: false,
            };
        }
    });
}

/**
 * Get active capture session state if one exists.
 */
export async function getActiveCaptureSession(): Promise<CapturedConversation | null> {
    if (!isExtensionContextValid()) {
        return null;
    }

    try {
        const result = await chrome.storage.local.get(ACTIVE_CAPTURE_SESSION_KEY);
        const session = result[ACTIVE_CAPTURE_SESSION_KEY];
        return session && typeof session === "object" ? (session as CapturedConversation) : null;
    } catch (error) {
        if (isExtensionContextInvalidatedError(error)) {
            console.warn("[VZ-CAPTURE-DEBUG] Extension context invalidated during getActiveCaptureSession");
        }
        return null;
    }
}

/**
 * Clear the active capture session state.
 */
export async function clearActiveCaptureSession(): Promise<StorageSaveResult> {
    if (!isExtensionContextValid()) {
        return {
            success: false,
            error: "Extension context invalidated",
            isContextInvalidated: true,
        };
    }

    try {
        await chrome.storage.local.remove(ACTIVE_CAPTURE_SESSION_KEY);
        return { success: true };
    } catch (error) {
        if (isExtensionContextInvalidatedError(error)) {
            return {
                success: false,
                error: "Extension context invalidated",
                isContextInvalidated: true,
            };
        }
        console.error("[VZ-CAPTURE-DEBUG] Storage operation failed: clearActiveCaptureSession", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Storage clear failed",
            isContextInvalidated: false,
        };
    }
}

/**
 * Read the entire epoch registry from storage.
 */
export async function getEpochRegistry(): Promise<EpochRegistry> {
    if (!isExtensionContextValid()) return {};
    try {
        const result = await chrome.storage.local.get(EPOCH_REGISTRY_KEY);
        const reg = result[EPOCH_REGISTRY_KEY];
        return reg && typeof reg === "object" ? (reg as EpochRegistry) : {};
    } catch {
        return {};
    }
}

/**
 * Update the status of a single epoch record in the registry and verify the write.
 * Returns true only if the write was committed and verified.
 */
export async function setEpochStatus(
    epochId: string,
    status: EpochStatus,
    extraFields?: Partial<EpochRecord>
): Promise<boolean> {
    if (!isExtensionContextValid()) return false;
    try {
        const registry = await getEpochRegistry();
        const existing = registry[epochId];
        if (!existing) return false;
        const updated: EpochRecord = {
            ...existing,
            status,
            ...extraFields,
        };
        registry[epochId] = updated;
        await chrome.storage.local.set({ [EPOCH_REGISTRY_KEY]: registry });
        // Verification gate
        const verify = await getEpochRegistry();
        return verify[epochId]?.status === status;
    } catch {
        return false;
    }
}

/**
 * Create and persist a new epoch record.
 */
export async function createEpochRecord(
    epochId: string,
    createdBy: "popup" | "recovery" = "popup"
): Promise<boolean> {
    if (!isExtensionContextValid()) return false;
    try {
        const registry = await getEpochRegistry();
        const record: EpochRecord = {
            epochId,
            status: "active",
            createdAt: Date.now(),
            createdBy,
            closedAt: null,
            invalidatedAt: null,
            reason: null,
        };
        registry[epochId] = record;
        await chrome.storage.local.set({
            [EPOCH_REGISTRY_KEY]: registry,
            [ACTIVE_EPOCH_KEY]: epochId,
        });
        // Verification gate
        const verify = await getEpochRegistry();
        return verify[epochId]?.status === "active";
    } catch {
        return false;
    }
}

