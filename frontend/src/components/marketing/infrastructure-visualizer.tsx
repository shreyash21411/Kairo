"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface PipelineStage {
  id: string
  step: string
  title: string
  subtitle: string
  tag: string
  meta: string
  detail: {
    type: string
    content: string
    target?: string
  }
}

const STAGES: PipelineStage[] = [
  {
    id: "input",
    step: "01",
    title: "Application",
    subtitle: "Agent / LLM Event",
    tag: "RAW STREAM",
    meta: "actor: dev_sarah",
    detail: {
      type: "User Statement",
      content: "\"I prefer PostgreSQL with Prisma ORM for all new services.\"",
      target: "ChatSession #204",
    },
  },
  {
    id: "ingest",
    step: "02",
    title: "Ingestion",
    subtitle: "Vectorize & Classify",
    tag: "TRANSFORM",
    meta: "dim: 1536 · embedding",
    detail: {
      type: "Extracted Memory",
      content: "Preference: Prefers PostgreSQL with Prisma ORM",
      target: "Type: Preference",
    },
  },
  {
    id: "scope",
    step: "03",
    title: "Scoped Partition",
    subtitle: "Project + Actor Isolation",
    tag: "SECURITY",
    meta: "proj: vz-prod",
    detail: {
      type: "Scope Partition",
      content: "Isolated to [Project: vz-prod] × [Actor: dev_sarah]",
      target: "Zero Cross-Leakage",
    },
  },
  {
    id: "store",
    step: "04",
    title: "Persistent Memory",
    subtitle: "Durable Knowledge Store",
    tag: "STORAGE",
    meta: "durable · indexed",
    detail: {
      type: "Committed Record",
      content: "Memory #481 stored with semantic vector index",
      target: "Active / Version 1",
    },
  },
  {
    id: "recall",
    step: "05",
    title: "Semantic Recall",
    subtitle: "Contextual Injection",
    tag: "CONTEXT",
    meta: "similarity: 94.8%",
    detail: {
      type: "Recalled Context",
      content: "Next session prompt automatically prepended with preference",
      target: "Agent Context Window",
    },
  },
]

export function InfrastructureVisualizer() {
  const [activeStage, setActiveStage] = React.useState<number>(1)
  const [isAutoPlaying, setIsAutoPlaying] = React.useState<boolean>(true)

  // Subtle automatic cycle if user hasn't clicked
  React.useEffect(() => {
    if (!isAutoPlaying) return
    const interval = setInterval(() => {
      setActiveStage((prev) => (prev + 1) % STAGES.length)
    }, 3800)
    return () => clearInterval(interval)
  }, [isAutoPlaying])

  const stage = STAGES[activeStage]

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-border/80 bg-surface-elevated/90 p-4 shadow-2xl backdrop-blur-xl sm:p-6 lg:p-7">
      {/* Decorative hairline grid background */}
      <div className="pointer-events-none absolute inset-0 bg-grid-pattern opacity-15" />
      <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />

      {/* Top telemetry bar */}
      <div className="relative mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3.5">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            VOIDZONE Pipeline Engine
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/40">|</span>
          <span className="font-mono text-[10px] text-muted-foreground/80">
            state: active_pipeline
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAutoPlaying(!isAutoPlaying)}
            className="rounded border border-border/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-border hover:text-foreground transition-colors cursor-pointer"
          >
            {isAutoPlaying ? "pause flow" : "resume flow"}
          </button>
          <span className="font-mono text-[10px] text-muted-foreground/60">
            {stage.meta}
          </span>
        </div>
      </div>

      {/* Desktop Pipeline Visualizer (horizontal flow) */}
      <div className="relative hidden md:block">
        {/* SVG connection bus */}
        <svg
          className="absolute left-0 top-6 h-1 w-full pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <line
            x1="5%"
            y1="50%"
            x2="95%"
            y2="50%"
            stroke="hsl(var(--border))"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <line
            x1="5%"
            y1="50%"
            x2={`${10 + (activeStage / (STAGES.length - 1)) * 80}%`}
            y2="50%"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            className="transition-all duration-500"
          />
        </svg>

        {/* 5 Stage Nodes */}
        <div className="relative grid grid-cols-5 gap-3">
          {STAGES.map((s, idx) => {
            const isActive = idx === activeStage
            const isCompleted = idx < activeStage
            return (
              <button
                key={s.id}
                onClick={() => {
                  setActiveStage(idx)
                  setIsAutoPlaying(false)
                }}
                className={cn(
                  "group relative flex flex-col items-start rounded-lg border p-3 text-left transition-all duration-200 focus-visible:outline-none cursor-pointer",
                  isActive
                    ? "border-primary/60 bg-surface-subtle shadow-md shadow-primary/5"
                    : isCompleted
                    ? "border-border/80 bg-surface-elevated/60 hover:border-border"
                    : "border-border/40 bg-surface-elevated/30 opacity-70 hover:opacity-90"
                )}
              >
                {/* Node indicator */}
                <div className="mb-3 flex items-center justify-between w-full">
                  <div
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10px] font-semibold transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                        : isCompleted
                        ? "border border-primary/40 bg-primary/10 text-primary"
                        : "border border-border bg-surface-subtle text-muted-foreground"
                    )}
                  >
                    {s.step}
                  </div>
                  <span
                    className={cn(
                      "font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
                      isActive
                        ? "border-primary/40 text-primary bg-primary/10"
                        : "border-border/40 text-muted-foreground/60"
                    )}
                  >
                    {s.tag}
                  </span>
                </div>

                <div className="w-full">
                  <div className="text-xs font-semibold text-foreground tracking-tight group-hover:text-foreground">
                    {s.title}
                  </div>
                  <div className="text-[11px] text-muted-foreground line-clamp-1">
                    {s.subtitle}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Mobile Stage Selector (compact pills) */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 md:hidden">
        {STAGES.map((s, idx) => (
          <button
            key={s.id}
            onClick={() => {
              setActiveStage(idx)
              setIsAutoPlaying(false)
            }}
            className={cn(
              "whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-[11px] transition-colors border",
              idx === activeStage
                ? "border-primary/60 bg-primary/10 text-primary font-medium"
                : "border-border/60 bg-surface-subtle/50 text-muted-foreground"
            )}
          >
            {s.step} {s.title}
          </button>
        ))}
      </div>

      {/* Active Phase Deep Dive Console */}
      <div className="mt-5 rounded-lg border border-border/80 bg-background/80 p-4 transition-all">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/40 pb-2.5 mb-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-primary">
              [{stage.step}] {stage.title}
            </span>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-xs text-muted-foreground">
              {stage.subtitle}
            </span>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground/80 bg-surface-subtle px-2 py-0.5 rounded border border-border/60 w-fit">
            target: {stage.detail.target}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="md:col-span-2">
            <div className="font-mono text-[10px] text-muted-foreground/60 uppercase mb-1">
              Data Payload Preview
            </div>
            <div className="rounded border border-border/60 bg-surface-subtle/70 p-2.5 font-mono text-xs text-foreground/90 leading-relaxed overflow-x-auto">
              {stage.detail.content}
            </div>
          </div>
          <div className="space-y-2 border-t md:border-t-0 md:border-l border-border/50 pt-2 md:pt-0 md:pl-4">
            <div>
              <div className="font-mono text-[10px] text-muted-foreground/60 uppercase">
                Operation Type
              </div>
              <div className="font-medium text-foreground">
                {stage.detail.type}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] text-muted-foreground/60 uppercase">
                Isolation Guarantee
              </div>
              <div className="text-muted-foreground">
                Scoped strictly to Project & Actor
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline narrative strip */}
      <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground/80 font-mono">
        <span>Information enters VOIDZONE → becomes durable memory → emerges as context</span>
        <span className="hidden sm:inline">Zero session reset</span>
      </div>
    </div>
  )
}
