"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface UseCase {
  id: string
  number: string
  category: string
  headline: string
  problem: string
  solution: string
  memorySnippet: string
}

const USE_CASES: UseCase[] = [
  {
    id: "dev-agents",
    number: "01",
    category: "Developer & Coding Agents",
    headline: "Persistent understanding of your repository architecture and style.",
    problem: "Coding assistants repeatedly suggest incompatible packages, violate private architectural rules, or forget previously established migration decisions on each fresh pull request.",
    solution: "Kairo stores repository goals, developer framework preferences, and team styling conventions as permanent memory objects, providing continuity across weeks of iteration.",
    memorySnippet: "Memory: [Preference] Always use Dapper with strict parameterization instead of heavy ORMs for analytics services.",
  },
  {
    id: "ai-saas",
    number: "02",
    category: "Multi-Tenant AI SaaS",
    headline: "Zero cross-customer context leakage with project and actor scoping.",
    problem: "When building multi-tenant AI applications, customer context easily bleeds across shared prompt caches or unstructured vector namespaces, posing catastrophic security risks.",
    solution: "Kairo's cryptographic tenant scoping guarantees that an actor's memories are strictly accessible only within that actor's explicit project partition.",
    memorySnippet: "Scope Guarantee: Tenant 'org_acme' and Tenant 'org_globex' execute in isolated vector partitions.",
  },
  {
    id: "personal-ai",
    number: "03",
    category: "Personal Assistants & Copilots",
    headline: "Relationships and goals that endure beyond the active tab.",
    problem: "Chatbots feel artificial and transactional because closing the browser tab permanently evaporates all user context, routines, and ongoing life goals.",
    solution: "Kairo continuously distills conversation threads into durable Goal and Preference memories, allowing assistants to resume seamlessly on mobile, web, or terminal.",
    memorySnippet: "Memory: [Goal] Target launch date for Kairo v1 is October 15th; prioritize zero-defect launch readiness.",
  },
  {
    id: "autonomous-agents",
    number: "04",
    category: "Autonomous Multi-Step Workflows",
    headline: "Long-horizon state preservation across complex tool loops.",
    problem: "Autonomous agents executing 50+ tool calls exhaust their context window quickly, crashing into token limits and forgetting their initial mission parameters.",
    solution: "Instead of ballooning prompt token counts, agents offload intermediate discoveries to Kairo and retrieve only the salient facts needed for the current step.",
    memorySnippet: "Memory: [Fact] Endpoint /api/v1/auth returned 429 rate limit after 100 requests; exponential backoff verified.",
  },
]

export function UseCasesSection() {
  const [selectedCase, setSelectedCase] = React.useState<number>(0)
  const currentCase = USE_CASES[selectedCase]

  return (
    <section id="use-cases" className="relative border-t border-border/80 bg-background py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        
        {/* Section Header */}
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">
            08 / Real-World Applications
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            Where persistent memory changes the equation.
          </h2>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Persistent context transforms episodic AI toys into reliable software colleagues. Here is how modern teams deploy Kairo.
          </p>
        </div>

        {/* Editorial Asymmetric Layout */}
        <div className="mt-14 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Category Selector (5 cols) */}
          <div className="lg:col-span-5 space-y-2.5">
            {USE_CASES.map((uc, idx) => {
              const isSelected = idx === selectedCase
              return (
                <button
                  key={uc.id}
                  onClick={() => setSelectedCase(idx)}
                  className={cn(
                    "w-full text-left rounded-xl border p-4 sm:p-5 transition-all cursor-pointer",
                    isSelected
                      ? "border-primary/50 bg-surface-elevated shadow-md shadow-primary/5"
                      : "border-border/60 bg-surface-subtle/30 opacity-70 hover:opacity-100 hover:border-border"
                  )}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-xs text-primary font-semibold">
                      {uc.number}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      Application Scope
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {uc.category}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                    {uc.headline}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Right Column: Deep Architectural Analysis (7 cols) */}
          <div className="lg:col-span-7 rounded-xl border border-border/80 bg-surface-elevated p-6 sm:p-8 relative shadow-xl">
            <div className="flex items-center justify-between border-b border-border/60 pb-3.5 mb-6">
              <span className="font-mono text-xs font-semibold text-primary uppercase">
                Case Analysis: {currentCase.category}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                Kairo Architecture Profile
              </span>
            </div>

            <h3 className="text-xl sm:text-2xl font-semibold text-foreground tracking-tight mb-6 leading-snug">
              {currentCase.headline}
            </h3>

            {/* Problem Statement */}
            <div className="mb-5 rounded-lg border border-destructive/20 bg-surface-subtle/40 p-4">
              <div className="font-mono text-[10px] text-rose-400 font-semibold uppercase mb-1">
                The Friction Point
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                {currentCase.problem}
              </p>
            </div>

            {/* Solution Narrative */}
            <div className="mb-6 rounded-lg border border-emerald-500/20 bg-surface-subtle/40 p-4">
              <div className="font-mono text-[10px] text-emerald-400 font-semibold uppercase mb-1">
                The Kairo Solution
              </div>
              <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">
                {currentCase.solution}
              </p>
            </div>

            {/* Specimen Output */}
            <div className="rounded-lg border border-border/80 bg-background/90 p-4 font-mono text-xs text-foreground/90">
              <div className="text-muted-foreground/60 text-[10px] uppercase mb-1">
                Live Memory Record in Production
              </div>
              <div>{currentCase.memorySnippet}</div>
            </div>

          </div>

        </div>

      </div>
    </section>
  )
}
