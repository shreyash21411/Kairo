export type Platform =
    | "chatgpt"
    | "claude"
    | "gemini"
    | (string & {});

export type MessageRole =
    | "user"
    | "assistant"
    | "system";

export type CaptureMethod =
    | "manual_paste"
    | "file_import"
    | "supported_connector"
    | "api_import"
    | "unknown";

export type CaptureCompleteness =
    | "complete"
    | "partial"
    | "unknown";

export interface ConversationMessage {
    id: string;
    role: MessageRole;
    content: string;
    timestamp?: string;
    capturedAt?: string;
    sourceMessageId?: string;
    epochId?: string;
}

export interface Conversation {
    id: string;

    schemaVersion?: "1.0";

    // Epoch that authorized this conversation capture
    epochId?: string;

    // Project this conversation belongs to
    projectId?: string;

    platform: Platform;

    platformConversationId?: string;

    title?: string;
    url?: string;

    captureMethod?: CaptureMethod;

    completeness?: CaptureCompleteness;

    firstCapturedAt?: string;

    lastCapturedAt?: string;

    messages: ConversationMessage[];

    capturedAt: string;

    sourceHash?: string;
}

export interface AIPlatformConnector {
    platform: Platform;

    isSupportedPage(): boolean;

    getCurrentConversation(): Promise<Conversation | null>;
}
