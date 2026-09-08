"use client"

import * as React from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import { tokenizeCode, type Lang, type TokKind } from "@/lib/syntax-highlight"

// ── Token color map ───────────────────────────────────────────────────────────
const TOK_COLOR: Record<TokKind, string> = {
  keyword: "#c084fc", // violet-400
  string:  "#86efac", // green-300
  comment: "#71717a", // zinc-500
  number:  "#fde047", // yellow-300
  fn:      "#93c5fd", // blue-300
  type:    "#fed7aa", // orange-200
  flag:    "#67e8f9", // cyan-300
  plain:   "#f4f4f5", // zinc-100
}

interface CodeBlockProps {
  code: string
  lang: Lang
  filename?: string
  className?: string
}

export function CodeBlock({ code, lang, filename, className }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false)
  const lines = React.useMemo(() => tokenizeCode(code, lang), [code, lang])

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded border border-zinc-300 bg-zinc-950 font-mono text-[12.5px] text-zinc-100 shadow-sm dark:border-zinc-800 dark:bg-[#0b0b0f]",
        className
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4 py-2.5 dark:bg-zinc-900/40">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-red-500/70" />
            <span className="size-2.5 rounded-full bg-yellow-500/70" />
            <span className="size-2.5 rounded-full bg-green-500/70" />
          </div>
          {filename && (
            <span className="text-[11px] text-zinc-400">{filename}</span>
          )}
        </div>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code body */}
      <div className="overflow-x-auto p-5">
        <pre className="leading-6" aria-label={`${lang} code snippet`}>
          {lines.map((toks, lineIdx) => (
            <div key={lineIdx} className="flex">
              <span
                className="mr-5 w-5 shrink-0 select-none text-right text-[11px] text-zinc-600 dark:text-zinc-700"
                aria-hidden="true"
              >
                {lineIdx + 1}
              </span>
              <code>
                {toks.map((tok, ti) => (
                  <span key={ti} style={{ color: TOK_COLOR[tok.kind] }}>
                    {tok.text}
                  </span>
                ))}
              </code>
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}
