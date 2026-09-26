"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/providers/auth-provider"
import { HeroStoryAnimation } from "@/components/marketing/hero-story-animation"
import { ArrowRight, ChevronDown, Terminal, Shield, Sparkles } from "lucide-react"

export function HeroSection() {
  const { isAuthenticated } = useAuth()

  return (
    <section className="relative pt-24 pb-20 md:pt-32 md:pb-28 lg:pt-36 lg:pb-32 overflow-hidden">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">

          {/* Left Column: Editorial Headline & Actions */}
          <div className="lg:col-span-6 xl:col-span-5 flex flex-col items-start text-left">

            {/* Eyebrow Chip */}
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface-elevated/60 backdrop-blur-sm px-3 py-1 text-[11px] font-mono font-medium text-muted-foreground mb-6 shadow-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span>Persistent AI Memory Infrastructure</span>
            </div>

            {/* Signature Headline */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-foreground leading-[1.08]">
              Give your AI <br className="hidden sm:inline" />
              <span className="text-primary font-bold">a memory</span>.
            </h1>

            {/* Supporting Copy */}
            <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-lg">
              Persistent memory for AI applications, agents, and assistants.
              Retain context, user preferences, and project facts that outlast any single conversation window.
            </p>

            {/* Primary Action Buttons */}
            <div className="mt-8 flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <Button
                size="lg"
                className="h-11 px-6 text-xs sm:text-sm font-medium rounded-full bg-foreground text-background hover:bg-foreground/90 transition-all duration-150 active:translate-y-px shadow-sm cursor-pointer"
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
                className="h-11 px-5 text-xs sm:text-sm font-medium rounded-full border-border/70 bg-surface-elevated/50 backdrop-blur-sm hover:bg-surface-elevated transition-all duration-150 active:translate-y-px cursor-pointer"
                asChild
              >
                <Link href="#remembers">
                  See how it works
                  <ChevronDown className="ml-1.5 h-3.5 w-3.5 text-muted-foreground" />
                </Link>
              </Button>
            </div>

            {/* Quick Developer Trust Bar - no border-t */}
            <div className="mt-8 flex flex-wrap items-center gap-y-2 gap-x-5 text-xs font-mono text-muted-foreground/80">
              <div className="flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-primary" />
                <span>REST &amp; Python SDK</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span>Actor-Level Isolation</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>Model Context Protocol</span>
              </div>
            </div>

          </div>

          {/* Right Column: Signature Interactive Visual */}
          <div className="lg:col-span-6 xl:col-span-7 flex justify-center w-full">
            <HeroStoryAnimation />
          </div>

        </div>

      </div>
    </section>
  )
}
