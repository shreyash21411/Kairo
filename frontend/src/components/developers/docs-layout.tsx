"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { FloatingNavbar } from "@/components/layout/floating-navbar"
import { Footer } from "@/components/layout/footer"
import {
  ChevronRight,
  Terminal,
  FileCode,
  Code2,
  Cpu,
  BookOpen,
  Layers,
  Menu,
  X,
} from "lucide-react"

// ── Sidebar nav structure ─────────────────────────────────────────────────────

const SIDEBAR_SECTIONS = [
  {
    title: "Getting Started",
    items: [
      { label: "Developer Hub", href: "/developers", icon: Layers },
    ],
  },
  {
    title: "REST API",
    items: [
      { label: "Authentication", href: "/developers/api#authentication", icon: Terminal },
      { label: "Memories", href: "/developers/api#memories", icon: BookOpen },
      { label: "Search", href: "/developers/api#search", icon: Terminal },
      { label: "Chat", href: "/developers/api#chat", icon: Terminal },
    ],
  },
  {
    title: "SDKs",
    items: [
      { label: "Python SDK", href: "/developers/python", icon: FileCode },
      { label: "Node.js SDK", href: "/developers/node", icon: Code2 },
    ],
  },
  {
    title: "Integrations",
    items: [
      { label: "MCP", href: "/developers/mcp", icon: Cpu },
    ],
  },
]

interface DocsSidebarProps {
  onClose?: () => void
}

function DocsSidebar({ onClose }: DocsSidebarProps) {
  const pathname = usePathname()

  return (
    <nav aria-label="Documentation navigation" className="flex flex-col gap-6">
      {SIDEBAR_SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {section.title}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const baseHref = item.href.split("#")[0]
              const isActive = pathname === baseHref
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-colors duration-100",
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        isActive ? "text-primary" : "text-muted-foreground/60 group-hover:text-foreground"
                      )}
                    />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────

interface BreadcrumbItem {
  label: string
  href?: string
}

interface DocsLayoutProps {
  children: React.ReactNode
  breadcrumbs?: BreadcrumbItem[]
}

export function DocsLayout({ children, breadcrumbs }: DocsLayoutProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false)

  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col">
      <FloatingNavbar />

      <main className="flex-1 pt-20 sm:pt-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">

          {/* Mobile sidebar toggle */}
          <div className="flex items-center gap-3 mb-4 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              aria-label="Open documentation navigation"
            >
              <Menu className="h-3.5 w-3.5" />
              <span>Navigation</span>
            </button>
            {breadcrumbs && (
              <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
                {breadcrumbs.map((crumb, i) => (
                  <React.Fragment key={crumb.label}>
                    {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
                    {crumb.href ? (
                      <Link href={crumb.href} className="hover:text-foreground transition-colors">{crumb.label}</Link>
                    ) : (
                      <span className="text-foreground font-medium">{crumb.label}</span>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            )}
          </div>

          {/* Mobile sidebar drawer */}
          {mobileSidebarOpen && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <div
                className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                onClick={() => setMobileSidebarOpen(false)}
              />
              <div className="absolute left-0 top-0 bottom-0 w-72 bg-background border-r border-border/70 p-6 overflow-y-auto shadow-xl">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-sm font-semibold text-foreground">Documentation</span>
                  <button
                    type="button"
                    onClick={() => setMobileSidebarOpen(false)}
                    className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Close navigation"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <DocsSidebar onClose={() => setMobileSidebarOpen(false)} />
              </div>
            </div>
          )}

          <div className="flex gap-10 py-8 pb-16">
            {/* Desktop sidebar */}
            <aside className="hidden lg:block w-52 shrink-0 sticky top-28 self-start max-h-[calc(100vh-8rem)] overflow-y-auto pb-6">
              <DocsSidebar />
            </aside>

            {/* Main content */}
            <div className="min-w-0 flex-1">
              {/* Desktop breadcrumbs */}
              {breadcrumbs && (
                <nav aria-label="Breadcrumb" className="hidden lg:flex items-center gap-1 text-xs text-muted-foreground mb-6">
                  {breadcrumbs.map((crumb, i) => (
                    <React.Fragment key={crumb.label}>
                      {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
                      {crumb.href ? (
                        <Link href={crumb.href} className="hover:text-foreground transition-colors">{crumb.label}</Link>
                      ) : (
                        <span className="text-foreground font-medium">{crumb.label}</span>
                      )}
                    </React.Fragment>
                  ))}
                </nav>
              )}
              {children}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
