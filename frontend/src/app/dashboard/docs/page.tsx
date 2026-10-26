"use client";

import React, { useState } from "react";
import { BookOpen, Copy, Check, Shield, KeyRound, Terminal, Cpu, Layers } from "lucide-react";

// ─── Code block with copy ─────────────────────────────────────────────────────
function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-md border border-border/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-surface-subtle/30">
        <span className="text-[10px] font-mono text-muted-foreground/70">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? (
            <><Check className="h-3 w-3 text-emerald-500" />Copied</>
          ) : (
            <><Copy className="h-3 w-3" />Copy</>
          )}
        </button>
      </div>
      <pre className="px-4 py-3 text-[11px] font-mono leading-relaxed overflow-x-auto text-foreground/80 bg-transparent">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────
function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="h-7 w-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="pl-10 space-y-3">{children}</div>
    </div>
  );
}

// ─── Endpoint row ─────────────────────────────────────────────────────────────
function EndpointRow({
  method,
  path,
  description,
  auth,
}: {
  method: string;
  path: string;
  description: string;
  auth: "jwt" | "apikey";
}) {
  const methodColor =
    method === "GET" ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" :
    method === "POST" ? "text-blue-500 bg-blue-500/10 border-blue-500/20" :
    method === "PUT" ? "text-amber-500 bg-amber-500/10 border-amber-500/20" :
    method === "DELETE" ? "text-red-500 bg-red-500/10 border-red-500/20" :
    "text-muted-foreground bg-muted border-border";

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/30 last:border-0">
      <span className={`inline-flex items-center shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${methodColor} w-12 justify-center`}>
        {method}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-foreground">{path}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{description}</div>
      </div>
      <span className={`shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded border ${
        auth === "jwt"
          ? "bg-purple-500/10 text-purple-500 border-purple-500/20"
          : "bg-amber-500/10 text-amber-500 border-amber-500/20"
      }`}>
        {auth === "jwt" ? "JWT" : "API Key"}
      </span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DocsPage() {
  return (
    <div className="space-y-8 max-w-3xl">
      {/* ── Page Header ── */}
      <div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">API Reference</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          VOIDZONE Memory Platform V1 · Base URL:{" "}
          <code className="font-mono text-foreground/80">https://voidzone-staging-api.onrender.com</code>
        </p>
      </div>

      {/* ── Authentication ── */}
      <Section
        icon={Shield}
        title="Authentication"
        description="VOIDZONE uses two separate authentication schemes based on the endpoint group."
      >
        <div className="space-y-3">
          <div className="border border-border/60 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/30 bg-surface-subtle/30">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">JWT — Identity plane</span>
            </div>
            <div className="p-4 space-y-1.5 text-xs text-muted-foreground">
              <p>Used for <code className="font-mono text-foreground">/api/auth/*</code>, <code className="font-mono text-foreground">/api/v1/projects/*</code>, and <code className="font-mono text-foreground">/api/v1/api-keys/*</code>.</p>
              <p>Obtain via <code className="font-mono text-foreground">POST /api/auth/login</code>. Include as <code className="font-mono text-foreground">Authorization: Bearer &lt;jwt&gt;</code>.</p>
            </div>
          </div>
          <div className="border border-border/60 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/30 bg-surface-subtle/30">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">VOIDZONE API Key — Data plane</span>
            </div>
            <div className="p-4 space-y-1.5 text-xs text-muted-foreground">
              <p>Used for <code className="font-mono text-foreground">/api/v1/memories/*</code>, <code className="font-mono text-foreground">/api/chats</code>, and <code className="font-mono text-foreground">/api/chat-processing/*</code>.</p>
              <p>Include as <code className="font-mono text-foreground">Authorization: Bearer vz_live_sec_…</code>. Backend derives Project and User context from the key.</p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Quick Start ── */}
      <Section
        icon={Terminal}
        title="Quick Start"
        description="Store your first memory in three requests."
      >
        <CodeBlock language="bash" code={`# 1. Register and login to get a JWT
curl -X POST http://localhost:5171/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email": "dev@example.com", "password": "YourPassword"}'

# 2. Create a project (JWT required)
curl -X POST http://localhost:5171/api/v1/projects \\
  -H "Authorization: Bearer <jwt>" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "My AI Agent"}'

# 3. Generate an API key for the project
curl -X POST http://localhost:5171/api/v1/api-keys \\
  -H "Authorization: Bearer <jwt>" \\
  -H "Content-Type: application/json" \\
  -d '{"projectId": 1, "name": "Production"}'`} />

        <CodeBlock language="bash" code={`# 4. Store a memory (VOIDZONE API Key)
curl -X POST http://localhost:5171/api/v1/memories \\
  -H "Authorization: Bearer vz_live_sec_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "User prefers TypeScript and dark mode",
    "memoryType": "Preference",
    "actorId": "user-123"
  }'

# 5. Semantic recall
curl -X POST http://localhost:5171/api/v1/memories/search \\
  -H "Authorization: Bearer vz_live_sec_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "What are the user preferences?",
    "actorId": "user-123",
    "topK": 5
  }'`} />
      </Section>

      {/* ── Memory API ── */}
      <Section
        icon={Cpu}
        title="Memory API"
        description="Core durable memory operations. All endpoints use VOIDZONE API Key authentication."
      >
        <div className="border border-border/60 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-border/40 bg-surface-subtle/30">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Endpoints</span>
          </div>
          <div className="px-4 py-1">
            <EndpointRow method="POST" path="/api/v1/memories" description="Store memory, embed via Mistral AI, deduplicate within actor scope." auth="apikey" />
            <EndpointRow method="GET" path="/api/v1/memories" description="List all active memories scoped to the authenticated project." auth="apikey" />
            <EndpointRow method="GET" path="/api/v1/memories/{id}" description="Retrieve a single memory with its full version history." auth="apikey" />
            <EndpointRow method="PUT" path="/api/v1/memories/{id}" description="Update memory content and type. Archives current state, regenerates embeddings." auth="apikey" />
            <EndpointRow method="DELETE" path="/api/v1/memories/{id}" description="Soft-deactivate a memory. Preserved for audit, excluded from recall." auth="apikey" />
            <EndpointRow method="POST" path="/api/v1/memories/search" description="Semantic vector similarity search within actor scope." auth="apikey" />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Memory Types</div>
          <div className="flex flex-wrap gap-1.5">
            {["Preference", "Fact", "Goal", "Context", "Skill", "Relationship"].map((t) => (
              <code key={t} className="text-[10px] font-mono px-2 py-0.5 rounded border border-border/60 bg-surface-subtle/50 text-foreground/70">
                {t}
              </code>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Memory Scope Model</div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Memories are scoped by <code className="font-mono text-foreground">ProjectId + ActorId</code>.
            The backend derives <code className="font-mono text-foreground">ProjectId</code> and <code className="font-mono text-foreground">UserId</code> from the API key context —
            you must never include them in request payloads. Only <code className="font-mono text-foreground">actorId</code> is required.
          </p>
        </div>
      </Section>

      {/* ── SDK ── */}
      <Section
        icon={Layers}
        title="SDK"
        description="Install the official VOIDZONE .NET SDK."
      >
        <CodeBlock language="bash" code="dotnet add package Voidzone.SDK" />

        <CodeBlock language="csharp" code={`using Voidzone.SDK;
using Voidzone.SDK.Models;

// Initialize the client
var client = new VoidzoneClient("vz_live_sec_...");

// Store a memory
var result = await client.Memories.StoreAsync(new StoreMemoryRequest
{
    Content = "User prefers TypeScript for all new projects",
    MemoryType = MemoryType.Preference,
    ActorId = "user-123"
});

// Semantic recall
var memories = await client.Memories.SearchAsync(new SearchMemoryRequest
{
    Query = "What programming language does the user prefer?",
    ActorId = "user-123",
    TopK = 5
});`} />
      </Section>

      {/* ── API Keys endpoint reference ── */}
      <Section
        icon={KeyRound}
        title="Projects & API Keys"
        description="Management endpoints use JWT authentication."
      >
        <div className="border border-border/60 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-border/40 bg-surface-subtle/30">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Endpoints</span>
          </div>
          <div className="px-4 py-1">
            <EndpointRow method="POST" path="/api/auth/register" description="Register a new developer account." auth="jwt" />
            <EndpointRow method="POST" path="/api/auth/login" description="Authenticate and receive a JWT." auth="jwt" />
            <EndpointRow method="GET" path="/api/v1/projects" description="List all projects for the authenticated user." auth="jwt" />
            <EndpointRow method="POST" path="/api/v1/projects" description="Create a new project." auth="jwt" />
            <EndpointRow method="DELETE" path="/api/v1/projects/{id}" description="Delete a project and all associated resources." auth="jwt" />
            <EndpointRow method="GET" path="/api/v1/api-keys" description="List API keys for the selected project." auth="jwt" />
            <EndpointRow method="POST" path="/api/v1/api-keys" description="Generate a new API key. Raw secret shown once only." auth="jwt" />
            <EndpointRow method="DELETE" path="/api/v1/api-keys/{id}" description="Revoke an API key. Immediate HTTP 401 for all requests using it." auth="jwt" />
          </div>
        </div>
      </Section>
    </div>
  );
}
