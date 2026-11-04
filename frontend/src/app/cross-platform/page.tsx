import React from "react"
import { Metadata } from "next"
import Link from "next/link"
import {
  Globe,
  Sparkles,
  ArrowRight,
  Shield,
  Layers,
  Brain,
  Puzzle,
  Blocks,
  Mic,
  Bot,
  CheckCircle2,
  Clock,
  ArrowDown,
  Terminal,
  Database,
  Lock,
  Workflow,
  RefreshCw,
} from "lucide-react"
import { FloatingNavbar } from "@/components/layout/floating-navbar"
import { Footer } from "@/components/layout/footer"
import { AmbientBackground } from "@/components/layout/ambient-background"
import { Button } from "@/components/ui/button"
import { EXTENSION_RELEASE } from "@/lib/extension-release"

export const metadata: Metadata = {
  title: "Cross-Platform AI Memory — VOIDZONE",
  description:
    "Preserve project context, architectural decisions, and user preferences across independent AI assistants. Unify ChatGPT, Claude, Gemini, and IDE workflows with persistent memory.",
}

const PLATFORMS = [
  {
    id: "chatgpt",
    name: "ChatGPT Browser Extension",
    category: "Browser Extension",
    status: "Available",
    statusColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    icon: Puzzle,
    description:
      "Direct browser integration for ChatGPT. Ingests live dialogue, preserves turn provenance locally, and sends user-triggered memory extractions to your VOIDZONE backend.",
    support: "Google Chrome (Manifest V3)",
    ctaText: "Get Extension",
    ctaHref: "/dashboard/extension",
    isAvailable: true,
    features: [
      "Live MutationObserver turn capture",
      "Cryptographic epoch observation baseline",
      "Zero prompt-leaking client architecture",
      "Local-first continuity export and import",
    ],
  },
  {
    id: "claude",
    name: "Claude Integration",
    category: "Assistant Connector",
    status: "Coming Soon",
    statusColor: "text-primary bg-primary/10 border-primary/30",
    icon: Bot,
    description:
      "Seamless context synchronization for Claude chats and projects. Carry over project architecture and coding standards into Claude sessions without copy-pasting.",
    support: "Planned Integration",
    ctaText: "Roadmap Preview",
    ctaHref: "#continuity",
    isAvailable: false,
    features: [
      "Artifact-aware memory extraction",
      "Scoped Claude project memory bridge",
      "Model Context Protocol (MCP) transport",
      "Automated decision recall injection",
    ],
  },
  {
    id: "gemini",
    name: "Gemini Integration",
    category: "Multimodal Assistant",
    status: "Coming Soon",
    statusColor: "text-primary bg-primary/10 border-primary/30",
    icon: Sparkles,
    description:
      "Deep integration with Google Gemini web interface and developer APIs. Unifies Google AI workspace context with your centralized VOIDZONE memory layer.",
    support: "Planned Integration",
    ctaText: "Roadmap Preview",
    ctaHref: "#continuity",
    isAvailable: false,
    features: [
      "Long-context window memory indexing",
      "Google Workspace cross-reference support",
      "Multimodal prompt decision anchoring",
      "Semantic similarity search over sessions",
    ],
  },
  {
    id: "plugins",
    name: "Cross-Platform Plugins",
    category: "Developer Tooling",
    status: "Coming Soon",
    statusColor: "text-primary bg-primary/10 border-primary/30",
    icon: Blocks,
    description:
      "Native plugins for VS Code, JetBrains, Cursor, and command-line developer agents. Query and commit project memories straight from your editor canvas.",
    support: "In Development",
    ctaText: "Learn More",
    ctaHref: "/dashboard/plugins",
    isAvailable: false,
    features: [
      "In-editor semantic memory inspector",
      "Git commit & PR decision harvesting",
      "Zero-latency local vector cache",
      "Team and workspace actor isolation",
    ],
  },
  {
    id: "beru",
    name: "Beru Voice Agent",
    category: "Voice Assistant",
    status: "Coming Soon",
    statusColor: "text-primary bg-primary/10 border-primary/30",
    icon: Mic,
    description:
      "Autonomous voice-first AI companion equipped with persistent memory. Log architectural decisions, discuss specs during pairing, and retrieve past notes hands-free.",
    support: "In Development",
    ctaText: "Learn More",
    ctaHref: "/dashboard/beru",
    isAvailable: false,
    features: [
      "Low-latency voice turn ingestion",
      "Spoken decision & requirement classification",
      "Cross-modal recall into ChatGPT and IDE",
      "Strict privacy & ephemeral audio buffer",
    ],
  },
]

const PIPELINE_STEPS = [
  {
    step: "01",
    title: "Live Turn Observation",
    description:
      "Conversational turns are captured with cryptographic identity hashes and turn-level provenance. The user retains full control via active capture toggles.",
    icon: EyeIcon,
  },
  {
    step: "02",
    title: "Zero-Leakage Local Buffer",
    description:
      "Raw dialogue remains in isolated client storage. Unsent or unauthorized turns are discarded across epoch transitions to preserve absolute privacy.",
    icon: Shield,
  },
  {
    step: "03",
    title: "Structured Knowledge Extraction",
    description:
      "The VOIDZONE backend classifies text into discrete memory categories (Fact, Preference, Goal, Context, Skill) with strict actor and project boundaries.",
    icon: Brain,
  },
  {
    step: "04",
    title: "Cross-Assistant Recall",
    description:
      "Stored memories are indexed as pgvector embeddings. Any connected assistant or SDK query surfaces the exact past context when relevant.",
    icon: RefreshCw,
  },
]

function EyeIcon({ className }: { className?: string }) {
  return <Workflow className={className} />
}

export default function CrossPlatformPage() {
  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col">
      <AmbientBackground />
      <FloatingNavbar />

      <main className="flex-1 relative z-10 pt-24 pb-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 space-y-20">

          {/* Hero Section */}
          <section className="text-center max-w-3xl mx-auto pt-6 sm:pt-12 space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-surface-elevated/80 px-3.5 py-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground shadow-xs">
              <Globe className="h-3.5 w-3.5 text-primary" />
              <span>Cross-Platform Memory Architecture</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-foreground leading-[1.15]">
              One Unified Memory Across All Your AI Assistants
            </h1>

            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
              Every major AI assistant operates in an isolated silo. VOIDZONE provides the missing persistent memory infrastructure: preserving project context, architectural decisions, and preferences across independent tools.
            </p>

            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="rounded-full px-6 font-medium bg-foreground text-background hover:bg-foreground/90 shadow-sm cursor-pointer">
                <Link href="/dashboard/extension">
                  Install ChatGPT Extension ({EXTENSION_RELEASE.version}) <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="rounded-full px-6 font-medium border-border/80 bg-surface-elevated/60 hover:bg-surface-elevated cursor-pointer">
                <Link href="#availability">
                  Explore Ecosystem
                </Link>
              </Button>
            </div>
          </section>

          {/* Section: The Problem & The Solution */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            {/* The Problem — Refined with subtle graphite/blue-tinted surface, no red */}
            <div className="rounded-xl border border-border/80 bg-surface-elevated/60 p-6 sm:p-8 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="text-[11px] font-mono uppercase tracking-wider text-primary font-semibold flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  The Multi-Assistant Amnesia Problem
                </div>
                <h3 className="text-xl font-semibold text-foreground">
                  Starting over with every new chat thread
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  You spend 30 minutes explaining your database schema and coding conventions in ChatGPT. Later, you switch to Claude or start a new branch: the assistant has zero recollection. You are forced into repetitive copy-pasting, bloated system prompts, and context degradation.
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-surface-subtle/50 p-3 text-xs font-mono text-muted-foreground">
                Fragmented chat histories · Redundant onboarding · Silent drift
              </div>
            </div>

            {/* The Solution — Continuity Architecture */}
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 sm:p-8 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="text-[11px] font-mono uppercase tracking-wider text-primary font-semibold flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  The VOIDZONE Continuity Architecture
                </div>
                <h3 className="text-xl font-semibold text-foreground">
                  Durable, scoped memory that follows your workflow
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  VOIDZONE captures verifiable decisions, technical preferences, and constraints directly from live conversations. Memories are structured into classified facts and indexed as vector embeddings. When you open another assistant, the same context is instantly queryable.
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-surface-elevated/40 p-3 text-xs font-mono text-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Zero prompt-stuffing · Scoped per project & actor · Fully searchable</span>
              </div>
            </div>
          </section>

          {/* Section: Platform Availability Matrix */}
          <section id="availability" className="space-y-6 scroll-mt-24">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border/60 pb-4">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Ecosystem Support Matrix
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  Supported Platforms & Roadmap
                </h2>
              </div>
              <div className="text-xs font-mono text-muted-foreground">
                1 Production Ready · 4 In Active Development
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PLATFORMS.map((platform) => {
                const Icon = platform.icon
                return (
                  <div
                    key={platform.id}
                    className={`rounded-xl border p-5 sm:p-6 flex flex-col justify-between transition-all duration-200 ${
                      platform.isAvailable
                        ? "border-primary/40 bg-surface-elevated/80 shadow-md shadow-primary/5 ring-1 ring-primary/20 md:col-span-2"
                        : "border-border/60 bg-surface-elevated/40"
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${
                            platform.isAvailable
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border/60 bg-surface-subtle text-muted-foreground"
                          }`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="text-base font-semibold text-foreground flex items-center gap-2">
                              {platform.name}
                              {platform.isAvailable && (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-primary/20 text-primary border border-primary/30">
                                  Production
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {platform.category} · {platform.support}
                            </div>
                          </div>
                        </div>

                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-mono font-medium ${platform.statusColor}`}>
                          {platform.status}
                        </span>
                      </div>

                      <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed mb-4">
                        {platform.description}
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
                        {platform.features.map((feat, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-xs text-foreground/90 font-mono">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                            <span className="truncate">{feat}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-4 border-t border-border/40 flex items-center justify-between">
                      <span className="text-xs font-mono text-muted-foreground">
                        {platform.isAvailable
                          ? `Manifest V3 · v${EXTENSION_RELEASE.version} · Free Unpacked Distribution`
                          : "Integration in research & testing pipeline"}
                      </span>
                      {platform.isAvailable ? (
                        <Button asChild size="sm" className="rounded-md font-medium text-xs bg-primary text-primary-foreground hover:bg-primary-hover transition-colors">
                          <Link href={platform.ctaHref}>
                            {platform.ctaText} <ArrowRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      ) : (
                        <Button asChild variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground">
                          <Link href={platform.ctaHref}>
                            {platform.ctaText} →
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Section: Continuity & Knowledge Extraction Pipeline */}
          <section id="continuity" className="space-y-8 scroll-mt-24">
            <div className="max-w-2xl">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                Data Plane Architecture
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-foreground mb-3">
                How Conversation Turns Become Reusable Knowledge
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                VOIDZONE does not record entire chat sessions as raw unstructured dumps. Instead, each turn goes through a verified, local-first capture lifecycle before extraction.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {PIPELINE_STEPS.map((pipe) => {
                const Icon = pipe.icon
                return (
                  <div
                    key={pipe.step}
                    className="rounded-xl border border-border/60 bg-surface-elevated/40 p-5 flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-primary">
                          {pipe.step}
                        </span>
                        <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-surface-elevated text-muted-foreground">
                          <Icon className="h-3.5 w-3.5 text-primary" />
                        </div>
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {pipe.title}
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {pipe.description}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Section: Security, Privacy & API Credentials */}
          <section className="rounded-xl border border-border/80 bg-surface-elevated/60 p-6 sm:p-8 space-y-4">
            <div className="flex items-center gap-2 text-xs font-mono text-primary uppercase tracking-wider font-semibold">
              <Shield className="h-4 w-4" />
              <span>Strict Security & Privacy Guarantees</span>
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              Zero Model Secrets in Browser Clients
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2 text-xs text-muted-foreground leading-relaxed">
              <div className="space-y-1.5">
                <span className="font-semibold text-foreground block font-mono text-[11px]">
                  Server-Side Model Credentials
                </span>
                <p>
                  Meta Model API keys (OpenAI, Anthropic, Gemini) are strictly managed on your secure VOIDZONE backend. The browser extension NEVER holds LLM API keys.
                </p>
              </div>
              <div className="space-y-1.5">
                <span className="font-semibold text-foreground block font-mono text-[11px]">
                  Kairo Access Token Auth
                </span>
                <p>
                  The extension communicates with the VOIDZONE data plane using your scoped Kairo API key. All network traffic is encrypted over HTTPS with HMAC integrity.
                </p>
              </div>
              <div className="space-y-1.5">
                <span className="font-semibold text-foreground block font-mono text-[11px]">
                  Epoch Isolation & Invalidation
                </span>
                <p>
                  Toggling Memory OFF immediately severs capture listeners and flushes observer state. Off-period messages can never leak across epoch boundaries.
                </p>
              </div>
            </div>
          </section>

          {/* Final Call to Action */}
          <section className="text-center rounded-2xl border border-border/80 bg-surface-elevated/50 p-8 sm:p-12 space-y-5">
            <h2 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight">
              Ready to give your AI assistants persistent memory?
            </h2>
            <p className="text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Download the free VOIDZONE Browser Extension for Google Chrome and start capturing structured project context in seconds.
            </p>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="default" className="rounded-full px-5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90">
                <Link href="/dashboard/extension">
                  Install Browser Extension →
                </Link>
              </Button>
              <Button asChild variant="outline" size="default" className="rounded-full px-5 text-xs font-medium border-border/80 bg-surface-elevated/80">
                <Link href="/register">
                  Create Free Account
                </Link>
              </Button>
            </div>
          </section>

        </div>
      </main>

      <Footer />
    </div>
  )
}
