/**
 * scripts/package-beru-extension.mjs
 *
 * BERU Extension Packaging & Distribution Script
 * Packages the independent BERU extension (beru-extension/dist) into a standalone ZIP.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const BERU_DIST = path.join(ROOT_DIR, "beru-extension", "dist");
const MANIFEST_PATH = path.join(ROOT_DIR, "beru-extension", "manifest.json");
const DOWNLOADS_DIR = path.join(ROOT_DIR, "frontend", "public", "downloads");

class ZipArchive {
  constructor() {
    this.entries = [];
  }

  addFile(relativePath, data) {
    const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const uncompressedData = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const crc = zlib.crc32(uncompressedData);
    const compressedData = zlib.deflateRawSync(uncompressedData, { level: 9 });

    this.entries.push({
      name: normalizedPath,
      crc,
      uncompressedSize: uncompressedData.length,
      compressedSize: compressedData.length,
      data: compressedData,
    });
  }

  toBuffer() {
    const localHeaders = [];
    const centralDirectoryHeaders = [];
    let offset = 0;

    const now = new Date();
    const dosTime =
      ((now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds() / 2))) &
      0xffff;
    const dosDate =
      (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) &
      0xffff;

    for (const entry of this.entries) {
      const nameBuffer = Buffer.from(entry.name, "utf8");

      const localHeader = Buffer.alloc(30 + nameBuffer.length);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0x0800, 6);
      localHeader.writeUInt16LE(8, 8);
      localHeader.writeUInt16LE(dosTime, 10);
      localHeader.writeUInt16LE(dosDate, 12);
      localHeader.writeUInt32LE(entry.crc, 14);
      localHeader.writeUInt32LE(entry.compressedSize, 18);
      localHeader.writeUInt32LE(entry.uncompressedSize, 22);
      localHeader.writeUInt16LE(nameBuffer.length, 26);
      localHeader.writeUInt16LE(0, 28);
      nameBuffer.copy(localHeader, 30);

      const localHeaderOffset = offset;
      localHeaders.push(localHeader, entry.data);
      offset += localHeader.length + entry.data.length;

      const cdHeader = Buffer.alloc(46 + nameBuffer.length);
      cdHeader.writeUInt32LE(0x02014b50, 0);
      cdHeader.writeUInt16LE(20, 4);
      cdHeader.writeUInt16LE(20, 6);
      cdHeader.writeUInt16LE(0x0800, 8);
      cdHeader.writeUInt16LE(8, 10);
      cdHeader.writeUInt16LE(dosTime, 12);
      cdHeader.writeUInt16LE(dosDate, 14);
      cdHeader.writeUInt32LE(entry.crc, 16);
      cdHeader.writeUInt32LE(entry.compressedSize, 20);
      cdHeader.writeUInt32LE(entry.uncompressedSize, 24);
      cdHeader.writeUInt16LE(nameBuffer.length, 28);
      cdHeader.writeUInt16LE(0, 30);
      cdHeader.writeUInt16LE(0, 32);
      cdHeader.writeUInt16LE(0, 34);
      cdHeader.writeUInt16LE(0, 36);
      cdHeader.writeUInt32LE(0, 38);
      cdHeader.writeUInt32LE(localHeaderOffset, 42);
      nameBuffer.copy(cdHeader, 46);

      centralDirectoryHeaders.push(cdHeader);
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const cdh of centralDirectoryHeaders) {
      cdSize += cdh.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localHeaders, ...centralDirectoryHeaders, eocd]);
  }
}

function collectFiles(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      files.push({ fullPath, relPath });
    }
  }

  return files;
}

export function packageBeruExtension() {
  console.log("=============================================================");
  console.log("  BERU EXTENSION PACKAGING");
  console.log("=============================================================");

  if (!fs.existsSync(BERU_DIST)) {
    throw new Error(`BERU build directory not found: ${BERU_DIST}. Run 'npm run build' in beru-extension first.`);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const version = manifest.version || "0.1.0";
  console.log(`• Package Name:     ${manifest.name}`);
  console.log(`• Version:          ${version}`);

  const allFiles = collectFiles(BERU_DIST);
  const zip = new ZipArchive();
  const packagedFileNames = [];

  for (const file of allFiles) {
    if (file.relPath.endsWith(".map") || file.relPath.includes("node_modules") || file.relPath.startsWith(".")) {
      continue;
    }

    const content = fs.readFileSync(file.fullPath);
    zip.addFile(file.relPath, content);
    packagedFileNames.push(file.relPath);
  }

  const zipBuffer = zip.toBuffer();
  const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
  const sizeBytes = zipBuffer.length;
  const sizeKb = (sizeBytes / 1024).toFixed(1);

  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  const versionedFileName = `beru-extension-v${version}.zip`;
  const latestFileName = `beru-extension-latest.zip`;

  const versionedFilePath = path.join(DOWNLOADS_DIR, versionedFileName);
  const latestFilePath = path.join(DOWNLOADS_DIR, latestFileName);

  fs.writeFileSync(versionedFilePath, zipBuffer);
  fs.writeFileSync(latestFilePath, zipBuffer);

  const releaseMetadata = {
    name: "BERU Voice Assistant Extension",
    version,
    manifestVersion: manifest.manifest_version || 3,
    status: "Available",
    browser: "Google Chrome",
    targetPlatforms: ["ChatGPT", "Claude"],
    filename: versionedFileName,
    downloadUrl: `/downloads/${versionedFileName}`,
    latestDownloadUrl: `/downloads/${latestFileName}`,
    sha256,
    sizeBytes,
    sizeKb: `${sizeKb} KB`,
    releaseDate: new Date().toISOString().split("T")[0],
    permissions: manifest.permissions || [],
    hostPermissions: manifest.host_permissions || [],
    filesIncluded: packagedFileNames,
  };

  const releaseJsonPath = path.join(DOWNLOADS_DIR, "beru-release.json");
  fs.writeFileSync(releaseJsonPath, JSON.stringify(releaseMetadata, null, 2), "utf8");

  console.log(`• Versioned Archive: ${versionedFilePath} (${sizeKb} KB)`);
  console.log(`• Latest Archive:    ${latestFilePath} (${sizeKb} KB)`);
  console.log(`• SHA-256 Checksum:  ${sha256}`);
  console.log(`• Release Metadata:  ${releaseJsonPath}`);
  console.log("=============================================================");
  console.log("  BERU Packaging Complete: Standalone distribution ready.");
  console.log("=============================================================");

  return releaseMetadata;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    packageBeruExtension();
  } catch (err) {
    console.error("Packaging failed:", err);
    process.exit(1);
  }
}

