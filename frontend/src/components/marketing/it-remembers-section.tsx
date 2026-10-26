"use client"

import * as React from "react"
import {
  ConversationBubble,
  MemoryObject,
  TypingText,
} from "@/components/marketing/product-primitives"
import { Sparkles, Database, Check } from "lucide-react"
import { cn } from "@/lib/utils"

export function ItRemembersSection() {
  const [phase, setPhase] = React.useState<number>(1)

  React.useEffect(() => {
    const t1 = setTimeout(() => setPhase(2), 2200)
    const t2 = setTimeout(() => setPhase(3), 3800)
    const t3 = setTimeout(() => setPhase(1), 8500)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [phase])

  return (
    <section id="remembers" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        
        <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-primary font-semibold mb-3">
            <span>Conversational Ingestion</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            It remembers.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            Important details don&apos;t disappear when the conversation ends. VOIDZONE extracts durable preferences and facts automatically.
          </p>
        </div>

        {/* Product demonstration card */}
        <div className="mx-auto max-w-xl rounded-2xl border border-border/60 bg-surface-elevated/80 backdrop-blur-sm p-6 sm:p-8 shadow-xl shadow-black/5 dark:shadow-black/20">
          
          <div className="space-y-4">
            
            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground mb-2">
                <span>CONVERSATION INPUT</span>
                <span className="text-muted-foreground/60">Live Stream</span>
              </div>
              <ConversationBubble role="user" author="Engineer" time="10:42 AM">
                {phase >= 1 ? (
                  <TypingText text="I prefer PostgreSQL for new projects." speed={26} />
                ) : null}
              </ConversationBubble>
            </div>

            <div className="flex flex-col items-center py-1">
              <div className="h-5 w-px bg-border/70" />
              <div
                className={cn(
                  "my-1 flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] transition-all duration-300",
                  phase >= 2
                    ? "border-primary/50 bg-primary/10 text-primary font-medium"
                    : "border-border/60 bg-surface-subtle text-muted-foreground/80"
                )}
              >
                {phase === 2 ? (
                  <><Sparkles className="h-3 w-3 animate-spin" /><span>Distilling structured memory...</span></>
                ) : phase >= 3 ? (
                  <><Check className="h-3 w-3 text-emerald-500" /><span>Persisted to Vector Store</span></>
                ) : (
                  <><Database className="h-3 w-3" /><span>Monitoring for long-term facts</span></>
                )}
              </div>
              <div className="h-5 w-px bg-border/70" />
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground mb-2">
                <span>DURABLE MEMORY SPECIMEN</span>
                <span className="text-emerald-500/80 font-medium">Outlasts Session</span>
              </div>
              <div
                className={cn(
                  "transition-all duration-300",
                  phase >= 3
                    ? "opacity-100 translate-y-0"
                    : "opacity-25 translate-y-1 pointer-events-none"
                )}
              >
                <MemoryObject
                  type="Preference"
                  content="Prefers PostgreSQL for new projects"
                  state={phase >= 3 ? "remembered" : "remembering"}
                  actor="Engineer"
                  time="Permanent Context"
                />
              </div>
            </div>

          </div>

          <div className="mt-6 pt-4 border-t border-border/40 text-center font-mono text-[11px] text-muted-foreground">
            Zero re-prompting required in future sessions · Available across all tools
          </div>
        </div>

      </div>
    </section>
  )
}