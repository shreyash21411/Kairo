"use client";

import React from "react";
import Link from "next/link";
import {
  Mic,
  Clock,
  Sparkles,
  Shield,
  Layers,
  ArrowRight,
  Headphones,
  AudioWaveform,
  Volume2,
  Lock,
  Workflow,
  Brain,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const RESEARCH_PILLARS = [
  {
    title: "Ephemeral Audio Streaming",
    desc: "Voice audio is transcribed in-flight and immediately purged. Audio bytes are never written to disk or stored long-term, guaranteeing strict acoustic privacy.",
    icon: Lock,
  },
  {
    title: "Conversational Turn Disambiguation",
    desc: "Distinguishing casual banter from actionable engineering decisions. Only verifiable facts, preferences, and architecture constraints are crystallized into memory.",
    icon: Brain,
  },
  {
    title: "Cross-Modal Memory Bridging",
    desc: "A decision voiced in a morning standup or pairing session is immediately indexed and available when you open ChatGPT or your IDE editor later that day.",
    icon: Workflow,
  },
  {
    title: "Zero-Latency Grounded Recall",
    desc: "When speaking with Beru, answers are synthesized with sub-300ms vector similarity lookups against your active project and actor scope.",
    icon: AudioWaveform,
  },
];

export default function BeruVoiceAgentPage() {
  return (
    <div className="space-y-8">
      {/* Header & Status Card */}
      <div className="rounded-xl border border-border/80 bg-surface-elevated/60 p-5 sm:p-7 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Mic className="h-4 w-4" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                Beru Voice Agent
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Autonomous voice-first AI companion with persistent conversational memory and cross-modal continuity.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-mono font-medium text-primary">
              <Clock className="mr-1.5 h-3.5 w-3.5" />
              Coming Soon
            </span>
          </div>
        </div>

        {/* Clear, honest technical disclaimer */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs text-muted-foreground leading-relaxed space-y-2">
          <div className="font-semibold text-foreground font-mono text-[11px] flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>Research & Development Status Notice</span>
          </div>
          <p>
            Beru Voice Agent is an active VOIDZONE research project exploring real-time acoustic dialogue and persistent memory continuity. Voice streaming pipelines, speech models, and audio interfaces are currently in prototype staging and are not yet deployed to production.
          </p>
        </div>
      </div>

      {/* Voice Architecture Pillars */}
      <div className="space-y-4">
        <div className="border-b border-border/60 pb-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Acoustic Memory Architecture
          </h2>
          <p className="text-xs text-muted-foreground">
            The core research principles guiding the development of VOIDZONE's voice-first agent.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {RESEARCH_PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.title}
                className="rounded-xl border border-border/60 bg-surface-elevated/40 p-5 flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-surface-subtle text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="text-xs font-semibold text-foreground">
                      {pillar.title}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {pillar.desc}
                  </p>
                </div>

                <div className="pt-2 border-t border-border/40 text-[10px] font-mono text-muted-foreground/60 flex items-center justify-between">
                  <span>R&D Milestone</span>
                  <span className="text-primary/70">Active Spec</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cross-Modal Memory Continuity Scenario */}
      <div className="rounded-xl border border-border/80 bg-surface-elevated/60 p-5 sm:p-7 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">
            Envisioned Cross-Modal Workflow
          </h2>
          <p className="text-xs text-muted-foreground">
            How persistent memory unites verbal discussions with written code.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-1 text-xs">
          <div className="rounded-lg border border-border/60 bg-surface-subtle/40 p-4 space-y-2">
            <span className="font-mono text-[10.5px] font-semibold text-primary block uppercase">
              Phase 1 · Voice Pairing
            </span>
            <p className="text-muted-foreground leading-relaxed">
              While discussing design tradeoffs on a walk or standup: &ldquo;Beru, remember that for all v2 endpoints, we are enforcing HMAC-SHA256 request signatures.&rdquo;
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-surface-subtle/40 p-4 space-y-2">
            <span className="font-mono text-[10.5px] font-semibold text-primary block uppercase">
              Phase 2 · Vector Ingestion
            </span>
            <p className="text-muted-foreground leading-relaxed">
              VOIDZONE extracts the architectural rule as a classified Fact/Preference with project tags and indexes the embedding into pgvector.
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-surface-subtle/40 p-4 space-y-2">
            <span className="font-mono text-[10.5px] font-semibold text-primary block uppercase">
              Phase 3 · Assistant Recall
            </span>
            <p className="text-muted-foreground leading-relaxed">
              Two days later in ChatGPT, you ask: &ldquo;Generate the auth middleware for our new endpoint.&rdquo; The browser extension injects the signature rule automatically.
            </p>
          </div>
        </div>
      </div>

      {/* Available Alternatives */}
      <div className="rounded-xl border border-border/80 bg-surface-elevated/60 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-foreground">
            Looking for available persistent memory tools today?
          </div>
          <p className="text-xs text-muted-foreground">
            Install the VOIDZONE Browser Extension for ChatGPT or explore the developer API.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button asChild size="sm" className="h-8 text-xs font-medium bg-foreground text-background hover:bg-foreground/90">
            <Link href="/dashboard/extension">
              Browser Extension <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8 text-xs font-medium border-border/70 bg-surface-elevated hover:bg-surface-elevated/80">
            <Link href="/dashboard/docs">
              API Docs
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
