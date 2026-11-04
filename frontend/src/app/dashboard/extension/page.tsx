"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Download,
  Check,
  Copy,
  Puzzle,
  Shield,
  Layers,
  KeyRound,
  ExternalLink,
  ChevronRight,
  Terminal,
  AlertTriangle,
  HelpCircle,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Cpu,
  FileCheck,
  Info,
  Bug,
  MessageSquareWarning,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXTENSION_RELEASE } from "@/lib/extension-release";
import { useProject } from "@/providers/project-provider";

export default function BrowserExtensionPage() {
  const { sessionApiKey } = useProject();
  const [copiedHash, setCopiedHash] = useState(false);

  const handleCopyHash = () => {
    navigator.clipboard.writeText(EXTENSION_RELEASE.sha256).then(() => {
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    });
  };

  const steps = [
    {
      num: "01",
      title: "Download ZIP",
      desc: `Download the packaged VOIDZONE Browser Extension beta archive (${EXTENSION_RELEASE.filename}, ${EXTENSION_RELEASE.sizeKb}) directly to your machine.`,
      action: (
        <Button asChild size="sm" className="h-8 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary-hover">
          <a href="/downloads/voidzone-browser-extension-latest.zip" download="voidzone-browser-extension-latest.zip">
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download ZIP ({EXTENSION_RELEASE.sizeKb})
          </a>
        </Button>
      ),
    },
    {
      num: "02",
      title: "Extract ZIP",
      desc: "Unzip the downloaded file (voidzone-browser-extension-latest.zip) into a dedicated local directory on your machine (e.g., ~/voidzone-extension or C:\\voidzone-extension). Ensure that manifest.json is directly inside the extracted folder.",
    },
    {
      num: "03",
      title: "Open chrome://extensions",
      desc: "Open Google Chrome and navigate to chrome://extensions in your address bar (or go to Menu ⋮ → Extensions → Manage Extensions).",
      code: "chrome://extensions",
    },
    {
      num: "04",
      title: "Enable Developer Mode",
      desc: "In the top-right corner of the Extensions page, toggle the Developer mode switch to ON.",
    },
    {
      num: "05",
      title: "Select 'Load unpacked'",
      desc: "Click the 'Load unpacked' button located on the top-left toolbar of the Extensions page.",
    },
    {
      num: "06",
      title: "Select the extracted folder containing manifest.json",
      desc: "In the file picker dialog, navigate to and select the extracted directory containing manifest.json. Chrome will immediately install and activate the VOIDZONE extension.",
    },
    {
      num: "07",
      title: "Pin to Toolbar & Authenticate",
      desc: "Click the Chrome puzzle piece icon on your toolbar, locate 'AI Memory' (VOIDZONE Browser Extension), and click the pin icon. Open the extension popup to enter your Kairo API key.",
    },
  ];

  const workflowSteps = [
    {
      step: 1,
      title: "Authorized Turn Observation",
      description:
        "When active capture is enabled, the content script observes visible ChatGPT conversation turns via MutationObserver without interfering with user interaction.",
    },
    {
      step: 2,
      title: "Local-First Storage Isolation",
      description:
        "Conversation turns are held securely within Chrome extension local storage. Memory toggle strictly governs epoch boundaries to prevent silent leakage.",
    },
    {
      step: 3,
      title: "User-Triggered Extraction",
      description:
        "Extraction is explicit and user-commanded. When triggered, captured turns are dispatched to your configured VOIDZONE backend endpoint.",
    },
    {
      step: 4,
      title: "Structured Knowledge Synthesis",
      description:
        "The backend analyzes dialogue, extracts discrete memories (Fact, Preference, Goal, Context, Skill), and generates vector embeddings.",
    },
    {
      step: 5,
      title: "Continuity Archive Generation",
      description:
        "Generates portable, SHA-256 verified continuity archives containing conversation decisions, timeline milestones, and extraction summaries.",
    },
    {
      step: 6,
      title: "Multi-Session Context Restoration",
      description:
        "Restores relevant context into subsequent conversations across ChatGPT and developer tools without repeating prompt setup.",
    },
  ];

  const troubleshooting = [
    {
      q: "Extension context invalidated error in ChatGPT console",
      a: "This happens when the extension is updated or reloaded in chrome://extensions while a ChatGPT tab is open. Simply refresh the ChatGPT tab to re-establish the extension runtime connection.",
    },
    {
      q: "HTTP 401 Unauthorized / Invalid API Key",
      a: "Verify that your Kairo API key is correctly configured in the extension popup. You can generate or inspect your keys in the API Keys section of the dashboard.",
    },
    {
      q: "QUOTA_BYTES storage quota warning",
      a: "Chrome restricts extension storage per item. VOIDZONE employs automatic archive chunking and LRU session pruning. Open the extension popup to manage or prune completed sessions.",
    },
    {
      q: "Cannot connect to backend endpoint",
      a: "The extension is pre-configured to connect to the official VOIDZONE backend. If you experience connection errors, verify your internet connection or check the backend status in the extension popup.",
    },
    {
      q: "DOM selector changes after ChatGPT web updates",
      a: "VOIDZONE uses multi-tier evidence-based fallback selectors. If OpenAI updates the DOM layout, reload the page or update to the latest extension patch.",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header & Status Card */}
      <div className="rounded-xl border border-border/80 bg-surface-elevated/60 p-5 sm:p-7 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
                <Puzzle className="h-4 w-4" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                {EXTENSION_RELEASE.name}
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Controlled Beta Release (v{EXTENSION_RELEASE.version}) — Manifest V3 extension for capturing, structuring, and restoring ChatGPT context.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-mono font-medium text-emerald-400">
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Beta Release
            </span>
            <span className="inline-flex items-center rounded-full border border-border/80 bg-surface-subtle px-2.5 py-0.5 text-[11px] font-mono text-muted-foreground">
              {EXTENSION_RELEASE.browser}
            </span>
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-mono text-primary font-medium">
              v{EXTENSION_RELEASE.version} Beta
            </span>
          </div>
        </div>

        {/* Action Bar & Hash Strip */}
        <div className="rounded-lg border border-border/60 bg-surface-subtle/50 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <FileCheck className="h-4 w-4 text-primary" />
              <span>Verified Beta Package (v{EXTENSION_RELEASE.version})</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-muted-foreground">
              <span>File: {EXTENSION_RELEASE.filename}</span>
              <span>•</span>
              <span>Size: {EXTENSION_RELEASE.sizeKb}</span>
              <span>•</span>
              <span>Release Date: {EXTENSION_RELEASE.releaseDate}</span>
              <span>•</span>
              <span className="text-emerald-400">Controlled Public Beta</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button asChild size="sm" className="h-9 px-4 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary-hover shadow-xs cursor-pointer">
              <a href="/downloads/voidzone-browser-extension-latest.zip" download="voidzone-browser-extension-latest.zip">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download Beta (.zip)
              </a>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9 px-3 text-xs font-medium border-border/70 bg-surface-elevated hover:bg-surface-elevated/80 cursor-pointer">
              <a href={EXTENSION_RELEASE.downloadUrl} download={EXTENSION_RELEASE.filename} title="Direct link to versioned archive">
                v{EXTENSION_RELEASE.version} Archive
              </a>
            </Button>
          </div>
        </div>

        {/* SHA-256 Verification Strip */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono border-t border-border/40 pt-3">
          <div className="flex items-center gap-2 text-muted-foreground truncate">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground/70">SHA-256:</span>
            <span className="text-[11px] text-foreground/80 truncate max-w-md select-all">
              {EXTENSION_RELEASE.sha256}
            </span>
          </div>
          <button
            onClick={handleCopyHash}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline cursor-pointer shrink-0"
          >
            {copiedHash ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>Copy Checksum</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Manual Beta Installation Notice */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary shrink-0 mt-0.5">
          <Info className="h-4 w-4" />
        </div>
        <div className="space-y-1 text-xs">
          <div className="font-semibold text-foreground flex items-center gap-2">
            <span>Manual Beta Installation Notice</span>
            <span className="rounded bg-primary/20 text-primary font-mono text-[10px] px-1.5 py-0.5 font-medium">
              Developer Mode
            </span>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            This is a controlled beta distribution packaged directly from VOIDZONE&apos;s verified build artifacts. It is installed manually via Google Chrome&apos;s Developer Mode rather than through the Chrome Web Store. All dialogue capture, state storage, and archive generation remain local-first on your machine.
          </p>
        </div>
      </div>

      {/* Critical Security & Credential Isolation Architecture */}
      <div className="rounded-xl border border-border/80 bg-surface-elevated/60 p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 text-xs font-mono font-semibold uppercase tracking-wider text-primary">
          <Shield className="h-4 w-4" />
          <span>Security & Credential Management Architecture</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs leading-relaxed">
          <div className="rounded-lg border border-border/60 bg-surface-subtle/40 p-4 space-y-2">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-primary" />
              <span>Backend-Managed Meta Model Credentials</span>
            </div>
            <p className="text-muted-foreground">
              Third-party AI provider credentials are managed securely server-side by the VOIDZONE backend.{" "}
              <strong className="text-foreground">
                Never place third-party LLM secrets inside browser extension configuration.
              </strong>
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-surface-subtle/40 p-4 space-y-2">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-emerald-400" />
              <span>Kairo Data Plane Authentication</span>
            </div>
            <p className="text-muted-foreground">
              The browser extension uses your scoped <strong className="text-foreground">Kairo API key</strong> to authenticate requests to the backend memory API. You can generate and inspect Kairo keys anytime in{" "}
              <Link href="/dashboard/api-keys" className="text-primary hover:underline">
                API Keys
              </Link>
              .
            </p>
            {sessionApiKey && (
              <div className="mt-2 text-[10.5px] font-mono text-emerald-500 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded">
                ✓ Active session key detected in your developer dashboard.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Step-by-Step Installation Instructions */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Chrome Beta Installation Guide
            </h2>
            <p className="text-xs text-muted-foreground">
              Follow these steps to install the unpacked beta extension in Google Chrome Developer Mode.
            </p>
          </div>
          <span className="text-xs font-mono text-muted-foreground/70 hidden sm:inline-block">
            Direct ZIP download · Unpacked manual installation
          </span>
        </div>

        <div className="space-y-3">
          {steps.map((s) => (
            <div
              key={s.num}
              className="rounded-lg border border-border/60 bg-surface-elevated/40 p-4 flex flex-col sm:flex-row sm:items-start gap-4 transition-colors hover:border-border"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-subtle border border-border/70 font-mono text-xs font-bold text-primary shrink-0">
                {s.num}
              </div>

              <div className="flex-1 space-y-1.5">
                <div className="text-xs font-semibold text-foreground flex items-center justify-between">
                  <span>{s.title}</span>
                  {s.action}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {s.desc}
                </p>
                {s.code && (
                  <div className="pt-1">
                    <code className="rounded bg-surface-subtle px-2 py-0.5 font-mono text-[11px] text-primary border border-border/60 select-all">
                      {s.code}
                    </code>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Beta Feedback & Issue Reporting Section */}
      <div className="rounded-xl border border-border/80 bg-surface-elevated/60 p-5 sm:p-7 space-y-4">
        <div className="flex items-center gap-2 text-xs font-mono font-semibold uppercase tracking-wider text-primary">
          <Bug className="h-4 w-4" />
          <span>Beta Feedback & Issue Reporting</span>
        </div>

        <div className="space-y-3 text-xs leading-relaxed">
          <p className="text-muted-foreground">
            As a controlled beta release (<strong className="text-foreground">v{EXTENSION_RELEASE.version}</strong>), your feedback is vital for refining capture stability and continuity flows across ChatGPT interface updates.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
            <div className="rounded-lg border border-border/60 bg-surface-subtle/40 p-3.5 space-y-1.5">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <MessageSquareWarning className="h-3.5 w-3.5 text-primary" />
                <span>Helpful Diagnostic Details</span>
              </div>
              <ul className="text-muted-foreground space-y-1 list-disc list-inside text-[11.5px]">
                <li>Operating system and Chrome version (<code className="font-mono text-primary">chrome://version</code>)</li>
                <li>ChatGPT interface mode (standard chat, Canvas, voice transcription)</li>
                <li>Console logs from <code className="font-mono text-primary">chrome://extensions</code> → <em>Inspect views</em></li>
                <li>Capture status indicated in the extension popup header</li>
              </ul>
            </div>

            <div className="rounded-lg border border-border/60 bg-surface-subtle/40 p-3.5 space-y-1.5 flex flex-col justify-between">
              <div>
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Reporting Channel Notice</span>
                </div>
                <p className="text-muted-foreground text-[11.5px] pt-1">
                  Automated in-app bug submission and public ticketing are currently in development for this beta. Please submit diagnostic details and feedback directly through your designated VOIDZONE coordinator or internal team channel.
                </p>
              </div>
              <div className="text-[10.5px] font-mono text-muted-foreground/70 bg-surface-subtle border border-border/50 px-2 py-1 rounded">
                Note: Never transmit confidential transcripts or Kairo API keys in feedback reports.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Extension Workflow Architecture */}
      <div className="rounded-xl border border-border/80 bg-surface-elevated/60 p-5 sm:p-7 space-y-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Extension Capture & Continuity Lifecycle
          </h2>
          <p className="text-xs text-muted-foreground">
            How dialogue flows from ChatGPT through local storage to persistent vector memories.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {workflowSteps.map((ws) => (
            <div
              key={ws.step}
              className="rounded-lg border border-border/60 bg-surface-subtle/40 p-4 space-y-2 flex flex-col justify-between"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary font-mono text-[10px] font-bold">
                    {ws.step}
                  </span>
                  <span className="text-xs font-semibold text-foreground">
                    {ws.title}
                  </span>
                </div>
                <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                  {ws.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Troubleshooting Section */}
      <div className="rounded-xl border border-border/80 bg-surface-elevated/60 p-5 sm:p-7 space-y-4">
        <div className="flex items-center gap-2 text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground">
          <HelpCircle className="h-4 w-4 text-primary" />
          <span>Troubleshooting & Common Questions</span>
        </div>

        <div className="space-y-3 pt-1">
          {troubleshooting.map((item, idx) => (
            <div key={idx} className="rounded-lg border border-border/60 bg-surface-subtle/30 p-3.5 space-y-1 text-xs">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <span className="text-primary font-mono">Q:</span>
                <span>{item.q}</span>
              </div>
              <p className="text-muted-foreground leading-relaxed pl-4">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
