"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/providers/auth-provider"
import { ArrowRight, BookOpen } from "lucide-react"

export function CtaSection() {
  const { isAuthenticated } = useAuth()

  return (
    <section className="relative py-28 md:py-36 overflow-hidden">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center relative z-10">
        <h2 className="text-3xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-foreground leading-[1.12]">
          Give your AI the context <br className="hidden sm:inline" />
          <span className="text-primary font-bold">it was missing</span>.
        </h2>

        <p className="mt-5 max-w-lg mx-auto text-base sm:text-lg text-muted-foreground leading-relaxed">
          Start building with persistent memory in minutes. Available via REST, Python SDK, Node.js, and Model Context Protocol.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3.5">
          <Button
            size="lg"
            className="h-11 px-7 text-xs sm:text-sm font-medium rounded-full bg-foreground text-background hover:bg-foreground/90 transition-all duration-150 active:translate-y-px shadow-sm cursor-pointer"
            asChild
          >
            <Link href={isAuthenticated ? "/dashboard" : "/register"}>
              {isAuthenticated ? "Open Dashboard" : "Start building"}
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>

          <Button
            size="lg"
            variant="outline"
            className="h-11 px-6 text-xs sm:text-sm font-medium rounded-full border-border/70 bg-surface-elevated/60 backdrop-blur-sm hover:bg-surface-elevated transition-all duration-150 active:translate-y-px cursor-pointer"
            asChild
          >
            <Link href="#developers">
              <BookOpen className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
              Read the docs
            </Link>
          </Button>
        </div>

        <div className="mt-10 flex items-center justify-center gap-6 text-xs font-mono text-muted-foreground/80">
          <span>pgvector Powered</span>
          <span>·</span>
          <span>Actor Partitioning</span>
          <span>·</span>
          <span>Model Agnostic</span>
        </div>
      </div>
    </section>
  )
}