"use client";

import React, { useState } from "react";
import { useProject } from "@/providers/project-provider";
import { memoriesApi } from "@/lib/api/memoriesApi";
import { RetrievedMemory } from "@/types/memory";
import { ApiError } from "@/types/api";
import { Button } from "@/components/ui/button";
import { SessionKeyBar } from "@/components/dashboard/session-key-bar";
import { StatusBanner } from "@/components/dashboard/status-banner";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LoadingState } from "@/components/dashboard/loading-state";
import { Search, Loader2, User, Sliders, Brain, ArrowRight } from "lucide-react";

// ─── Similarity bar visual ────────────────────────────────────────────────────
function SimilarityBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.88 ? "bg-emerald-500" :
    score >= 0.75 ? "bg-blue-500" :
    score >= 0.60 ? "bg-amber-500" :
    "bg-muted-foreground/40";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-20 rounded-full bg-border/40 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[10px] font-mono font-semibold tabular-nums ${
        score >= 0.88 ? "text-emerald-500" :
        score >= 0.75 ? "text-blue-500" :
        score >= 0.60 ? "text-amber-500" :
        "text-muted-foreground"
      }`}>
        {pct}%
      </span>
    </div>
  );
}

// ─── Memory Type label map ────────────────────────────────────────────────────
const TYPE_STYLES: Record<string, string> = {
  Preference:   "text-blue-500",
  Fact:         "text-amber-500",
  Goal:         "text-emerald-500",
  Context:      "text-purple-500",
  Skill:        "text-cyan-500",
  Relationship: "text-rose-500",
};

export default function SemanticSearchPage() {
  const { selectedProject, sessionApiKey, activeActorId } = useProject();

  const [query, setQuery] = useState("");
  const [actorId, setActorId] = useState(activeActorId);
  const [topK, setTopK] = useState(5);

  const [results, setResults] = useState<RetrievedMemory[] | null>(null);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => { setActorId(activeActorId); }, [activeActorId]);
  React.useEffect(() => { setResults(null); setLastQuery(null); }, [selectedProject]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionApiKey) { setError("A project API key is required for semantic search."); return; }
    if (!query.trim() || !actorId.trim()) { setError("Query and Actor ID are both required."); return; }

    setError(null);
    setIsSearching(true);

    try {
      const res = await memoriesApi.search(sessionApiKey, {
        query: query.trim(),
        topK,
        actorId: actorId.trim(),
      });
      setResults(res.memories);
      setLastQuery(res.query);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Semantic search failed.");
      setResults(null);
    } finally {
      setIsSearching(false);
    }
  };

  const canSearch = !!sessionApiKey && !!query.trim() && !!actorId.trim() && !isSearching;

  return (
    <div className="space-y-5">
      {/* ── Page Header ── */}
      <div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">Semantic Search</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Vector similarity recall · Project:{" "}
          <span className="font-medium text-foreground font-mono">
            {selectedProject?.name ?? "—"}
          </span>
        </p>
      </div>

      {/* ── Session Key Bar ── */}
      <SessionKeyBar />

      {/* ── Notifications ── */}
      <StatusBanner type="error" message={error} onDismiss={() => setError(null)} />

      {/* ── Search Form ── */}
      <form onSubmit={handleSearch} className="space-y-3">
        {/* Query input — visually prominent */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Natural language query — e.g. What are the user's editor preferences?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSearch) {
                handleSearch(e as unknown as React.FormEvent);
              }
            }}
            className="w-full pl-10 pr-28 py-3 text-sm rounded-lg border border-border/80 bg-surface-elevated focus:outline-none focus:ring-1 focus:ring-ring font-sans placeholder:text-muted-foreground/50 transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <kbd className="hidden sm:inline-flex items-center text-[10px] font-mono text-muted-foreground/50 bg-muted px-1.5 py-0.5 rounded border border-border/50">
              ⌘↵
            </kbd>
            <Button type="submit" size="sm" disabled={!canSearch} className="h-7 text-xs gap-1.5">
              {isSearching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Actor + Top-K controls */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              required
              placeholder="actor-id"
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
            />
          </div>
          <div className="flex items-center gap-2.5">
            <Sliders className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">Top-K:</span>
            <input
              type="range"
              min="1"
              max="20"
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="w-20 cursor-pointer accent-primary"
            />
            <span className="text-xs font-mono text-foreground w-4 text-right">{topK}</span>
          </div>
        </div>
      </form>

      {/* ── Results ── */}
      {isSearching ? (
        <LoadingState message="Computing semantic similarity across vector embeddings…" />
      ) : results !== null ? (
        results.length === 0 ? (
          <EmptyState
            icon={Brain}
            title="No relevant memories found"
            description={`No records met the relevance threshold for "${lastQuery}" in Actor scope '${actorId}'.`}
          />
        ) : (
          <div className="space-y-3">
            {/* Results metadata */}
            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground px-0.5">
              <span>
                {results.length} result{results.length !== 1 ? "s" : ""} · &ldquo;{lastQuery}&rdquo;
              </span>
              <span className="text-muted-foreground/50 hidden sm:block">
                cosine similarity · Mistral AI embeddings
              </span>
            </div>

            {/* Result rows */}
            <div className="border border-border/60 rounded-lg overflow-hidden">
              <div className="divide-y divide-border/30">
                {results.map((item, idx) => (
                  <div key={item.memoryId} className="px-4 py-3.5 hover:bg-surface-subtle/20 transition-colors">
                    <div className="flex items-start gap-4">
                      {/* Rank */}
                      <span className="font-mono text-[10px] text-muted-foreground/50 pt-0.5 w-4 shrink-0 text-right">
                        {idx + 1}
                      </span>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            #{item.memoryId}
                          </span>
                          {item.memoryType && (
                            <span className={`text-[10px] font-mono font-medium ${TYPE_STYLES[item.memoryType] ?? "text-muted-foreground"}`}>
                              {item.memoryType}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-foreground leading-relaxed font-sans">
                          {item.content}
                        </p>
                      </div>

                      {/* Similarity score — strictly from backend */}
                      <div className="shrink-0 flex flex-col items-end gap-1.5 pt-0.5">
                        <SimilarityBar score={item.similarity} />
                        <span className="text-[10px] font-mono text-muted-foreground/50">
                          {item.similarity.toFixed(4)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-border/30 bg-surface-subtle/20">
                <span className="text-[10px] font-mono text-muted-foreground/50">
                  POST /api/v1/memories/search · actor: {actorId}
                </span>
              </div>
            </div>
          </div>
        )
      ) : (
        /* Pre-search idle state */
        !sessionApiKey ? null : (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-surface-subtle border border-border/60 mb-4">
              <Search className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Enter a query to begin semantic recall</p>
            <p className="text-[11px] text-muted-foreground/50 mt-1 font-mono">
              Actor scope: {actorId || "—"}
            </p>
          </div>
        )
      )}
    </div>
  );
}
