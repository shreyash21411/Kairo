import Link from "next/link"

const FOOTER_GROUPS = [
  {
    title: "Product",
    links: [
      { label: "Overview", href: "/" },
      { label: "It Remembers", href: "#remembers" },
      { label: "Context Accumulation", href: "#memory-over-time" },
      { label: "Semantic Recall", href: "#ask-naturally" },
      { label: "Memory Lifecycle", href: "#lifecycle" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Developer Hub", href: "/developers" },
      { label: "REST API", href: "/developers/api" },
      { label: "Python SDK", href: "/developers/python" },
      { label: "Node.js SDK", href: "/developers/node" },
      { label: "MCP Integration", href: "/developers/mcp" },
    ],
  },
  {
    title: "Platform",
    links: [
      { label: "Actor Isolation", href: "#isolation" },
      { label: "Use Cases", href: "#use-cases" },
      { label: "Architecture FAQ", href: "#faq" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Create Account", href: "/register" },
    ],
  },
]

export function Footer() {
  return (
    <footer className="relative z-10 py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">

          {/* Brand Column */}
          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-border/70 bg-surface-elevated text-foreground font-mono text-[11px] font-bold text-primary">
                K
              </div>
              <span className="font-mono text-sm font-semibold tracking-wider text-foreground uppercase">
                Kairo
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">
              Persistent memory infrastructure for autonomous AI agents, assistants, and applications.
            </p>
            <p className="mt-4 font-mono text-[10.5px] text-muted-foreground/70">
              Durable · Scoped · Semantic
            </p>
          </div>

          {/* Navigation Links Columns */}
          {FOOTER_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-foreground/80 font-semibold">
                {group.title}
              </p>
              <ul className="flex flex-col gap-2.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

        </div>

        {/* Bottom Bar */}
        <div className="mt-14 pt-6 border-t border-border/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[11px] font-mono text-muted-foreground/70">
          <div>
            © {new Date().getFullYear()} Kairo Systems. All rights reserved.
          </div>
          <div className="flex items-center gap-3">
            <span>REST API v1.0</span>
            <span>·</span>
            <span>pgvector Infrastructure</span>
            <span>·</span>
            <span>Zero Data Leakage</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
