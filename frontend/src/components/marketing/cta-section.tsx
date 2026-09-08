import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight, Terminal } from "lucide-react"

export function CtaSection() {
  return (
    <section
      id="get-started"
      className="border-t border-border py-20 px-6 sm:py-28"
      aria-label="Get started with Kairo"
    >
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl text-balance">
              Persistent memory infrastructure for AI.
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">
              Integrate persistent state into your AI agents without operating complex vector databases.
              Standard REST endpoints, scoped API keys, and Mistral semantic recall.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="default" className="gap-2 px-5 text-sm font-medium" asChild>
              <Link href="#quickstart">
                Start with Quickstart
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button variant="outline" size="default" className="gap-2 px-5 text-sm font-medium" asChild>
              <Link href="#api">
                <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
                API Specification
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
