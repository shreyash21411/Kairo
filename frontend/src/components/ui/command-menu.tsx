"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useProject } from "@/providers/project-provider"
import { useTheme } from "next-themes"
import {
  LayoutDashboard,
  Brain,
  Search,
  Terminal,
  KeyRound,
  MessageSquareCode,
  BookOpen,
  FolderGit2,
  Plus,
  Sun,
  Moon,
  Laptop,
  ArrowRight,
} from "lucide-react"

interface CommandMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const router = useRouter()
  const { projects, selectProject } = useProject()
  const { setTheme } = useTheme()
  const [query, setQuery] = React.useState("")
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) {
      setQuery("")
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Build command list based on state
  const items = React.useMemo(() => {
    const list: Array<{
      category: string
      id: string
      title: string
      subtitle?: string
      icon: React.ComponentType<{ className?: string }>
      onSelect: () => void
    }> = [
      // Navigation
      {
        category: "Navigation",
        id: "nav-overview",
        title: "Overview",
        subtitle: "Workspace dashboard & telemetry",
        icon: LayoutDashboard,
        onSelect: () => router.push("/dashboard"),
      },
      {
        category: "Navigation",
        id: "nav-memories",
        title: "Memory Explorer",
        subtitle: "Inspect, edit, and deactivate memories",
        icon: Brain,
        onSelect: () => router.push("/dashboard/memories"),
      },
      {
        category: "Navigation",
        id: "nav-search",
        title: "Semantic Vector Search",
        subtitle: "Natural language query across memory embeddings",
        icon: Search,
        onSelect: () => router.push("/dashboard/search"),
      },
      {
        category: "Navigation",
        id: "nav-playground",
        title: "Developer Playground",
        subtitle: "Test Kairo Memory operations live",
        icon: Terminal,
        onSelect: () => router.push("/dashboard/playground"),
      },
      {
        category: "Navigation",
        id: "nav-keys",
        title: "API Keys",
        subtitle: "Manage data plane access tokens",
        icon: KeyRound,
        onSelect: () => router.push("/dashboard/api-keys"),
      },
      {
        category: "Navigation",
        id: "nav-chat",
        title: "Chat Pipeline",
        subtitle: "Test conversation extraction guard",
        icon: MessageSquareCode,
        onSelect: () => router.push("/dashboard/chat"),
      },
      {
        category: "Navigation",
        id: "nav-docs",
        title: "API Reference & SDKs",
        subtitle: "Authoritative developer documentation",
        icon: BookOpen,
        onSelect: () => router.push("/dashboard/docs"),
      },
    ]

    // Switch Projects
    projects.forEach((p) => {
      list.push({
        category: "Switch Project",
        id: `proj-${p.projectId}`,
        title: p.name,
        subtitle: `Project #${p.projectId}`,
        icon: FolderGit2,
        onSelect: () => {
          selectProject(p)
          router.push("/dashboard")
        },
      })
    })

    // Theme Actions
    list.push(
      {
        category: "Preferences",
        id: "theme-dark",
        title: "Switch to Dark Theme",
        icon: Moon,
        onSelect: () => setTheme("dark"),
      },
      {
        category: "Preferences",
        id: "theme-light",
        title: "Switch to Light Theme",
        icon: Sun,
        onSelect: () => setTheme("light"),
      },
      {
        category: "Preferences",
        id: "theme-system",
        title: "Match System Theme",
        icon: Laptop,
        onSelect: () => setTheme("system"),
      }
    )

    if (!query.trim()) return list

    const q = query.toLowerCase()
    return list.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
        item.category.toLowerCase().includes(q)
    )
  }, [projects, query, router, selectProject, setTheme])

  // Reset selectedIndex if out of range
  React.useEffect(() => {
    setSelectedIndex(0)
  }, [items.length])

  // Keybindings
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, items.length))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + items.length) % Math.max(1, items.length))
    } else if (e.key === "Enter" && items[selectedIndex]) {
      e.preventDefault()
      items[selectedIndex].onSelect()
      onOpenChange(false)
    } else if (e.key === "Escape") {
      e.preventDefault()
      onOpenChange(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-xs transition-opacity duration-150 animate-in fade-in"
        onClick={() => onOpenChange(false)}
      />

      {/* Command Palette Surface */}
      <div
        className="relative z-50 w-full max-w-xl rounded-lg border border-border/80 bg-card shadow-2xl overflow-hidden transition-all duration-150 animate-in fade-in zoom-in-98"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-border/60">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search workspace..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground bg-muted/60 border border-border/50">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[360px] overflow-y-auto p-1.5 space-y-0.5">
          {items.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No matching commands or projects found.
            </div>
          ) : (
            items.map((item, idx) => {
              const Icon = item.icon
              const isSelected = idx === selectedIndex

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    item.onSelect()
                    onOpenChange(false)
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-2.5 py-2 rounded-md text-xs cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-foreground hover:bg-muted/60"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isSelected ? "text-primary-foreground" : "text-muted-foreground"
                      }`}
                    />
                    <div className="truncate">
                      <span className="truncate">{item.title}</span>
                      {item.subtitle && (
                        <span
                          className={`ml-2 text-[10px] font-mono truncate ${
                            isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                          }`}
                        >
                          {item.subtitle}
                        </span>
                      )}
                    </div>
                  </div>

                  <span
                    className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      isSelected
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-muted/80 text-muted-foreground"
                    }`}
                  >
                    {item.category}
                  </span>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-3.5 py-2 border-t border-border/50 bg-surface-elevated/40 flex items-center justify-between text-[10px] text-muted-foreground font-mono">
          <div className="flex items-center gap-3">
            <span>↑↓ to navigate</span>
            <span>↵ to select</span>
          </div>
          <span>Kairo Command</span>
        </div>
      </div>
    </div>
  )
}
