"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export function ScopingSection() {
  const [selectedActor, setSelectedActor] = React.useState<"alex" | "marcus">("alex")

  return (
    <section id="architecture" className="relative border-t border-border/80 bg-surface-elevated/40 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        
        {/* Section Header */}
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">
            05 / Multi-Tenant Isolation
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground leading-tight">
            The right memory. For the right context.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            Persistent memory must never become a chaotic global dump. Kairo isolates memory by project and actor, ensuring that individual users, autonomous agents, and production environments retain strict boundaries.
          </p>
        </div>

        {/* Diagrammatic Isolation Architecture Canvas */}
        <div className="mt-14 rounded-xl border border-border/80 bg-surface-elevated p-6 sm:p-10 relative overflow-hidden shadow-xl">
          <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />

          {/* Top Level: Kairo Organization */}
          <div className="flex flex-col items-center text-center">
            <div className="rounded-lg border border-border/80 bg-background px-4 py-2 font-mono text-xs font-semibold text-foreground shadow-sm">
              KAIRO WORKSPACE
            </div>
            
            {/* Trunk Line */}
            <div className="h-6 w-px border-l-2 border-border/80 my-1" />

            {/* Project Node */}
            <div className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 font-mono text-xs font-semibold text-primary">
              PROJECT: core-platform-v1
            </div>

            {/* Branching Connector Line */}
            <div className="relative w-full max-w-md h-8 my-1 flex items-center justify-center">
              {/* Horizontal Bar */}
              <div className="absolute top-0 left-1/4 right-1/4 h-px border-t border-border/80" />
              {/* Left Drop */}
              <div className="absolute top-0 left-1/4 h-8 w-px border-l border-border/80" />
              {/* Right Drop */}
              <div className="absolute top-0 right-1/4 h-8 w-px border-l border-border/80" />
            </div>
          </div>

          {/* Actor Level: Split Columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 mt-2">
            
            {/* Actor A: Developer */}
            <div
              onClick={() => setSelectedActor("alex")}
              className={cn(
                "rounded-xl border p-5 sm:p-6 transition-all cursor-pointer relative",
                selectedActor === "alex"
                  ? "border-primary/60 bg-surface-subtle shadow-md shadow-primary/5"
                  : "border-border/60 bg-surface-elevated/40 opacity-70 hover:opacity-90"
              )}
            >
              <div className="flex items-center justify-between border-b border-border/50 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-blue-400" />
                  <span className="font-mono text-xs font-semibold text-foreground">
                    ACTOR: developer_alex
                  </span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground bg-surface-elevated px-2 py-0.5 rounded border border-border/60">
                  Role: Backend Eng
                </span>
              </div>

              <div className="space-y-2.5 font-mono text-xs">
                <div className="rounded border border-border/60 bg-background/80 p-3">
                  <span className="text-[10px] text-blue-400 font-semibold block mb-0.5">
                    PREFERENCE
                  </span>
                  <p className="text-foreground/90 font-sans text-xs">
                    "Prefers asynchronous message brokers with RabbitMQ for event delivery."
                  </p>
                </div>
                <div className="rounded border border-border/60 bg-background/80 p-3">
                  <span className="text-[10px] text-emerald-400 font-semibold block mb-0.5">
                    CONTEXT
                  </span>
                  <p className="text-foreground/90 font-sans text-xs">
                    "Currently profiling serialization throughput on microservice endpoints."
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                <span>Scope partition: isolated</span>
                <span className="text-primary font-medium">● Active View</span>
              </div>
            </div>

            {/* Actor B: Autonomous QA Agent */}
            <div
              onClick={() => setSelectedActor("marcus")}
              className={cn(
                "rounded-xl border p-5 sm:p-6 transition-all cursor-pointer relative",
                selectedActor === "marcus"
                  ? "border-primary/60 bg-surface-subtle shadow-md shadow-primary/5"
                  : "border-border/60 bg-surface-elevated/40 opacity-70 hover:opacity-90"
              )}
            >
              <div className="flex items-center justify-between border-b border-border/50 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-purple-400" />
                  <span className="font-mono text-xs font-semibold text-foreground">
                    ACTOR: agent_qa_ci
                  </span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground bg-surface-elevated px-2 py-0.5 rounded border border-border/60">
                  Role: Test Bot
                </span>
              </div>

              <div className="space-y-2.5 font-mono text-xs">
                <div className="rounded border border-border/60 bg-background/80 p-3">
                  <span className="text-[10px] text-purple-400 font-semibold block mb-0.5">
                    SKILL
                  </span>
                  <p className="text-foreground/90 font-sans text-xs">
                    "Executes end-to-end integration test suites across Chromium and WebKit."
                  </p>
                </div>
                <div className="rounded border border-border/60 bg-background/80 p-3">
                  <span className="text-[10px] text-amber-400 font-semibold block mb-0.5">
                    GOAL
                  </span>
                  <p className="text-foreground/90 font-sans text-xs">
                    "Verify zero regressions on login session invalidation after token refresh."
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                <span>Scope partition: isolated</span>
                <span className="text-primary font-medium">● Active View</span>
              </div>
            </div>

          </div>

          {/* Bottom Security Rule Statement */}
          <div className="mt-8 rounded-lg border border-border/70 bg-background/90 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="text-primary">🛡️</span>
              <span className="text-foreground font-medium">
                Isolation Law: Memory is isolated by project and actor.
              </span>
            </div>
            <span>Cross-tenant leakage: mathematically impossible</span>
          </div>

        </div>

      </div>
    </section>
  )
}
