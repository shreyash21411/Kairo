import type {
    AIPlatformConnector,
    Conversation,
} from "./types";

import { extractChatGPTMessages } from "./chatgptExtractor";

export const chatGPTConnector: AIPlatformConnector = {
    platform: "chatgpt",

    isSupportedPage(): boolean {
        return window.location.hostname === "chatgpt.com";
    },

    async getCurrentConversation(): Promise<Conversation | null> {
        if (!this.isSupportedPage()) {
            return null;
        }

        const messages = extractChatGPTMessages();

        if (messages.length === 0) {
            return null;
        }

        return {
            id: window.location.pathname,
            platform: "chatgpt",
            title: document.title,
            url: window.location.href,
            messages,
            capturedAt: new Date().toISOString(),
        };
    },
};