"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface MemorySpecimen {
  id: string
  type: "Preference" | "Goal" | "Context" | "Skill"
  badgeColor: string
  content: string
  actor: string
  project: string
  createdAt: string
  version: number
  description: string
}

const SPECIMENS: MemorySpecimen[] = [
  {
    id: "mem_pref_801",
    type: "Preference",
    badgeColor: "text-blue-400 border-blue-500/30 bg-blue-500/10",
    content: "Prefers PostgreSQL for new microservices; strictly enforce snake_case schema columns.",
    actor: "lead_architect",
    project: "fintech-core",
    createdAt: "2026-09-12 14:22 UTC",
    version: 1,
    description: "Informs future architectural proposals and database migration suggestions automatically.",
  },
  {
    id: "mem_goal_802",
    type: "Goal",
    badgeColor: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    content: "Migrate auth service from monolithic session cookies to JWT bearer with asymmetric signing.",
    actor: "lead_architect",
    project: "fintech-core",
    createdAt: "2026-09-14 09:10 UTC",
    version: 2,
    description: "Maintains high-level project milestones across long-running autonomous development loops.",
  },
  {
    id: "mem_ctx_803",
    type: "Context",
    badgeColor: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    content: "Currently benchmarking vector query latency with pgvector HNSW indexing on 1M embeddings.",
    actor: "perf_engineer",
    project: "ai-search",
    createdAt: "2026-09-16 18:45 UTC",
    version: 1,
    description: "Preserves temporal developer workspace state across fragmented prompt sessions.",
  },
  {
    id: "mem_skl_804",
    type: "Skill",
    badgeColor: "text-purple-400 border-purple-500/30 bg-purple-500/10",
    content: "Writes idiomatic C# 13 and Next.js 15 App Router code with strict TypeScript zero-any rules.",
    actor: "team_standards",
    project: "enterprise-org",
    createdAt: "2026-09-08 11:30 UTC",
    version: 1,
    description: "Grounds agent code synthesis to organization-wide engineering guidelines.",
  },
]

export function DurableMemorySection() {
  const [selectedId, setSelectedId] = React.useState<string>("mem_pref_801")
  const activeSpecimen = SPECIMENS.find((s) => s.id === selectedId) || SPECIMENS[0]

  return (
    <section className="relative border-t border-border/80 bg-surface-elevated/40 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        
        {/* Editorial Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">
              03 / Durable State Substrate
            </p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
              Not unstructured text. Structured, typed memory.
            </h2>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              Dumping raw chat transcripts into a vector database creates noise. VOIDZONE structures persistent knowledge into typed, versioned memory entities linked to discrete project scopes.
            </p>
          </div>

          <div className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-surface-subtle px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
            <span>Specimens: Illustrative product examples</span>
          </div>
        </div>

        {/* Editorial Specimen Ledger (Asymmetric list + deep preview) */}
        <div className="mt-14 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left: Specimen ledger list (5 cols) */}
          <div className="lg:col-span-5 space-y-2.5">
            {SPECIMENS.map((specimen) => {
              const isSelected = specimen.id === selectedId
              return (
                <button
                  key={specimen.id}
                  onClick={() => setSelectedId(specimen.id)}
                  className={cn(
                    "w-full text-left rounded-lg border p-4 transition-all duration-150 cursor-pointer",
                    isSelected
                      ? "border-primary/50 bg-surface-elevated shadow-sm"
                      : "border-border/50 bg-surface-subtle/20 hover:border-border hover:bg-surface-subtle/50"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn(
                      "font-mono text-[10px] uppercase font-semibold px-2 py-0.5 rounded border",
                      specimen.badgeColor
                    )}>
                      {specimen.type}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      v{specimen.version} · {specimen.actor}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-foreground line-clamp-1">
                    {specimen.content}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Right: Rich Specimen Inspector (7 cols) */}
          <div className="lg:col-span-7 rounded-xl border border-border/80 bg-surface-elevated p-6 sm:p-8 relative">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4 mb-6">
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  "font-mono text-xs uppercase font-semibold px-2.5 py-1 rounded border",
                  activeSpecimen.badgeColor
                )}>
                  {activeSpecimen.type}
                </span>
                <span className="font-mono text-xs text-foreground font-medium">
                  {activeSpecimen.id}
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
                <span>Version {activeSpecimen.version}</span>
                <span>·</span>
                <span>Active</span>
              </div>
            </div>

            {/* Specimen Main Content */}
            <div className="rounded-lg border border-border/70 bg-background/90 p-5 mb-6">
              <div className="font-mono text-[10px] text-muted-foreground uppercase mb-2">
                Memory Content Payload
              </div>
              <blockquote className="text-sm sm:text-base font-medium text-foreground leading-relaxed">
                "{activeSpecimen.content}"
              </blockquote>
            </div>

            {/* Architectural Impact */}
            <div className="mb-6">
              <div className="font-mono text-[10px] text-muted-foreground uppercase mb-1">
                Contextual Function
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                {activeSpecimen.description}
              </p>
            </div>

            {/* Metadata Table */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-5 border-t border-border/50 text-xs">
              <div>
                <div className="font-mono text-[10px] text-muted-foreground uppercase">Project Scope</div>
                <div className="font-mono text-xs text-foreground mt-0.5">{activeSpecimen.project}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-muted-foreground uppercase">Actor Partition</div>
                <div className="font-mono text-xs text-foreground mt-0.5">{activeSpecimen.actor}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-muted-foreground uppercase">Timestamp</div>
                <div className="font-mono text-[11px] text-muted-foreground mt-0.5">{activeSpecimen.createdAt}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-muted-foreground uppercase">Retention</div>
                <div className="font-mono text-[11px] text-primary mt-0.5">Durable (V1)</div>
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  )
}
