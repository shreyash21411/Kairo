"use client"

import * as React from "react"
import { Check, Copy, Terminal } from "lucide-react"
import { cn } from "@/lib/utils"
import { tokenizeCode, type Lang, type TokKind } from "@/lib/syntax-highlight"

// ── Token color map: Clean, high-legibility developer theme ─────────────────
const TOK_COLOR: Record<TokKind, string> = {
  keyword: "#818cf8", // indigo-400
  string:  "#34d399", // emerald-400
  comment: "#71717a", // zinc-500
  number:  "#fbbf24", // amber-400
  fn:      "#60a5fa", // blue-400
  type:    "#f472b6", // pink-400
  flag:    "#38bdf8", // sky-400
  plain:   "#f4f4f5", // zinc-100
}

interface CodeBlockProps {
  code: string
  lang: Lang
  filename?: string
  className?: string
  hideLineNumbers?: boolean
}

export function CodeBlock({
  code,
  lang,
  filename,
  className,
  hideLineNumbers = false,
}: CodeBlockProps) {
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
        "overflow-hidden rounded-md border border-border/80 bg-surface-elevated font-mono text-[12px] text-foreground shadow-xs",
        className
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border/60 bg-surface-subtle/60 px-3 py-1.5 text-muted-foreground text-[11px]">
        <div className="flex items-center gap-2">
          <Terminal className="h-3 w-3 text-primary shrink-0" />
          {filename ? (
            <span className="font-medium text-foreground">{filename}</span>
          ) : (
            <span className="uppercase tracking-wider text-[10px]">{lang}</span>
          )}
        </div>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
          className="flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code body */}
      <div className="overflow-x-auto p-3.5">
        <pre className="leading-5" aria-label={`${lang} code snippet`}>
          {lines.map((toks, lineIdx) => (
            <div key={lineIdx} className="flex">
              {!hideLineNumbers && (
                <span
                  className="mr-4 w-4 shrink-0 select-none text-right text-[10px] text-muted-foreground/40 font-mono"
                  aria-hidden="true"
                >
                  {lineIdx + 1}
                </span>
              )}
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
