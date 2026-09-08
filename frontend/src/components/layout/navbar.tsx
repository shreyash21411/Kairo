"use client"

import * as React from "react"
import Link from "next/link"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const NAV = [
  { label: "Quickstart",   href: "#quickstart"   },
  { label: "Architecture", href: "#architecture" },
  { label: "Capabilities", href: "#api"          },
] as const

export function Navbar() {
  const [scrolled, setScrolled] = React.useState(false)

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 h-14 transition-all duration-200",
        scrolled
          ? "border-b border-border bg-background/90 backdrop-blur-md shadow-xs"
          : "border-b border-transparent bg-background/60 backdrop-blur-xs"
      )}
    >
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6">
        {/* Brand identity */}
        <Link
          href="/"
          className="flex items-center gap-2.5 focus-visible:outline-none"
          aria-label="Kairo home"
        >
          <span className="text-[15px] font-semibold tracking-tight text-foreground">Kairo</span>
          <span className="hidden text-xs text-muted-foreground/60 sm:inline">—</span>
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
            persistent memory infrastructure
          </span>
        </Link>

        {/* Navigation links with improved readability */}
        <nav
          className="hidden items-center gap-8 md:flex"
          aria-label="Main navigation"
        >
          {NAV.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3.5 text-xs font-medium"
            asChild
          >
            <Link href="#quickstart">Quickstart</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
