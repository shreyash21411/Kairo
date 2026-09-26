import React from "react"
import { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, ArrowDown, Terminal, FileCode, Code2, Cpu, Layers, ChevronRight, Zap } from "lucide-react"
import { FloatingNavbar } from "@/components/layout/floating-navbar"
import { Footer } from "@/components/layout/footer"
import { AmbientBackground } from "@/components/layout/ambient-background"

export const metadata: Metadata = {
  title: "Developer Hub — Kairo",
  description: "Build with Kairo. Integrate persistent AI memory via REST API, Python SDK, Node.js SDK, or Model Context Protocol.",
}

const INTEGRATION_PATHS = [
  {
    id: "api",
    icon: Terminal,
    label: "REST API",
    subtitle: "Direct HTTP integration",
    description: "Any language, any runtime. Authenticate with your API key and POST to our endpoints. Full control over every request.",
    href: "/developers/api",
    install: "Authorization: Bearer <API_KEY>",
    badge: "HTTP",
    badgeColor: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  },
  {
    id: "python",
    icon: FileCode,
    label: "Python SDK",
    subtitle: "pip install kairo",
    description: "Official Python client built on httpx. Typed dataclasses, automatic retry logic, and context manager support.",
    href: "/developers/python",
    install: "pip install kairo",
    badge: "Python 3.10+",
    badgeColor: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  },
  {
    id: "node",
    icon: Code2,
    label: "Node.js SDK",
    subtitle: "npm install @kairo/sdk",
    description: "Official TypeScript/JavaScript client built on native fetch. Full type coverage and tree-shakeable exports.",
    href: "/developers/node",
    install: "npm install @kairo/sdk",
    badge: "Node ≥ 18",
    badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  },
  {
    id: "mcp",
    icon: Cpu,
    label: "Model Context Protocol",
    subtitle: "Native MCP integration",
    description: "Connect any MCP-compatible AI app directly to Kairo. Tools: remember, recall, update, forget. No SDK required.",
    href: "/developers/mcp",
    install: "Authorization: Bearer <API_KEY>",
    badge: "MCP v1",
    badgeColor: "text-purple-400 bg-purple-500/10 border-purple-500/30",
  },
]

const QUICK_LINKS = [
  { label: "Authentication", href: "/developers/api#authentication", desc: "API key setup & headers" },
  { label: "Create a Memory", href: "/developers/api#create-memory", desc: "POST /api/v1/memories" },
  { label: "Search Memories", href: "/developers/api#search", desc: "Semantic vector recall" },
  { label: "Python Quick Start", href: "/developers/python#quickstart", desc: "3-line integration" },
  { label: "Node.js Quick Start", href: "/developers/node#quickstart", desc: "TypeScript example" },
  { label: "MCP Configuration", href: "/developers/mcp#configuration", desc: "JSON config for agents" },
  { label: "Dashboard Playground", href: "/dashboard/playground", desc: "Test API interactively" },
  { label: "API Keys", href: "/dashboard/api-keys", desc: "Create & manage keys" },
]

export default function DevelopersPage() {
  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col">
      <AmbientBackground />
      <FloatingNavbar />

      <main className="flex-1 relative z-10 pt-24 pb-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">

          {/* Page Header */}
          <div className="mb-14 max-w-2xl">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-surface-elevated/60 px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                <Layers className="h-3 w-3 text-primary" />
                <span>Developer Hub</span>
              </div>
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground mb-4">
              Build with Kairo
            </h1>
            <p className="text-base text-muted-foreground leading-relaxed">
              Give your AI application persistent memory in minutes. Choose your integration path and follow the documentation to your first stored memory.
            </p>
          </div>

          {/* Integration path cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-14">
            {INTEGRATION_PATHS.map((path) => (
              <Link
                key={path.id}
                href={path.href}
                className="group relative rounded-xl border border-border/60 bg-surface-elevated/40 p-5 hover:border-primary/40 hover:bg-surface-elevated/70 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-surface-elevated/80 group-hover:border-primary/40 transition-colors">
                      <path.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{path.label}</div>
                      <div className="text-[11px] text-muted-foreground">{path.subtitle}</div>
                    </div>
                  </div>
                  <span className={`inline-flex items-center rounded-[4px] border px-1.5 py-0.5 text-[10px] font-mono font-medium ${path.badgeColor}`}>
                    {path.badge}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mb-4">{path.description}</p>
                <div className="flex items-center justify-between">
                  <code className="rounded bg-surface-elevated/80 border border-border/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground truncate max-w-[200px]">
                    {path.install}
                  </code>
                  <span className="flex items-center gap-1 text-[11px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    Docs <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {/* Quick links grid */}
          <div className="mb-14">
            <h2 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
              <Zap className="h-3 w-3" />
              Quick Links
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {QUICK_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="group flex flex-col gap-1 rounded-md border border-border/50 bg-surface-elevated/30 px-3 py-2.5 hover:border-border hover:bg-surface-elevated/60 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">{link.label}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                  </span>
                  <span className="text-[10px] text-muted-foreground">{link.desc}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Developer journey */}
          <div className="rounded-xl border border-border/60 bg-surface-elevated/30 p-5 sm:p-6">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Your first Kairo integration</h2>
            
            {/* Desktop: 1 → 2 → 3 → 4 → 5 */}
            <div className="hidden lg:flex items-center gap-2 w-full">
              {[
                { stepNum: "1", label: "Create an account", href: "/register" },
                { stepNum: "2", label: "Generate an API key", href: "/dashboard/api-keys" },
                { stepNum: "3", label: "Store your first memory", href: "/developers/api#create-memory" },
                { stepNum: "4", label: "Search semantically", href: "/developers/api#search" },
                { stepNum: "5", label: "Connect your agent", href: "/developers/mcp" },
              ].map((item, i) => (
                <React.Fragment key={item.stepNum}>
                  <Link
                    href={item.href}
                    className="flex-1 min-w-0 group flex items-center gap-2 rounded-lg border border-border/50 bg-surface-elevated/40 px-2.5 py-2 hover:border-primary/40 hover:bg-surface-elevated/80 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-mono font-semibold text-primary">
                      {item.stepNum}
                    </span>
                    <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors truncate">
                      {item.label}
                    </span>
                  </Link>
                  {i < 4 && <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
                </React.Fragment>
              ))}
            </div>

            {/* Tablet: Balanced wrapping two-row layout */}
            <div className="hidden sm:grid lg:hidden grid-cols-2 md:grid-cols-3 gap-2.5 w-full">
              {[
                { stepPad: "01", label: "Create an account", href: "/register" },
                { stepPad: "02", label: "Generate an API key", href: "/dashboard/api-keys" },
                { stepPad: "03", label: "Store first memory", href: "/developers/api#create-memory" },
                { stepPad: "04", label: "Search semantically", href: "/developers/api#search" },
                { stepPad: "05", label: "Connect your agent", href: "/developers/mcp" },
              ].map((item) => (
                <Link
                  key={item.stepPad}
                  href={item.href}
                  className="group flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-surface-elevated/40 p-3 hover:border-primary/40 hover:bg-surface-elevated/80 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-mono font-semibold text-primary">
                      {item.stepPad}
                    </span>
                    <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors truncate">
                      {item.label}
                    </span>
                  </div>
                  <ArrowRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                </Link>
              ))}
            </div>

            {/* Mobile: Vertical sequence with 01 → ↓ → 02 → ↓ */}
            <div className="flex sm:hidden flex-col items-stretch gap-1.5 w-full">
              {[
                { stepPad: "01", label: "Create an account", href: "/register" },
                { stepPad: "02", label: "Generate an API key", href: "/dashboard/api-keys" },
                { stepPad: "03", label: "Store your first memory", href: "/developers/api#create-memory" },
                { stepPad: "04", label: "Search semantically", href: "/developers/api#search" },
                { stepPad: "05", label: "Connect your agent", href: "/developers/mcp" },
              ].map((item, i) => (
                <React.Fragment key={item.stepPad}>
                  <Link
                    href={item.href}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-surface-elevated/40 px-3.5 py-2.5 hover:border-primary/40 hover:bg-surface-elevated/80 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-mono font-semibold text-primary">
                        {item.stepPad}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                        {item.label}
                      </span>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                  </Link>
                  {i < 4 && (
                    <div className="flex justify-center py-0.5">
                      <ArrowDown className="h-3.5 w-3.5 text-muted-foreground/40" />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  )
}

