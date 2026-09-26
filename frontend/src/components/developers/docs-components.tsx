"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Copy, Check } from "lucide-react"

// ── Method Badge ──────────────────────────────────────────────────────────────

const METHOD_COLORS = {
  GET: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  POST: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  PUT: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  DELETE: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  PATCH: "bg-purple-500/10 text-purple-400 border-purple-500/30",
} as const

export function MethodBadge({ method }: { method: keyof typeof METHOD_COLORS }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-[4px] border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider",
      METHOD_COLORS[method]
    )}>
      {method}
    </span>
  )
}

// ── Copy Button ───────────────────────────────────────────────────────────────

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy to clipboard"
      className={cn(
        "flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground",
        className
      )}
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
  )
}

// ── Code Block ────────────────────────────────────────────────────────────────

interface DocsCodeBlockProps {
  code: string
  lang?: string
  filename?: string
  className?: string
}

export function DocsCodeBlock({ code, lang = "bash", filename, className }: DocsCodeBlockProps) {
  return (
    <div className={cn(
      "overflow-hidden rounded-md border border-border/80 bg-[#0d0d10] font-mono text-[12px] text-zinc-100 shadow-sm",
      className
    )}>
      <div className="flex items-center justify-between border-b border-border/50 bg-zinc-900/60 px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {filename || lang}
        </span>
        <CopyButton text={code} />
      </div>
      <div className="overflow-x-auto p-4">
        <pre className="leading-relaxed"><code>{code}</code></pre>
      </div>
    </div>
  )
}

// ── Callout ───────────────────────────────────────────────────────────────────

const CALLOUT_STYLES = {
  info: "border-blue-500/30 bg-blue-500/5 text-blue-300",
  warning: "border-amber-500/30 bg-amber-500/5 text-amber-300",
  success: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
  danger: "border-rose-500/30 bg-rose-500/5 text-rose-300",
} as const

export function Callout({
  variant = "info",
  children,
  className,
}: {
  variant?: keyof typeof CALLOUT_STYLES
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn(
      "rounded-md border px-4 py-3 text-xs leading-relaxed",
      CALLOUT_STYLES[variant],
      className
    )}>
      {children}
    </div>
  )
}

// ── Parameter Table ───────────────────────────────────────────────────────────

export interface ParamRow {
  name: string
  type: string
  required?: boolean
  description: string
}

export function ParameterTable({ params }: { params: ParamRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border/60">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/60 bg-surface-subtle/60">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Type</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Required</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Description</th>
          </tr>
        </thead>
        <tbody>
          {params.map((p) => (
            <tr key={p.name} className="border-b border-border/40 last:border-0 hover:bg-accent/20 transition-colors">
              <td className="px-4 py-2.5 font-mono text-[11px] text-primary/90">{p.name}</td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-amber-400/80">{p.type}</td>
              <td className="px-4 py-2.5">
                {p.required
                  ? <span className="text-rose-400/80 font-medium">required</span>
                  : <span className="text-muted-foreground/50">optional</span>
                }
              </td>
              <td className="px-4 py-2.5 text-muted-foreground leading-relaxed">{p.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Docs Section ──────────────────────────────────────────────────────────────

export function DocsSection({
  id,
  title,
  children,
  className,
}: {
  id?: string
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn("scroll-mt-28", className)}>
      {title && (
        <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground border-b border-border/40 pb-3">
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}

// ── Endpoint Card ─────────────────────────────────────────────────────────────

export function EndpointCard({
  method,
  path,
  description,
  children,
}: {
  method: keyof typeof METHOD_COLORS
  path: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface-elevated/40 overflow-hidden mb-6">
      <div className="flex items-center gap-3 border-b border-border/40 bg-surface-subtle/40 px-4 py-3">
        <MethodBadge method={method} />
        <code className="font-mono text-[12px] text-foreground/90">{path}</code>
      </div>
      {(description || children) && (
        <div className="px-4 py-4 space-y-4">
          {description && <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>}
          {children}
        </div>
      )}
    </div>
  )
}
