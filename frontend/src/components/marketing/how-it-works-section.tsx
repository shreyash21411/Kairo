import { MemoryLifecycleVisual } from "@/components/marketing/memory-lifecycle-visual"

interface LifecyclePhase {
  number: string
  title: string
  summary: string
  detail: string
  endpoint?: string
}

const PHASES: LifecyclePhase[] = [
  {
    number: "01",
    title: "Semantic Context Retrieval",
    summary: "Query memory before prompt construction",
    endpoint: "POST /api/v1/memories/search",
    detail:
      "When a user prompt arrives, the agent queries Kairo with the input text. Kairo embeds the query with Mistral, runs cosine similarity across all active memories for the authenticated user, and returns semantically relevant facts.",
  },
  {
    number: "02",
    title: "Context-Informed Inference",
    summary: "Inject persistent facts into agent prompt",
    detail:
      "The agent prepends retrieved memories into its system prompt or message history. The language model generates its completion with complete awareness of previous user decisions, stated constraints, and project facts.",
  },
  {
    number: "03",
    title: "Persistence & Version Snapshot",
    summary: "Store new facts with duplicate protection",
    endpoint: "POST /api/v1/memories",
    detail:
      "Newly identified facts or preferences are sent to Kairo. Two-pass duplicate validation (exact match and semantic similarity) prevents redundant entries. Subsequent updates automatically snapshot the prior state in MemoryVersions.",
  },
]

export function HowItWorksSection() {
  return (
    <section
      id="architecture"
      className="border-t border-border py-20 px-6 sm:py-24"
      aria-label="Architecture and lifecycle"
    >
      <div className="mx-auto max-w-6xl">
        {/* Section Header: Editorial & clean */}
        <div className="mb-12 max-w-3xl">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            The memory lifecycle in agent workflows.
          </h2>
          <p className="mt-3 text-[16px] leading-relaxed text-muted-foreground">
            How Kairo maintains durable memory across distinct agent sessions without requiring you
            to build or operate custom vector databases.
          </p>
        </div>

        {/* Signature Architecture Visual */}
        <div className="mb-16">
          <MemoryLifecycleVisual />
        </div>

        {/* Editorial Three-Phase Breakdown (Clean hairline typography, no generic cards) */}
        <div className="grid gap-8 divide-y divide-border/60 lg:grid-cols-3 lg:gap-12 lg:divide-y-0 lg:divide-x">
          {PHASES.map((phase, idx) => (
            <div key={phase.number} className={idx > 0 ? "pt-8 lg:pt-0 lg:pl-12" : ""}>
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-3 font-mono">
                <span className="font-semibold text-foreground">PHASE {phase.number}</span>
                {phase.endpoint && (
                  <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-foreground/80">
                    {phase.endpoint}
                  </span>
                )}
              </div>

              <h3 className="text-lg font-medium text-foreground">{phase.title}</h3>
              <p className="mt-1 text-sm font-medium text-muted-foreground">{phase.summary}</p>
              <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground/90">
                {phase.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
