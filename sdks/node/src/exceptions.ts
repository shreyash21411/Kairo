/**
 * Kairo SDK exception hierarchy.
 *
 * All exceptions thrown by the SDK extend KairoError.
 *
 * HTTP status mapping:
 *   400 → KairoValidationError
 *   401 → KairoAuthenticationError
 *   403 → KairoAuthorizationError
 *   404 → KairoNotFoundError
 *   429 → KairoRateLimitError
 *   5xx → KairoServerError
 *
 * Network / transport failures → KairoConnectionError
 */

/**
 * Base class for all Kairo SDK errors.
 * Catch this to handle any Kairo-related failure.
 */
export class KairoError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
        // Preserves the correct stack trace in V8/Node.js.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (Error as any).captureStackTrace === "function") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (Error as any).captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * The request body or parameters failed validation.
 * HTTP 400.
 */
export class KairoValidationError extends KairoError {}

/**
 * The API key is missing, invalid, revoked, or expired.
 * HTTP 401.
 */
export class KairoAuthenticationError extends KairoError {}

/**
 * The authenticated user does not have permission to perform this action.
 * HTTP 403.
 */
export class KairoAuthorizationError extends KairoError {}

/**
 * The requested resource does not exist or does not belong to the authenticated user.
 * HTTP 404.
 */
export class KairoNotFoundError extends KairoError {}

/**
 * The API rate limit has been exceeded.
 * HTTP 429.
 */
export class KairoRateLimitError extends KairoError {}

/**
 * The Kairo server encountered an unexpected error.
 * HTTP 5xx.
 */
export class KairoServerError extends KairoError {}

/**
 * A network or transport error prevented reaching the Kairo API.
 * Covers connection failures, DNS resolution failures, and timeouts.
 */
export class KairoConnectionError extends KairoError {}
