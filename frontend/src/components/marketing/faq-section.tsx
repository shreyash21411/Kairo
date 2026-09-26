"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronDown, HelpCircle } from "lucide-react"

interface FaqItem {
  question: string
  answer: string
}

const FAQS: FaqItem[] = [
  {
    question: "What does Kairo remember?",
    answer:
      "Kairo remembers discrete facts, preferences, goals, and context extracted from user conversations or explicit API calls. You can save structured memory types such as 'Preference', 'Goal', 'Context', or 'Fact'. Fleeting conversational pleasantries are filtered out automatically.",
  },
  {
    question: "How is memory scoped and isolated?",
    answer:
      "Memories are partitioned hierarchically. Every memory is bound to a specific Organization, Project, and Actor ID. Kairo enforces cryptographic data isolation so that queries executed on behalf of one user or project can never retrieve another user's stored context.",
  },
  {
    question: "How does semantic search work in Kairo?",
    answer:
      "Every stored memory is projected into high-dimensional vector embeddings and indexed in pgvector. When a query is submitted, Kairo performs cosine similarity search across the vector space to recall the most contextually relevant memories, even when the query uses completely different words.",
  },
  {
    question: "How do I integrate Kairo into an existing AI agent?",
    answer:
      "Integration requires only two API operations: (1) Ingest facts into Kairo at the end of each session or turn using POST /api/v1/memories, and (2) Retrieve relevant memories using POST /api/v1/memories/search before sending prompts to your LLM. Official SDKs are available for Python and Node.js.",
  },
  {
    question: "Can I connect Kairo to Claude Desktop or Cursor via MCP?",
    answer:
      "Yes. Kairo provides a Model Context Protocol (MCP) server. You can configure Kairo in Claude Desktop or Cursor using npx @kairo/mcp-server, enabling your coding assistant to recall preferences and architectural guidelines across sessions automatically.",
  },
  {
    question: "Does Kairo replace my database or vector store?",
    answer:
      "No. Kairo is specialized memory infrastructure for conversational agents. It handles deduplication, temporal relevance, actor scoping, and semantic recall so you do not need to build complex memory extraction pipelines or custom vector search infrastructure yourself.",
  },
]

export function FaqSection() {
  const [openIndex, setOpenIndex] = React.useState<number | null>(0)

  const toggle = (idx: number) => {
    setOpenIndex((current) => (current === idx ? null : idx))
  }

  return (
    <section id="faq" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        
        <div className="text-center max-w-2xl mx-auto mb-14 sm:mb-16">
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-primary font-semibold mb-3">
            <HelpCircle className="h-3.5 w-3.5" />
            <span>Frequently Asked Questions</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            Frequently asked questions.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            Everything you need to know about Kairo&apos;s architecture, memory isolation, and developer integration.
          </p>
        </div>

        {/* Accordion — items are product cards, section is transparent */}
        <div className="space-y-3">
          {FAQS.map((faq, idx) => {
            const isOpen = openIndex === idx
            const contentId = `faq-content-${idx}`
            const buttonId = `faq-button-${idx}`

            return (
              <div
                key={faq.question}
                className={cn(
                  "rounded-2xl border transition-all duration-200 overflow-hidden backdrop-blur-sm",
                  isOpen
                    ? "border-border/70 bg-surface-elevated/80 shadow-sm"
                    : "border-border/40 bg-surface-elevated/30 hover:bg-surface-elevated/60 hover:border-border/60"
                )}
              >
                <button
                  type="button"
                  id={buttonId}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  onClick={() => toggle(idx)}
                  className="w-full flex items-center justify-between gap-4 p-5 sm:p-6 text-left cursor-pointer active:translate-y-px transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="text-sm sm:text-base font-semibold text-foreground tracking-tight">
                    {faq.question}
                  </span>
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-surface-subtle/60 text-muted-foreground transition-transform duration-200",
                      isOpen && "rotate-180 text-primary border-primary/40"
                    )}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </button>

                {isOpen && (
                  <div
                    id={contentId}
                    role="region"
                    aria-labelledby={buttonId}
                    className="px-5 pb-5 sm:px-6 sm:pb-6 text-xs sm:text-sm text-muted-foreground leading-relaxed border-t border-border/40 pt-4 animate-in fade-in duration-150"
                  >
                    {faq.answer}
                  </div>
                )}
              </div>
            )
          })}
        </div>

      </div>
    </section>
  )
}