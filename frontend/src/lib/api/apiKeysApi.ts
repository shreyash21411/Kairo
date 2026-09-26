import {
  ApiKeyResponse,
  CreateApiKeyRequest,
  CreatedApiKeyResponse,
} from "@/types/apiKey";
import { jwtRequest } from "./client";

export const apiKeysApi = {
  /**
   * Generates a new API key for the specified project.
   * POST /api/v1/api-keys (Scheme: KairoJwt)
   * The raw apiKey is returned ONLY in this response.
   */
  async create(data: CreateApiKeyRequest): Promise<CreatedApiKeyResponse> {
    return jwtRequest<CreatedApiKeyResponse>("/api/v1/api-keys", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  /**
   * Lists all API keys for the specified project.
   * GET /api/v1/api-keys?projectId={projectId} (Scheme: KairoJwt)
   * Returns metadata only (keyPrefix, etc.); raw key is never returned here.
   */
  async listByProject(projectId: number): Promise<ApiKeyResponse[]> {
    return jwtRequest<ApiKeyResponse[]>(`/api/v1/api-keys?projectId=${projectId}`, {
      method: "GET",
    });
  },

  /**
   * Revokes an API key.
   * DELETE /api/v1/api-keys/{apiKeyId} (Scheme: KairoJwt)
   */
  async revoke(apiKeyId: number): Promise<{ message: string }> {
    return jwtRequest<{ message: string }>(`/api/v1/api-keys/${apiKeyId}`, {
      method: "DELETE",
    });
  },
};
