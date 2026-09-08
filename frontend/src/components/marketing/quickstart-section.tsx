"use client"

import * as React from "react"
import { CodeBlock } from "@/components/ui/code-block"
import { Check, Copy, Terminal } from "lucide-react"
import { type Lang } from "@/lib/syntax-highlight"

type LangKey = "python" | "typescript" | "curl"

interface ExampleConfig {
  label: string
  lang: Lang
  filename: string
  installCmd?: string
  code: string
  response: string
}

const EXAMPLES: Record<LangKey, ExampleConfig> = {
  python: {
    label: "Python",
    lang: "python",
    filename: "quickstart.py",
    installCmd: "pip install requests",
    code: `import os
import requests

BASE_URL = os.environ.get("KAIRO_API_URL", "http://localhost:5000")
API_KEY = os.environ.get("KAIRO_API_KEY", "")

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# 1. Create a memory (authenticated user context)
create_res = requests.post(
    f"{BASE_URL}/api/v1/memories",
    headers=headers,
    json={
        "content": "The user prefers dark mode in all applications.",
        "memoryType": "Preference"
    }
)
created_memory = create_res.json()
print("Memory ID:", created_memory.get("memoryId"))

# 2. Semantically search memories before agent completion
search_res = requests.post(
    f"{BASE_URL}/api/v1/memories/search",
    headers=headers,
    json={
        "query": "What are the user's UI preferences?",
        "topK": 5
    }
)
for memory in search_res.json().get("memories", []):
    print(f"[{memory['similarity']:.2f}] {memory['content']}")`,
    response: `{
  "query": "What are the user's UI preferences?",
  "count": 1,
  "memories": [
    {
      "memoryId": 42,
      "content": "The user prefers dark mode in all applications.",
      "memoryType": "Preference",
      "similarity": 0.94,
      "isRelevant": true
    }
  ]
}`,
  },
  typescript: {
    label: "Node.js / TS",
    lang: "js",
    filename: "quickstart.ts",
    installCmd: "npm install node-fetch",
    code: `const BASE_URL = process.env.KAIRO_API_URL || "http://localhost:5000";
const API_KEY = process.env.KAIRO_API_KEY || "";

const headers = {
  "Authorization": \`Bearer \${API_KEY}\`,
  "Content-Type": "application/json",
};

// 1. Create a memory
const createRes = await fetch(\`\${BASE_URL}/api/v1/memories\`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    content: "The user prefers dark mode in all applications.",
    memoryType: "Preference",
  }),
});
const created = await createRes.json();
console.log("Created memory:", created.memoryId);

// 2. Semantically search memories for prompt injection
const searchRes = await fetch(\`\${BASE_URL}/api/v1/memories/search\`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    query: "What are the user's UI preferences?",
    topK: 5,
  }),
});
const { memories } = await searchRes.json();
console.log("Retrieved context:", memories);`,
    response: `{
  "query": "What are the user's UI preferences?",
  "count": 1,
  "memories": [
    {
      "memoryId": 42,
      "content": "The user prefers dark mode in all applications.",
      "memoryType": "Preference",
      "similarity": 0.94,
      "isRelevant": true
    }
  ]
}`,
  },
  curl: {
    label: "cURL / REST",
    lang: "curl",
    filename: "quickstart.sh",
    installCmd: "curl -sSL",
    code: `# Configure local or deployed endpoint
export KAIRO_API_URL="\${KAIRO_API_URL:-http://localhost:5000}"
export KAIRO_API_KEY="$KAIRO_API_KEY"

# 1. Create a memory
curl -X POST "$KAIRO_API_URL/api/v1/memories" \\
  -H "Authorization: Bearer $KAIRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "The user prefers dark mode in all applications.",
    "memoryType": "Preference"
  }'

# 2. Semantic vector search
curl -X POST "$KAIRO_API_URL/api/v1/memories/search" \\
  -H "Authorization: Bearer $KAIRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "What are the user's UI preferences?",
    "topK": 5
  }'`,
    response: `{
  "query": "What are the user's UI preferences?",
  "count": 1,
  "memories": [
    {
      "memoryId": 42,
      "content": "The user prefers dark mode in all applications.",
      "memoryType": "Preference",
      "similarity": 0.94,
      "isRelevant": true
    }
  ]
}`,
  },
}

export function QuickstartSection() {
  const [selectedLang, setSelectedLang] = React.useState<LangKey>("python")
  const [copiedInstall, setCopiedInstall] = React.useState(false)

  const activeExample = EXAMPLES[selectedLang]

  const handleCopyInstall = () => {
    if (!activeExample.installCmd) return
    navigator.clipboard.writeText(activeExample.installCmd).then(() => {
      setCopiedInstall(true)
      setTimeout(() => setCopiedInstall(false), 2000)
    })
  }

  return (
    <section id="quickstart" className="border-t border-border py-20 px-6 sm:py-24" aria-label="Developer Quickstart">
      <div className="mx-auto max-w-6xl">
        {/* Section Header: Editorial & clean, no repetitive badge */}
        <div className="mb-10 max-w-3xl">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Integrate with the Memory V1 API.
          </h2>
          <p className="mt-3 text-[16px] leading-relaxed text-muted-foreground">
            Call Kairo directly from your agent runtime with standard HTTP requests.
            Authenticate with your API key, persist structured memories, and query semantic context.
          </p>
        </div>

        {/* Control Bar: Language selector + Install command */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Language selector */}
          <div className="flex items-center gap-1">
            {(Object.keys(EXAMPLES) as LangKey[]).map((key) => {
              const isActive = selectedLang === key
              return (
                <button
                  key={key}
                  onClick={() => setSelectedLang(key)}
                  className={`rounded px-3 py-1.5 font-mono text-xs font-medium transition-all ${
                    isActive
                      ? "border border-border bg-accent text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {EXAMPLES[key].label}
                </button>
              )
            })}
          </div>

          {/* Quick install pill */}
          {activeExample.installCmd && (
            <div className="flex items-center gap-2 rounded border border-border bg-card/60 px-3 py-1.5 font-mono text-xs text-muted-foreground">
              <Terminal className="size-3.5 text-muted-foreground/70" />
              <span className="text-foreground">{activeExample.installCmd}</span>
              <button
                onClick={handleCopyInstall}
                aria-label="Copy install command"
                className="ml-1 text-muted-foreground hover:text-foreground"
              >
                {copiedInstall ? (
                  <Check className="size-3 text-emerald-500" />
                ) : (
                  <Copy className="size-3" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* Code & Response Grid */}
        <div className="grid gap-6 lg:grid-cols-[1.45fr,1fr]">
          {/* Request code block */}
          <div className="flex flex-col">
            <CodeBlock
              code={activeExample.code}
              lang={activeExample.lang}
              filename={activeExample.filename}
              className="h-full"
            />
          </div>

          {/* Response inspector pane */}
          <div className="flex flex-col overflow-hidden rounded border border-zinc-300 bg-zinc-950 font-mono text-[12.5px] text-zinc-100 shadow-sm dark:border-zinc-800 dark:bg-[#0b0b0f]">
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4 py-2.5 dark:bg-zinc-900/40">
              <span className="text-[11px] text-zinc-400">Response · 200 OK</span>
              <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                application/json
              </span>
            </div>

            <div className="p-4 text-[12px] leading-relaxed">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
                POST /api/v1/memories/search
              </p>
              <pre className="overflow-x-auto text-zinc-300">
                <code>{activeExample.response}</code>
              </pre>
            </div>

            <div className="mt-auto border-t border-zinc-800 bg-zinc-900/30 p-4 font-sans text-xs text-zinc-400">
              <p className="font-mono text-[11px] font-medium text-zinc-200">
                Mistral Semantic Match
              </p>
              <p className="mt-1 text-[12px] leading-normal text-zinc-400">
                Memories are ranked by vector cosine similarity and filtered by Mistral relevance evaluation before being returned to your agent context.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
