"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  Sparkles,
  Database,
  Search,
  Shield,
  Check,
  ArrowRight,
  Cpu,
} from "lucide-react"

interface LifecycleStage {
  id: "remember" | "understand" | "retrieve" | "scope"
  number: string
  title: string
  subtitle: string
  detail: string
}

const STAGES: LifecycleStage[] = [
  {
    id: "remember",
    number: "01",
    title: "Remember",
    subtitle: "Deduplication & Ingestion",
    detail: "Conversations are evaluated in real time. Important facts pass exact-match and semantic duplicate checks before ingestion.",
  },
  {
    id: "understand",
    number: "02",
    title: "Understand",
    subtitle: "Vector Manifold Projection",
    detail: "Memories are classified by type (Preference, Goal, Fact, Context) and transformed into high-dimensional vector embeddings.",
  },
  {
    id: "retrieve",
    number: "03",
    title: "Retrieve",
    subtitle: "Semantic Cosine Search",
    detail: "Natural language questions match against the indexed memory manifold using cosine distance with sub-50ms query latency.",
  },
  {
    id: "scope",
    number: "04",
    title: "Scope",
    subtitle: "Cryptographic Partitioning",
    detail: "Strict actor and project boundaries ensure memories are accessible only to authorized sessions and tenants.",
  },
]

export function MemoryLifecycleSection() {
  const [activeStage, setActiveStage] = React.useState<"remember" | "understand" | "retrieve" | "scope">("remember")

  return (
    <section id="lifecycle" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        
        <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-primary font-semibold mb-3">
            <Cpu className="h-3.5 w-3.5" />
            <span>Product Architecture</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            The Memory Lifecycle.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            How Kairo turns fleeting dialogue into permanent, privacy-isolated, and semantically queryable context.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left: stage selector tabs */}
          <div className="lg:col-span-5 flex flex-col gap-3">
            {STAGES.map((st) => {
              const isActive = activeStage === st.id
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setActiveStage(st.id)}
                  className={cn(
                    "text-left rounded-2xl border p-5 transition-all duration-200 cursor-pointer active:translate-y-px",
                    isActive
                      ? "border-primary/70 bg-surface-elevated/90 backdrop-blur-sm shadow-lg shadow-primary/5 ring-1 ring-primary/25"
                      : "border-border/50 bg-surface-elevated/40 backdrop-blur-sm hover:bg-surface-elevated/70 hover:border-border/70"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn("font-mono text-xs font-semibold", isActive ? "text-primary" : "text-muted-foreground")}>
                      {st.number} · {st.title}
                    </span>
                    <span className="font-mono text-[10px] uppercase text-muted-foreground/70">{st.subtitle}</span>
                  </div>
                  <p className="text-xs sm:text-[13px] text-muted-foreground leading-relaxed">{st.detail}</p>
                </button>
              )
            })}
          </div>

          {/* Right: dynamic specimen panel */}
          <div className="lg:col-span-7 rounded-2xl border border-border/60 bg-surface-elevated/80 backdrop-blur-sm p-6 sm:p-8 shadow-xl shadow-black/5 dark:shadow-black/20 min-h-[420px] flex flex-col justify-between">
            
            <div className="flex items-center justify-between border-b border-border/40 pb-3 mb-6 font-mono text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary" />
                <span className="font-semibold text-foreground uppercase">Stage: {activeStage.toUpperCase()}</span>
              </div>
              <span>Live DOM Visualization</span>
            </div>

            {activeStage === "remember" && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                  <span className="font-mono text-[10px] uppercase text-muted-foreground block mb-2">Ingested Payload</span>
                  <div className="font-mono text-xs text-foreground/90 leading-relaxed bg-surface-subtle/60 p-3 rounded-lg border border-border/40">
                    <div>POST /api/v1/memories</div>
                    <div className="text-muted-foreground mt-1">&#123; &quot;content&quot;: &quot;Prefers PostgreSQL&quot;, &quot;actorId&quot;: &quot;usr_99&quot; &#125;</div>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs font-mono text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Deduplication check passed: 0 existing conflicts</span>
                </div>
                <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/5 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Check className="h-4 w-4 text-emerald-400" />
                    <div>
                      <div className="font-mono text-xs font-semibold text-foreground">Memory Crystallized</div>
                      <div className="text-[11px] text-muted-foreground">Preference: Prefers PostgreSQL</div>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-400 bg-emerald-500/10">Status: Stored</span>
                </div>
              </div>
            )}

            {activeStage === "understand" && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                  <span className="font-mono text-[10px] uppercase text-muted-foreground block mb-2">Entity &amp; Type Classification</span>
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="p-2.5 rounded border border-blue-500/30 bg-blue-500/5 text-blue-400">
                      <div>Type: Preference</div>
                      <div className="text-[10px] text-muted-foreground">High Durability</div>
                    </div>
                    <div className="p-2.5 rounded border border-purple-500/30 bg-purple-500/5 text-purple-400">
                      <div>Domain: Database</div>
                      <div className="text-[10px] text-muted-foreground">Tech Stack Entity</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-border/60 bg-surface-subtle/60 p-4 font-mono text-xs">
                  <span className="text-[10px] uppercase text-muted-foreground block mb-1">Vector Embedding Representation</span>
                  <div className="text-muted-foreground/90 break-all text-[11px] leading-relaxed">
                    [-0.0421, 0.1294, 0.8841, -0.2105, 0.0543, 0.7412, ...] (1536 dim)
                  </div>
                  <div className="mt-2 text-[10px] text-primary flex items-center gap-1.5">
                    <Database className="h-3 w-3" />
                    <span>pgvector index updated in &lt; 15ms</span>
                  </div>
                </div>
              </div>
            )}

            {activeStage === "retrieve" && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                  <span className="font-mono text-[10px] uppercase text-muted-foreground block mb-1">Incoming Semantic Query</span>
                  <p className="text-xs font-medium text-foreground">&quot;What database does this user prefer?&quot;</p>
                </div>
                <div className="rounded-xl border border-primary/35 bg-primary/5 p-4">
                  <div className="flex items-center justify-between text-xs font-mono mb-2">
                    <span className="text-primary font-semibold">Matched Vector Hit</span>
                    <span className="text-emerald-400">Score: 0.94</span>
                  </div>
                  <p className="text-xs text-foreground/90 font-medium">&quot;Prefers PostgreSQL for new projects&quot;</p>
                  <div className="mt-2 text-[10px] font-mono text-muted-foreground">
                    Retrieved from indexed cluster · Ready for prompt injection
                  </div>
                </div>
              </div>
            )}

            {activeStage === "scope" && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                  <span className="font-mono text-[10px] uppercase text-muted-foreground block mb-2">Tenant &amp; Actor Security Envelope</span>
                  <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                    <div className="p-3 rounded border border-border/50 bg-surface-subtle/60">
                      <div className="text-foreground font-semibold">Actor: usr_alex</div>
                      <div className="text-[10.5px] text-emerald-400 mt-1">✓ Access Granted</div>
                    </div>
                    <div className="p-3 rounded border border-border/50 bg-surface-subtle/60 opacity-60">
                      <div className="text-foreground font-semibold">Actor: usr_maya</div>
                      <div className="text-[10.5px] text-rose-400 mt-1">✗ Access Denied</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-3">
                  <Shield className="h-5 w-5 text-emerald-400 shrink-0" />
                  <div className="text-xs">
                    <div className="font-semibold text-foreground">Cryptographic Isolation Active</div>
                    <div className="text-muted-foreground text-[11px] mt-0.5">
                      No query can cross actor boundaries, even within the same organization.
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 pt-3 border-t border-border/40 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
              <span>Automatic Lifecycle Pipeline</span>
              <span className="text-primary font-medium">Ready for Production</span>
            </div>

          </div>

        </div>

      </div>
    </section>
  )
}