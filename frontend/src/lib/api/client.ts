import { ApiError, ProblemDetails } from "@/types/api";
import { TokenPair } from "@/types/auth";

const ACCESS_TOKEN_KEY = "vz_access_token";
const REFRESH_TOKEN_KEY = "vz_refresh_token";

export function getApiBaseUrl(): string {
  const envUrl = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_VOIDZONE_API_URL?.trim() : undefined;
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  // Deployed production builds must have an explicit backend URL configured.
  // Silent fallback to localhost in production redirects client browser requests to the user's local machine.
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_VOIDZONE_API_URL is not configured. Production builds require an explicit VOIDZONE API URL."
    );
  }

  return "http://localhost:5171";
}

// ── Token Storage Helpers ───────────────────────────────────────────────────

export function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } catch {
    // Ignore storage quota or disabled storage errors
  }
}

export function clearStoredTokens(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Ignore
  }
}

// ── Single-Flight Refresh Mutex ─────────────────────────────────────────────

let activeRefreshPromise: Promise<string | null> | null = null;

async function executeSingleFlightRefresh(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    clearStoredTokens();
    dispatchAuthLogout();
    return null;
  }

  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      clearStoredTokens();
      dispatchAuthLogout();
      return null;
    }

    const data = (await res.json()) as TokenPair;
    setStoredTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    clearStoredTokens();
    dispatchAuthLogout();
    return null;
  }
}

function dispatchAuthLogout(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("voidzone:auth:logout"));
  }
}

// ── Error Parser ────────────────────────────────────────────────────────────

async function parseApiError(res: Response): Promise<ApiError> {
  let problem: ProblemDetails | undefined;
  let message = `Request failed with status ${res.status}`;

  try {
    const text = await res.text();
    if (text) {
      problem = JSON.parse(text) as ProblemDetails;
      if (problem.message) {
        message = problem.message;
      } else if (problem.detail) {
        message = problem.detail;
      } else if (problem.title) {
        message = problem.title;
      }
    }
  } catch {
    // Non-JSON error body
  }

  return new ApiError(res.status, message, problem);
}

// ── JWT-Authenticated Client (Developer Account, Projects, API Keys) ────────

export interface JwtRequestOptions extends RequestInit {
  _retry?: boolean;
}

export async function jwtRequest<T>(
  endpoint: string,
  options: JwtRequestOptions = {}
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = getStoredAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized with token refresh & exactly-once retry
  if (res.status === 401 && !options._retry) {
    // If no token was present in the first place, throw immediately
    if (!token) {
      throw await parseApiError(res);
    }

    // Single-flight refresh mutex
    if (!activeRefreshPromise) {
      activeRefreshPromise = executeSingleFlightRefresh().finally(() => {
        activeRefreshPromise = null;
      });
    }

    const newAccessToken = await activeRefreshPromise;
    if (newAccessToken) {
      // Retry original request exactly once
      return jwtRequest<T>(endpoint, {
        ...options,
        _retry: true,
      });
    } else {
      throw await parseApiError(res);
    }
  }

  if (!res.ok) {
    throw await parseApiError(res);
  }

  if (res.status === 204) {
    return {} as T;
  }

  return (await res.json()) as T;
}

// ── Public Anonymous Request (Login, Register) ──────────────────────────────

export async function anonymousRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    throw await parseApiError(res);
  }

  return (await res.json()) as T;
}

// ── API-Key-Authenticated Client (Memory V1 API, Chat Processing) ───────────

export type ApiKeyRequestOptions = RequestInit;

export async function apiKeyRequest<T>(
  endpoint: string,
  apiKey: string,
  options: ApiKeyRequestOptions = {}
): Promise<{ status: number; data: T }> {
  if (!apiKey || !apiKey.trim()) {
    throw new ApiError(401, "A valid VOIDZONE API key is required for this operation.");
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${apiKey.trim()}`);

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    throw await parseApiError(res);
  }

  if (res.status === 204) {
    return { status: res.status, data: {} as T };
  }

  const data = (await res.json()) as T;
  return { status: res.status, data };
}
