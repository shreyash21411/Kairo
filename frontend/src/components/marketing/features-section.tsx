interface CapabilityItem {
  title: string
  status: "Current V1" | "Roadmap"
  description: string
  endpoint?: string
  specification: string
}

const CAPABILITIES: CapabilityItem[] = [
  {
    title: "Mistral Semantic Embeddings & Vector Search",
    status: "Current V1",
    endpoint: "POST /api/v1/memories/search",
    description:
      "Generates dense vector embeddings using Mistral (`mistral-embed`) during ingestion. Natural language queries compute cosine similarity against stored memory vectors and evaluate relevance to retrieve top-k context.",
    specification: "Embeddings: Mistral · Similarity: Cosine metric · Relevance evaluator: LLM validation",
  },
  {
    title: "Multi-Pass Duplicate Prevention",
    status: "Current V1",
    endpoint: "POST /api/v1/memories",
    description:
      "Prevents memory store pollution through a two-pass validation gate. First, an exact text match is checked. Second, semantic cosine similarity is evaluated against existing user memories. Duplicate submissions return `isDuplicate: true`.",
    specification: "Exact text matching + Semantic vector similarity threshold",
  },
  {
    title: "Cryptographic Tenant & User Boundary",
    status: "Current V1",
    description:
      "Strict authorization boundary. The HTTP caller never supplies `userId`. The user identity is resolved solely from the SHA-256 hash of the API key. All reads, updates, and deletes verify repository-level ownership.",
    specification: "Auth: Bearer token · Key storage: SHA-256 hex hash · LastUsedAt tracking",
  },
  {
    title: "Immutable Snapshots & Non-Destructive Mutations",
    status: "Current V1",
    endpoint: "PUT & DELETE /api/v1/memories/{id}",
    description:
      "Before any memory is updated, an immutable snapshot is committed to `MemoryVersions`. Deletions perform soft deactivation (`isActive = false`), keeping records audit-safe while removing them from active search queries.",
    specification: "Versioning: MemoryVersions table · Deletion: Soft-deactivate",
  },
  {
    title: "Automated Memory Consolidation Engine",
    status: "Roadmap",
    description:
      "Background reconciliation pipeline designed to automatically merge evolving preferences, resolve conflicting assertions, and reduce long-term token bloat across disparate conversational sessions.",
    specification: "Target feature: Multi-turn fact reconciliation and memory graph clustering",
  },
]

export function FeaturesSection() {
  return (
    <section id="api" className="border-t border-border py-20 px-6 sm:py-24" aria-label="System Capabilities">
      <div className="mx-auto max-w-6xl">
        {/* Editorial 2-Column Composition */}
        <div className="grid gap-12 lg:grid-cols-[1fr,1.6fr] lg:gap-16">
          {/* Left Column: Heading and Overview */}
          <div>
            <div className="lg:sticky lg:top-24">
              <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl text-balance">
                System capabilities & technical boundaries.
              </h2>
              <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">
                Kairo is engineered to decouple agent state from runtime execution.
                Every memory operation is bounded by tenant isolation, vector integrity, and strict immutability.
              </p>

              <div className="mt-8 border-t border-border/70 pt-6">
                <p className="font-mono text-xs text-muted-foreground">
                  Current implementation: Memory V1 API (Frozen)
                </p>
                <p className="mt-1 text-xs text-muted-foreground/80">
                  Backed by ASP.NET Core, EF Core, SQL Server, and Mistral Embeddings.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Editorial Capability List with Hairline Dividers */}
          <div className="divide-y divide-border/60">
            {CAPABILITIES.map((cap, idx) => (
              <div key={cap.title} className={idx === 0 ? "pb-8" : "py-8"}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h3 className="text-lg font-medium text-foreground">{cap.title}</h3>
                  <span
                    className={`font-mono text-[10px] px-2 py-0.5 rounded uppercase tracking-wider font-semibold ${
                      cap.status === "Current V1"
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {cap.status}
                  </span>
                </div>

                {cap.endpoint && (
                  <p className="font-mono text-xs text-primary mb-2">
                    {cap.endpoint}
                  </p>
                )}

                <p className="text-[14px] leading-relaxed text-muted-foreground mb-3">
                  {cap.description}
                </p>

                <p className="font-mono text-[11px] text-muted-foreground/80">
                  {cap.specification}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
