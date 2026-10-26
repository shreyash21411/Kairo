"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface FlowStep {
  number: string
  title: string
  headline: string
  description: string
  codeSnippet: string
  badge: string
}

const STEPS: FlowStep[] = [
  {
    number: "01",
    title: "Capture & Remember",
    headline: "Transform application events into structured memory objects",
    description: "Ingest agent interactions, tool execution results, or user dialogue via REST endpoints or SDK helpers.",
    codeSnippet: `await vz.memories.create({
  content: "Prefers PostgreSQL and clean architecture for microservices",
  memoryType: "Preference",
  actorId: "actor_dev_01"
})`,
    badge: "POST /api/v1/memories",
  },
  {
    number: "02",
    title: "Understand & Vectorize",
    headline: "Dense semantic embedding with structured classification",
    description: "VOIDZONE generates high-dimensional embeddings and categorizes memory types (Preference, Goal, Fact, Context, Skill, Relationship) for fast multi-modal indexing.",
    codeSnippet: `{
  "embedding": [0.0142, -0.0821, 0.0418, ...],
  "memoryType": "Preference",
  "projectScope": "vz-prod",
  "indexed": true
}`,
    badge: "Vector Embedding Pipeline",
  },
  {
    number: "03",
    title: "Store & Partition",
    headline: "Durable persistence strictly bounded by Project and Actor",
    description: "Memories are written to PostgreSQL pgvector with strict tenant boundaries. Actor A and Actor B never cross-contaminate knowledge.",
    codeSnippet: `// Cryptographically isolated scoping
Scope = ProjectId + ActorId
Active status: Version 1
Deduplication: Exact matches merged`,
    badge: "PostgreSQL pgvector Store",
  },
  {
    number: "04",
    title: "Retrieve & Contextualize",
    headline: "Semantic retrieval of relevant memory and context",
    description: "Execute natural-language vector queries with cosine distance scoring. Relevant memories are injected directly into your agent prompt.",
    codeSnippet: `const matches = await vz.memories.search({
  query: "What database should I suggest for this project?",
  actorId: "actor_dev_01",
  limit: 3
});
// Top match: 94.8% similarity -> Prefers PostgreSQL`,
    badge: "POST /api/v1/memories/search",
  },
]

export function HowItWorksSection() {
  const [activeStep, setActiveStep] = React.useState<number>(0)

  return (
    <section id="how-it-works" className="relative border-t border-border/80 bg-background py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        
        {/* Section Header */}
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">
            02 / Architecture & Flow
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            How VOIDZONE turns dialogue into durable intelligence.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            From raw conversation events to contextual recall: a four-stage pipeline designed for extreme reliability, tenant isolation, and semantic precision.
          </p>
        </div>

        {/* Interactive Step Navigator & Stage Exhibit */}
        <div className="mt-14 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left: Step Selection Column (5 cols) */}
          <div className="lg:col-span-5 space-y-3">
            {STEPS.map((step, idx) => {
              const isSelected = idx === activeStep
              return (
                <button
                  key={step.number}
                  onClick={() => setActiveStep(idx)}
                  className={cn(
                    "w-full text-left rounded-xl border p-4 sm:p-5 transition-all duration-200 cursor-pointer",
                    isSelected
                      ? "border-primary/50 bg-surface-elevated shadow-md shadow-primary/5"
                      : "border-border/60 bg-surface-subtle/30 opacity-70 hover:opacity-100 hover:border-border"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn(
                      "font-mono text-xs font-semibold px-2 py-0.5 rounded",
                      isSelected ? "bg-primary text-primary-foreground" : "bg-surface-elevated text-muted-foreground border border-border"
                    )}>
                      {step.number}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {step.badge}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground tracking-tight">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {step.headline}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Right: Rich Interactive Code & Architecture Canvas (7 cols) */}
          <div className="lg:col-span-7 rounded-xl border border-border/80 bg-surface-elevated p-6 sm:p-8 relative overflow-hidden shadow-2xl">
            <div className="pointer-events-none absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
            
            {/* Stage Title Strip */}
            <div className="flex items-center justify-between border-b border-border/60 pb-4 mb-6">
              <div>
                <span className="font-mono text-xs uppercase tracking-wider text-primary font-semibold">
                  Stage {STEPS[activeStep].number} — {STEPS[activeStep].title}
                </span>
                <p className="text-sm font-medium text-foreground mt-1">
                  {STEPS[activeStep].headline}
                </p>
              </div>
            </div>

            {/* Description Narrative */}
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed mb-6">
              {STEPS[activeStep].description}
            </p>

            {/* Code Block / Data Stream Payload */}
            <div className="relative rounded-lg border border-border/80 bg-background/90 p-4 font-mono text-xs overflow-x-auto shadow-inner">
              <div className="flex items-center justify-between text-muted-foreground/60 text-[10px] border-b border-border/40 pb-2 mb-3">
                <span>payload_preview.ts</span>
                <span>vz-v1.0</span>
              </div>
              <pre className="text-foreground/90 leading-relaxed">
                <code>{STEPS[activeStep].codeSnippet}</code>
              </pre>
            </div>

            {/* Pipeline Guarantee Pill */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border/40 text-[11px] font-mono text-muted-foreground">
              <span>● Semantic Index: active</span>
              <span>Tenant Scope: strict isolation</span>
            </div>
          </div>

        </div>

      </div>
    </section>
  )
}
