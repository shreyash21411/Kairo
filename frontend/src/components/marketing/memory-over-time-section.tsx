"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  ConversationBubble,
  MemoryObject,
} from "@/components/marketing/product-primitives"
import { Calendar, CheckCircle2, Layers } from "lucide-react"

interface TimelineNode {
  day: string
  date: string
  label: string
  rawMessage: string
  type: "Preference" | "Context" | "Goal"
  memorySummary: string
  benefit: string
}

const TIMELINE_NODES: TimelineNode[] = [
  {
    day: "Monday",
    date: "Sep 12",
    label: "Session 01",
    rawMessage: "I prefer PostgreSQL for new projects.",
    type: "Preference",
    memorySummary: "Prefers PostgreSQL for new projects",
    benefit: "Saved database preference",
  },
  {
    day: "Wednesday",
    date: "Sep 14",
    label: "Session 02",
    rawMessage: "I'm building an AI memory platform called VOIDZONE.",
    type: "Context",
    memorySummary: "Building AI memory platform called VOIDZONE",
    benefit: "Saved active project context",
  },
  {
    day: "Friday",
    date: "Sep 16",
    label: "Session 03",
    rawMessage: "Keep the architecture modular and simple.",
    type: "Goal",
    memorySummary: "Keep architecture modular and simple",
    benefit: "Saved technical design goal",
  },
]

export function MemoryOverTimeSection() {
  const [activeCount] = React.useState<number>(3)

  return (
    <section id="memory-over-time" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        
        <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-primary font-semibold mb-3">
            <Layers className="h-3.5 w-3.5" />
            <span>Context Accumulation</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            Every conversation adds context.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            Instead of resetting when a chat closes, VOIDZONE assembles an enduring understanding of you, your team, and your architecture over time.
          </p>
        </div>

        {/* Timeline grid — product cards, section itself is transparent */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative items-stretch">
          {TIMELINE_NODES.map((node, idx) => {
            const isVisible = idx < activeCount

            return (
              <div
                key={node.day}
                className={cn(
                  "rounded-2xl border p-5 sm:p-6 transition-all duration-300 flex flex-col justify-between",
                  isVisible
                    ? "border-border/60 bg-surface-elevated/80 backdrop-blur-sm text-foreground"
                    : "border-border/30 bg-surface-elevated/20 opacity-40"
                )}
              >
                <div>
                  <div className="flex items-center justify-between border-b border-border/40 pb-3 mb-4 text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      <span className="font-semibold text-foreground uppercase tracking-wider">
                        {node.day}
                      </span>
                    </div>
                    <span className="text-muted-foreground/80">{node.date}</span>
                  </div>

                  <div className="mb-4">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground block mb-1.5">
                      What was said
                    </span>
                    <ConversationBubble role="user" author="Developer" time={node.day}>
                      &quot;{node.rawMessage}&quot;
                    </ConversationBubble>
                  </div>

                  <div>
                    <span className="font-mono text-[10px] uppercase text-muted-foreground block mb-1.5">
                      Distilled into VOIDZONE
                    </span>
                    <MemoryObject
                      type={node.type}
                      content={node.memorySummary}
                      state="remembered"
                      time="Persisted"
                    />
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-border/40 flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span>{node.benefit}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Synthesis banner — product card, not section shell */}
        <div className="mt-10 rounded-2xl border border-primary/25 bg-primary/5 backdrop-blur-sm p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-primary font-semibold block mb-1">
                Accumulated Context State By Friday
              </span>
              <p className="text-xs sm:text-sm font-medium text-foreground">
                Your AI assistant understands: your preferred database, active repository, and architectural principles.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-2 text-xs font-mono text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span>Zero re-prompting needed next week</span>
            </div>
          </div>
        </div>

      </div>
    </section>
  )
}