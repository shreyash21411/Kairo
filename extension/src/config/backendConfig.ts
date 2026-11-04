/**
 * backendConfig.ts
 *
 * Centralized backend configuration for the VOIDZONE Chrome Extension.
 *
 * PRODUCTION DEPLOYMENT STATUS:
 * The official VOIDZONE cloud backend infrastructure is currently pending deployment.
 * No production domain has been provisioned yet.
 *
 * CRITICAL PRIVACY & SECURITY POLICIES:
 * 1. The backend URL is intentionally NOT user-configurable. Ordinary users cannot
 *    redirect extension requests to arbitrary endpoints.
 * 2. Localhost / 127.0.0.1 is strictly restricted to local development / test environments
 *    and is NEVER used or exposed in the production package.
 * 3. We do not invent fake domains or placeholders as live production endpoints.
 * 4. When the official VOIDZONE backend is deployed, set OFFICIAL_PRODUCTION_BACKEND_URL
 *    to the live production origin (e.g., https://api.voidzone.com) and rebuild.
 */

// In Vite production builds, import.meta.env.DEV is statically replaced with `false`,
// allowing Vite/Rollup dead-code elimination to strip all local development URLs.
// In Node.js test environments, optional chaining falls back to checking process.env.
const isNodeDev =
  typeof globalThis !== "undefined" &&
  Boolean(
    (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.NODE_ENV !== "production"
  );
export const IS_DEVELOPMENT: boolean = Boolean(import.meta.env?.DEV ?? isNodeDev);

/**
 * Official production backend URL.
 * Currently null because cloud backend infrastructure is pending deployment.
 * Update this single constant once the production endpoint is provisioned.
 */
export const OFFICIAL_PRODUCTION_BACKEND_URL: string | null =
  "https://voidzone-staging-api.onrender.com";
/**
 * Centralized backend base URL for all API requests.
 * In development / test: connects to local development server.
 * In production: connects to the official production backend (or empty string if pending).
 * Vite dead-code elimination guarantees that localhost never appears in production bundles.
 */
export const BACKEND_BASE_URL: string = IS_DEVELOPMENT
  ? "http://localhost:5171"
  : (OFFICIAL_PRODUCTION_BACKEND_URL ?? "");

/**
 * Current deployment status descriptor for the UI.
 */
export const BACKEND_DEPLOYMENT_STATUS: "production" | "development" | "pending" =
  OFFICIAL_PRODUCTION_BACKEND_URL
    ? "production"
    : IS_DEVELOPMENT
      ? "development"
      : "pending";
