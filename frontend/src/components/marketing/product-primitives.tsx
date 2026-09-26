"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Sparkles, Check, Database, Bot, User, ArrowUpRight } from "lucide-react"

/* ── 1. Typing Text Primitive ─────────────────────────────────────────────── */
export function TypingText({
  text,
  speed = 28,
  startDelay = 0,
  onComplete,
  className,
}: {
  text: string
  speed?: number
  startDelay?: number
  onComplete?: () => void
  className?: string
}) {
  const [displayed, setDisplayed] = React.useState("")
  const [isTyping, setIsTyping] = React.useState(false)

  React.useEffect(() => {
    let timeoutId: NodeJS.Timeout
    let intervalId: NodeJS.Timeout
    setDisplayed("")
    setIsTyping(false)

    timeoutId = setTimeout(() => {
      setIsTyping(true)
      let currentIdx = 0

      intervalId = setInterval(() => {
        currentIdx++
        setDisplayed(text.slice(0, currentIdx))

        if (currentIdx >= text.length) {
          clearInterval(intervalId)
          setIsTyping(false)
          onComplete?.()
        }
      }, speed)
    }, startDelay)

    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
    }
  }, [text, speed, startDelay, onComplete])

  return (
    <span className={cn("inline", className)}>
      {displayed}
      {isTyping && (
        <span
          aria-hidden="true"
          className="inline-block w-1 h-3.5 ml-0.5 bg-primary align-middle animate-pulse"
        />
      )}
    </span>
  )
}

/* ── 2. Conversation Bubble ───────────────────────────────────────────────── */
export function ConversationBubble({
  role = "user",
  author = "Developer",
  children,
  time,
  className,
}: {
  role?: "user" | "ai" | "system"
  author?: string
  children: React.ReactNode
  time?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl px-4 py-3.5 text-xs sm:text-[13px] transition-all duration-200",
        role === "user"
          ? "border border-border/80 bg-surface-elevated/90 text-foreground shadow-xs"
          : role === "ai"
          ? "border border-primary/30 bg-surface-subtle/90 text-foreground shadow-xs shadow-primary/5"
          : "border border-border/40 bg-background text-muted-foreground",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 mb-1.5 text-[11px] font-mono text-muted-foreground">
        <span className="font-medium text-foreground/80 flex items-center gap-1.5">
          {role === "ai" ? (
            <Bot className="h-3 w-3 text-primary" />
          ) : role === "user" ? (
            <User className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Database className="h-3 w-3 text-muted-foreground" />
          )}
          {author}
        </span>
        {time && <span className="opacity-70 text-[10px]">{time}</span>}
      </div>
      <div className="leading-relaxed font-sans text-foreground/95 select-text">{children}</div>
    </div>
  )
}

/* ── 3. Memory Object ─────────────────────────────────────────────────────── */
export function MemoryObject({
  type = "Preference",
  content,
  state = "active",
  actor,
  time,
  score,
  className,
}: {
  type?: "Preference" | "Goal" | "Fact" | "Context" | "Skill"
  content: React.ReactNode
  state?: "remembering" | "remembered" | "active" | "recalling"
  actor?: string
  time?: string
  score?: number
  className?: string
}) {
  const typeTokens: Record<string, string> = {
    Preference: "border-blue-500/30 text-blue-400 bg-blue-500/10",
    Goal: "border-amber-500/30 text-amber-400 bg-amber-500/10",
    Fact: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
    Context: "border-purple-500/30 text-purple-400 bg-purple-500/10",
    Skill: "border-cyan-500/30 text-cyan-400 bg-cyan-500/10",
  }

  return (
    <div
      className={cn(
        "relative rounded-xl border bg-surface-elevated/95 p-3.5 sm:p-4 text-xs transition-all duration-300 shadow-sm",
        state === "remembering" && "border-primary/80 shadow-xs shadow-primary/10",
        state === "remembered" && "border-emerald-500/50 shadow-xs shadow-emerald-500/10",
        state === "recalling" && "border-primary/80 ring-1 ring-primary/30 bg-surface-subtle shadow-md shadow-primary/10",
        state === "active" && "border-border/70 hover:border-border",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span
          className={cn(
            "font-mono text-[9.5px] uppercase font-semibold px-2 py-0.5 rounded border tracking-wider",
            typeTokens[type] || typeTokens.Preference
          )}
        >
          {type}
        </span>

        <div className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
          {state === "remembering" && (
            <span className="text-primary flex items-center gap-1 font-medium">
              <Sparkles className="h-3 w-3 animate-spin" />
              Remembering...
            </span>
          )}
          {state === "remembered" && (
            <span className="text-emerald-500 dark:text-emerald-400 flex items-center gap-1 font-medium">
              <Check className="h-3 w-3" />
              Remembered
            </span>
          )}
          {state === "recalling" && (
            <span className="text-primary flex items-center gap-1 font-medium">
              <ArrowUpRight className="h-3 w-3" />
              Recalled
            </span>
          )}
          {score !== undefined && (
            <span className="text-[10px] text-primary/80 font-mono">
              sim: {score.toFixed(2)}
            </span>
          )}
          {actor && <span className="opacity-70">{actor}</span>}
          {time && <span className="opacity-60">{time}</span>}
        </div>
      </div>

      <div className="text-foreground/95 font-medium leading-relaxed font-sans text-[12.5px] sm:text-[13px]">
        {content}
      </div>
    </div>
  )
}

/* ── 4. Progressive SVG Connection Line ────────────────────────────────────── */
export function ConnectionLine({
  active = false,
  direction = "down",
  label,
  className,
}: {
  active?: boolean
  direction?: "down" | "right" | "curve"
  label?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center font-mono text-[10px] my-1 text-muted-foreground transition-all duration-300",
        active ? "text-primary" : "text-border/70",
        className
      )}
    >
      {direction === "down" && (
        <div className="flex flex-col items-center gap-1 w-full">
          <svg width="2" height="24" className="overflow-visible">
            <line
              x1="1"
              y1="0"
              x2="1"
              y2="24"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray={active ? "none" : "2 2"}
              className={cn("transition-colors duration-300", active ? "text-primary" : "text-border")}
            />
          </svg>
          {label && (
            <span
              className={cn(
                "px-2 py-0.5 rounded border text-[9px] uppercase tracking-wider font-mono transition-colors duration-300",
                active
                  ? "border-primary/50 bg-primary/10 text-primary font-semibold"
                  : "border-border/60 bg-surface-subtle text-muted-foreground"
              )}
            >
              {label}
            </span>
          )}
          <svg width="2" height="24" className="overflow-visible">
            <line
              x1="1"
              y1="0"
              x2="1"
              y2="24"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray={active ? "none" : "2 2"}
              className={cn("transition-colors duration-300", active ? "text-primary" : "text-border")}
            />
          </svg>
        </div>
      )}
    </div>
  )
}
