import { Metadata } from "next"
import Link from "next/link"
import { DocsLayout } from "@/components/developers/docs-layout"
import {
  DocsSection,
  DocsCodeBlock,
  Callout,
  ParameterTable,
} from "@/components/developers/docs-components"
import { ArrowRight } from "lucide-react"

export const metadata: Metadata = {
  title: "MCP Integration — VOIDZONE Developer Docs",
  description: "Connect any Model Context Protocol compatible AI application directly to VOIDZONE memory. Tools: remember, recall, update, forget.",
}

// ── Real MCP examples from VoidzoneMemoryTools.cs implementation ─────────────────

const MCP_ENDPOINT = `https://api.voidzone.dev/mcp`

const CURSOR_CONFIG = `// .cursor/mcp.json
{
  "mcpServers": {
    "voidzone": {
      "url": "https://api.voidzone.dev/mcp",
      "headers": {
        "Authorization": "Bearer vz_live_sec_..."
      }
    }
  }
}`

const CLAUDE_DESKTOP_CONFIG = `// claude_desktop_config.json
{
  "mcpServers": {
    "voidzone": {
      "url": "https://api.voidzone.dev/mcp",
      "headers": {
        "Authorization": "Bearer vz_live_sec_..."
      }
    }
  }
}`

const WINDSURF_CONFIG = `// ~/.codeium/windsurf/mcp_config.json
{
  "mcpServers": {
    "voidzone": {
      "serverUrl": "https://api.voidzone.dev/mcp",
      "headers": {
        "Authorization": "Bearer vz_live_sec_..."
      }
    }
  }
}`

const PING_EXAMPLE = `// Tool: vz_ping
// Confirms the MCP server is reachable and authenticates your key
// Input: (no parameters)
// Output: "VOIDZONE MCP v1 online. Authenticated as user 4."`

const REMEMBER_EXAMPLE = `// Tool: remember
// Stores a durable memory in VOIDZONE
// Parameters:
//   content:    string  — Memory text (max 10,000 chars)
//   memoryType: string  — Preference | Fact | Goal | Context | Skill | Relationship | Other
//   actorId:    string  — Actor identifier for memory scoping

// Example agent tool call:
remember(
  content="User prefers PostgreSQL for all new projects",
  memoryType="Preference",
  actorId="user-alex-123"
)

// Success response:
{
  "stored": true,
  "memoryId": 17,
  "userId": 4,
  "content": "User prefers PostgreSQL for all new projects",
  "memoryType": "Preference",
  "isActive": true,
  "createdAt": "2026-09-26T10:30:00Z",
  "updatedAt": "2026-09-26T10:30:00Z"
}

// Duplicate response:
{
  "stored": false,
  "isDuplicate": true,
  "reason": "SemanticDuplicate: similarity 0.97 with memory #12"
}`

const RECALL_EXAMPLE = `// Tool: recall
// Semantically searches memories within an actor scope
// Parameters:
//   query:   string  — Natural language search query
//   actorId: string  — Actor scope to search
//   topK:    int     — Max results (1–100, default 5)

// Example agent tool call:
recall(
  query="What database does this user prefer?",
  actorId="user-alex-123",
  topK=3
)

// Response:
{
  "query": "What database does this user prefer?",
  "count": 2,
  "memories": [
    {
      "memoryId": 17,
      "content": "User prefers PostgreSQL for all new projects",
      "memoryType": "Preference",
      "similarity": 0.9312
    },
    {
      "memoryId": 8,
      "content": "User avoids MySQL in production",
      "memoryType": "Fact",
      "similarity": 0.7841
    }
  ]
}`

const UPDATE_EXAMPLE = `// Tool: update
// Updates an existing memory and regenerates its embedding
// Parameters:
//   memoryId:   int     — ID of the memory to update
//   content:    string  — New memory content
//   memoryType: string  — New memory type
//   actorId:    string  — Actor scope (must match original)

update(
  memoryId=17,
  content="User strongly prefers PostgreSQL, avoids MySQL entirely",
  memoryType="Preference",
  actorId="user-alex-123"
)

// Response:
{
  "updated": true,
  "memoryId": 17,
  "content": "User strongly prefers PostgreSQL, avoids MySQL entirely",
  "memoryType": "Preference",
  "isActive": true,
  "updatedAt": "2026-09-26T11:00:00Z"
}`

const FORGET_EXAMPLE = `// Tool: forget
// Soft-deletes a memory (preserves database record, deactivates)
// Parameters:
//   memoryId: int    — ID of the memory to deactivate
//   actorId:  string — Actor scope (must match original)

forget(
  memoryId=17,
  actorId="user-alex-123"
)

// Response:
{
  "forgotten": true,
  "memoryId": 17,
  "message": "Memory deactivated. The record is preserved in the database."
}`

const RESOURCES_EXAMPLE = `// MCP Resources — Read-only data exposed to clients
// No tool call needed; clients can read these URIs directly

voidzone://user/profile       — Current user profile & project context
voidzone://projects           — All active projects for this user
voidzone://memories           — All active memories for this user
voidzone://memories/{id}      — Single memory by numeric ID`

export default function McpDocsPage() {
  return (
    <DocsLayout
      breadcrumbs={[
        { label: "Developers", href: "/developers" },
        { label: "MCP Integration" },
      ]}
    >
      <div className="space-y-12">

        {/* Header */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-[4px] border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 font-mono text-[10px] text-purple-400 font-medium">
              MCP v1
            </span>
            <span className="rounded-[4px] border border-border/60 bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              Streamable HTTP transport
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-2">
            Model Context Protocol
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            VOIDZONE exposes a native MCP server at <code className="text-[12px] bg-surface-elevated px-1 rounded">/mcp</code>.
            Connect any MCP-compatible AI application — Cursor, Claude Desktop, Windsurf, or a custom agent — and give it persistent, searchable memory with no SDK required.
          </p>
        </div>

        {/* How it works */}
        <DocsSection id="overview" title="How It Works">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              The VOIDZONE MCP server uses the same authentication and memory pipeline as the REST API.
              Your API key is authenticated by the same handler used by all other endpoints.
              Tools are thin adapters — they call the existing memory service directly. No memory logic is duplicated in the MCP layer.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Transport", value: "Streamable HTTP" },
                { label: "Endpoint", value: "/mcp" },
                { label: "Authentication", value: "Bearer API key" },
                { label: "Scoping", value: "Per project & actorId" },
              ].map((item) => (
                <div key={item.label} className="rounded-md border border-border/50 bg-surface-elevated/30 px-3 py-2.5">
                  <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium mb-1">{item.label}</div>
                  <div className="font-mono text-xs text-foreground/90">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </DocsSection>

        {/* Authentication */}
        <DocsSection id="authentication" title="Authentication">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Send your VOIDZONE API key in the <code className="bg-surface-elevated px-1 rounded text-[11px]">Authorization</code> header as a Bearer token.
              The MCP endpoint is the same as the REST API — it requires the same key format.
            </p>
            <DocsCodeBlock code={`Authorization: Bearer vz_live_sec_...`} lang="bash" filename="Required header" />
            <Callout variant="warning">
              API keys are per-project. The MCP server uses the key to determine which project and user the memory operations belong to. Never share keys between projects.
            </Callout>
          </div>
        </DocsSection>

        {/* MCP Endpoint */}
        <DocsSection id="endpoint" title="MCP Endpoint">
          <div className="space-y-4">
            <DocsCodeBlock code={MCP_ENDPOINT} lang="bash" filename="MCP server URL" />
            <p className="text-xs text-muted-foreground">
              This is the Streamable HTTP transport endpoint. Point your MCP client at this URL with your API key in the Authorization header.
            </p>
          </div>
        </DocsSection>

        {/* Configuration */}
        <DocsSection id="configuration" title="Client Configuration">
          <div className="space-y-6">
            <div>
              <h3 className="mb-3 text-xs font-semibold text-foreground">Cursor</h3>
              <DocsCodeBlock code={CURSOR_CONFIG} lang="json" filename=".cursor/mcp.json" />
            </div>
            <div>
              <h3 className="mb-3 text-xs font-semibold text-foreground">Claude Desktop</h3>
              <DocsCodeBlock code={CLAUDE_DESKTOP_CONFIG} lang="json" filename="claude_desktop_config.json" />
            </div>
            <div>
              <h3 className="mb-3 text-xs font-semibold text-foreground">Windsurf</h3>
              <DocsCodeBlock code={WINDSURF_CONFIG} lang="json" filename="mcp_config.json" />
            </div>
          </div>
        </DocsSection>

        {/* Tools */}
        <DocsSection id="tools" title="Available Tools">
          <div className="mb-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              VOIDZONE exposes 5 MCP tools. All memory-scoping and authentication is enforced server-side from the API key — actor identity is never accepted from tool arguments.
            </p>
          </div>

          <div className="space-y-2 mb-6">
            {[
              { name: "vz_ping", desc: "Health check — confirms the server is live and the API key is valid" },
              { name: "remember", desc: "Store a durable, deduplicated, vectorized memory" },
              { name: "recall", desc: "Semantically search memories within an actor scope" },
              { name: "update", desc: "Update an existing memory and regenerate its embedding" },
              { name: "forget", desc: "Soft-delete (deactivate) a memory" },
            ].map((tool) => (
              <div key={tool.name} className="flex items-start gap-3 rounded-md border border-border/50 bg-surface-elevated/30 px-4 py-3">
                <code className="font-mono text-[11px] text-primary/90 shrink-0 mt-0.5">{tool.name}</code>
                <span className="text-xs text-muted-foreground">{tool.desc}</span>
              </div>
            ))}
          </div>

          {/* vz_ping */}
          <div id="vz_ping" className="scroll-mt-28 mb-8">
            <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2">
              <code className="font-mono text-[13px] text-primary">vz_ping</code>
            </h3>
            <DocsCodeBlock code={PING_EXAMPLE} lang="bash" />
          </div>

          {/* remember */}
          <div id="remember" className="scroll-mt-28 mb-8">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              <code className="font-mono text-[13px] text-primary">remember</code>
            </h3>
            <div className="space-y-3">
              <ParameterTable params={[
                { name: "content", type: "string", required: true, description: "Memory text. Max 10,000 characters." },
                { name: "memoryType", type: "string", required: true, description: "Preference | Fact | Goal | Context | Skill | Relationship | Other" },
                { name: "actorId", type: "string", required: true, description: "Actor identifier for memory scoping within the authenticated project." },
              ]} />
              <DocsCodeBlock code={REMEMBER_EXAMPLE} lang="bash" />
            </div>
          </div>

          {/* recall */}
          <div id="recall" className="scroll-mt-28 mb-8">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              <code className="font-mono text-[13px] text-primary">recall</code>
            </h3>
            <div className="space-y-3">
              <ParameterTable params={[
                { name: "query", type: "string", required: true, description: "Natural language search query. Embedded and searched by cosine similarity." },
                { name: "actorId", type: "string", required: true, description: "Actor scope to search within." },
                { name: "topK", type: "int", required: false, description: "Max results. Range 1–100. Default: 5." },
              ]} />
              <DocsCodeBlock code={RECALL_EXAMPLE} lang="bash" />
            </div>
          </div>

          {/* update */}
          <div id="update" className="scroll-mt-28 mb-8">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              <code className="font-mono text-[13px] text-primary">update</code>
            </h3>
            <div className="space-y-3">
              <ParameterTable params={[
                { name: "memoryId", type: "int", required: true, description: "ID of the memory to update." },
                { name: "content", type: "string", required: true, description: "New memory content." },
                { name: "memoryType", type: "string", required: true, description: "New memory type classification." },
                { name: "actorId", type: "string", required: true, description: "Actor scope (must match original memory scope)." },
              ]} />
              <DocsCodeBlock code={UPDATE_EXAMPLE} lang="bash" />
            </div>
          </div>

          {/* forget */}
          <div id="forget" className="scroll-mt-28 mb-8">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              <code className="font-mono text-[13px] text-primary">forget</code>
            </h3>
            <div className="space-y-3">
              <ParameterTable params={[
                { name: "memoryId", type: "int", required: true, description: "ID of the memory to deactivate." },
                { name: "actorId", type: "string", required: true, description: "Actor scope (must match original memory scope)." },
              ]} />
              <DocsCodeBlock code={FORGET_EXAMPLE} lang="bash" />
            </div>
          </div>
        </DocsSection>

        {/* MCP Resources */}
        <DocsSection id="resources" title="MCP Resources">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              VOIDZONE also exposes read-only MCP Resources. These are data URIs your MCP client can read directly without calling a tool. All resources are scoped to the authenticated API key.
            </p>
            <DocsCodeBlock code={RESOURCES_EXAMPLE} lang="bash" filename="Resource URIs" />
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-surface-subtle/60">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Resource URI</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Returns</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["voidzone://user/profile", "Current user profile, active project, API key ID, project count"],
                    ["voidzone://projects", "All active projects belonging to the authenticated user"],
                    ["voidzone://memories", "All active memories for the authenticated user, newest first"],
                    ["voidzone://memories/{memoryId}", "Single memory by ID, enforcing tenant boundary"],
                  ].map(([uri, desc]) => (
                    <tr key={uri} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-2.5 font-mono text-[11px] text-primary/90 whitespace-nowrap">{uri}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </DocsSection>

        {/* Security */}
        <DocsSection id="security" title="Security Model">
          <div className="space-y-3">
            <Callout variant="info">
              <strong className="font-semibold text-blue-200">User identity is never accepted from tool arguments.</strong>{" "}
              The MCP server reads user and project identity exclusively from the authenticated API key context — the same mechanism used by all REST API endpoints. A compromised tool call cannot escalate privileges or access another user&apos;s data.
            </Callout>
            <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p>• Tenant isolation: every memory query includes userId at the SQL level. Cross-user access is structurally impossible.</p>
              <p>• Actor isolation: memories are scoped to (projectId, actorId). Recall only returns memories within the requested actor scope.</p>
              <p>• The MCP endpoint requires authorization — unauthenticated requests receive 401 before any tool executes.</p>
            </div>
          </div>
        </DocsSection>

        {/* Next steps */}
        <div className="rounded-xl border border-border/60 bg-surface-elevated/30 p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Next steps</h3>
          <div className="flex flex-wrap gap-3">
            <Link href="/developers/api" className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              REST API Reference <ArrowRight className="h-3 w-3" />
            </Link>
            <Link href="/developers/python" className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              Python SDK <ArrowRight className="h-3 w-3" />
            </Link>
            <Link href="/developers/node" className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              Node.js SDK <ArrowRight className="h-3 w-3" />
            </Link>
            <Link href="/dashboard/api-keys" className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              Get an API Key <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

      </div>
    </DocsLayout>
  )
}
