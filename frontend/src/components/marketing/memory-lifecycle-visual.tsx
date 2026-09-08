"use client"

import * as React from "react"

export function MemoryLifecycleVisual() {
  return (
    <div className="relative w-full overflow-hidden rounded border border-border bg-card/40 p-6 sm:p-8">
      {/* Visual Header */}
      <div className="mb-6 flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-primary" />
          <span className="font-mono text-xs font-medium text-foreground">
            Memory Lifecycle Architecture
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          Mistral Embed · Cosine Vector Space
        </span>
      </div>

      {/* SVG Diagram: Ingestion -> Vector Projection -> Memory Lattice -> Semantic Retrieval */}
      <div className="w-full">
        <svg
          viewBox="0 0 640 300"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-auto text-foreground"
          aria-label="Kairo Memory and Retrieval Lifecycle Diagram"
        >
          {/* Background grid dots */}
          <pattern
            id="diag-grid"
            x="0"
            y="0"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r="0.8" className="fill-muted-foreground/15" />
          </pattern>
          <rect width="640" height="300" fill="url(#diag-grid)" rx="4" />

          {/* Coordinate axes for Vector Space */}
          <g className="opacity-40">
            <line x1="280" y1="260" x2="480" y2="260" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="280" y1="60" x2="280" y2="260" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
            <text x="475" y="275" className="fill-muted-foreground font-mono text-[9px]">dim_x</text>
            <text x="255" y="70" className="fill-muted-foreground font-mono text-[9px]">dim_y</text>
          </g>

          {/* NODE 1: Ingested Fact */}
          <g transform="translate(30, 90)">
            <rect
              width="180"
              height="85"
              rx="4"
              className="fill-background stroke-border"
              strokeWidth="1"
            />
            <text x="14" y="24" className="fill-foreground font-mono text-[11px] font-semibold">
              01 · INGESTION
            </text>
            <text x="14" y="44" className="fill-muted-foreground font-mono text-[10px]">
              POST /api/v1/memories
            </text>
            <rect x="14" y="54" width="152" height="20" rx="2" className="fill-accent/40" />
            <text x="20" y="68" className="fill-foreground/90 font-mono text-[9px]">
              &quot;prefers dark mode&quot;
            </text>
          </g>

          {/* Connecting Arrow 1: Ingestion -> Vector Projection */}
          <path
            d="M 210 132 L 275 132"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-primary/70"
            strokeDasharray="2 2"
          />
          <polygon points="275,129 281,132 275,135" className="fill-primary" />

          {/* VECTOR SPACE CLUSTER (Nodes in vector coordinate space) */}
          <g>
            {/* Cluster hull / boundary */}
            <path
              d="M 310 100 C 350 70, 420 80, 450 110 C 470 140, 460 200, 410 220 C 360 230, 310 190, 310 100 Z"
              className="fill-primary/5 stroke-primary/20"
              strokeWidth="1"
            />
            <text x="320" y="90" className="fill-primary/80 font-mono text-[10px] font-medium tracking-wide">
              Persistent Vector Space
            </text>

            {/* Interconnected memory nodes */}
            <line x1="330" y1="130" x2="380" y2="160" stroke="currentColor" strokeWidth="1" className="text-border" />
            <line x1="380" y1="160" x2="420" y2="120" stroke="currentColor" strokeWidth="1" className="text-border" />
            <line x1="380" y1="160" x2="390" y2="200" stroke="currentColor" strokeWidth="1" className="text-border" />
            <line x1="330" y1="130" x2="350" y2="180" stroke="currentColor" strokeWidth="1" className="text-border" />

            {/* Memory points */}
            <circle cx="330" cy="130" r="3.5" className="fill-foreground" />
            <circle cx="350" cy="180" r="3" className="fill-muted-foreground" />
            <circle cx="420" cy="120" r="3" className="fill-muted-foreground" />
            <circle cx="390" cy="200" r="3" className="fill-muted-foreground" />

            {/* Target active memory hit */}
            <circle cx="380" cy="160" r="5" className="fill-primary stroke-background" strokeWidth="1.5" />
            <text x="370" y="148" className="fill-primary font-mono text-[9px] font-bold">
              ID: 42
            </text>

            {/* Similarity vector line */}
            <line
              x1="380"
              y1="160"
              x2="480"
              y2="160"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-primary"
            />
            <text x="390" y="176" className="fill-emerald-600 dark:fill-emerald-400 font-mono text-[9px] font-semibold">
              sim: 0.94
            </text>
          </g>

          {/* NODE 2: Context Retrieval / Search Result */}
          <g transform="translate(480, 100)">
            <rect
              width="135"
              height="95"
              rx="4"
              className="fill-background stroke-border"
              strokeWidth="1"
            />
            <text x="12" y="24" className="fill-foreground font-mono text-[11px] font-semibold">
              02 · RETRIEVAL
            </text>
            <text x="12" y="42" className="fill-muted-foreground font-mono text-[9px]">
              POST /memories/search
            </text>
            <rect x="12" y="52" width="111" height="32" rx="2" className="fill-accent/40" />
            <text x="18" y="66" className="fill-foreground/90 font-mono text-[8.5px]">
              isRelevant: true
            </text>
            <text x="18" y="78" className="fill-muted-foreground font-mono text-[8.5px]">
              Inject to Prompt →
            </text>
          </g>
        </svg>
      </div>

      {/* Visual Captions */}
      <div className="mt-4 grid grid-cols-1 gap-4 border-t border-border/60 pt-4 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <p className="font-mono text-[11px] font-semibold text-foreground">Ingest & Deduplicate</p>
          <p className="mt-0.5 text-[12px] leading-normal">
            New facts pass exact-match and cosine threshold checks to prevent duplicate entries.
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] font-semibold text-foreground">Vector Space Index</p>
          <p className="mt-0.5 text-[12px] leading-normal">
            Mistral embeddings map memories into an indexed vector manifold scoped per API key.
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] font-semibold text-foreground">Semantic Recall</p>
          <p className="mt-0.5 text-[12px] leading-normal">
            Natural language queries recall relevant memories for prompt context injection.
          </p>
        </div>
      </div>
    </div>
  )
}
