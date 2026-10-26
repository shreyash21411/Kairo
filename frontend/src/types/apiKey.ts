export interface CreateApiKeyRequest {
  projectId: number;
  name: string;
  expiresAt?: string | null;
}

export interface ApiKeyResponse {
  apiKeyId: number;
  projectId: number;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

/**
 * Returned ONLY upon creation.
 * The raw `apiKey` field is NEVER returned in subsequent list/get operations.
 */
export interface CreatedApiKeyResponse extends ApiKeyResponse {
  apiKey: string;
}

export interface ValidateApiKeyRequest {
  apiKey: string;
}

export interface ValidateApiKeyResponse {
  isValid: boolean;
  projectId?: number;
  apiKeyId?: number;
  message?: string;
}

export interface VerifyApiKeyResponse {
  valid: boolean;
  projectId: number;
  userId: number;
  apiKeyId: number;
}
