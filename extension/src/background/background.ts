import type { Conversation } from "../connectors/types";

import {
    saveConversation,
} from "../storage/conversationStorage";
import {
    isExtensionContextInvalidatedError,
} from "../continuity/contentScriptLifecycle";

console.log(
    "AI Memory background service started"
);

chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {

        if (message.type === "CONVERSATION_CAPTURED") {

            const conversation =
                message.conversation as Conversation;

            chrome.storage.local.get(
                ["selectedProject", "memoryEnabled"],
                async (result) => {

                    if (chrome.runtime.lastError) {
                        const err = chrome.runtime.lastError;
                        if (isExtensionContextInvalidatedError(err)) {
                            console.warn("[VZ-CAPTURE-DEBUG] Extension context invalidated in background worker while reading selectedProject");
                        } else {
                            console.error(
                                "AI Memory failed to read selected project:",
                                err
                            );
                        }

                        sendResponse({
                            success: false,
                            error:
                                chrome.runtime.lastError.message,
                        });

                        return;
                    }

                    // Strict privacy boundary enforcement:
                    // Positive gate: memoryEnabled must be strictly true.
                    // Using === false would pass silently when memoryEnabled is undefined (first install,
                    // storage clear, quota eviction, migration) — a privacy violation.
                    if (result.memoryEnabled !== true) {
                        console.warn("[VZ-CAPTURE-DEBUG] Background rejected CONVERSATION_CAPTURED: capture is not strictly ON", {
                            memoryEnabled: result.memoryEnabled,
                        });
                        sendResponse({
                            success: false,
                            error: "Capture is disabled: cannot persist conversation",
                        });
                        return;
                    }

                    try {

                        const selectedProject =
                            result.selectedProject as
                            | string
                            | undefined;

                        const conversationWithProject:
                            Conversation = {
                            ...conversation,

                            projectId:
                                selectedProject,
                        };

                        const storageResult =
                            await saveConversation(
                                conversationWithProject
                            );

                        sendResponse({
                            success: true,

                            message:
                                storageResult.isNewConversation
                                    ? "Conversation added"
                                    : "Conversation updated",

                            newMessageCount:
                                storageResult
                                    .newMessages
                                    .length,
                        });

                    } catch (error) {
                        if (isExtensionContextInvalidatedError(error)) {
                            console.warn("[VZ-CAPTURE-DEBUG] Extension context invalidated in background worker while saving conversation", {
                                conversationId: conversation.id,
                            });
                        } else {
                            console.error(
                                "AI Memory failed to store conversation:",
                                error
                            );
                        }

                        sendResponse({
                            success: false,

                            error:
                                error instanceof Error
                                    ? error.message
                                    : "Unknown error",
                        });
                    }
                }
            );

            return true;
        }

        sendResponse({
            success: true,
            message:
                "Background service is alive",
        });

        return false;
    }
);
