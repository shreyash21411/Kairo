import type {
    ConversationMessage,
    MessageRole,
} from "./types.ts";

import { createMessageId } from "./messageId.ts";
import { extractVisibleConversationFromDOM } from "./domConversationExtractor.ts";

function detectRole(element: Element): MessageRole {
    const role = element.getAttribute(
        "data-message-author-role"
    );

    if (role === "user") {
        return "user";
    }

    if (role === "assistant") {
        return "assistant";
    }

    return "system";
}

export function extractChatGPTMessages(): ConversationMessage[] {
    const messageElements = document.querySelectorAll(
        "[data-message-author-role]"
    );

    if (messageElements.length > 0) {
        const messages: ConversationMessage[] = [];

        messageElements.forEach((element) => {
            const role = detectRole(element);

            const content =
                element.textContent?.trim() ?? "";

            if (!content) {
                return;
            }

            messages.push({
                id: createMessageId(role, content),
                role,
                content,
            });
        });

        if (messages.length > 0) {
            return messages;
        }
    }

    // Evidence-based extraction fallback using observed live ChatGPT DOM
    const domExtracted = extractVisibleConversationFromDOM();
    return domExtracted.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ?? undefined,
        sourceMessageId: m.sourceMessageId ?? undefined,
    }));
}
