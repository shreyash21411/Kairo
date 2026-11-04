/**
 * extension-release.ts
 *
 * Source of truth for browser extension release metadata on the frontend.
 * Generated automatically by scripts/package-extension.mjs.
 */

import releaseData from "@/config/extension-release.json";

export interface ExtensionReleaseMetadata {
  name: string;
  version: string;
  manifestVersion: number;
  status: "Available" | "Coming Soon" | "Deprecated";
  browser: string;
  targetPlatform: string;
  filename: string;
  downloadUrl: string;
  latestDownloadUrl: string;
  sha256: string;
  sizeBytes: number;
  sizeKb: string;
  releaseDate: string;
  permissions: string[];
  hostPermissions: string[];
  filesIncluded: string[];
}

export const EXTENSION_RELEASE: ExtensionReleaseMetadata = releaseData as ExtensionReleaseMetadata;

