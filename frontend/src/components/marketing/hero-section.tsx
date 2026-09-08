import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight, Terminal } from "lucide-react"

function HeroApiInspector() {
  return (
    <div className="w-full overflow-hidden rounded border border-zinc-300 bg-zinc-950 font-mono text-[12.5px] text-zinc-100 shadow-sm dark:border-zinc-800 dark:bg-[#0b0b0f]">
      {/* Pane header */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4 py-2.5 dark:bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-[#ff5f57]/80" />
            <span className="size-2.5 rounded-full bg-[#febc2e]/80" />
            <span className="size-2.5 rounded-full bg-[#28c840]/80" />
          </div>
          <span className="text-[11px] text-zinc-400">HTTP / 1.1 · Kairo V1 Contract</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
            201 Created
          </span>
        </div>
      </div>

      {/* Request Section */}
      <div className="border-b border-zinc-800/80 px-5 py-4 leading-6">
        <div className="mb-2.5 flex items-baseline gap-2">
          <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-300">
            POST
          </span>
          <span className="text-zinc-200">/api/v1/memories</span>
        </div>

        <div className="mb-3 space-y-0.5 text-[11px] text-zinc-400">
          <div>
            <span className="text-zinc-500">Authorization: </span>
            <span className="text-amber-400/90">Bearer </span>
            <span className="text-zinc-300">$KAIRO_API_KEY</span>
          </div>
          <div>
            <span className="text-zinc-500">Content-Type: </span>
            <span className="text-zinc-300">application/json</span>
          </div>
        </div>

        <div className="text-[12px]">
          <span className="text-zinc-500">{"{"}</span>
          <div className="ml-4 space-y-0.5">
            <div>
              <span className="text-zinc-400">&quot;content&quot;</span>
              <span className="text-zinc-500">: </span>
              <span className="text-emerald-300">&quot;The user prefers dark mode in all applications.&quot;</span>
              <span className="text-zinc-500">,</span>
            </div>
            <div>
              <span className="text-zinc-400">&quot;memoryType&quot;</span>
              <span className="text-zinc-500">: </span>
              <span className="text-emerald-300">&quot;Preference&quot;</span>
            </div>
          </div>
          <span className="text-zinc-500">{"}"}</span>
        </div>
      </div>

      {/* Response Section */}
      <div className="px-5 py-4 leading-6 text-[12px]">
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
          <span>Response Payload</span>
          <span className="text-zinc-400">application/json</span>
        </div>
        <span className="text-zinc-500">{"{"}</span>
        <div className="ml-4 space-y-0.5">
          <div>
            <span className="text-zinc-400">&quot;memoryId&quot;</span>
            <span className="text-zinc-500">: </span>
            <span className="text-amber-400">42</span>
            <span className="text-zinc-500">,</span>
          </div>
          <div>
            <span className="text-zinc-400">&quot;userId&quot;</span>
            <span className="text-zinc-500">: </span>
            <span className="text-amber-400">7</span>
            <span className="text-zinc-500">,</span>
          </div>
          <div>
            <span className="text-zinc-400">&quot;content&quot;</span>
            <span className="text-zinc-500">: </span>
            <span className="text-emerald-300">&quot;The user prefers dark mode in all applications.&quot;</span>
            <span className="text-zinc-500">,</span>
          </div>
          <div>
            <span className="text-zinc-400">&quot;memoryType&quot;</span>
            <span className="text-zinc-500">: </span>
            <span className="text-emerald-300">&quot;Preference&quot;</span>
            <span className="text-zinc-500">,</span>
          </div>
          <div>
            <span className="text-zinc-400">&quot;isActive&quot;</span>
            <span className="text-zinc-500">: </span>
            <span className="text-sky-300">true</span>
            <span className="text-zinc-500">,</span>
          </div>
          <div>
            <span className="text-zinc-400">&quot;createdAt&quot;</span>
            <span className="text-zinc-500">: </span>
            <span className="text-emerald-300">&quot;2026-09-07T11:00:00.000Z&quot;</span>
          </div>
        </div>
        <span className="text-zinc-500">{"}"}</span>
      </div>
    </div>
  )
}

export function HeroSection() {
  return (
    <section
      id="hero"
      className="mx-auto max-w-6xl px-6 pt-32 pb-20 sm:pt-36 sm:pb-24"
      aria-label="Hero"
    >
      <div className="grid items-start gap-12 lg:grid-cols-[1.15fr,0.85fr] xl:gap-16">
        {/* Left column: Hero copy and hierarchy */}
        <div className="flex flex-col">
          {/* Identity relationship line */}
          <div className="mb-6 flex items-center gap-2 text-sm font-medium tracking-tight text-foreground/85">
            <span className="font-semibold text-foreground">Kairo</span>
            <span className="text-muted-foreground/50">—</span>
            <span className="text-muted-foreground">persistent memory infrastructure</span>
          </div>

          {/* Scaled H1 */}
          <h1 className="text-4xl font-semibold tracking-[-0.04em] leading-[1.08] text-foreground sm:text-5xl lg:text-6xl text-balance">
            Persistent memory for AI agents and applications.
          </h1>

          {/* Body */}
          <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-muted-foreground sm:text-[17px]">
            Kairo provides a dedicated persistence layer for LLM agents. Store facts,
            preferences, and context through a standardized REST API, and retrieve them
            using Mistral semantic vector search across every conversation session.
          </p>

          {/* CTAs */}
          <div className="mt-8 flex flex-wrap items-center gap-3.5">
            <Button size="default" className="gap-2 px-5 text-sm font-medium" asChild>
              <Link href="#quickstart">
                Start integration
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button variant="outline" size="default" className="gap-2 px-5 text-sm font-medium" asChild>
              <Link href="#api">
                <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
                API specification
              </Link>
            </Button>
          </div>

          {/* Specifications line */}
          <div className="mt-10 border-t border-border/70 pt-4">
            <p className="font-mono text-xs text-muted-foreground/80">
              Memory V1 API · Mistral Semantic Embeddings · Scoped Bearer Authentication
            </p>
          </div>
        </div>

        {/* Right column: Aligned Inspector */}
        <div className="w-full">
          <HeroApiInspector />
        </div>
      </div>
    </section>
  )
}
