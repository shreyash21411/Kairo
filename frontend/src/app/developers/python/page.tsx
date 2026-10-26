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
  title: "Python SDK — VOIDZONE Developer Docs",
  description: "Official VOIDZONE Python SDK documentation. Install with pip install voidzone and add persistent memory to your Python applications and AI agents.",
}

// ── Real Python SDK code examples (from actual SDK implementation) ─────────────

const INSTALL_CODE = `pip install voidzone`

const QUICKSTART_CODE = `from voidzone import Voidzone

# Reads VOIDZONE_API_KEY environment variable automatically
client = Voidzone()

# Store a memory
result = client.memories.create(
    content="User prefers PostgreSQL for new projects",
    memory_type="Preference",
    actor_id="user-alex-123",
)
print(f"Memory ID: {result.memory.memory_id}")

# Search semantically
results = client.memories.search(
    query="What database does this user prefer?",
    actor_id="user-alex-123",
    top_k=5,
)
for m in results.memories:
    print(f"[{m.similarity:.4f}] {m.content}")`

const AUTH_CODE = `import os
from voidzone import Voidzone

# Option 1: Environment variable (recommended)
# export VOIDZONE_API_KEY=vz_live_sec_...
client = Voidzone()

# Option 2: Pass explicitly
client = Voidzone(api_key="vz_live_sec_...")

# Option 3: Context manager (auto-closes HTTP pool)
with Voidzone(api_key=os.environ["VOIDZONE_API_KEY"]) as client:
    memories = client.memories.list()`

const CREATE_CODE = `from voidzone import Voidzone

client = Voidzone()

result = client.memories.create(
    content="User works in Python and prefers type hints",
    memory_type="Fact",
    actor_id="user-123",
)

if result.is_duplicate:
    print(f"Duplicate: {result.duplicate_reason}")
else:
    memory = result.memory
    print(f"Stored memory {memory.memory_id}")
    print(f"  content: {memory.content}")
    print(f"  type:    {memory.memory_type}")
    print(f"  active:  {memory.is_active}")`

const SEARCH_CODE = `from voidzone import Voidzone

client = Voidzone()

results = client.memories.search(
    query="What interface theme does the user prefer?",
    actor_id="user-123",
    top_k=3,
)

print(f"Found {results.count} memories for query: {results.query!r}")
for m in results.memories:
    print(f"  [{m.similarity:.4f}] {m.content}")`

const GET_CODE = `from voidzone import Voidzone, VoidzoneNotFoundError

client = Voidzone()

try:
    memory = client.memories.get(memory_id=17)
    print(memory.content)
    print(memory.created_at)
except VoidzoneNotFoundError:
    print("Memory not found or not owned by this user")`

const UPDATE_CODE = `from voidzone import Voidzone

client = Voidzone()

updated = client.memories.update(
    memory_id=17,
    content="User strongly prefers PostgreSQL, avoids MySQL",
    memory_type="Preference",
)

print(f"Updated at: {updated.updated_at}")`

const DELETE_CODE = `from voidzone import Voidzone

client = Voidzone()

result = client.memories.delete(memory_id=17)
print(result.message)
# Memory deactivated. The record is preserved in the database.`

const LIST_CODE = `from voidzone import Voidzone

client = Voidzone()

memories = client.memories.list()
for m in memories:
    print(f"[{m.memory_id}] {m.memory_type}: {m.content}")`

const ERROR_CODE = `from voidzone import (
    Voidzone,
    VoidzoneAuthenticationError,
    VoidzoneAuthorizationError,
    VoidzoneValidationError,
    VoidzoneNotFoundError,
    VoidzoneRateLimitError,
    VoidzoneServerError,
    VoidzoneConnectionError,
)

client = Voidzone()

try:
    result = client.memories.create(
        content="",          # intentionally invalid
        memory_type="Fact",
        actor_id="user-123",
    )
except VoidzoneValidationError as e:
    print(f"Validation failed: {e.message} (HTTP {e.status_code})")
except VoidzoneAuthenticationError as e:
    print(f"Auth failed — check your API key: {e}")
except VoidzoneRateLimitError as e:
    retry_in = e.retry_after
    print(f"Rate limited. Retry in {retry_in}s")
except VoidzoneConnectionError as e:
    print(f"Network error: {e}")
except VoidzoneServerError as e:
    print(f"Server error (HTTP {e.status_code}): {e}")`

export default function PythonSdkPage() {
  return (
    <DocsLayout
      breadcrumbs={[
        { label: "Developers", href: "/developers" },
        { label: "Python SDK" },
      ]}
    >
      <div className="space-y-12">

        {/* Header */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-[4px] border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-400 font-medium">
              voidzone 0.1.0
            </span>
            <span className="rounded-[4px] border border-border/60 bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              Python 3.10+
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-2">
            Python SDK
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            Official Python client for the VOIDZONE AI Memory Platform. Built on{" "}
            <code className="text-[12px] bg-surface-elevated px-1 rounded">httpx</code> with typed dataclasses, automatic error mapping, and context manager support.
          </p>
        </div>

        {/* Installation */}
        <DocsSection id="installation" title="Installation">
          <div className="space-y-4">
            <DocsCodeBlock code={INSTALL_CODE} lang="bash" filename="Terminal" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Package name: <code className="bg-surface-elevated px-1 rounded">voidzone</code></p>
              <p>Requires: Python 3.10 or later, httpx ≥ 0.27.0</p>
            </div>
          </div>
        </DocsSection>

        {/* Authentication */}
        <DocsSection id="authentication" title="Authentication">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              The <code className="bg-surface-elevated px-1 rounded text-[11px]">Voidzone</code> client requires an API key from your{" "}
              <Link href="/dashboard/api-keys" className="text-primary hover:underline">API Keys dashboard</Link>.
              The key is sent as a Bearer token on every request and is never exposed through repr or exception messages.
            </p>
            <DocsCodeBlock code={AUTH_CODE} lang="python" filename="auth.py" />
            <Callout variant="warning">
              Prefer environment variables over hard-coding keys. Set <code>VOIDZONE_API_KEY</code> in your environment and call <code>Voidzone()</code> with no arguments.
            </Callout>
          </div>
        </DocsSection>

        {/* Quick start */}
        <DocsSection id="quickstart" title="Quick Start">
          <DocsCodeBlock code={QUICKSTART_CODE} lang="python" filename="quickstart.py" />
        </DocsSection>

        {/* Create memory */}
        <DocsSection id="create" title="Create a Memory">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-surface-elevated px-1 rounded text-[11px]">client.memories.create()</code> calls{" "}
              <code className="bg-surface-elevated px-1 rounded text-[11px]">POST /api/v1/memories</code>.
              The backend automatically embeds the content and detects duplicates.
              Check <code className="bg-surface-elevated px-1 rounded text-[11px]">result.is_duplicate</code> to distinguish creation from deduplication.
            </p>
            <ParameterTable params={[
              { name: "content", type: "str", required: true, description: "Memory text. Max 10,000 characters." },
              { name: "memory_type", type: "str", required: true, description: "Preference | Fact | Goal | Context | Skill | Relationship | Other" },
              { name: "actor_id", type: "str", required: true, description: "Application-level actor identifier for memory scoping." },
            ]} />
            <DocsCodeBlock code={CREATE_CODE} lang="python" filename="create_memory.py" />
          </div>
        </DocsSection>

        {/* Search */}
        <DocsSection id="search" title="Search Memories">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-surface-elevated px-1 rounded text-[11px]">client.memories.search()</code> calls{" "}
              <code className="bg-surface-elevated px-1 rounded text-[11px]">POST /api/v1/memories/search</code>.
              Returns a <code className="bg-surface-elevated px-1 rounded text-[11px]">MemorySearchResponse</code> with a ranked list of{" "}
              <code className="bg-surface-elevated px-1 rounded text-[11px]">RetrievedMemory</code> objects ordered by descending similarity.
            </p>
            <ParameterTable params={[
              { name: "query", type: "str", required: true, description: "Natural language search query." },
              { name: "actor_id", type: "str", required: true, description: "Actor scope to search within." },
              { name: "top_k", type: "int", required: false, description: "Max results. Range 1–100. Default: 5." },
            ]} />
            <DocsCodeBlock code={SEARCH_CODE} lang="python" filename="search_memories.py" />
          </div>
        </DocsSection>

        {/* Get */}
        <DocsSection id="get" title="Get a Memory">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-surface-elevated px-1 rounded text-[11px]">client.memories.get(memory_id)</code> retrieves a single memory by ID.
              Raises <code className="bg-surface-elevated px-1 rounded text-[11px]">VoidzoneNotFoundError</code> if the memory does not exist or does not belong to the authenticated user.
            </p>
            <DocsCodeBlock code={GET_CODE} lang="python" filename="get_memory.py" />
          </div>
        </DocsSection>

        {/* List */}
        <DocsSection id="list" title="List Memories">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-surface-elevated px-1 rounded text-[11px]">client.memories.list()</code> returns all active memories for the authenticated API key&#39;s project, newest first.
            </p>
            <DocsCodeBlock code={LIST_CODE} lang="python" filename="list_memories.py" />
          </div>
        </DocsSection>

        {/* Update */}
        <DocsSection id="update" title="Update a Memory">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-surface-elevated px-1 rounded text-[11px]">client.memories.update()</code> updates content and type. The backend archives the previous version and regenerates the embedding.
            </p>
            <ParameterTable params={[
              { name: "memory_id", type: "int", required: true, description: "ID of the memory to update." },
              { name: "content", type: "str", required: true, description: "New memory content." },
              { name: "memory_type", type: "str", required: true, description: "New memory type classification." },
            ]} />
            <DocsCodeBlock code={UPDATE_CODE} lang="python" filename="update_memory.py" />
          </div>
        </DocsSection>

        {/* Delete */}
        <DocsSection id="delete" title="Delete a Memory">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-surface-elevated px-1 rounded text-[11px]">client.memories.delete(memory_id)</code> soft-deletes a memory. The record is preserved but will not appear in list or search results.
            </p>
            <DocsCodeBlock code={DELETE_CODE} lang="python" filename="delete_memory.py" />
          </div>
        </DocsSection>

        {/* Error handling */}
        <DocsSection id="errors" title="Error Handling">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              All SDK exceptions inherit from <code className="bg-surface-elevated px-1 rounded text-[11px]">VoidzoneError</code>. Each typed exception includes a{" "}
              <code className="bg-surface-elevated px-1 rounded text-[11px]">message</code> and <code className="bg-surface-elevated px-1 rounded text-[11px]">status_code</code>.
              <code className="bg-surface-elevated px-1 rounded text-[11px]">VoidzoneRateLimitError</code> additionally exposes <code className="bg-surface-elevated px-1 rounded text-[11px]">retry_after</code> (seconds).
            </p>
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-surface-subtle/60">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Exception</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">HTTP status</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">When raised</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["VoidzoneAuthenticationError", "401", "Invalid or missing API key"],
                    ["VoidzoneAuthorizationError", "403", "API key lacks permission for the resource"],
                    ["VoidzoneValidationError", "400", "Invalid request body or missing required fields"],
                    ["VoidzoneNotFoundError", "404", "Memory not found or not owned by this user"],
                    ["VoidzoneConflictError", "409", "Conflict with existing server state"],
                    ["VoidzoneRateLimitError", "429", "Too many requests — check retry_after"],
                    ["VoidzoneServerError", "5xx", "Unexpected server-side error"],
                    ["VoidzoneConnectionError", "—", "Network failure, timeout, DNS error"],
                  ].map(([exc, status, when]) => (
                    <tr key={exc} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-2 font-mono text-[11px] text-primary/90">{exc}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">{status}</td>
                      <td className="px-4 py-2 text-muted-foreground">{when}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DocsCodeBlock code={ERROR_CODE} lang="python" filename="error_handling.py" />
          </div>
        </DocsSection>

        {/* Next steps */}
        <div className="rounded-xl border border-border/60 bg-surface-elevated/30 p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Next steps</h3>
          <div className="flex flex-wrap gap-3">
            <Link href="/developers/api" className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              REST API Reference <ArrowRight className="h-3 w-3" />
            </Link>
            <Link href="/developers/node" className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              Node.js SDK <ArrowRight className="h-3 w-3" />
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
