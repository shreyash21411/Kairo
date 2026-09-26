export interface CreateMessageRequest {
  externalMessageId: string;
  role: string;
  content: string;
  createdAt?: string;
}

export interface CreateChatRequest {
  externalConversationId: string;
  source: string;
  name?: string | null;
  projectId?: number | null;
  messages: CreateMessageRequest[];
}

export interface CreateChatResponse {
  chatId: number;
  message: string;
}

export interface ChatProcessingResult {
  chatId: number;
  message: string;
  extractedCount: number;
  createdCount: number;
  skippedCount: number;
  skipReason?: string | null;
}
