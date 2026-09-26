"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface ApiEndpoint {
  id: string
  method: "POST" | "GET"
  path: string
  title: string
  description: string
  requestPayload?: string
  responseStatus: string
  responsePayload: string
  curlSnippet: string
}

const ENDPOINTS: ApiEndpoint[] = [
  {
    id: "create-memory",
    method: "POST",
    path: "/api/v1/memories",
    title: "Create Durable Memory",
    description: "Store a new memory item scoped to the project and actor. Handles vector embedding and deduplication automatically.",
    requestPayload: `{
  "content": "Prefers PostgreSQL for new projects",
  "memoryType": "Preference",
  "actorId": "user_123"
}`,
    responseStatus: "201 Created",
    responsePayload: `{
  "id": "mem_882910fa",
  "content": "Prefers PostgreSQL for new projects",
  "memoryType": "Preference",
  "actorId": "user_123",
  "projectId": "proj_prod_01",
  "createdAt": "2026-09-17T22:30:00Z",
  "isActive": true
}`,
    curlSnippet: `curl -X POST https://api.kairo.dev/api/v1/memories \\
  -H "Authorization: Bearer kairo_live_sec_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "Prefers PostgreSQL for new projects",
    "memoryType": "Preference",
    "actorId": "user_123"
  }'`,
  },
  {
    id: "search-memories",
    method: "POST",
    path: "/api/v1/memories/search",
    title: "Semantic Vector Search",
    description: "Retrieve relevant memories using natural-language similarity search with exact cosine distance scoring.",
    requestPayload: `{
  "query": "What database does this developer prefer?",
  "actorId": "user_123",
  "limit": 2
}`,
    responseStatus: "200 OK",
    responsePayload: `[
  {
    "id": "mem_882910fa",
    "content": "Prefers PostgreSQL for new projects",
    "memoryType": "Preference",
    "similarity": 0.948,
    "createdAt": "2026-09-17T22:30:00Z"
  },
  {
    "id": "mem_11928bc3",
    "content": "Currently implementing pgvector database layer",
    "memoryType": "Context",
    "similarity": 0.912,
    "createdAt": "2026-09-16T18:45:00Z"
  }
]`,
    curlSnippet: `curl -X POST https://api.kairo.dev/api/v1/memories/search \\
  -H "Authorization: Bearer kairo_live_sec_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "What database does this developer prefer?",
    "actorId": "user_123",
    "limit": 2
  }'`,
  },
  {
    id: "list-memories",
    method: "GET",
    path: "/api/v1/memories?actorId=user_123",
    title: "List Scoped Memories",
    description: "Retrieve paginated active memories filtered by actor or memory type within your active project scope.",
    responseStatus: "200 OK",
    responsePayload: `[
  {
    "id": "mem_882910fa",
    "content": "Prefers PostgreSQL for new projects",
    "memoryType": "Preference",
    "actorId": "user_123",
    "isActive": true
  }
]`,
    curlSnippet: `curl -X GET "https://api.kairo.dev/api/v1/memories?actorId=user_123" \\
  -H "Authorization: Bearer kairo_live_sec_..."`,
  },
]

export function DeveloperApiSection() {
  const [selectedEndpointId, setSelectedEndpointId] = React.useState<string>("create-memory")
  const [mode, setMode] = React.useState<"http" | "curl">("http")
  const [copied, setCopied] = React.useState(false)

  const endpoint = ENDPOINTS.find((e) => e.id === selectedEndpointId) || ENDPOINTS[0]

  const handleCopy = () => {
    const textToCopy = mode === "curl" ? endpoint.curlSnippet : (endpoint.requestPayload || endpoint.responsePayload)
    navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section id="developers" className="relative border-t border-border/80 bg-background py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        
        {/* Section Header */}
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-widest text-primary mb-3">
            06 / Developer REST Contracts
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            Real REST contracts. Zero friction.
          </h2>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Direct HTTP contracts with zero hidden magic. Authenticate with a standard bearer API key and execute durable recall directly from any backend runtime.
          </p>
        </div>

        {/* Technical API Explorer */}
        <div className="mt-12 rounded-xl border border-border/80 bg-surface-elevated p-6 sm:p-8 shadow-xl">
          
          {/* Endpoint Bar & Mode Switcher */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-border/60 pb-5 mb-6">
            <div className="flex flex-wrap items-center gap-2">
              {ENDPOINTS.map((ep) => (
                <button
                  key={ep.id}
                  onClick={() => setSelectedEndpointId(ep.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1.5 font-mono text-xs transition-colors cursor-pointer border",
                    ep.id === selectedEndpointId
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border/60 bg-surface-subtle text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className={cn(
                    "font-bold text-[10px]",
                    ep.method === "POST" ? "text-emerald-400" : "text-blue-400"
                  )}>
                    {ep.method}
                  </span>
                  <span>{ep.path.split("?")[0]}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-border/60 p-0.5 bg-surface-subtle">
                <button
                  onClick={() => setMode("http")}
                  className={cn(
                    "rounded px-2.5 py-1 font-mono text-[11px] transition-colors cursor-pointer",
                    mode === "http" ? "bg-surface-elevated text-foreground font-medium shadow-xs" : "text-muted-foreground"
                  )}
                >
                  HTTP Payload
                </button>
                <button
                  onClick={() => setMode("curl")}
                  className={cn(
                    "rounded px-2.5 py-1 font-mono text-[11px] transition-colors cursor-pointer",
                    mode === "curl" ? "bg-surface-elevated text-foreground font-medium shadow-xs" : "text-muted-foreground"
                  )}
                >
                  cURL
                </button>
              </div>

              <button
                onClick={handleCopy}
                className="rounded-md border border-border/60 bg-surface-subtle px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-base font-semibold text-foreground tracking-tight">
              {endpoint.title}
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              {endpoint.description}
            </p>
          </div>

          {/* Code Viewer */}
          {mode === "curl" ? (
            <div className="rounded-lg border border-border/80 bg-background/95 p-4 font-mono text-xs overflow-x-auto text-foreground/90 leading-relaxed shadow-inner">
              <pre><code>{endpoint.curlSnippet}</code></pre>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Request Payload */}
              {endpoint.requestPayload ? (
                <div className="rounded-lg border border-border/80 bg-background/95 p-4 font-mono text-xs overflow-x-auto shadow-inner">
                  <div className="flex items-center justify-between text-muted-foreground/60 text-[10px] border-b border-border/40 pb-2 mb-3">
                    <span>Request Body (JSON)</span>
                    <span className="text-emerald-400 font-semibold">{endpoint.method}</span>
                  </div>
                  <pre className="text-foreground/90 leading-relaxed">
                    <code>{endpoint.requestPayload}</code>
                  </pre>
                </div>
              ) : (
                <div className="rounded-lg border border-border/60 bg-surface-subtle/30 p-4 font-mono text-xs flex items-center justify-center text-muted-foreground">
                  No request body required for this GET endpoint.
                </div>
              )}

              {/* Response Payload */}
              <div className="rounded-lg border border-border/80 bg-background/95 p-4 font-mono text-xs overflow-x-auto shadow-inner">
                <div className="flex items-center justify-between text-muted-foreground/60 text-[10px] border-b border-border/40 pb-2 mb-3">
                  <span>Response Payload</span>
                  <span className="text-emerald-400 font-semibold">{endpoint.responseStatus}</span>
                </div>
                <pre className="text-foreground/90 leading-relaxed">
                  <code>{endpoint.responsePayload}</code>
                </pre>
              </div>
            </div>
          )}

          <div className="mt-6 border-t border-border/40 pt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-muted-foreground">
            <span>Auth: Authorization: Bearer &lt;API_KEY&gt;</span>
            <span>Content-Type: application/json</span>
          </div>

        </div>

      </div>
    </section>
  )
}
