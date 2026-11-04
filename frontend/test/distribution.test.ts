/**
 * frontend/test/distribution.test.ts
 *
 * Automated regression suite for VOIDZONE Cross-Platform & Extension Distribution.
 *
 * Covers:
 * 1. Extension package existence & versioned naming in frontend/public/downloads
 * 2. Cryptographic SHA-256 integrity match between packaged ZIP and release.json
 * 3. File containment validation: manifest.json, index.html, assets, service-worker
 * 4. Exclusion of developer artifacts: no .ts, no .env, no node_modules
 * 5. Frontend release metadata consistency (extension-release.json)
 * 6. Forward slashes in ZIP entry paths for cross-platform Chrome compatibility
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, "..");
const ROOT_DIR = path.resolve(FRONTEND_DIR, "..");

const DOWNLOADS_DIR = path.join(FRONTEND_DIR, "public", "downloads");
const RELEASE_JSON_PATH = path.join(DOWNLOADS_DIR, "release.json");
const CONFIG_JSON_PATH = path.join(FRONTEND_DIR, "src", "config", "extension-release.json");
const MANIFEST_PATH = path.join(ROOT_DIR, "extension", "manifest.json");

/** Simple ZIP entry parser */
function parseZipEntries(buffer: Buffer): Array<{ name: string; compressedSize: number; uncompressedSize: number }> {
  const entries: Array<{ name: string; compressedSize: number; uncompressedSize: number }> = [];
  let offset = 0;

  while (offset < buffer.length - 4) {
    const sig = buffer.readUInt32LE(offset);

    if (sig === 0x04034b50) {
      // Local file header
      const nameLen = buffer.readUInt16LE(offset + 26);
      const extraLen = buffer.readUInt16LE(offset + 28);
      const compSize = buffer.readUInt32LE(offset + 18);
      const uncompSize = buffer.readUInt32LE(offset + 22);
      const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLen);

      entries.push({ name, compressedSize: compSize, uncompressedSize: uncompSize });
      offset += 30 + nameLen + extraLen + compSize;
    } else {
      offset++;
    }
  }

  return entries;
}

describe("VOIDZONE Extension Distribution & Release Integrity", () => {
  test("1. Manifest and release metadata exist and have consistent versioning", () => {
    assert.ok(fs.existsSync(MANIFEST_PATH), "extension/manifest.json must exist");
    assert.ok(fs.existsSync(RELEASE_JSON_PATH), "public/downloads/release.json must exist");
    assert.ok(fs.existsSync(CONFIG_JSON_PATH), "src/config/extension-release.json must exist");

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    const release = JSON.parse(fs.readFileSync(RELEASE_JSON_PATH, "utf8"));
    const config = JSON.parse(fs.readFileSync(CONFIG_JSON_PATH, "utf8"));

    assert.equal(release.version, manifest.version, "Release version must match manifest version");
    assert.equal(config.version, manifest.version, "Config version must match manifest version");
    assert.equal(release.status, "Available", "Status must be Available");
    assert.equal(release.browser, "Google Chrome", "Target browser must be Google Chrome");
  });

  test("2. Packaged ZIP files exist in public/downloads", () => {
    const release = JSON.parse(fs.readFileSync(RELEASE_JSON_PATH, "utf8"));
    const versionedZipPath = path.join(DOWNLOADS_DIR, release.filename);
    const latestZipPath = path.join(DOWNLOADS_DIR, "voidzone-browser-extension-latest.zip");

    assert.ok(fs.existsSync(versionedZipPath), `Versioned ZIP must exist: ${release.filename}`);
    assert.ok(fs.existsSync(latestZipPath), "Latest ZIP alias must exist");

    const stat = fs.statSync(versionedZipPath);
    assert.ok(stat.size > 10000, "ZIP size should be greater than 10 KB");
    assert.equal(stat.size, release.sizeBytes, "ZIP sizeBytes must match release.json metadata");
  });

  test("3. SHA-256 cryptographic checksum matches release.json", () => {
    const release = JSON.parse(fs.readFileSync(RELEASE_JSON_PATH, "utf8"));
    const zipPath = path.join(DOWNLOADS_DIR, release.filename);
    const buffer = fs.readFileSync(zipPath);

    const actualSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    assert.equal(actualSha256, release.sha256, "Cryptographic hash must match exactly");
  });

  test("4. ZIP archive contains all essential Chrome Extension files", () => {
    const release = JSON.parse(fs.readFileSync(RELEASE_JSON_PATH, "utf8"));
    const zipPath = path.join(DOWNLOADS_DIR, release.filename);
    const buffer = fs.readFileSync(zipPath);

    const entries = parseZipEntries(buffer);
    const entryNames = entries.map((e) => e.name);

    assert.ok(entryNames.includes("manifest.json"), "Archive must contain manifest.json at root");
    assert.ok(entryNames.includes("index.html"), "Archive must contain index.html at root");
    assert.ok(entryNames.includes("service-worker-loader.js"), "Archive must contain service-worker-loader.js");

    const assetEntries = entryNames.filter((name) => name.startsWith("assets/"));
    assert.ok(assetEntries.length >= 5, "Archive must contain compiled asset bundles");
  });

  test("5. ZIP archive strictly excludes source files and development artifacts", () => {
    const release = JSON.parse(fs.readFileSync(RELEASE_JSON_PATH, "utf8"));
    const zipPath = path.join(DOWNLOADS_DIR, release.filename);
    const buffer = fs.readFileSync(zipPath);

    const entries = parseZipEntries(buffer);

    for (const entry of entries) {
      assert.ok(!entry.name.endsWith(".ts"), `Forbidden TypeScript source found in ZIP: ${entry.name}`);
      assert.ok(!entry.name.endsWith(".tsx"), `Forbidden TSX source found in ZIP: ${entry.name}`);
      assert.ok(!entry.name.includes("node_modules"), `Forbidden node_modules found in ZIP: ${entry.name}`);
      assert.ok(!entry.name.startsWith(".env"), `Forbidden env file found in ZIP: ${entry.name}`);
      assert.ok(!entry.name.includes("\\"), `ZIP entry path must use forward slashes: ${entry.name}`);
    }
  });

  test("6. All newly added frontend page modules exist", () => {
    const publicCrossPlatform = path.join(FRONTEND_DIR, "src", "app", "cross-platform", "page.tsx");
    const dashboardExtension = path.join(FRONTEND_DIR, "src", "app", "dashboard", "extension", "page.tsx");
    const dashboardPlugins = path.join(FRONTEND_DIR, "src", "app", "dashboard", "plugins", "page.tsx");
    const dashboardBeru = path.join(FRONTEND_DIR, "src", "app", "dashboard", "beru", "page.tsx");

    assert.ok(fs.existsSync(publicCrossPlatform), "/cross-platform page must exist");
    assert.ok(fs.existsSync(dashboardExtension), "/dashboard/extension page must exist");
    assert.ok(fs.existsSync(dashboardPlugins), "/dashboard/plugins page must exist");
    assert.ok(fs.existsSync(dashboardBeru), "/dashboard/beru page must exist");
  });

  test("7. Extension download page correctly links to latest ZIP and displays beta metadata", () => {
    const dashboardExtensionPath = path.join(FRONTEND_DIR, "src", "app", "dashboard", "extension", "page.tsx");
    assert.ok(fs.existsSync(dashboardExtensionPath), "Dashboard extension page must exist");

    const pageContent = fs.readFileSync(dashboardExtensionPath, "utf8");

    // Must link directly to latest ZIP
    assert.ok(
      pageContent.includes("/downloads/voidzone-browser-extension-latest.zip"),
      "Download button must point to /downloads/voidzone-browser-extension-latest.zip"
    );

    // Must reference release metadata and SHA-256
    assert.ok(
      pageContent.includes("EXTENSION_RELEASE.sha256"),
      "Must display cryptographic SHA-256 hash"
    );

    // Must be labeled as beta
    assert.ok(
      pageContent.includes("Beta Release") && pageContent.includes("Controlled Beta Release"),
      "Must clearly label the release as a controlled beta"
    );
  });

  test("8. Extension download page includes installation steps, manual install notice, and feedback section", () => {
    const dashboardExtensionPath = path.join(FRONTEND_DIR, "src", "app", "dashboard", "extension", "page.tsx");
    const pageContent = fs.readFileSync(dashboardExtensionPath, "utf8");

    // All required installation steps
    assert.ok(pageContent.includes("Download ZIP"), "Must include 'Download ZIP' step");
    assert.ok(pageContent.includes("Extract ZIP"), "Must include 'Extract ZIP' step");
    assert.ok(pageContent.includes("chrome://extensions"), "Must include 'chrome://extensions' step");
    assert.ok(pageContent.includes("Developer Mode"), "Must include 'Developer Mode' step");
    assert.ok(pageContent.includes("Load unpacked"), "Must include 'Load unpacked' step");
    assert.ok(pageContent.includes("manifest.json"), "Must instruct selecting folder with manifest.json");

    // Manual beta notice
    assert.ok(
      pageContent.includes("Manual Beta Installation Notice") &&
        pageContent.includes("Chrome Web Store"),
      "Must explain manual installation vs Chrome Web Store"
    );

    // Beta feedback section
    assert.ok(
      pageContent.includes("Beta Feedback & Issue Reporting"),
      "Must include beta feedback reporting section"
    );
  });

  test("9. Latest ZIP matches canonical SHA-256 hash", () => {
    const latestZipPath = path.join(DOWNLOADS_DIR, "voidzone-browser-extension-latest.zip");
    assert.ok(fs.existsSync(latestZipPath), "voidzone-browser-extension-latest.zip must exist");

    const buffer = fs.readFileSync(latestZipPath);
    const actualSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const expectedSha256 = "4b602c6950094cfa5d76bf0c39d819f351e38adb257f78dddf814dfebdd3e20f";

    assert.equal(actualSha256, expectedSha256, "Latest ZIP SHA-256 must match the expected checksum");
  });
});
