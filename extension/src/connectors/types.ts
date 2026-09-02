export type Platform =
    | "chatgpt"
    | "claude"
    | "gemini";

export type MessageRole =
    | "user"
    | "assistant"
    | "system";

export interface ConversationMessage {
    id: string;
    role: MessageRole;
    content: string;
    timestamp?: string;
}

export interface Conversation {
    id: string;

    // Project this conversation belongs to
    projectId?: string;

    platform: Platform;

    title?: string;
    url?: string;

    messages: ConversationMessage[];

    capturedAt: string;
}

export interface AIPlatformConnector {
    platform: Platform;

    isSupportedPage(): boolean;

    getCurrentConversation(): Promise<Conversation | null>;
}