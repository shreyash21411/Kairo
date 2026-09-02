import type {
    ConversationMessage,
    MessageRole,
} from "./types";

import { createMessageId } from "./messageId";

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

    return messages;
}