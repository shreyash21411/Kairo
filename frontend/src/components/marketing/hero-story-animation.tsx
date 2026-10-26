"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  ConversationBubble,
  MemoryObject,
  TypingText,
} from "@/components/marketing/product-primitives"
import { Sparkles, ArrowRight, RotateCcw, Play, Pause, Database, Clock } from "lucide-react"

export function HeroStoryAnimation() {
  // Step sequence: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> hold -> reset
  const [step, setStep] = React.useState<number>(1)
  const [isPaused, setIsPaused] = React.useState<boolean>(false)

  React.useEffect(() => {
    if (isPaused) return

    let timer: NodeJS.Timeout

    switch (step) {
      case 1:
        // Step 1: User message typing ("I prefer PostgreSQL...") -> advance to draw at 2.2s
        timer = setTimeout(() => setStep(2), 2200)
        break
      case 2:
        // Step 2: SVG path draws down to VOIDZONE -> advance to processing at 0.9s
        timer = setTimeout(() => setStep(3), 900)
        break
      case 3:
        // Step 3: VOIDZONE pulse "Remembering..." -> advance to memory created at 1.1s
        timer = setTimeout(() => setStep(4), 1100)
        break
      case 4:
        // Step 4: Memory object crystallizes -> advance to time transition at 1.4s
        timer = setTimeout(() => setStep(5), 1400)
        break
      case 5:
        // Step 5: "2 weeks later" time progression appears -> advance to query at 1.2s
        timer = setTimeout(() => setStep(6), 1200)
        break
      case 6:
        // Step 6: User queries "What database do I prefer?" -> advance to recall at 1.8s
        timer = setTimeout(() => setStep(7), 1800)
        break
      case 7:
        // Step 7: Recall connection travels from memory back into prompt -> 1.0s
        timer = setTimeout(() => setStep(8), 1000)
        break
      case 8:
        // Step 8: AI answers with context -> hold for 6 seconds to comfortably read, then restart
        timer = setTimeout(() => setStep(1), 6000)
        break
      default:
        break
    }

    return () => clearTimeout(timer)
  }, [step, isPaused])

  const restart = () => setStep(1)

  return (
    <div className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-border/80 bg-surface-elevated/95 p-5 sm:p-7 shadow-xl shadow-black/5 dark:shadow-black/20 backdrop-blur-xl">
      {/* Top Controller Bar */}
      <div className="relative mb-5 flex items-center justify-between border-b border-border/50 pb-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span className="font-mono text-[11px] font-semibold tracking-wider uppercase text-foreground">
            Continuous Context Demonstration
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPaused(!isPaused)}
            className="flex items-center gap-1 rounded-md border border-border/60 bg-surface-subtle px-2 py-0.8 font-mono text-[10.5px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer active:translate-y-px"
            aria-label={isPaused ? "Play demonstration" : "Pause demonstration"}
          >
            {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            <span>{isPaused ? "Play" : "Pause"}</span>
          </button>
          <button
            type="button"
            onClick={restart}
            className="flex items-center gap-1 rounded-md border border-border/60 bg-surface-subtle px-2 py-0.8 font-mono text-[10.5px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer active:translate-y-px"
            aria-label="Restart demonstration"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Narrative Sequence Canvas */}
      <div className="space-y-4">
        
        {/* PHASE A: SESSION 01 — Monday Ingestion */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
            <span className="font-semibold text-foreground/90">SESSION 01 · INITIAL CHAT</span>
            <span className="text-muted-foreground/70">Conversation</span>
          </div>

          <ConversationBubble role="user" author="Developer" time="Monday">
            {step >= 1 ? (
              <TypingText
                text="I prefer PostgreSQL for new projects."
                speed={26}
              />
            ) : null}
          </ConversationBubble>

          {/* SVG Animated Connection Line down to Memory Object */}
          <div className="flex justify-center py-0.5">
            <div className="relative flex flex-col items-center">
              <svg width="2" height="24" className="overflow-visible">
                <line
                  x1="1"
                  y1="0"
                  x2="1"
                  y2="24"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray={step >= 2 ? "none" : "2 2"}
                  className={cn(
                    "transition-colors duration-300",
                    step >= 2 ? "text-primary" : "text-border"
                  )}
                />
              </svg>
              {step >= 3 && step <= 4 && (
                <span className="my-0.5 px-2 py-0.5 rounded border border-primary/40 bg-primary/10 text-[9px] font-mono text-primary animate-pulse tracking-wider">
                  VOIDZONE: Ingesting & Embedding
                </span>
              )}
            </div>
          </div>

          {/* Persistent Memory Object */}
          <div
            className={cn(
              "transition-all duration-300",
              step >= 4
                ? "opacity-100 translate-y-0"
                : "opacity-25 translate-y-1 pointer-events-none"
            )}
          >
            <MemoryObject
              type="Preference"
              content="Prefers PostgreSQL for new projects"
              state={step === 3 ? "remembering" : step >= 4 ? "remembered" : "active"}
              time="Permanent Context"
              score={step >= 7 ? 0.94 : undefined}
            />
          </div>
        </div>

        {/* PHASE B: TIME PASSAGE ("2 weeks later") */}
        <div
          className={cn(
            "transition-all duration-400 py-1",
            step >= 5 ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"
          )}
        >
          <div className="flex items-center justify-center gap-2">
            <div className="h-px flex-1 bg-border/60" />
            <div className="flex items-center gap-1.5 rounded-full border border-border/80 bg-surface-subtle px-3 py-1 font-mono text-[10px] text-muted-foreground shadow-xs">
              <Clock className="h-3 w-3 text-primary" />
              <span>2 weeks later · Fresh session / new tab</span>
            </div>
            <div className="h-px flex-1 bg-border/60" />
          </div>
        </div>

        {/* PHASE C: SESSION 02 — Semantic Recall */}
        <div
          className={cn(
            "space-y-3 transition-all duration-400",
            step >= 6 ? "opacity-100 translate-y-0" : "opacity-20 translate-y-1 pointer-events-none"
          )}
        >
          <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
            <span className="font-semibold text-foreground/90">SESSION 02 · NEW QUERY</span>
            <span className="text-primary font-medium">Zero Prompt Context</span>
          </div>

          <ConversationBubble role="user" author="Developer" time="Today">
            {step >= 6 ? (
              <TypingText
                text="What database do I prefer for new projects?"
                speed={24}
              />
            ) : null}
          </ConversationBubble>

          {/* Upward Recall Connection */}
          {step >= 7 && (
            <div className="flex items-center justify-center py-1 animate-in fade-in duration-300">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-primary/50 bg-primary/10 text-primary font-mono text-[10px] font-medium">
                <Sparkles className="h-3 w-3 animate-pulse" />
                Retrieved & injected from VOIDZONE (sim: 0.94)
              </span>
            </div>
          )}

          {/* AI Response with Recalled Context */}
          {step >= 8 && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <ConversationBubble role="ai" author="Assistant" time="Just now">
                You prefer <strong>PostgreSQL</strong> for new projects. Would you like me to initialize the schema with migrations ready?
              </ConversationBubble>
            </div>
          )}
        </div>

      </div>

      {/* Bottom Subtitle */}
      <div className="mt-5 pt-3 border-t border-border/50 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
        <span>VOIDZONE bridges the gap across independent sessions.</span>
        <span className="text-primary">Durable Memory</span>
      </div>
    </div>
  )
}
