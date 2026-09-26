"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { MemoryObject } from "@/components/marketing/product-primitives"
import { Bot, UserCheck, AppWindow, Code2 } from "lucide-react"

interface UseCaseSpecimen {
  id: string
  icon: React.ElementType
  category: string
  title: string
  description: string
  memory: {
    type: "Goal" | "Preference" | "Context" | "Skill"
    content: string
    actor?: string
    status: string
  }
}

const SPECIMENS: UseCaseSpecimen[] = [
  {
    id: "agents",
    icon: Bot,
    category: "Autonomous Systems",
    title: "AI agents that resume multi-step workflows.",
    description:
      "Long-running tasks don't fail when token context windows fill up. Agents record checkpoints and resume exactly where they left off.",
    memory: {
      type: "Goal",
      content: "Benchmarking database connection pooling across 5,000 parallel test writes",
      actor: "Agent-04",
      status: "Checkpoint Saved",
    },
  },
  {
    id: "products",
    icon: AppWindow,
    category: "Software Products",
    title: "AI SaaS products that remember each customer.",
    description:
      "Deliver tailored experiences that remember team preferences while guaranteeing customer data is never accessible to another tenant.",
    memory: {
      type: "Preference",
      content: "Customer requires monthly invoicing in EUR with raw usage breakdowns",
      actor: "Acme Corp",
      status: "Tenant Scoped",
    },
  },
  {
    id: "assistants",
    icon: UserCheck,
    category: "Executive & Personal",
    title: "Personal assistants that remember you over time.",
    description:
      "No more re-introducing yourself every Monday. Your assistant recalls previous decisions, key contacts, and ongoing priorities.",
    memory: {
      type: "Context",
      content: "Preparing the quarterly board presentation for the sync on Thursday",
      actor: "Executive",
      status: "Persisted",
    },
  },
  {
    id: "coding",
    icon: Code2,
    category: "Developer Tooling",
    title: "Coding agents that adhere to team architecture.",
    description:
      "Coding assistants follow your team's architectural decisions, style guidelines, and package preferences without manual prompting.",
    memory: {
      type: "Preference",
      content: "Always use PostgreSQL and Next.js App Router for new customer microservices",
      actor: "Engineering Team",
      status: "Enforced",
    },
  },
]

export function HumanUseCasesSection() {
  const [activeCard, setActiveCard] = React.useState<string>("agents")

  return (
    <section id="use-cases" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        
        <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-primary font-semibold mb-3">
            <AppWindow className="h-3.5 w-3.5" />
            <span>Applications &amp; Architecture</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            What you can build.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            From autonomous coding tools to enterprise copilots, persistent memory transforms fleeting chat into durable intelligence.
          </p>
        </div>

        {/* 2x2 grid of product cards — section itself is transparent */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          {SPECIMENS.map((item) => {
            const Icon = item.icon
            const isSelected = activeCard === item.id

            return (
              <div
                key={item.id}
                onClick={() => setActiveCard(item.id)}
                className={cn(
                  "rounded-2xl border p-6 sm:p-7 flex flex-col justify-between transition-all duration-200 cursor-pointer backdrop-blur-sm",
                  isSelected
                    ? "border-primary/60 bg-surface-elevated/90 shadow-md shadow-primary/5 ring-1 ring-primary/15"
                    : "border-border/50 bg-surface-elevated/50 hover:bg-surface-elevated/80 hover:border-border/70"
                )}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 bg-surface-subtle/60 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="font-mono text-[11px] uppercase text-muted-foreground tracking-wider">
                        {item.category}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground/80 px-2 py-0.5 rounded border border-border/40">
                      {item.memory.status}
                    </span>
                  </div>

                  <h3 className="text-lg sm:text-xl font-semibold text-foreground tracking-tight mb-2.5">
                    {item.title}
                  </h3>

                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed mb-6">
                    {item.description}
                  </p>
                </div>

                <div className="pt-4 border-t border-border/40">
                  <div className="flex items-center justify-between text-[10.5px] font-mono text-muted-foreground mb-2">
                    <span>MEMORY SPECIMEN</span>
                    <span>{item.memory.actor}</span>
                  </div>
                  <MemoryObject
                    type={item.memory.type}
                    content={item.memory.content}
                    state="remembered"
                    time={item.memory.status}
                  />
                </div>
              </div>
            )
          })}
        </div>

      </div>
    </section>
  )
}