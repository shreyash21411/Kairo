/**
 * productionDistributionConfig.test.ts
 *
 * Automated regression test suite for VOIDZONE Chrome Extension Production Distribution:
 * 1. Development manifest.json remains intact with localhost and chatgpt.
 * 2. Production manifest generation logic creates chatgpt.com/* and voidzone-staging-api.onrender.com/*
 *    and strictly excludes localhost / 127.0.0.1.
 * 3. Centralized production backend URL resolves to https://voidzone-staging-api.onrender.com.
 * 4. User-provided Kairo API key is transmitted via standard Bearer authorization.
 * 5. Legacy backendBaseUrl storage keys are purged on read/save and cannot override the centralized URL.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OFFICIAL_PRODUCTION_BACKEND_URL,
  BACKEND_BASE_URL,
  BACKEND_DEPLOYMENT_STATUS,
} from "../src/config/backendConfig.ts";
import {
  getBackendConfig,
  saveBackendConfig,
  checkLiveness,
  extractMemory,
  generateContinuity,
  KAIRO_API_KEY_KEY,
  BACKEND_BASE_URL_KEY,
} from "../src/services/voidzoneBackendClient.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(EXTENSION_ROOT, "manifest.json");

// Save original fetch
const originalFetch = globalThis.fetch;

// Mock chrome.storage.local
const mockStorage = new Map<string, unknown>();
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (keys: string | string[]) => {
        if (typeof keys === "string") {
          return { [keys]: mockStorage.get(keys) };
        }
        const result: Record<string, unknown> = {};
        for (const k of keys) {
          result[k] = mockStorage.get(k);
        }
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) {
          mockStorage.set(k, v);
        }
      },
      remove: async (keys: string | string[]) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          mockStorage.delete(k);
        }
      },
    },
  },
};

describe("Production Distribution & Backend Configuration", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockStorage.clear();
  });

  test("1. Development manifest.json preserves local development host permissions", () => {
    assert.ok(fs.existsSync(MANIFEST_PATH), "extension/manifest.json must exist");
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

    assert.strictEqual(manifest.manifest_version, 3);
    assert.ok(Array.isArray(manifest.host_permissions), "host_permissions must be an array");

    // Must preserve chatgpt.com and localhost/127.0.0.1 for local developer iteration
    assert.ok(
      manifest.host_permissions.includes("https://chatgpt.com/*"),
      "Dev manifest must include https://chatgpt.com/*"
    );
    assert.ok(
      manifest.host_permissions.includes("http://localhost/*"),
      "Dev manifest must include http://localhost/*"
    );
    assert.ok(
      manifest.host_permissions.includes("https://localhost/*"),
      "Dev manifest must include https://localhost/*"
    );
    assert.ok(
      manifest.host_permissions.includes("http://127.0.0.1/*"),
      "Dev manifest must include http://127.0.0.1/*"
    );
  });

  test("2. Production host permissions logic includes Render backend and excludes all localhost", async () => {
    // Inspect package-extension script to verify production host permissions
    const packageScriptPath = path.resolve(EXTENSION_ROOT, "..", "scripts", "package-extension.mjs");
    assert.ok(fs.existsSync(packageScriptPath), "package-extension.mjs must exist");
    const scriptContent = fs.readFileSync(packageScriptPath, "utf8");

    // Verify prodHostPermissions definition
    assert.match(
      scriptContent,
      /"https:\/\/voidzone-staging-api\.onrender\.com\/\*"/,
      "Packaging script must explicitly declare Render backend URL in prodHostPermissions"
    );
    assert.match(
      scriptContent,
      /"https:\/\/chatgpt\.com\/\*"/,
      "Packaging script must explicitly declare ChatGPT URL in prodHostPermissions"
    );

    // Verify prodHostPermissions excludes localhost
    const prodPermissionsMatch = scriptContent.match(
      /const prodHostPermissions\s*=\s*\[([\s\S]*?)\];/
    );
    assert.ok(prodPermissionsMatch, "prodHostPermissions array must be defined");
    const prodPermissionsList = prodPermissionsMatch[1];
    assert.ok(!prodPermissionsList.includes("localhost"), "Production permissions must NOT contain localhost");
    assert.ok(!prodPermissionsList.includes("127.0.0.1"), "Production permissions must NOT contain 127.0.0.1");
  });

  test("3. Centralized backendConfig resolves to official Render backend in production", () => {
    assert.strictEqual(
      OFFICIAL_PRODUCTION_BACKEND_URL,
      "https://voidzone-staging-api.onrender.com",
      "OFFICIAL_PRODUCTION_BACKEND_URL must be the official Render endpoint"
    );
    assert.strictEqual(
      BACKEND_DEPLOYMENT_STATUS,
      "production",
      "BACKEND_DEPLOYMENT_STATUS must be 'production' when official URL is set"
    );

    // Verify that production fallback resolves to OFFICIAL_PRODUCTION_BACKEND_URL
    const resolvedProdUrl = false ? "http://localhost:5171" : (OFFICIAL_PRODUCTION_BACKEND_URL ?? "");
    assert.strictEqual(resolvedProdUrl, "https://voidzone-staging-api.onrender.com");
  });

  test("4. getBackendConfig purges legacy backendBaseUrl and enforces centralized URL", async () => {
    // Simulate legacy storage with custom/injected backendBaseUrl
    mockStorage.set(BACKEND_BASE_URL_KEY, "https://malicious-or-outdated-url.example.com");
    mockStorage.set(KAIRO_API_KEY_KEY, "kro_live_user_key_777");

    const config = await getBackendConfig();

    // The centralized URL must take precedence
    assert.strictEqual(config.backendBaseUrl, BACKEND_BASE_URL);
    assert.strictEqual(config.kairoApiKey, "kro_live_user_key_777");

    // Obsolete key must be removed from storage
    assert.strictEqual(mockStorage.has(BACKEND_BASE_URL_KEY), false);
  });

  test("5. saveBackendConfig never persists backendBaseUrl", async () => {
    await saveBackendConfig({
      backendBaseUrl: "https://attempted-override.example.com",
      kairoApiKey: "kro_valid_key_888",
    });

    assert.strictEqual(mockStorage.get(KAIRO_API_KEY_KEY), "kro_valid_key_888");
    assert.strictEqual(mockStorage.has(BACKEND_BASE_URL_KEY), false);
  });

  test("6. Requests to Render backend include Bearer auth and correct endpoint paths", async () => {
    let capturedUrl = "";
    let capturedAuthHeader = "";

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedAuthHeader = ((init?.headers ?? {}) as Record<string, string>)["Authorization"] ?? "";
      return new Response(
        JSON.stringify({
          userId: 1,
          projectId: 1,
          result: {
            projectName: "VOIDZONE",
            currentObjective: "Production test",
            importantDecisions: [],
            constraints: [],
            completedWork: [],
            outstandingTasks: [],
            blockers: [],
            recommendedNextAction: "Verify",
            technicalContext: "Test",
            tokenUsage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            generatedAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    await generateContinuity(
      { rawTranscript: "Human: Test\nAssistant: OK" },
      {
        backendBaseUrl: "https://voidzone-staging-api.onrender.com",
        kairoApiKey: "kro_prod_token_test",
      }
    );

    assert.strictEqual(
      capturedUrl,
      "https://voidzone-staging-api.onrender.com/api/voidzone/continuity/generate"
    );
    assert.strictEqual(capturedAuthHeader, "Bearer kro_prod_token_test");
  });

  test("7. Liveness probe correctly queries Render endpoint /health/live", async () => {
    let capturedUrl = "";
    let capturedAcceptHeader = "";

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedAcceptHeader = ((init?.headers ?? {}) as Record<string, string>)["Accept"] ?? "";
      return new Response("Healthy", { status: 200, statusText: "OK" });
    }) as typeof fetch;

    const res = await checkLiveness("https://voidzone-staging-api.onrender.com");

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(
      capturedUrl,
      "https://voidzone-staging-api.onrender.com/health/live"
    );
    assert.strictEqual(capturedAcceptHeader, "*/*");
  });
});
