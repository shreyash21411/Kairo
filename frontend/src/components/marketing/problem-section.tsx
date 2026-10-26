"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export function ProblemSection() {
  return (
    <section className="relative border-t border-border/80 bg-surface-elevated/40 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        {/* Section Header: Strong Typographic Statement */}
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">
            01 / The Fundamental Deficit
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground leading-tight">
            Reasoning without recall is just amnesia.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            Modern models possess superhuman reasoning capabilities, yet they operate in total isolation. Every conversation begins from a blank slate, forcing developers to resort to fragile prompt stuffing or brittle local caches.
          </p>
        </div>

        {/* Asymmetric Architecture Comparison (Disconnected vs VOIDZONE) */}
        <div className="mt-14 grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
          
          {/* Left: The Stateless Paradigm */}
          <div className="relative rounded-xl border border-destructive/20 bg-surface-subtle/40 p-6 sm:p-8 flex flex-col justify-between overflow-hidden">
            <div>
              <div className="flex items-center justify-between mb-6">
                <span className="font-mono text-xs uppercase tracking-wider text-rose-400/90 font-medium">
                  Stateless Execution (Without VOIDZONE)
                </span>
                <span className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-mono text-[10px] text-rose-400">
                  CONTEXT LOST
                </span>
              </div>

              <div className="space-y-3.5 font-mono text-xs">
                {/* Disconnected Session 1 */}
                <div className="rounded-lg border border-border/60 bg-surface-elevated/60 p-3.5 opacity-90">
                  <div className="flex items-center justify-between text-muted-foreground mb-1 text-[11px]">
                    <span>Session 01 · 10:42 AM</span>
                    <span className="text-rose-400/80">Evicted</span>
                  </div>
                  <p className="text-foreground/90 font-sans text-xs">
                    "I build our backend with .NET 9 and PostgreSQL."
                  </p>
                </div>

                {/* Severed Line */}
                <div className="flex items-center justify-center py-1">
                  <div className="h-4 w-px border-l border-dashed border-rose-500/40" />
                </div>

                {/* Disconnected Session 2 */}
                <div className="rounded-lg border border-border/60 bg-surface-elevated/60 p-3.5 opacity-90">
                  <div className="flex items-center justify-between text-muted-foreground mb-1 text-[11px]">
                    <span>Session 02 · 02:15 PM</span>
                    <span className="text-rose-400/80">Evicted</span>
                  </div>
                  <p className="text-foreground/90 font-sans text-xs">
                    "Please optimize this migration script for PostgreSQL."
                  </p>
                </div>

                {/* Severed Line */}
                <div className="flex items-center justify-center py-1">
                  <div className="h-4 w-px border-l border-dashed border-rose-500/40" />
                </div>

                {/* Disconnected Session 3 */}
                <div className="rounded-lg border border-border/60 bg-surface-elevated/60 p-3.5 opacity-90">
                  <div className="flex items-center justify-between text-muted-foreground mb-1 text-[11px]">
                    <span>Session 03 · Next Day</span>
                    <span className="text-rose-400/80">Reset to Zero</span>
                  </div>
                  <p className="text-muted-foreground font-sans text-xs italic">
                    AI: "Which database and runtime does your project use?"
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-border/40 pt-4 text-[11px] text-muted-foreground font-mono">
              Result: Repetitive prompt-crafting, fractured context, degraded user trust.
            </div>
          </div>

          {/* Right: The VOIDZONE Persistent Substrate */}
          <div className="relative rounded-xl border border-primary/30 bg-surface-elevated p-6 sm:p-8 flex flex-col justify-between overflow-hidden shadow-lg shadow-primary/5">
            <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-2xl" />

            <div>
              <div className="flex items-center justify-between mb-6">
                <span className="font-mono text-xs uppercase tracking-wider text-primary font-medium">
                  Persistent Substrate (With VOIDZONE)
                </span>
                <span className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                  CONTINUOUS CONTEXT
                </span>
              </div>

              {/* Sessions converging into VOIDZONE */}
              <div className="space-y-2.5 font-mono text-xs">
                <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                  <div className="rounded border border-border/60 bg-surface-subtle p-2">
                    <span className="text-muted-foreground">Session 01</span>
                    <div className="text-foreground font-medium mt-0.5">Stack Defined</div>
                  </div>
                  <div className="rounded border border-border/60 bg-surface-subtle p-2">
                    <span className="text-muted-foreground">Session 02</span>
                    <div className="text-foreground font-medium mt-0.5">DB Patterns</div>
                  </div>
                  <div className="rounded border border-border/60 bg-surface-subtle p-2">
                    <span className="text-muted-foreground">Session 03</span>
                    <div className="text-foreground font-medium mt-0.5">Architecture</div>
                  </div>
                </div>

                {/* Convergence Arrow */}
                <div className="flex items-center justify-center py-2 text-primary font-mono text-xs">
                  <span>↓ Ingested & Scoped into VOIDZONE Layer ↓</span>
                </div>

                {/* Persistent Knowledge Representation */}
                <div className="rounded-lg border border-primary/40 bg-surface-subtle/80 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-foreground font-semibold">
                      Durable Knowledge Graph
                    </span>
                    <span className="font-mono text-[10px] text-primary">Active Scope: user_123</span>
                  </div>
                  <div className="space-y-1 text-[11px] font-sans text-foreground/90">
                    <div className="flex items-start gap-2">
                      <span className="text-primary font-mono text-[10px] mt-0.5">●</span>
                      <span><strong>Preference:</strong> Prefers PostgreSQL and .NET 9</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-primary font-mono text-[10px] mt-0.5">●</span>
                      <span><strong>Context:</strong> Production database migration in progress</span>
                    </div>
                  </div>
                </div>

                {/* Instant Context Recall on Next Session */}
                <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 font-sans text-xs text-foreground">
                  <span className="font-mono text-[10px] text-emerald-400 font-semibold block mb-0.5">
                    Session 04 · Instant Recall
                  </span>
                  AI immediately tailors code to .NET 9 and PostgreSQL with zero prompting needed.
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-border/40 pt-4 text-[11px] text-muted-foreground font-mono">
              Result: Agents that genuinely remember, evolve, and personalize across months of interaction.
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
