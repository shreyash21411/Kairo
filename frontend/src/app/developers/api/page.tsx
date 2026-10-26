import { Metadata } from "next"
import Link from "next/link"
import { DocsLayout } from "@/components/developers/docs-layout"
import {
  DocsSection,
  EndpointCard,
  MethodBadge,
  DocsCodeBlock,
  Callout,
  ParameterTable,
} from "@/components/developers/docs-components"
import { ArrowRight } from "lucide-react"

export const metadata: Metadata = {
  title: "REST API Reference — VOIDZONE",
  description: "Complete VOIDZONE REST API reference. Authenticate with an API key and manage memories, search semantically, and run chat pipelines.",
}

// ── Real API examples derived from implementation ─────────────────────────────

const AUTH_EXAMPLE = `curl -X GET https://api.voidzone.dev/api/v1/memories \\
  -H "Authorization: Bearer vz_live_sec_..."`

const CREATE_MEMORY_CURL = `curl -X POST https://api.voidzone.dev/api/v1/memories \\
  -H "Authorization: Bearer vz_live_sec_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "User prefers PostgreSQL for new projects",
    "memoryType": "Preference",
    "actorId": "user-alex-123"
  }'`

const CREATE_MEMORY_RESPONSE_NEW = `{
  "memoryId": 17,
  "userId": 4,
  "content": "User prefers PostgreSQL for new projects",
  "memoryType": "Preference",
  "isActive": true,
  "createdAt": "2026-09-26T10:30:00Z",
  "updatedAt": "2026-09-26T10:30:00Z"
}`

const CREATE_MEMORY_RESPONSE_DUP = `{
  "isDuplicate": true,
  "reason": "SemanticDuplicate: similarity 0.97 with memory #12"
}`

const LIST_MEMORIES_CURL = `curl -X GET https://api.voidzone.dev/api/v1/memories \\
  -H "Authorization: Bearer vz_live_sec_..."`

const LIST_MEMORIES_RESPONSE = `{
  "userId": 4,
  "count": 3,
  "memories": [
    {
      "memoryId": 17,
      "userId": 4,
      "content": "User prefers PostgreSQL for new projects",
      "memoryType": "Preference",
      "isActive": true,
      "createdAt": "2026-09-26T10:30:00Z",
      "updatedAt": "2026-09-26T10:30:00Z"
    }
  ]
}`

const GET_MEMORY_CURL = `curl -X GET https://api.voidzone.dev/api/v1/memories/17 \\
  -H "Authorization: Bearer vz_live_sec_..."`

const UPDATE_MEMORY_CURL = `curl -X PUT https://api.voidzone.dev/api/v1/memories/17 \\
  -H "Authorization: Bearer vz_live_sec_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "User strongly prefers PostgreSQL, avoids MySQL",
    "memoryType": "Preference"
  }'`

const DELETE_MEMORY_CURL = `curl -X DELETE https://api.voidzone.dev/api/v1/memories/17 \\
  -H "Authorization: Bearer vz_live_sec_..."`

const DELETE_MEMORY_RESPONSE = `{
  "memoryId": 17,
  "message": "Memory deactivated. The record is preserved in the database."
}`

const SEARCH_CURL = `curl -X POST https://api.voidzone.dev/api/v1/memories/search \\
  -H "Authorization: Bearer vz_live_sec_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "What database does this user prefer?",
    "actorId": "user-alex-123",
    "topK": 5
  }'`

const SEARCH_RESPONSE = `{
  "query": "What database does this user prefer?",
  "count": 2,
  "memories": [
    {
      "memoryId": 17,
      "content": "User prefers PostgreSQL for new projects",
      "memoryType": "Preference",
      "similarity": 0.9312
    },
    {
      "memoryId": 8,
      "content": "User has used MySQL in legacy projects but dislikes it",
      "memoryType": "Fact",
      "similarity": 0.7841
    }
  ]
}`

export default function ApiDocsPage() {
  return (
    <DocsLayout
      breadcrumbs={[
        { label: "Developers", href: "/developers" },
        { label: "REST API" },
      ]}
    >
      <div className="space-y-12">

        {/* Page title */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-2">
            REST API Reference
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            The VOIDZONE REST API is the foundation of all integrations. Use it directly from any HTTP client, or via the Python and Node.js SDKs which wrap these exact endpoints.
          </p>
        </div>

        {/* Authentication */}
        <DocsSection id="authentication" title="Authentication">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              All memory and data-plane endpoints require an API key. Obtain your key from the{" "}
              <Link href="/dashboard/api-keys" className="text-primary hover:underline">API Keys dashboard</Link>.
              Pass the key in the <code className="text-xs bg-surface-elevated px-1 rounded">Authorization</code> header as a Bearer token.
            </p>
            <DocsCodeBlock code={AUTH_EXAMPLE} lang="bash" filename="Authentication header" />
            <Callout variant="warning">
              Never include API keys in client-side browser code or commit them to version control. Use environment variables.
            </Callout>
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-surface-subtle/60">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Header</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Value</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Description</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/40">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-primary/90">Authorization</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-amber-400/80">Bearer &lt;API_KEY&gt;</td>
                    <td className="px-4 py-2.5 text-muted-foreground">Required on all authenticated endpoints</td>
                  </tr>
                  <tr className="border-b border-border/40">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-primary/90">Content-Type</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-amber-400/80">application/json</td>
                    <td className="px-4 py-2.5 text-muted-foreground">Required on POST and PUT requests</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </DocsSection>

        {/* Memories */}
        <DocsSection id="memories" title="Memories">
          <div className="mb-4 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              The core resource. Memories are scoped to your API key&#39;s project and partitioned per <code className="text-[11px] bg-surface-elevated px-1 rounded">actorId</code> — an application-level identifier for the person or agent being remembered.
            </p>
            <p className="text-xs text-muted-foreground">
              Supported <code className="text-[11px] bg-surface-elevated px-1 rounded">memoryType</code> values:{" "}
              <code className="text-[11px] bg-surface-elevated px-1 rounded">Preference</code>{" "}
              <code className="text-[11px] bg-surface-elevated px-1 rounded">Fact</code>{" "}
              <code className="text-[11px] bg-surface-elevated px-1 rounded">Goal</code>{" "}
              <code className="text-[11px] bg-surface-elevated px-1 rounded">Context</code>{" "}
              <code className="text-[11px] bg-surface-elevated px-1 rounded">Skill</code>{" "}
              <code className="text-[11px] bg-surface-elevated px-1 rounded">Relationship</code>{" "}
              <code className="text-[11px] bg-surface-elevated px-1 rounded">Other</code>
            </p>
          </div>

          {/* Create Memory */}
          <div id="create-memory" className="scroll-mt-28">
            <EndpointCard
              method="POST"
              path="/api/v1/memories"
              description="Store a new durable memory. The backend automatically embeds the content, detects exact and semantic duplicates, and returns the created memory or a duplicate notice."
            >
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Request body</p>
                  <ParameterTable params={[
                    { name: "content", type: "string", required: true, description: "The memory text. Max 10,000 characters." },
                    { name: "memoryType", type: "string", required: true, description: "Classification: Preference | Fact | Goal | Context | Skill | Relationship | Other" },
                    { name: "actorId", type: "string", required: true, description: "Application-level actor identifier for memory scoping. Determines which partition the memory belongs to." },
                  ]} />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Example request</p>
                  <DocsCodeBlock code={CREATE_MEMORY_CURL} lang="bash" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider mb-2">201 Created — New memory</p>
                    <DocsCodeBlock code={CREATE_MEMORY_RESPONSE_NEW} lang="json" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-amber-400 uppercase tracking-wider mb-2">200 OK — Duplicate detected</p>
                    <DocsCodeBlock code={CREATE_MEMORY_RESPONSE_DUP} lang="json" />
                  </div>
                </div>
              </div>
            </EndpointCard>
          </div>

          {/* List Memories */}
          <EndpointCard
            method="GET"
            path="/api/v1/memories"
            description="List all active memories belonging to the authenticated API key's project. Results are returned newest-first."
          >
            <div className="space-y-4">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Example request</p>
                <DocsCodeBlock code={LIST_MEMORIES_CURL} lang="bash" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider mb-2">200 OK</p>
                <DocsCodeBlock code={LIST_MEMORIES_RESPONSE} lang="json" />
              </div>
            </div>
          </EndpointCard>

          {/* Get Memory */}
          <EndpointCard
            method="GET"
            path="/api/v1/memories/{memoryId}"
            description="Retrieve a single memory by its numeric ID. Returns 404 if the memory does not exist or does not belong to the authenticated user."
          >
            <div className="space-y-4">
              <ParameterTable params={[
                { name: "memoryId", type: "integer (path)", required: true, description: "The numeric ID of the memory to retrieve." },
              ]} />
              <DocsCodeBlock code={GET_MEMORY_CURL} lang="bash" />
            </div>
          </EndpointCard>

          {/* Update Memory */}
          <EndpointCard
            method="PUT"
            path="/api/v1/memories/{memoryId}"
            description="Update the content and type of an existing memory. The backend archives the previous version and regenerates the semantic embedding for the updated content."
          >
            <div className="space-y-4">
              <ParameterTable params={[
                { name: "memoryId", type: "integer (path)", required: true, description: "The numeric ID of the memory to update." },
                { name: "content", type: "string (body)", required: true, description: "Updated memory content. Max 10,000 characters." },
                { name: "memoryType", type: "string (body)", required: true, description: "Updated memory type classification." },
              ]} />
              <DocsCodeBlock code={UPDATE_MEMORY_CURL} lang="bash" />
            </div>
          </EndpointCard>

          {/* Delete Memory */}
          <EndpointCard
            method="DELETE"
            path="/api/v1/memories/{memoryId}"
            description="Soft-delete (deactivate) a memory. The record is preserved in the database but will no longer appear in list or search results."
          >
            <div className="space-y-4">
              <ParameterTable params={[
                { name: "memoryId", type: "integer (path)", required: true, description: "The numeric ID of the memory to deactivate." },
              ]} />
              <DocsCodeBlock code={DELETE_MEMORY_CURL} lang="bash" />
              <div>
                <p className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider mb-2">200 OK</p>
                <DocsCodeBlock code={DELETE_MEMORY_RESPONSE} lang="json" />
              </div>
            </div>
          </EndpointCard>
        </DocsSection>

        {/* Search */}
        <DocsSection id="search" title="Semantic Search">
          <div className="mb-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              VOIDZONE embeds your search query using the same model used at ingestion time, computes cosine similarity against stored memories within the actor scope, and applies relevance evaluation to return the most contextually appropriate results.
            </p>
          </div>
          <EndpointCard
            method="POST"
            path="/api/v1/memories/search"
            description="Semantically search memories within an actor scope. Returns ranked results with similarity scores."
          >
            <div className="space-y-4">
              <ParameterTable params={[
                { name: "query", type: "string", required: true, description: "Natural language search query. The system embeds this and searches by semantic similarity." },
                { name: "actorId", type: "string", required: true, description: "Actor scope to search within. Only memories with this actorId are included in results." },
                { name: "topK", type: "integer", required: false, description: "Maximum number of results to return. Range: 1–100. Default: 5." },
              ]} />
              <DocsCodeBlock code={SEARCH_CURL} lang="bash" />
              <div>
                <p className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider mb-2">200 OK</p>
                <DocsCodeBlock code={SEARCH_RESPONSE} lang="json" />
              </div>
            </div>
          </EndpointCard>
        </DocsSection>

        {/* Error codes */}
        <DocsSection id="errors" title="Error Codes">
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-surface-subtle/60">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Meaning</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Common cause</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { code: "200 OK", meaning: "Success (duplicate detected)", cause: "Memory create returned a duplicate notice" },
                  { code: "201 Created", meaning: "New memory stored", cause: "Memory create succeeded, new record" },
                  { code: "400 Bad Request", meaning: "Validation error", cause: "Missing required field, invalid memoryType, or empty content" },
                  { code: "401 Unauthorized", meaning: "Authentication failed", cause: "Missing or invalid API key" },
                  { code: "403 Forbidden", meaning: "Authorization failed", cause: "API key does not own the requested resource" },
                  { code: "404 Not Found", meaning: "Resource not found", cause: "memoryId does not exist or does not belong to this user" },
                  { code: "429 Too Many Requests", meaning: "Rate limit exceeded", cause: "Slow down. Check Retry-After header." },
                  { code: "500 Internal Server Error", meaning: "Server error", cause: "Unexpected server failure" },
                ].map((r) => (
                  <tr key={r.code} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-primary/90 whitespace-nowrap">{r.code}</td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{r.meaning}</td>
                    <td className="px-4 py-2.5 text-muted-foreground/70">{r.cause}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DocsSection>

        {/* Next steps */}
        <div className="rounded-xl border border-border/60 bg-surface-elevated/30 p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Next steps</h3>
          <div className="flex flex-wrap gap-3">
            <Link href="/developers/python" className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              Python SDK <ArrowRight className="h-3 w-3" />
            </Link>
            <Link href="/developers/node" className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              Node.js SDK <ArrowRight className="h-3 w-3" />
            </Link>
            <Link href="/developers/mcp" className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              MCP Integration <ArrowRight className="h-3 w-3" />
            </Link>
            <Link href="/dashboard/playground" className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              Interactive Playground <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

      </div>
    </DocsLayout>
  )
}
