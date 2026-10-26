import {
  ChatProcessingResult,
  CreateChatRequest,
  CreateChatResponse,
} from "@/types/chat";
import { apiKeyRequest } from "./client";

export const chatApi = {
  /**
   * Ingests a chat conversation.
   * POST /api/chats (Scheme: VoidzoneApiKey)
   */
  async ingestChat(
    apiKey: string,
    data: CreateChatRequest,
    signal?: AbortSignal
  ): Promise<CreateChatResponse> {
    const res = await apiKeyRequest<CreateChatResponse>("/api/chats", apiKey, {
      method: "POST",
      body: JSON.stringify(data),
      signal,
    });
    return res.data;
  },

  /**
   * Processes a chat conversation by ID.
   * POST /api/chat-processing/{chatId} (Scheme: VoidzoneApiKey)
   *
   * In Phase 11.3 scoped architecture, chats belonging to a Project without
   * an explicit ActorId trigger the scoped chat guard and safely skip memory extraction.
   */
  async processChat(
    apiKey: string,
    chatId: number,
    signal?: AbortSignal
  ): Promise<ChatProcessingResult> {
    const res = await apiKeyRequest<ChatProcessingResult>(
      `/api/chat-processing/${chatId}`,
      apiKey,
      {
        method: "POST",
        signal,
      }
    );
    return res.data;
  },
};
