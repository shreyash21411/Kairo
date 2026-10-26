"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/providers/auth-provider";
import { useProject } from "@/providers/project-provider";
import { memoriesApi } from "@/lib/api/memoriesApi";
import { MemoryListItem } from "@/types/memory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Brain,
  Search,
  Terminal,
  KeyRound,
  FolderGit2,
  ArrowRight,
  User,
  Layers,
  Calendar,
  Key,
} from "lucide-react";

export default function DashboardOverviewPage() {
  const { user } = useAuth();
  const { selectedProject, projects, projectApiKeys, sessionApiKey, activeActorId } = useProject();
  const [memories, setMemories] = useState<MemoryListItem[]>([]);
  const [isLoadingMemories, setIsLoadingMemories] = useState(false);

  // Load real active memories for the selected project with race protection
  useEffect(() => {
    if (!sessionApiKey || !selectedProject) {
      setMemories([]);
      return;
    }

    const abortController = new AbortController();
    const capturedProjectId = selectedProject.projectId;
    const capturedKey = sessionApiKey;

    setIsLoadingMemories(true);
    memoriesApi
      .list(capturedKey, abortController.signal)
      .then((data) => {
        if (
          selectedProject?.projectId === capturedProjectId &&
          sessionApiKey === capturedKey
        ) {
          setMemories(data.memories || []);
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        if (
          selectedProject?.projectId === capturedProjectId &&
          sessionApiKey === capturedKey
        ) {
          setMemories([]);
        }
      })
      .finally(() => {
        if (
          selectedProject?.projectId === capturedProjectId &&
          sessionApiKey === capturedKey
        ) {
          setIsLoadingMemories(false);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [sessionApiKey, selectedProject?.projectId]);

  const activeKeysCount = projectApiKeys.filter((k) => k.isActive).length;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/60">
        <div>
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">
            Command Center
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Workspace Overview
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time infrastructure context for{" "}
            <span className="font-semibold text-foreground">
              {selectedProject?.name ?? "Workspace"}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link href="/dashboard/playground">
              <Terminal className="h-3.5 w-3.5 mr-1" />
              Playground
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/dashboard/memories">
              <Brain className="h-3.5 w-3.5 mr-1" />
              Memory Explorer
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Telemetry Strip (Single unified container, NOT 4 cards) */}
      <div className="grid grid-cols-2 md:grid-cols-4 rounded-lg border border-border/80 bg-surface-elevated/60 divide-y md:divide-y-0 md:divide-x divide-border/60 overflow-hidden">
        {/* Total Projects */}
        <div className="p-4 space-y-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
            <span>Projects</span>
            <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground/60" />
          </div>
          <div className="text-xl font-bold text-foreground font-mono">
            {projects.length}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            Across developer account
          </div>
        </div>

        {/* Project API Keys */}
        <div className="p-4 space-y-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
            <span>API Keys</span>
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground/60" />
          </div>
          <div className="text-xl font-bold text-foreground font-mono">
            {projectApiKeys.length}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {activeKeysCount} active in selected project
          </div>
        </div>

        {/* Stored Memories */}
        <div className="p-4 space-y-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
            <span>Stored Memories</span>
            <Brain className="h-3.5 w-3.5 text-muted-foreground/60" />
          </div>
          <div className="text-xl font-bold text-foreground font-mono">
            {sessionApiKey ? memories.length : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {sessionApiKey ? "Project context active" : "API Key required to list"}
          </div>
        </div>

        {/* Active Actor Scope */}
        <div className="p-4 space-y-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
            <span>Active Actor</span>
            <User className="h-3.5 w-3.5 text-muted-foreground/60" />
          </div>
          <div className="text-sm font-semibold text-foreground font-mono truncate">
            {activeActorId}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            Partition: (Project, Actor)
          </div>
        </div>
      </div>

      {/* Recent Memories Stream (Hairline separated rows, NOT nested cards) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <div className="font-semibold text-foreground flex items-center gap-2">
            <span>Recent Stored Memories</span>
            {memories.length > 0 && (
              <span className="text-[10px] font-mono text-muted-foreground">
                ({memories.length})
              </span>
            )}
          </div>
          <Link
            href="/dashboard/memories"
            className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 font-mono text-[11px]"
          >
            <span>View all</span>
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {!sessionApiKey ? (
          <div className="p-6 rounded-lg border border-border/80 bg-surface-elevated/40 text-center space-y-2">
            <Key className="h-5 w-5 text-amber-500 mx-auto" />
            <div className="text-xs font-semibold text-foreground">API Session Key Required</div>
            <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
              Provide an active Project API key to inspect real memories stored in this project context.
            </p>
            <Button size="sm" variant="outline" asChild className="text-xs mt-2">
              <Link href="/dashboard/api-keys">Configure API Keys</Link>
            </Button>
          </div>
        ) : isLoadingMemories ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 rounded-md border border-border/60 bg-surface-subtle/40 animate-pulse"
              />
            ))}
          </div>
        ) : memories.length === 0 ? (
          <div className="p-8 rounded-lg border border-border/80 bg-surface-elevated/40 text-center space-y-2">
            <Brain className="h-5 w-5 text-muted-foreground/60 mx-auto" />
            <div className="text-xs font-semibold text-foreground">No memories recorded yet</div>
            <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
              This project does not contain any active memories. Ingest memories using the Playground or Python/Node SDKs.
            </p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button size="sm" asChild>
                <Link href="/dashboard/memories">Add Memory</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/dashboard/playground">Open Playground</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border/80 bg-surface-elevated/40 divide-y divide-border/60 overflow-hidden">
            {memories.slice(0, 5).map((m) => (
              <div
                key={m.memoryId}
                className="p-3.5 hover:bg-surface-subtle/50 transition-colors flex items-start justify-between gap-4"
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-primary font-medium">
                      #{m.memoryId}
                    </span>
                    <Badge variant={m.memoryType?.toLowerCase() as any || "secondary"}>
                      {m.memoryType || "Other"}
                    </Badge>
                    <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-2.5 w-2.5 text-muted-foreground/60" />
                      {new Date(m.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/90 font-sans leading-relaxed truncate">
                    {m.content}
                  </p>
                </div>

                <Button size="sm" variant="ghost" asChild className="shrink-0 text-xs">
                  <Link href="/dashboard/memories">Inspect</Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Developer Quick Navigation Links */}
      <div className="pt-4 border-t border-border/60 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-muted-foreground">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/playground" className="hover:text-primary transition-colors">
            Playground →
          </Link>
          <Link href="/dashboard/search" className="hover:text-primary transition-colors">
            Semantic Search →
          </Link>
          <Link href="/dashboard/docs" className="hover:text-primary transition-colors">
            SDK Reference →
          </Link>
        </div>
        <span>VOIDZONE Core Engine v1.0</span>
      </div>
    </div>
  );
}
