"use client";

import React from "react";
import Link from "next/link";
import {
  Blocks,
  Clock,
  Layers,
  Code2,
  Terminal,
  Cpu,
  ArrowRight,
  Shield,
  Workflow,
  Sparkles,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const PLANNED_PLUGINS = [
  {
    name: "VS Code & Cursor Extension",
    category: "IDE Integration",
    status: "In Architecture",
    description:
      "Direct editor canvas integration. Query project architectural decisions without leaving your editor, and automatically index commit messages as project context.",
    icon: Code2,
    features: [
      "Inline ⌘K memory prompt insertion",
      "Git diff & commit rationale indexing",
      "Per-workspace memory scoping",
    ],
  },
  {
    name: "JetBrains Suite Plugin",
    category: "IDE Integration",
    status: "Planned",
    description:
      "Native IntelliJ IDEA, WebStorm, and PyCharm plugin. Bridges local language server semantic context with your central VOIDZONE memory bank.",
    icon: Layers,
    features: [
      "Project-level memory inspector tool window",
      "Symbol & refactoring decision history",
      "Automated team memory synchronization",
    ],
  },
  {
    name: "CLI & Pre-Commit Hook Agent",
    category: "Terminal Tooling",
    status: "In Prototype",
    description:
      "A lightweight terminal companion for capturing shell sessions, deployment notes, and architectural decisions straight from your command line.",
    icon: Terminal,
    features: [
      "voidzone remember 'switch Redis to cluster mode'",
      "Automated PR description generation from memory",
      "Headless CI/CD test failure knowledge base",
    ],
  },
  {
    name: "Model Context Protocol (MCP) Multi-Bridge",
    category: "Agent Protocol",
    status: "Active Spec",
    description:
      "Standardized multi-agent protocol connector allowing autonomous agents (Claude Code, Cline, Roo Code) to query and commit memories concurrently.",
    icon: Cpu,
    features: [
      "Native MCP tools: remember, recall, forget",
      "Granular actor token permissions",
      "Conflict-free concurrent memory merging",
    ],
  },
];

export default function PluginsPage() {
  return (
    <div className="space-y-8">
      {/* Header & Status Banner */}
      <div className="rounded-xl border border-border/80 bg-surface-elevated/60 p-5 sm:p-7 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Blocks className="h-4 w-4" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                Cross-Platform Plugins
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Connecting persistent VOIDZONE memory to your everyday IDEs, terminal workflows, and autonomous agents.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-mono font-medium text-primary">
              <Clock className="mr-1.5 h-3.5 w-3.5" />
              Coming Soon
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-surface-subtle/50 p-4 text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground font-mono text-[11px]">Notice: </span>
          The plugin ecosystem is currently under active specification and architectural prototyping. In the meantime, you can integrate persistent memory into any developer workflow using our production{" "}
          <Link href="/dashboard/docs" className="text-primary hover:underline font-mono">
            REST API
          </Link>
          ,{" "}
          <Link href="/developers/python" className="text-primary hover:underline font-mono">
            Python SDK
          </Link>
          ,{" "}
          <Link href="/developers/node" className="text-primary hover:underline font-mono">
            Node.js SDK
          </Link>
          , or native{" "}
          <Link href="/developers/mcp" className="text-primary hover:underline font-mono">
            MCP server
          </Link>
          .
        </div>
      </div>

      {/* Planned Plugins Grid */}
      <div className="space-y-4">
        <div className="border-b border-border/60 pb-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Plugin Architecture Roadmap
          </h2>
          <p className="text-xs text-muted-foreground">
            Planned native integrations designed for zero-friction memory harvesting and recall.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PLANNED_PLUGINS.map((plugin) => {
            const Icon = plugin.icon;
            return (
              <div
                key={plugin.name}
                className="rounded-xl border border-border/60 bg-surface-elevated/40 p-5 flex flex-col justify-between space-y-4 transition-colors hover:border-border"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-surface-subtle text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-foreground">
                          {plugin.name}
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {plugin.category}
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex items-center rounded border border-border/70 bg-surface-subtle px-1.5 py-0.5 text-[9.5px] font-mono text-muted-foreground">
                      {plugin.status}
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {plugin.description}
                  </p>

                  <div className="space-y-1.5 pt-2">
                    {plugin.features.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] font-mono text-foreground/80">
                        <span className="h-1 w-1 rounded-full bg-primary shrink-0" />
                        <span className="truncate">{f}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-border/40 flex items-center justify-between text-xs">
                  <span className="text-[11px] font-mono text-muted-foreground/60">
                    Cross-Platform Specification
                  </span>
                  <span className="text-[11px] font-mono text-primary/70">
                    Coming Soon
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Integration Vision */}
      <div className="rounded-xl border border-border/80 bg-surface-elevated/60 p-5 sm:p-6 space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Workflow className="h-4 w-4 text-primary" />
          <span>Bi-Directional Context Flow</span>
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          When plugins launch, every decision made in your IDE (e.g. choosing a database migration strategy) will be automatically indexed into VOIDZONE. When you later open ChatGPT with the VOIDZONE Browser Extension or ask a CLI agent for guidance, the exact rationale is already in context.
        </p>
        <div className="pt-2 flex items-center gap-2">
          <Button asChild size="sm" variant="outline" className="h-8 text-xs font-medium border-border/70 bg-surface-elevated hover:bg-surface-elevated/80">
            <Link href="/dashboard/docs">
              Browse Current API Reference →
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
