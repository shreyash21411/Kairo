import {
    KairoAuthenticationError,
    KairoAuthorizationError,
    KairoConflictError,
    KairoConnectionError,
    KairoError,
    KairoNotFoundError,
    KairoRateLimitError,
    KairoServerError,
    KairoValidationError,
} from "./exceptions";
import { MemoryResource } from "./memories";
import { UsageResource } from "./usage";

// Safe declaration for Node environment when @types/node is not installed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

/** @internal */
const DEFAULT_BASE_URL = "http://localhost:5171";

/** @internal */
const DEFAULT_TIMEOUT_MS = 30_000;

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Configuration options for the {@link Kairo} client.
 */
export interface KairoConfig {
    /**
     * Your Kairo API key.
     * If omitted, falls back to the KAIRO_API_KEY environment variable.
     * If both are missing, throws {@link KairoAuthenticationError}.
     *
     * Never hard-code API keys in source files.
     * Use an environment variable instead:
     *
     * ```typescript
     * const kairo = new Kairo();
     * ```
     */
    apiKey?: string;

    /**
     * Override the Kairo API base URL.
     * Useful for staging, self-hosted, or local development instances.
     * Falls back to KAIRO_BASE_URL environment variable if omitted.
     *
     * Trailing slashes are stripped automatically.
     *
     * @default "http://localhost:5171"
     */
    baseUrl?: string;

    /**
     * HTTP request timeout in milliseconds.
     * Requests that exceed this limit raise {@link KairoConnectionError}.
     *
     * @default 30000
     */
    timeout?: number;
}

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Official Kairo Node.js/TypeScript SDK client.
 *
 * @example
 * ```typescript
 * import { Kairo } from "@kairo/sdk";
 *
 * const kairo = new Kairo({ apiKey: process.env.KAIRO_API_KEY! });
 *
 * const result = await kairo.memories.create({
 *     content: "User prefers dark mode",
 *     memoryType: "Preference",
 *     actorId: "user-123",
 * });
 * ```
 */
export class Kairo {
    /** @internal */
    private readonly _apiKey: string;
    /** @internal */
    private readonly _baseUrl: string;
    /** @internal */
    private readonly _timeout: number;

    /**
     * Memory operations resource.
     * Access all memory CRUD and search operations here.
     */
    public readonly memories: MemoryResource;

    /**
     * Usage reporting resource.
     * Access aggregated project usage reporting here.
     */
    public readonly usage: UsageResource;

    constructor(config?: KairoConfig) {
        const resolvedKey =
            config?.apiKey ||
            (typeof process !== "undefined" && process.env?.KAIRO_API_KEY) ||
            "";

        if (!resolvedKey || resolvedKey.trim() === "") {
            throw new KairoAuthenticationError(
                "No API key provided. Pass apiKey to Kairo constructor or set the KAIRO_API_KEY environment variable."
            );
        }

        // Store key internally — never expose through public properties.
        this._apiKey = resolvedKey.trim();

        const rawBase =
            config?.baseUrl ||
            (typeof process !== "undefined" && process.env?.KAIRO_BASE_URL) ||
            DEFAULT_BASE_URL;

        // Strip trailing slashes so path joins are always clean.
        this._baseUrl = rawBase.replace(/\/+$/, "");

        this._timeout = config?.timeout ?? DEFAULT_TIMEOUT_MS;

        this.memories = new MemoryResource(this);
        this.usage = new UsageResource(this);
    }

    // ── Internal HTTP transport ────────────────────────────────────────────────

    /**
     * Execute an authenticated HTTP request and return the parsed JSON body.
     *
     * This method is intentionally `public` only for use by resource classes
     * within the SDK. Developers should call resource methods instead.
     *
     * @internal
     */
    async request<T>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<T> {
        const url = `${this._baseUrl}/${path.replace(/^\/+/, "")}`;

        const headers: Record<string, string> = {
            // Authorization header is set on every request.
            // The raw API key is never logged or included in exceptions.
            Authorization: `Bearer ${this._apiKey}`,
            Accept: "application/json",
        };

        if (body !== undefined) {
            headers["Content-Type"] = "application/json";
        }

        // AbortSignal.timeout() is available in Node.js 17.3+ and Node.js 22.
        const signal = AbortSignal.timeout(this._timeout);

        let response: Response;

        try {
            response = await fetch(url, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal,
            });
        } catch (err: unknown) {
            // AbortSignal.timeout fires a TimeoutError (a DOMException subtype).
            if (err instanceof DOMException && err.name === "TimeoutError") {
                throw new KairoConnectionError(
                    `Request to Kairo API timed out after ${this._timeout}ms.`
                );
            }
            // All other fetch failures (DNS, ECONNREFUSED, etc.)
            const message =
                err instanceof Error ? err.message : String(err);
            throw new KairoConnectionError(
                `Network error contacting the Kairo API: ${message}`
            );
        }

        return this._handleResponse<T>(response);
    }

    /** @internal */
    private async _handleResponse<T>(response: Response): Promise<T> {
        const { status } = response;

        if (status === 200 || status === 201) {
            const text = await response.text();
            if (!text.trim()) {
                // Empty body — return undefined (caller must handle).
                return undefined as unknown as T;
            }
            try {
                return JSON.parse(text) as T;
            } catch {
                // Body is not JSON — return undefined.
                return undefined as unknown as T;
            }
        }

        const errorMessage = await extractErrorMessage(response);

        switch (status) {
            case 400:
                throw new KairoValidationError(
                    errorMessage ?? "Invalid request.",
                    400
                );
            case 401:
                throw new KairoAuthenticationError(
                    errorMessage ??
                        "Authentication failed. Check your Kairo API key.",
                    401
                );
            case 403:
                throw new KairoAuthorizationError(
                    errorMessage ??
                        "You do not have permission to perform this action.",
                    403
                );
            case 404:
                throw new KairoNotFoundError(
                    errorMessage ?? "The requested resource was not found.",
                    404
                );
            case 409:
                throw new KairoConflictError(
                    errorMessage ?? "The request conflicts with current server state.",
                    409
                );
            case 429: {
                let retryAfter: number | undefined = undefined;
                const rawRetry =
                    response.headers.get("retry-after") ??
                    response.headers.get("Retry-After");
                if (rawRetry && /^\d+$/.test(rawRetry.trim())) {
                    retryAfter = parseInt(rawRetry.trim(), 10);
                }
                throw new KairoRateLimitError(
                    errorMessage ??
                        "Rate limit exceeded. Please reduce your request rate.",
                    429,
                    retryAfter
                );
            }
        }

        if (status >= 500) {
            throw new KairoServerError(
                errorMessage ??
                    `The Kairo server returned an error (HTTP ${status}).`,
                status
            );
        }

        throw new KairoError(
            `Unexpected HTTP ${status} from Kairo API. ${errorMessage ?? ""}`.trim(),
            status
        );
    }

    /**
     * Returns a safe string representation.
     * The API key is never included.
     */
    toString(): string {
        return `Kairo { baseUrl: "${this._baseUrl}" }`;
    }

    /**
     * Prevents the API key appearing in JSON serialisation.
     */
    toJSON(): Record<string, unknown> {
        return { baseUrl: this._baseUrl };
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Safely extract a human-readable error message from an HTTP error response.
 * Returns null if no useful message can be found.
 *
 * @internal
 */
async function extractErrorMessage(
    response: Response
): Promise<string | null> {
    try {
        const text = await response.text();
        if (!text.trim()) return null;

        const data = JSON.parse(text) as Record<string, unknown>;
        if (typeof data.message === "string") {
            return data.message;
        }
        // Truncate to avoid flooding exception messages with large HTML.
        return text.slice(0, 300).trim() || null;
    } catch {
        return null;
    }
}

export const KairoClient = Kairo;
export type KairoClient = Kairo;
