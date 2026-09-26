"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface QueryScenario {
  id: string
  query: string
  label: string
  results: {
    type: "Preference" | "Goal" | "Context"
    content: string
    similarity: number
    similarityPercent: string
    reason: string
  }[]
}

const SCENARIOS: QueryScenario[] = [
  {
    id: "db-pref",
    query: "What database does this developer prefer?",
    label: "Database Preference",
    results: [
      {
        type: "Preference",
        content: "Prefers PostgreSQL for new microservices; strictly enforce snake_case schema columns.",
        similarity: 0.948,
        similarityPercent: "94.8%",
        reason: "Direct semantic match on developer persistence choice",
      },
      {
        type: "Context",
        content: "Currently benchmarking vector query latency with pgvector HNSW indexing on 1M embeddings.",
        similarity: 0.912,
        similarityPercent: "91.2%",
        reason: "Active context demonstrates hands-on PostgreSQL/pgvector work",
      },
      {
        type: "Goal",
        content: "Migrate auth service from monolithic session cookies to JWT bearer with asymmetric signing.",
        similarity: 0.742,
        similarityPercent: "74.2%",
        reason: "Related architectural migration within same service",
      },
    ],
  },
  {
    id: "coding-style",
    query: "What code formatting and typing standards should be applied?",
    label: "Code Standards",
    results: [
      {
        type: "Preference",
        content: "Writes idiomatic C# 13 and Next.js 15 App Router code with strict TypeScript zero-any rules.",
        similarity: 0.961,
        similarityPercent: "96.1%",
        reason: "Explicit rule mandate for TypeScript and C# syntax",
      },
      {
        type: "Context",
        content: "Enforce hairline borders and strict dark-first graphite theme across all UI components.",
        similarity: 0.884,
        similarityPercent: "88.4%",
        reason: "Styling token requirement",
      },
      {
        type: "Goal",
        content: "Keep backend frozen and verify all REST endpoints end-to-end.",
        similarity: 0.719,
        similarityPercent: "71.9%",
        reason: "General project operating constraint",
      },
    ],
  },
  {
    id: "active-milestone",
    query: "What is the primary technical objective right now?",
    label: "Current Objective",
    results: [
      {
        type: "Goal",
        content: "Build Kairo into a production AI persistent memory platform with zero session loss.",
        similarity: 0.954,
        similarityPercent: "95.4%",
        reason: "Core platform objective matches query intention",
      },
      {
        type: "Context",
        content: "Currently implementing the developer dashboard and marketing landing experience.",
        similarity: 0.923,
        similarityPercent: "92.3%",
        reason: "Immediate active milestone matching project timeline",
      },
      {
        type: "Preference",
        content: "Prefers PostgreSQL for new microservices; strictly enforce snake_case schema columns.",
        similarity: 0.685,
        similarityPercent: "68.5%",
        reason: "General stack context",
      },
    ],
  },
]

export function SemanticRecallSection() {
  const [activeScenarioId, setActiveScenarioId] = React.useState<string>("db-pref")
  const scenario = SCENARIOS.find((s) => s.id === activeScenarioId) || SCENARIOS[0]

  return (
    <section className="relative border-t border-border/80 bg-background py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        
        {/* Section Header */}
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">
            04 / Semantic Vector Retrieval
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            Recall context by meaning, not exact keywords.
          </h2>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Your agents don't need keyword matching. Kairo indexes high-dimensional vectors and performs semantic retrieval, returning the exact memories needed to answer vague or complex inquiries.
          </p>
        </div>

        {/* Interactive Query Simulator */}
        <div className="mt-12 rounded-xl border border-border/80 bg-surface-elevated p-6 sm:p-8 relative overflow-hidden shadow-xl">
          
          {/* Simulation Header / Scenario Picker */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-5 mb-6">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-primary uppercase">
                Vector Query Simulator
              </span>
              <span className="font-mono text-[10px] text-muted-foreground border border-border/60 rounded px-1.5 py-0.5">
                Illustrative Specimen
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">Select Query:</span>
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveScenarioId(s.id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-mono text-xs transition-colors cursor-pointer border",
                    s.id === activeScenarioId
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border/60 bg-surface-subtle text-muted-foreground hover:text-foreground"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Active Query Input Simulation Bar */}
          <div className="rounded-lg border border-border bg-background p-4 mb-8 flex items-center gap-3">
            <span className="font-mono text-xs text-primary font-bold">QUERY &gt;</span>
            <span className="font-mono text-sm text-foreground flex-1">
              "{scenario.query}"
            </span>
            <span className="font-mono text-[10px] text-muted-foreground bg-surface-subtle px-2 py-1 rounded border border-border/60 hidden sm:inline-block">
              TopK: 3 · Cosine Distance
            </span>
          </div>

          {/* Ranked Semantic Matches */}
          <div className="space-y-4">
            <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
              <span>Retrieved Memory Candidates</span>
              <span>Semantic Similarity</span>
            </div>

            {scenario.results.map((result, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-border/70 bg-surface-subtle/50 p-4 sm:p-5 transition-all hover:border-border hover:bg-surface-subtle/80"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs font-semibold text-muted-foreground">
                      #{idx + 1}
                    </span>
                    <span className={cn(
                      "font-mono text-[10px] uppercase font-semibold px-2 py-0.5 rounded border",
                      result.type === "Preference" && "text-blue-400 border-blue-500/30 bg-blue-500/10",
                      result.type === "Goal" && "text-amber-400 border-amber-500/30 bg-amber-500/10",
                      result.type === "Context" && "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                    )}>
                      {result.type}
                    </span>
                    <span className="text-xs text-muted-foreground hidden md:inline">
                      {result.reason}
                    </span>
                  </div>

                  {/* Similarity Score Indicator */}
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 w-24 bg-border/60 rounded-full overflow-hidden hidden sm:block">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${result.similarity * 100}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs font-bold text-foreground">
                      {result.similarityPercent}
                    </span>
                  </div>
                </div>

                <p className="text-sm font-medium text-foreground/95 leading-relaxed mt-1">
                  "{result.content}"
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 border-t border-border/50 pt-4 flex flex-col sm:flex-row sm:items-center justify-between text-[11px] font-mono text-muted-foreground gap-2">
            <span>Illustrative simulation values based on Kairo cosine vector distance.</span>
            <span>Zero prompt hallucination</span>
          </div>

        </div>

      </div>
    </section>
  )
}
