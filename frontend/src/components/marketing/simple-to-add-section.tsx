"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Terminal, Copy, Check, ArrowRight, Sparkles, CheckCircle2 } from "lucide-react"

interface CodeSnippet {
  id: "curl" | "python" | "node" | "mcp"
  label: string
  note: string
  code: string
}

const SNIPPETS: CodeSnippet[] = [
  {
    id: "curl",
    label: "cURL / REST",
    note: "Works with any HTTP client or backend runtime",
    code: `curl -X POST https://api.voidzone.dev/api/v1/memories \\
  -H "Authorization: Bearer vz_live_sec_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "Prefers PostgreSQL for new projects",
    "memoryType": "Preference",
    "actorId": "usr_alex_123"
  }'`,
  },
  {
    id: "python",
    label: "Python",
    note: "pip install voidzone-sdk",
    code: `from voidzone import Voidzone

client = Voidzone(api_key="vz_live_sec_...")

# Ingest and embed a memory
memory = client.memories.create(
    content="Prefers PostgreSQL for new projects",
    memory_type="Preference",
    actor_id="usr_alex_123"
)

# Recall relevant context semantically
results = client.memories.search(
    query="What database does this user prefer?",
    actor_id="usr_alex_123"
)`,
  },
  {
    id: "node",
    label: "TypeScript / Node",
    note: "npm install @voidzone/sdk",
    code: `import { VoidzoneClient } from "@voidzone/sdk";

const vz = new VoidzoneClient({
  apiKey: process.env.VOIDZONE_API_KEY
});

// Ingest memory
await vz.memories.create({
  content: "Prefers PostgreSQL for new projects",
  memoryType: "Preference",
  actorId: "usr_alex_123"
});

// Recall context
const results = await vz.memories.search({
  query: "What database does this user prefer?",
  actorId: "usr_alex_123"
});`,
  },
  {
    id: "mcp",
    label: "Model Context Protocol",
    note: "Connect AI coding tools and desktop agents directly",
    code: `{
  "mcpServers": {
    "voidzone": {
      "command": "npx",
      "args": ["-y", "@voidzone/mcp-server"],
      "env": {
        "VOIDZONE_API_KEY": "vz_live_sec_..."
      }
    }
  }
}`,
  },
]

export function SimpleToAddSection() {
  const [activeTab, setActiveTab] = React.useState<"curl" | "python" | "node" | "mcp">("curl")
  const [copied, setCopied] = React.useState(false)

  const current = SNIPPETS.find((s) => s.id === activeTab) || SNIPPETS[0]

  const handleCopy = () => {
    navigator.clipboard.writeText(current.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section id="developers" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        
        <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-primary font-semibold mb-3">
            <Terminal className="h-3.5 w-3.5" />
            <span>Developer Interface</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            Simple to add.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            Give your autonomous agent or application persistent memory with a clean, developer-friendly API.
          </p>
        </div>

        {/* Developer console — product card, transparent section */}
        <div className="rounded-2xl border border-border/60 bg-surface-elevated/80 backdrop-blur-sm overflow-hidden shadow-xl shadow-black/5 dark:shadow-black/20">
          
          {/* Header with tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-surface-subtle/60 px-4 sm:px-6 py-3">
            <div className="flex items-center gap-1.5 sm:gap-2">
              {SNIPPETS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "rounded-lg px-3 py-1 font-mono text-xs transition-all duration-150 cursor-pointer active:translate-y-px border",
                    tab.id === activeTab
                      ? "border-primary/60 bg-primary/10 text-primary font-semibold shadow-xs"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-surface-elevated/70"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline font-mono text-[11px] text-muted-foreground">{current.note}</span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-md border border-border/60 bg-surface-elevated/70 px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer active:translate-y-px"
                aria-label="Copy snippet code"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
          </div>

          {/* Code panel */}
          <div className="p-5 sm:p-7 bg-background/80 font-mono text-xs leading-relaxed overflow-x-auto text-foreground/90">
            <pre><code>{current.code}</code></pre>
          </div>

          {/* Execution flow bar */}
          <div className="border-t border-border/50 bg-surface-subtle/40 px-5 sm:px-7 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-2 text-foreground/90">
                <span className="px-2 py-0.5 rounded border border-border/60 bg-surface-elevated/70 font-semibold">Request</span>
                <ArrowRight className="h-3.5 w-3.5 text-primary" />
                <span className="px-2 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary font-semibold flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  VOIDZONE Engine
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-primary" />
                <span className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  201 Created
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">POST /api/v1/memories · Deduplicated &amp; Vectorized</span>
            </div>
          </div>

        </div>

        {/* Full docs CTA */}
        <div className="mt-8 text-center">
          <a
            href="/developers"
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface-elevated/60 px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            View full API documentation, SDK guides &amp; MCP reference
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>

      </div>
    </section>
  )
}