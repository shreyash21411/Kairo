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
  title: "Node.js SDK — VOIDZONE Developer Docs",
  description: "Official VOIDZONE Node.js/TypeScript SDK documentation. Install @voidzone/sdk and add persistent memory to your JavaScript applications.",
}

// ── Real Node.js SDK examples (from actual SDK implementation) ────────────────

const INSTALL_CODE = `npm install @voidzone/sdk`

const QUICKSTART_CODE = `import { Voidzone } from "@voidzone/sdk";

// Reads VOIDZONE_API_KEY environment variable automatically
const vz = new Voidzone();

// Store a memory
const result = await vz.memories.create({
  content: "User prefers PostgreSQL for new projects",
  memoryType: "Preference",
  actorId: "user-alex-123",
});

if (!result.isDuplicate) {
  console.log("Memory ID:", result.memory!.memoryId);
}

// Search semantically
const results = await vz.memories.search({
  query: "What database does this user prefer?",
  actorId: "user-alex-123",
  topK: 5,
});

for (const m of results.memories) {
  console.log(\`[\${m.similarity.toFixed(4)}] \${m.content}\`);
}`

const AUTH_CODE = `import { Voidzone } from "@voidzone/sdk";

// Option 1: Environment variable (recommended)
// VOIDZONE_API_KEY=vz_live_sec_... in .env
const vz = new Voidzone();

// Option 2: Pass explicitly
const vz = new Voidzone({
  apiKey: process.env.VOIDZONE_API_KEY!,
});

// Option 3: Custom base URL (staging / self-hosted)
const vz = new Voidzone({
  apiKey: process.env.VOIDZONE_API_KEY!,
  baseUrl: "https://api.voidzone.dev",
  timeout: 30000, // ms
});`

const CREATE_CODE = `import { Voidzone } from "@voidzone/sdk";

const vz = new Voidzone();

const result = await vz.memories.create({
  content: "User works in TypeScript and uses strict mode",
  memoryType: "Fact",
  actorId: "user-123",
});

if (result.isDuplicate) {
  console.log("Duplicate:", result.duplicateReason);
} else {
  const memory = result.memory!;
  console.log("Created memory", memory.memoryId);
  console.log("  content:", memory.content);
  console.log("  type:", memory.memoryType);
  console.log("  active:", memory.isActive);
}`

const SEARCH_CODE = `import { Voidzone } from "@voidzone/sdk";

const vz = new Voidzone();

const results = await vz.memories.search({
  query: "What interface theme does the user prefer?",
  actorId: "user-123",
  topK: 3,
});

console.log(\`Found \${results.count} memories for: "\${results.query}"\`);
for (const m of results.memories) {
  console.log(\`  [\${m.similarity.toFixed(4)}] \${m.content}\`);
}`

const GET_CODE = `import { Voidzone, VoidzoneNotFoundError } from "@voidzone/sdk";

const vz = new Voidzone();

try {
  const memory = await vz.memories.get(17);
  console.log(memory.content);
  console.log(memory.createdAt);
} catch (err) {
  if (err instanceof VoidzoneNotFoundError) {
    console.log("Memory not found or not owned by this user");
  }
}`

const LIST_CODE = `import { Voidzone } from "@voidzone/sdk";

const vz = new Voidzone();

const memories = await vz.memories.list();
for (const m of memories) {
  console.log(\`[\${m.memoryId}] \${m.memoryType}: \${m.content}\`);
}`

const UPDATE_CODE = `import { Voidzone } from "@voidzone/sdk";

const vz = new Voidzone();

const updated = await vz.memories.update(17, {
  content: "User strongly prefers PostgreSQL, avoids MySQL",
  memoryType: "Preference",
});

console.log("Updated at:", updated.updatedAt);`

const DELETE_CODE = `import { Voidzone } from "@voidzone/sdk";

const vz = new Voidzone();

const result = await vz.memories.delete(17);
console.log(result.message);
// Memory deactivated. The record is preserved in the database.`

const ERROR_CODE = `import {
  Voidzone,
  VoidzoneAuthenticationError,
  VoidzoneValidationError,
  VoidzoneNotFoundError,
  VoidzoneRateLimitError,
  VoidzoneConnectionError,
  VoidzoneServerError,
} from "@voidzone/sdk";

const vz = new Voidzone();

try {
  const result = await vz.memories.create({
    content: "",          // intentionally invalid
    memoryType: "Fact",
    actorId: "user-123",
  });
} catch (err) {
  if (err instanceof VoidzoneValidationError) {
    console.log(\`Validation failed: \${err.message} (HTTP \${err.statusCode})\`);
  } else if (err instanceof VoidzoneAuthenticationError) {
    console.log("Auth failed — check your API key");
  } else if (err instanceof VoidzoneRateLimitError) {
    const retryIn = err.retryAfter;
    console.log(\`Rate limited. Retry in \${retryIn}s\`);
  } else if (err instanceof VoidzoneConnectionError) {
    console.log(\`Network error: \${err.message}\`);
  } else if (err instanceof VoidzoneServerError) {
    console.log(\`Server error (HTTP \${err.statusCode}): \${err.message}\`);
  }
}`

const AGENT_CODE = `import { VoidzoneAgentMemory } from "@voidzone/sdk";

// VoidzoneAgentMemory is a higher-level integration helper
// designed for use inside LLM agent tool loops.
const memory = new VoidzoneAgentMemory({
  apiKey: process.env.VOIDZONE_API_KEY!,
  actorId: "agent-session-abc",
});

// These methods are designed to be called from agent tool implementations
await memory.remember("User asked to always use TypeScript", "Preference");
const context = await memory.recall("language preferences");`

export default function NodeSdkPage() {
  return (
    <DocsLayout
      breadcrumbs={[
        { label: "Developers", href: "/developers" },
        { label: "Node.js SDK" },
      ]}
    >
      <div className="space-y-12">

        {/* Header */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-[4px] border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400 font-medium">
              @voidzone/sdk 0.1.0
            </span>
            <span className="rounded-[4px] border border-border/60 bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              Node ≥ 18
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-2">
            Node.js SDK
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            Official TypeScript/JavaScript client for the VOIDZONE AI Memory Platform. Built on native{" "}
            <code className="text-[12px] bg-surface-elevated px-1 rounded">fetch</code> with full TypeScript type coverage, tree-shakeable ESM exports, and automatic error mapping.
          </p>
        </div>

        {/* Installation */}
        <DocsSection id="installation" title="Installation">
          <div className="space-y-4">
            <DocsCodeBlock code={INSTALL_CODE} lang="bash" filename="Terminal" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Package name: <code className="bg-surface-elevated px-1 rounded">@voidzone/sdk</code></p>
              <p>Requires: Node.js 18 or later (uses native <code>fetch</code> and <code>AbortSignal.timeout</code>)</p>
            </div>
          </div>
        </DocsSection>

        {/* Authentication */}
        <DocsSection id="authentication" title="Authentication">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              The <code className="bg-surface-elevated px-1 rounded text-[11px]">Voidzone</code> class requires an API key from your{" "}
              <Link href="/dashboard/api-keys" className="text-primary hover:underline">API Keys dashboard</Link>.
              The key is sent as a Bearer token on every request and never exposed through <code>toString()</code> or <code>toJSON()</code>.
            </p>
            <DocsCodeBlock code={AUTH_CODE} lang="js" filename="client.ts" />
            <Callout variant="warning">
              Never hard-code API keys. Use <code>process.env.VOIDZONE_API_KEY</code> or a secrets manager. The SDK reads <code>VOIDZONE_API_KEY</code> automatically if no <code>apiKey</code> is passed.
            </Callout>
          </div>
        </DocsSection>

        {/* Quick start */}
        <DocsSection id="quickstart" title="Quick Start">
          <DocsCodeBlock code={QUICKSTART_CODE} lang="js" filename="quickstart.ts" />
        </DocsSection>

        {/* Create memory */}
        <DocsSection id="create" title="Create a Memory">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-surface-elevated px-1 rounded text-[11px]">vz.memories.create()</code> calls{" "}
              <code className="bg-surface-elevated px-1 rounded text-[11px]">POST /api/v1/memories</code>.
              Check <code className="bg-surface-elevated px-1 rounded text-[11px]">result.isDuplicate</code> to determine whether the memory was created or deduplicated.
            </p>
            <ParameterTable params={[
              { name: "content", type: "string", required: true, description: "Memory text. Max 10,000 characters." },
              { name: "memoryType", type: "MemoryType", required: true, description: "Preference | Fact | Goal | Context | Skill | Relationship | Other" },
              { name: "actorId", type: "string", required: true, description: "Application-level actor identifier for memory scoping." },
            ]} />
            <DocsCodeBlock code={CREATE_CODE} lang="js" filename="create_memory.ts" />
          </div>
        </DocsSection>

        {/* Search */}
        <DocsSection id="search" title="Search Memories">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-surface-elevated px-1 rounded text-[11px]">vz.memories.search()</code> calls{" "}
              <code className="bg-surface-elevated px-1 rounded text-[11px]">POST /api/v1/memories/search</code>.
              Returns a <code className="bg-surface-elevated px-1 rounded text-[11px]">MemorySearchResponse</code> with results ordered by descending similarity.
            </p>
            <ParameterTable params={[
              { name: "query", type: "string", required: true, description: "Natural language search query." },
              { name: "actorId", type: "string", required: true, description: "Actor scope to search within." },
              { name: "topK", type: "number", required: false, description: "Max results. Range 1–100. Default: 5." },
            ]} />
            <DocsCodeBlock code={SEARCH_CODE} lang="js" filename="search_memories.ts" />
          </div>
        </DocsSection>

        {/* Get */}
        <DocsSection id="get" title="Get a Memory">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-surface-elevated px-1 rounded text-[11px]">vz.memories.get(memoryId)</code> retrieves a single memory by its numeric ID.
            </p>
            <DocsCodeBlock code={GET_CODE} lang="js" filename="get_memory.ts" />
          </div>
        </DocsSection>

        {/* List */}
        <DocsSection id="list" title="List Memories">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-surface-elevated px-1 rounded text-[11px]">vz.memories.list()</code> returns all active memories for the authenticated project, newest first.
            </p>
            <DocsCodeBlock code={LIST_CODE} lang="js" filename="list_memories.ts" />
          </div>
        </DocsSection>

        {/* Update */}
        <DocsSection id="update" title="Update a Memory">
          <div className="space-y-4">
            <ParameterTable params={[
              { name: "memoryId", type: "number (positional)", required: true, description: "ID of the memory to update." },
              { name: "content", type: "string", required: true, description: "New memory content." },
              { name: "memoryType", type: "MemoryType", required: true, description: "New memory type classification." },
            ]} />
            <DocsCodeBlock code={UPDATE_CODE} lang="js" filename="update_memory.ts" />
          </div>
        </DocsSection>

        {/* Delete */}
        <DocsSection id="delete" title="Delete a Memory">
          <DocsCodeBlock code={DELETE_CODE} lang="js" filename="delete_memory.ts" />
        </DocsSection>

        {/* Error handling */}
        <DocsSection id="errors" title="Error Handling">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              All SDK exceptions extend <code className="bg-surface-elevated px-1 rounded text-[11px]">VoidzoneError</code>.
              Each has a <code className="bg-surface-elevated px-1 rounded text-[11px]">message</code> string and <code className="bg-surface-elevated px-1 rounded text-[11px]">statusCode</code> number.
              <code className="bg-surface-elevated px-1 rounded text-[11px]">VoidzoneRateLimitError</code> adds <code className="bg-surface-elevated px-1 rounded text-[11px]">retryAfter</code>.
            </p>
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-surface-subtle/60">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Class</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">HTTP</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">When thrown</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["VoidzoneAuthenticationError", "401", "Invalid or missing API key"],
                    ["VoidzoneAuthorizationError", "403", "Key lacks permission for the resource"],
                    ["VoidzoneValidationError", "400", "Invalid request body"],
                    ["VoidzoneNotFoundError", "404", "Memory not found or not owned"],
                    ["VoidzoneConflictError", "409", "Conflict with existing state"],
                    ["VoidzoneRateLimitError", "429", "Too many requests"],
                    ["VoidzoneServerError", "5xx", "Unexpected server error"],
                    ["VoidzoneConnectionError", "—", "Network failure, timeout"],
                  ].map(([cls, status, when]) => (
                    <tr key={cls} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-2 font-mono text-[11px] text-primary/90">{cls}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">{status}</td>
                      <td className="px-4 py-2 text-muted-foreground">{when}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DocsCodeBlock code={ERROR_CODE} lang="js" filename="error_handling.ts" />
          </div>
        </DocsSection>

        {/* Agent integration */}
        <DocsSection id="agent" title="Agent Integration">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              The SDK exports <code className="bg-surface-elevated px-1 rounded text-[11px]">VoidzoneAgentMemory</code> — a higher-level helper for LLM agent tool loops. It wraps the memories API with convenience methods designed for agent use.
            </p>
            <DocsCodeBlock code={AGENT_CODE} lang="js" filename="agent_integration.ts" />
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
            <Link href="/developers/mcp" className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              MCP Integration <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

      </div>
    </DocsLayout>
  )
}
