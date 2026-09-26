"use client"

import * as React from "react"
import Link from "next/link"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAuth } from "@/providers/auth-provider"

const NAV_ITEMS = [
  { label: "Product", href: "#remembers" },
  { label: "Recall", href: "#ask-naturally" },
  { label: "Developers", href: "#developers" },
  { label: "Use Cases", href: "#use-cases" },
] as const

export function Navbar() {
  const { isAuthenticated } = useAuth()
  const [scrolled, setScrolled] = React.useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-200",
        scrolled
          ? "border-b border-border/80 bg-background/85 backdrop-blur-md"
          : "border-b border-transparent bg-background/40 backdrop-blur-xs"
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        {/* Brand identity */}
        <Link
          href="/"
          className="group flex items-center gap-2.5 focus-visible:outline-none"
          aria-label="Kairo home"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-[5px] border border-border bg-surface-elevated text-foreground transition-colors group-hover:border-primary/50">
            <span className="font-mono text-xs font-semibold text-primary">K</span>
          </div>
          <span className="font-mono text-[13px] font-semibold tracking-wider text-foreground uppercase">
            Kairo
          </span>
          <span className="hidden font-mono text-[10px] text-muted-foreground/60 sm:inline-block border border-border/60 rounded px-1.5 py-0.5">
            v1.0
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav
          className="hidden items-center gap-8 md:flex"
          aria-label="Main navigation"
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <ThemeToggle />

          {isAuthenticated ? (
            <Button
              size="sm"
              className="h-8 px-3.5 text-xs font-medium"
              asChild
            >
              <Link href="/dashboard">Dashboard →</Link>
            </Button>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
              >
                Sign in
              </Link>
              <Button
                size="sm"
                className="h-8 px-3.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 transition-all active:scale-[0.98]"
                asChild
              >
                <Link href="/register">Start building →</Link>
              </Button>
            </>
          )}

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground md:hidden hover:text-foreground"
            aria-label="Toggle mobile menu"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {mobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu drop */}
      {mobileMenuOpen && (
        <div className="border-b border-border bg-background/95 backdrop-blur-xl px-6 py-4 md:hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <nav className="flex flex-col gap-3">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground py-1"
              >
                {item.label}
              </Link>
            ))}
            {!isAuthenticated && (
              <Link
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground py-1 border-t border-border/40 pt-2"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  )
}

