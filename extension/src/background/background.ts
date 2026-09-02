import type { Conversation } from "../connectors/types";

import {
    saveConversation,
} from "../storage/conversationStorage";

console.log(
    "AI Memory background service started"
);

chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {

        if (message.type === "CONVERSATION_CAPTURED") {

            const conversation =
                message.conversation as Conversation;

            chrome.storage.local.get(
                ["selectedProject"],
                async (result) => {

                    if (chrome.runtime.lastError) {

                        console.error(
                            "AI Memory failed to read selected project:",
                            chrome.runtime.lastError
                        );

                        sendResponse({
                            success: false,
                            error:
                                chrome.runtime.lastError.message,
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

                        console.error(
                            "AI Memory failed to store conversation:",
                            error
                        );

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