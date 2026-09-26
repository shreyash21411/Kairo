"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  ConversationBubble,
  MemoryObject,
} from "@/components/marketing/product-primitives"
import { ShieldCheck, UserCheck, Lock } from "lucide-react"

interface PersonProfile {
  id: "alex" | "maya"
  name: string
  role: string
  statement: string
  storedMemory: string
  query: string
  answer: string
}

const PROFILES: Record<"alex" | "maya", PersonProfile> = {
  alex: {
    id: "alex",
    name: "Alex",
    role: "Backend Engineer",
    statement: "I prefer PostgreSQL for our services.",
    storedMemory: "Prefers PostgreSQL for backend services",
    query: "What database do I prefer?",
    answer: "You prefer PostgreSQL for your services.",
  },
  maya: {
    id: "maya",
    name: "Maya",
    role: "Data Engineer",
    statement: "I prefer MongoDB for telemetry streams.",
    storedMemory: "Prefers MongoDB for telemetry streams",
    query: "What database do I prefer?",
    answer: "You prefer MongoDB for telemetry streams.",
  },
}

export function RightPersonSection() {
  const [activePerson, setActivePerson] = React.useState<"alex" | "maya">("alex")
  const person = PROFILES[activePerson]

  return (
    <section id="isolation" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        
        <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-primary font-semibold mb-3">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Partition &amp; Isolation</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            The right memory, for the right person.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            Memories are partitioned strictly by actor and project. What Alex tells your assistant never bleeds into Maya&apos;s context.
          </p>
        </div>

        {/* Product demonstration card */}
        <div className="rounded-2xl border border-border/60 bg-surface-elevated/80 backdrop-blur-sm p-6 sm:p-8 shadow-xl shadow-black/5 dark:shadow-black/20">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-6 mb-6">
            <div>
              <span className="font-mono text-[10px] uppercase text-muted-foreground block mb-1">Active Tenant Partition</span>
              <p className="text-sm font-semibold text-foreground">Select an actor to view their isolated memory space</p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-surface-subtle/60 p-1 self-start sm:self-auto">
              {(["alex", "maya"] as const).map((id) => {
                const isSelected = activePerson === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActivePerson(id)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3.5 py-1.5 font-mono text-xs transition-all duration-150 cursor-pointer active:translate-y-px",
                      isSelected
                        ? "bg-foreground text-background font-semibold shadow-xs"
                        : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated"
                    )}
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    <span>{PROFILES[id].name} ({PROFILES[id].role})</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            
            {/* Left: Ingestion */}
            <div className="rounded-xl border border-border/50 bg-background/60 backdrop-blur-sm p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-mono text-muted-foreground mb-3 pb-2 border-b border-border/40">
                  <span className="font-semibold text-foreground">SESSION 01 · INPUT</span>
                  <span>{person.name}&apos;s Chat</span>
                </div>
                <ConversationBubble role="user" author={person.name} time="Last week">
                  &quot;{person.statement}&quot;
                </ConversationBubble>
                <div className="my-3 flex items-center justify-center">
                  <div className="h-4 w-px bg-border/60" />
                </div>
                <MemoryObject
                  type="Preference"
                  content={person.storedMemory}
                  state="remembered"
                  actor={person.name}
                  time="Private Partition"
                />
              </div>
              <div className="mt-4 pt-2 border-t border-border/40 text-[10.5px] font-mono text-muted-foreground flex items-center gap-1.5">
                <Lock className="h-3 w-3 text-primary" />
                <span>Isolated strictly to {person.name}&apos;s scope</span>
              </div>
            </div>

            {/* Right: Recall */}
            <div className="rounded-xl border border-border/50 bg-background/60 backdrop-blur-sm p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-mono text-muted-foreground mb-3 pb-2 border-b border-border/40">
                  <span className="font-semibold text-foreground">SESSION 02 · RECALL</span>
                  <span>{person.name}&apos;s Session</span>
                </div>
                <ConversationBubble role="user" author={person.name} time="Today">
                  &quot;{person.query}&quot;
                </ConversationBubble>
                <div className="my-3 flex items-center justify-center">
                  <div className="h-4 w-px bg-border/60" />
                </div>
                <ConversationBubble role="ai" author="Assistant" time="Instant Answer">
                  {person.answer}
                </ConversationBubble>
              </div>
              <div className="mt-4 pt-2 border-t border-border/40 text-[10.5px] font-mono text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-3 w-3 text-emerald-500" />
                <span>{person.name}&apos;s prompt never accesses other team data</span>
              </div>
            </div>

          </div>

          <div className="mt-6 pt-4 border-t border-border/40 text-center font-mono text-[11px] text-muted-foreground">
            Multi-tenant security · Cryptographically bounded memory partitions
          </div>

        </div>

      </div>
    </section>
  )
}