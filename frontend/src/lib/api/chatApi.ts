import {
  ChatProcessingResult,
  CreateChatRequest,
  CreateChatResponse,
} from "@/types/chat";
import { apiKeyRequest } from "./client";

export const chatApi = {
  /**
   * Ingests a chat conversation.
   * POST /api/chats (Scheme: KairoApiKey)
   */
  async ingestChat(
    apiKey: string,
    data: CreateChatRequest
  ): Promise<CreateChatResponse> {
    const res = await apiKeyRequest<CreateChatResponse>("/api/chats", apiKey, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.data;
  },

  /**
   * Processes a chat conversation by ID.
   * POST /api/chat-processing/{chatId} (Scheme: KairoApiKey)
   *
   * In Phase 11.3 scoped architecture, chats belonging to a Project without
   * an explicit ActorId trigger the scoped chat guard and safely skip memory extraction.
   */
  async processChat(
    apiKey: string,
    chatId: number
  ): Promise<ChatProcessingResult> {
    const res = await apiKeyRequest<ChatProcessingResult>(
      `/api/chat-processing/${chatId}`,
      apiKey,
      {
        method: "POST",
      }
    );
    return res.data;
  },
};
