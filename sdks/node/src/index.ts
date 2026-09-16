/**
 * @kairo/sdk — Official Kairo Node.js/TypeScript SDK
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

// ── Client ────────────────────────────────────────────────────────────────────
export { Kairo, KairoClient } from "./client";
export type { KairoConfig } from "./client";

// ── Agent Integration ─────────────────────────────────────────────────────────
export { KairoAgentMemory } from "./agent";
export type { KairoAgentMemoryOptions } from "./agent";

// ── Exceptions ────────────────────────────────────────────────────────────────
export {
    KairoError,
    KairoValidationError,
    KairoAuthenticationError,
    KairoAuthorizationError,
    KairoNotFoundError,
    KairoConflictError,
    KairoRateLimitError,
    KairoServerError,
    KairoConnectionError,
} from "./exceptions";

// ── Models / types ────────────────────────────────────────────────────────────
export type {
    MemoryType,
    Memory,
    RetrievedMemory,
    MemorySearchResponse,
    CreateMemoryRequest,
    UpdateMemoryRequest,
    MemorySearchRequest,
    CreateMemoryResult,
    DeleteMemoryResult,
} from "./models";
