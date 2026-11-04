/**
 * voidzoneBackendClient.ts
 *
 * Dedicated HTTP client for connecting the VOIDZONE Chrome Extension
 * to the ASP.NET Core Kairo.API backend.
 *
 * Key guarantees:
 * - Communicates with VoidzoneController endpoints:
 *     POST /api/voidzone/memory/extract
 *     POST /api/voidzone/continuity/generate
 * - Checks liveness via GET /health/live (anonymous liveness probe).
 * - Transmits Kairo API key via standard Authorization: Bearer header.
 * - Never logs or exposes API keys in exceptions, console messages, or errors.
 * - Single request per invocation — no automatic retries that could consume credits.
 * - Does not interact with or expose Meta API keys (those remain backend-only).
 */

import {
  type BackendConfig,
  type MemoryExtractRequest,
  type MetaMemoryResponse,
  type ContinuityGenerateRequest,
  type MetaContinuityResponse,
  type VoidzoneErrorCode,
  VoidzoneApiError,
} from "./voidzoneTypes.ts";

export const DEFAULT_BACKEND_URL = "http://localhost:5171";
export const BACKEND_BASE_URL_KEY = "backendBaseUrl";
export const KAIRO_API_KEY_KEY = "kairoApiKey";

/**
 * Retrieve the configured backend URL and Kairo API key from chrome.storage.local.
 * Defaults to DEFAULT_BACKEND_URL if not set.
 */
export async function getBackendConfig(): Promise<BackendConfig> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const result = await chrome.storage.local.get([
        BACKEND_BASE_URL_KEY,
        KAIRO_API_KEY_KEY,
      ]);
      return {
        backendBaseUrl:
          typeof result[BACKEND_BASE_URL_KEY] === "string" &&
          result[BACKEND_BASE_URL_KEY].trim().length > 0
            ? result[BACKEND_BASE_URL_KEY].trim().replace(/\/+$/, "")
            : DEFAULT_BACKEND_URL,
        kairoApiKey:
          typeof result[KAIRO_API_KEY_KEY] === "string"
            ? result[KAIRO_API_KEY_KEY].trim()
            : "",
      };
    } catch {
      // Fall through to defaults if storage read fails
    }
  }
  return {
    backendBaseUrl: DEFAULT_BACKEND_URL,
    kairoApiKey: "",
  };
}

/**
 * Persist updated backend URL and/or Kairo API key to chrome.storage.local.
 */
export async function saveBackendConfig(
  config: Partial<BackendConfig>
): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    const toStore: Record<string, string> = {};
    if (typeof config.backendBaseUrl === "string") {
      toStore[BACKEND_BASE_URL_KEY] = config.backendBaseUrl.trim().replace(/\/+$/, "");
    }
    if (typeof config.kairoApiKey === "string") {
      toStore[KAIRO_API_KEY_KEY] = config.kairoApiKey.trim();
    }
    await chrome.storage.local.set(toStore);
  }
}

/**
 * Performs a lightweight liveness check against GET /health/live.
 * This endpoint is anonymous, does not query the database, and confirms
 * that the backend server is reachable.
 */
export async function checkLiveness(
  baseUrlOverride?: string
): Promise<{ success: boolean; message: string; statusCode?: number }> {
  const baseUrl = (baseUrlOverride || (await getBackendConfig()).backendBaseUrl).replace(/\/+$/, "");
  const targetUrl = `${baseUrl}/health/live`;

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        Accept: "*/*",
      },
    });

    if (response.ok) {
      return {
        success: true,
        message: "Backend is online and reachable.",
        statusCode: response.status,
      };
    }

    return {
      success: false,
      message: `Backend returned HTTP ${response.status}.`,
      statusCode: response.status,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to connect to backend server.",
    };
  }
}

/**
 * Call POST /api/voidzone/memory/extract to extract structured project memory via Meta AI.
 */
export async function extractMemory(
  request: MemoryExtractRequest,
  configOverride?: Partial<BackendConfig>
): Promise<MetaMemoryResponse> {
  if (!request || !request.rawTranscript || !request.rawTranscript.trim()) {
    throw new VoidzoneApiError(
      "Raw transcript is required for memory extraction.",
      400,
      "raw_transcript_required"
    );
  }

  const config = await resolveConfig(configOverride);
  const targetUrl = `${config.backendBaseUrl}/api/voidzone/memory/extract`;

  return executeVoidzonePost<MetaMemoryResponse>(targetUrl, request, config.kairoApiKey);
}

/**
 * Call POST /api/voidzone/continuity/generate to generate structured continuity state via Meta AI.
 */
export async function generateContinuity(
  request: ContinuityGenerateRequest,
  configOverride?: Partial<BackendConfig>
): Promise<MetaContinuityResponse> {
  if (!request || !request.rawTranscript || !request.rawTranscript.trim()) {
    throw new VoidzoneApiError(
      "Raw transcript is required for continuity generation.",
      400,
      "raw_transcript_required"
    );
  }

  const config = await resolveConfig(configOverride);
  const targetUrl = `${config.backendBaseUrl}/api/voidzone/continuity/generate`;

  return executeVoidzonePost<MetaContinuityResponse>(targetUrl, request, config.kairoApiKey);
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

async function resolveConfig(override?: Partial<BackendConfig>): Promise<BackendConfig> {
  const stored = await getBackendConfig();
  return {
    backendBaseUrl: (override?.backendBaseUrl || stored.backendBaseUrl).replace(/\/+$/, ""),
    kairoApiKey: override?.kairoApiKey !== undefined ? override.kairoApiKey : stored.kairoApiKey,
  };
}

async function executeVoidzonePost<T>(
  targetUrl: string,
  payload: object,
  apiKey: string
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (apiKey && apiKey.trim().length > 0) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    throw new VoidzoneApiError(
      `Cannot connect to backend at ${new URL(targetUrl).origin}. Ensure Kairo.API is running.`,
      0,
      "network_error"
    );
  }

  if (response.ok) {
    try {
      const data = await response.json();
      return data as T;
    } catch {
      throw new VoidzoneApiError(
        "Backend returned an unparseable response body.",
        response.status,
        "meta_ai_malformed_response"
      );
    }
  }

  // Handle errors deterministically
  let errorJson: Record<string, unknown> | null = null;
  try {
    errorJson = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON error body
  }

  const statusCode = response.status;
  const errorCode = (typeof errorJson?.error === "string" ? errorJson.error : "") as VoidzoneErrorCode;

  if (statusCode === 503 || errorCode === "meta_ai_disabled") {
    throw new VoidzoneApiError(
      "Meta AI integration is disabled on the backend. Set MetaAI:Enabled = true in backend configuration to enable.",
      503,
      "meta_ai_disabled"
    );
  }

  if (statusCode === 401) {
    throw new VoidzoneApiError(
      "Authentication failed (HTTP 401). Please check your Kairo API key in Settings.",
      401,
      "unauthorized"
    );
  }

  if (statusCode === 413 || errorCode === "input_too_large") {
    const est = typeof errorJson?.estimatedTokens === "number" ? errorJson.estimatedTokens : undefined;
    const max = typeof errorJson?.maxTokens === "number" ? errorJson.maxTokens : undefined;
    throw new VoidzoneApiError(
      `Transcript is too large for Meta AI (${est ?? "unknown"} estimated tokens; maximum is ${max ?? "unknown"}). Trim the conversation and retry.`,
      413,
      "input_too_large",
      { estimatedTokens: est, maxTokens: max }
    );
  }

  if (statusCode === 429 || errorCode === "meta_ai_rate_limited") {
    throw new VoidzoneApiError(
      "Meta AI upstream rate limit reached (HTTP 429). Please wait before retrying.",
      429,
      "meta_ai_rate_limited"
    );
  }

  if (errorCode === "meta_ai_auth_failure") {
    throw new VoidzoneApiError(
      "Backend Meta Model API authentication failed (HTTP 502). Check backend User Secrets configuration.",
      502,
      "meta_ai_auth_failure"
    );
  }

  if (errorCode === "meta_ai_malformed_response") {
    throw new VoidzoneApiError(
      "Meta AI upstream returned a malformed response (HTTP 502).",
      502,
      "meta_ai_malformed_response"
    );
  }

  const rawMessage = typeof errorJson?.message === "string" ? errorJson.message : undefined;
  throw new VoidzoneApiError(
    rawMessage || `Backend returned error (HTTP ${statusCode}).`,
    statusCode,
    errorCode || "unknown"
  );
}

