"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface SdkOption {
  id: string
  label: string
  language: string
  snippet: string
  notes: string
}

const SDK_OPTIONS: SdkOption[] = [
  {
    id: "python",
    label: "Python SDK",
    language: "python",
    snippet: `from voidzone import Voidzone

client = Voidzone(api_key="vz_live_...")

# Store durable memory
memory = client.memories.create(
    content="User prefers succinct TypeScript over JavaScript",
    memory_type="Preference",
    actor_id="user_482"
)

# Recall relevant context semantically
recalled = client.memories.search(
    query="What language preference does this user have?",
    actor_id="user_482",
    limit=3
)`,
    notes: "pip install voidzone-sdk",
  },
  {
    id: "nodejs",
    label: "TypeScript / Node",
    language: "typescript",
    snippet: `import { VoidzoneClient } from "@voidzone/sdk";

const vz = new VoidzoneClient({
  apiKey: process.env.VOIDZONE_API_KEY!
});

// Create scoped memory
await vz.memories.create({
  content: "Prefers PostgreSQL with pgvector for embedding workloads",
  memoryType: "Preference",
  actorId: "dev_99"
});

// Semantic retrieval
const results = await vz.memories.search({
  query: "Database preferences for embedding stores",
  actorId: "dev_99"
});`,
    notes: "npm install @voidzone/sdk",
  },
  {
    id: "mcp",
    label: "MCP Protocol",
    language: "json",
    snippet: `{
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
    notes: "Connect AI tools and agents to VOIDZONE's persistent memory through the Model Context Protocol.",
  },
]

export function SdkMcpSection() {
  const [activeId, setActiveId] = React.useState<string>("python")
  const activeOption = SDK_OPTIONS.find((o) => o.id === activeId) || SDK_OPTIONS[0]
  const [copied, setCopied] = React.useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(activeOption.snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="relative border-t border-border/80 bg-surface-elevated/40 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        
        {/* Section Header */}
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">
            07 / Tooling & SDKs
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            Integrate anywhere in minutes.
          </h2>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Whether using Python agents, Node.js microservices, or standard Model Context Protocol (MCP) clients, VOIDZONE seamlessly binds to your execution stack.
          </p>
        </div>

        {/* Minimal Developer Terminal Box */}
        <div className="mt-12 rounded-xl border border-border/80 bg-surface-elevated overflow-hidden shadow-xl">
          
          {/* Top Bar: Tabs & Copy */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-surface-subtle/70 px-4 sm:px-6 py-3">
            <div className="flex items-center gap-2">
              {SDK_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setActiveId(opt.id)}
                  className={cn(
                    "rounded-md px-3 py-1 font-mono text-xs transition-colors cursor-pointer border",
                    opt.id === activeId
                      ? "border-primary/60 bg-primary/10 text-primary font-medium"
                      : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px] text-muted-foreground hidden sm:inline">
                {activeOption.notes}
              </span>
              <button
                onClick={handleCopy}
                className="rounded border border-border/60 bg-surface-elevated px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer"
              >
                {copied ? "Copied ✓" : "Copy Code"}
              </button>
            </div>
          </div>

          {/* Code Window */}
          <div className="p-5 sm:p-6 bg-background/95 font-mono text-xs overflow-x-auto text-foreground/90 leading-relaxed">
            <pre><code>{activeOption.snippet}</code></pre>
          </div>

          {/* Footer note for MCP / SDK */}
          <div className="border-t border-border/50 bg-surface-subtle/30 px-6 py-3 text-[11px] font-mono text-muted-foreground flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>{activeOption.notes}</span>
            <span>Zero proprietary lock-in</span>
          </div>

        </div>

      </div>
    </section>
  )
}
