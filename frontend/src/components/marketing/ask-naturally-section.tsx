"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  ConversationBubble,
  MemoryObject,
} from "@/components/marketing/product-primitives"
import { Search, Sparkles, CornerDownRight, Check } from "lucide-react"

interface RecalledSpecimen {
  type: "Preference" | "Context" | "Goal"
  content: string
  similarity: number
  isBestMatch: boolean
}

const SPECIMENS: RecalledSpecimen[] = [
  { type: "Preference", content: "Prefers PostgreSQL for new projects",       similarity: 0.94, isBestMatch: true  },
  { type: "Context",    content: "Uses PostgreSQL for persistent microservices", similarity: 0.81, isBestMatch: false },
  { type: "Goal",       content: "Keep service architecture simple and modular", similarity: 0.65, isBestMatch: false },
]

export function AskNaturallySection() {
  const [selectedMatch, setSelectedMatch] = React.useState<number>(0)

  return (
    <section id="ask-naturally" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        
        <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-primary font-semibold mb-3">
            <Search className="h-3.5 w-3.5" />
            <span>Semantic Recall</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            Ask naturally.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            You don&apos;t need exact keywords or query syntax. VOIDZONE performs vector similarity search to find the right memories based on the meaning behind what you ask.
          </p>
        </div>

        {/* Product demonstration card */}
        <div className="rounded-2xl border border-border/60 bg-surface-elevated/80 backdrop-blur-sm p-6 sm:p-8 shadow-xl shadow-black/5 dark:shadow-black/20">
          
          <div className="mb-6">
            <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground mb-2">
              <span>NATURAL LANGUAGE QUERY</span>
              <span className="text-muted-foreground/70">Semantic Search Input</span>
            </div>
            <ConversationBubble role="user" author="Developer" time="Current Session">
              &quot;What database setup did I say I wanted for new projects?&quot;
            </ConversationBubble>
          </div>

          <div className="my-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-y border-border/40 py-3 text-xs font-mono text-muted-foreground">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary animate-pulse" />
              <span className="text-foreground/90 font-medium">Cosine Similarity Search in Progress</span>
            </div>
            <span className="text-[10.5px] text-muted-foreground/80">Illustrative product demonstration</span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground mb-1">
              <span>RETRIEVED MEMORY CANDIDATES</span>
              <span className="text-primary font-medium">Ranked by Cosine Score</span>
            </div>

            {SPECIMENS.map((item, idx) => {
              const isSelected = idx === selectedMatch
              return (
                <div
                  key={item.content}
                  onClick={() => setSelectedMatch(idx)}
                  className={cn(
                    "rounded-xl border p-3.5 sm:p-4 transition-all duration-200 cursor-pointer",
                    isSelected
                      ? "border-primary/70 bg-primary/8 shadow-xs shadow-primary/10 ring-1 ring-primary/15"
                      : "border-border/50 bg-surface-elevated/50 hover:border-border/70 hover:bg-surface-elevated/70"
                  )}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] uppercase px-2 py-0.5 rounded border border-blue-500/30 text-blue-400 bg-blue-500/10 font-semibold">
                        {item.type}
                      </span>
                      {item.isBestMatch && (
                        <span className="font-mono text-[9px] uppercase px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-400 bg-emerald-500/10 font-medium flex items-center gap-1">
                          <Check className="h-2.5 w-2.5" />
                          Top Match
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-xs">
                      <span className="text-muted-foreground text-[11px]">Cosine Similarity:</span>
                      <span className={cn("font-semibold", item.similarity >= 0.9 ? "text-emerald-500 dark:text-emerald-400" : "text-primary")}>
                        {item.similarity.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <p className="text-[13px] font-medium text-foreground/95 leading-relaxed">{item.content}</p>
                </div>
              )
            })}
          </div>

          <div className="mt-6 pt-4 border-t border-border/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono text-muted-foreground">
            <div className="flex items-center gap-2">
              <CornerDownRight className="h-3.5 w-3.5 text-primary" />
              <span>Injected into LLM context window at runtime</span>
            </div>
            <span className="text-foreground/90 font-medium">Zero manual prompt engineering required</span>
          </div>

        </div>

      </div>
    </section>
  )
}