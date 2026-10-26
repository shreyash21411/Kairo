import {
  ApiKeyResponse,
  CreateApiKeyRequest,
  CreatedApiKeyResponse,
  ValidateApiKeyResponse,
  VerifyApiKeyResponse,
} from "@/types/apiKey";
import { jwtRequest, apiKeyRequest } from "./client";

export const apiKeysApi = {
  /**
   * Generates a new API key for the specified project.
   * POST /api/v1/api-keys (Scheme: VoidzoneJwt)
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
   * GET /api/v1/api-keys?projectId={projectId} (Scheme: VoidzoneJwt)
   * Returns metadata only (keyPrefix, etc.); raw key is never returned here.
   */
  async listByProject(projectId: number): Promise<ApiKeyResponse[]> {
    return jwtRequest<ApiKeyResponse[]>(`/api/v1/api-keys?projectId=${projectId}`, {
      method: "GET",
    });
  },

  /**
   * Revokes an API key.
   * DELETE /api/v1/api-keys/{apiKeyId} (Scheme: VoidzoneJwt)
   */
  async revoke(apiKeyId: number): Promise<{ message: string }> {
    return jwtRequest<{ message: string }>(`/api/v1/api-keys/${apiKeyId}`, {
      method: "DELETE",
    });
  },

  /**
   * Validates a raw API key using JWT authentication and resolves its server-side owning project ID.
   * POST /api/v1/api-keys/validate (Scheme: VoidzoneJwt)
   */
  async validate(apiKey: string): Promise<ValidateApiKeyResponse> {
    return jwtRequest<ValidateApiKeyResponse>("/api/v1/api-keys/validate", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    });
  },

  /**
   * Verifies the API key directly via Bearer authentication and resolves its server-side project ID.
   * GET /api/v1/api-keys/verify (Scheme: VoidzoneApiKey)
   */
  async verify(apiKey: string): Promise<VerifyApiKeyResponse> {
    const res = await apiKeyRequest<VerifyApiKeyResponse>("/api/v1/api-keys/verify", apiKey, {
      method: "GET",
    });
    return res.data;
  },
};
