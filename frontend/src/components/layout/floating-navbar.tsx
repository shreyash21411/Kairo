"use client"

import * as React from "react"
import Link from "next/link"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAuth } from "@/providers/auth-provider"
import { Menu, X, ArrowRight, ChevronDown } from "lucide-react"

// Information Architecture — 4 top-level items on desktop:
// Product (5 items) · Developers (4 items) · Resources (3 items) · Company (1 item)
// Mobile: grouped accordion drawer

const PRODUCT_ITEMS = [
  { label: "It Remembers",     href: "#remembers",       description: "Conversational ingestion & auto-extraction" },
  { label: "Timeline",         href: "#memory-over-time", description: "Context that accumulates over sessions" },
  { label: "Semantic Recall",  href: "#ask-naturally",   description: "Find memories by meaning, not keywords" },
  { label: "Actor Isolation",  href: "#isolation",       description: "Memory strictly scoped per person" },
  { label: "Memory Lifecycle", href: "#lifecycle",       description: "Ingest → classify → retrieve → expire" },
  { label: "See in Action",    href: "#see-in-action",   description: "Interactive product walkthrough" },
] as const

const DEVELOPER_ITEMS = [
  { label: "Developer Hub", href: "/developers",         description: "Start here — all integration paths" },
  { label: "REST API",      href: "/developers/api",     description: "Full HTTP API reference" },
  { label: "Python SDK",    href: "/developers/python",  description: "pip install voidzone" },
  { label: "Node.js SDK",   href: "/developers/node",    description: "npm install @voidzone/sdk" },
  { label: "MCP",           href: "/developers/mcp",     description: "Model Context Protocol native integration" },
] as const

const RESOURCES_ITEMS = [
  { label: "Use Cases",   href: "/#use-cases",  description: "What developers and teams are building" },
  { label: "FAQ",         href: "/#faq",        description: "Architecture, isolation, and integrations" },
  { label: "Docs",        href: "/developers",  description: "API reference and quick-start guides" },
] as const

interface NavDropdownProps {
  label: string
  items: ReadonlyArray<{ label: string; href: string; description: string }>
}

function NavDropdown({ label, items }: NavDropdownProps) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleClose = () => { closeTimer.current = setTimeout(() => setOpen(false), 120) }
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current) }

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey) }
  }, [])

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => { cancelClose(); setOpen(true) }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none cursor-pointer select-none",
          open ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {label}
        <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", open && "rotate-180")} />
      </button>

      <div
        className={cn(
          "absolute top-full left-1/2 -translate-x-1/2 mt-3 w-60 rounded-xl border border-border/70 bg-background/97 dark:bg-card/97 p-1.5 shadow-xl shadow-black/8 backdrop-blur-2xl transition-all duration-200 origin-top z-50",
          open
            ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
            : "opacity-0 scale-95 -translate-y-1 pointer-events-none"
        )}
        role="menu"
        aria-label={`${label} navigation`}
      >
        {items.map((item) => (
          <Link
            key={item.href + item.label}
            href={item.href}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="group flex flex-col gap-0.5 rounded-lg px-3 py-2.5 transition-colors duration-100 hover:bg-accent/60 focus-visible:outline-none focus-visible:bg-accent/60"
          >
            <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors duration-100">
              {item.label}
            </span>
            <span className="text-[10px] leading-snug text-muted-foreground">
              {item.description}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function FloatingNavbar() {
  const { isAuthenticated } = useAuth()
  const [scrolled, setScrolled] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [mobileProductOpen, setMobileProductOpen] = React.useState(false)
  const [mobileDevOpen, setMobileDevOpen] = React.useState(false)
  const [mobileResourcesOpen, setMobileResourcesOpen] = React.useState(false)

  React.useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false) }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [])

  React.useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [mobileOpen])

  return (
    <header className="fixed top-4 inset-x-0 z-50 pointer-events-none flex justify-center px-3 sm:px-6">
      <div className="w-full max-w-5xl">

        {/* Pill bar */}
        <div
          className={cn(
            "pointer-events-auto flex items-center justify-between rounded-full border px-3.5 py-1.5 sm:px-5 sm:py-2.5 transition-all duration-300",
            scrolled
              ? "border-border/80 bg-background/90 dark:bg-card/90 shadow-lg shadow-black/6 backdrop-blur-xl"
              : "border-border/50 bg-background/70 dark:bg-card/70 shadow-sm backdrop-blur-md"
          )}
        >
          {/* Brand */}
          <Link
            href="/"
            className="group flex items-center focus-visible:outline-none flex-shrink-0 py-0.5"
            aria-label="voidzone Home"
          >
            <span className="font-sans text-[18px] sm:text-[20px] font-bold tracking-tight text-foreground lowercase select-none transition-opacity group-hover:opacity-85">
              voidzone
            </span>
          </Link>

          {/* Desktop nav — 3 dropdowns */}
          <nav className="hidden items-center gap-5 lg:flex" aria-label="Main navigation">
            <NavDropdown label="Product"    items={PRODUCT_ITEMS}   />
            <NavDropdown label="Developers" items={DEVELOPER_ITEMS} />
            <NavDropdown label="Resources"  items={RESOURCES_ITEMS} />
          </nav>

          {/* Right action cluster */}
          <div className="flex items-center gap-2">
            <ThemeToggle />

            {isAuthenticated ? (
              <Button size="sm" className="hidden sm:inline-flex h-8 px-3.5 text-xs font-medium rounded-full bg-foreground text-background hover:bg-foreground/90 transition-all duration-150 active:translate-y-px shadow-xs cursor-pointer" asChild>
                <Link href="/dashboard">Dashboard <ArrowRight className="ml-1 h-3 w-3" /></Link>
              </Button>
            ) : (
              <>
                <Link href="/login" className="hidden md:inline-block text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground px-2">
                  Sign in
                </Link>
                <Button size="sm" className="hidden sm:inline-flex h-8 px-3.5 text-xs font-medium rounded-full bg-foreground text-background hover:bg-foreground/90 transition-all duration-150 active:translate-y-px shadow-xs cursor-pointer" asChild>
                  <Link href="/register">Start building <ArrowRight className="ml-1 h-3 w-3" /></Link>
                </Button>
              </>
            )}

            <button
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border/70 text-muted-foreground lg:hidden hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer active:translate-y-px transition-all"
              aria-expanded={mobileOpen}
              aria-label="Toggle navigation"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            className="pointer-events-auto mt-2 mx-1 rounded-2xl border border-border/80 bg-background/97 dark:bg-card/97 shadow-2xl shadow-black/12 backdrop-blur-2xl lg:hidden animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="p-4 flex flex-col gap-0">

              {/* Product */}
              <div>
                <button
                  type="button"
                  onClick={() => setMobileProductOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-2 py-2.5 text-xs font-semibold text-foreground cursor-pointer focus-visible:outline-none"
                >
                  Product
                  <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform duration-200", mobileProductOpen && "rotate-180")} />
                </button>
                {mobileProductOpen && (
                  <div className="pl-2 pb-1 flex flex-col gap-0.5">
                    {PRODUCT_ITEMS.map((item) => (
                      <Link key={item.href + item.label} href={item.href} onClick={() => setMobileOpen(false)}
                        className="flex flex-col gap-0.5 rounded-lg px-3 py-2 hover:bg-accent/50 transition-colors">
                        <span className="text-xs font-medium text-foreground">{item.label}</span>
                        <span className="text-[10px] text-muted-foreground">{item.description}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-border/40 mx-2" />

              {/* Developers */}
              <div>
                <button
                  type="button"
                  onClick={() => setMobileDevOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-2 py-2.5 text-xs font-semibold text-foreground cursor-pointer focus-visible:outline-none"
                >
                  Developers
                  <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform duration-200", mobileDevOpen && "rotate-180")} />
                </button>
                {mobileDevOpen && (
                  <div className="pl-2 pb-1 flex flex-col gap-0.5">
                    {DEVELOPER_ITEMS.map((item) => (
                      <Link key={item.href + item.label} href={item.href} onClick={() => setMobileOpen(false)}
                        className="flex flex-col gap-0.5 rounded-lg px-3 py-2 hover:bg-accent/50 transition-colors">
                        <span className="text-xs font-medium text-foreground">{item.label}</span>
                        <span className="text-[10px] text-muted-foreground">{item.description}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-border/40 mx-2" />

              {/* Resources */}
              <div>
                <button
                  type="button"
                  onClick={() => setMobileResourcesOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-2 py-2.5 text-xs font-semibold text-foreground cursor-pointer focus-visible:outline-none"
                >
                  Resources
                  <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform duration-200", mobileResourcesOpen && "rotate-180")} />
                </button>
                {mobileResourcesOpen && (
                  <div className="pl-2 pb-1 flex flex-col gap-0.5">
                    {RESOURCES_ITEMS.map((item) => (
                      <Link key={item.href + item.label} href={item.href} onClick={() => setMobileOpen(false)}
                        className="flex flex-col gap-0.5 rounded-lg px-3 py-2 hover:bg-accent/50 transition-colors">
                        <span className="text-xs font-medium text-foreground">{item.label}</span>
                        <span className="text-[10px] text-muted-foreground">{item.description}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* CTA */}
              <div className="border-t border-border/50 mx-2 mt-1 pt-3 pb-1 flex flex-col gap-2">
                {!isAuthenticated ? (
                  <>
                    <Link href="/login" onClick={() => setMobileOpen(false)} className="w-full text-center py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                      Sign in
                    </Link>
                    <Button size="sm" className="w-full h-9 rounded-xl text-xs font-medium bg-foreground text-background hover:bg-foreground/90 active:translate-y-px" asChild>
                      <Link href="/register" onClick={() => setMobileOpen(false)}>
                        Start building <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </>
                ) : (
                  <Button size="sm" className="w-full h-9 rounded-xl text-xs font-medium bg-foreground text-background hover:bg-foreground/90 active:translate-y-px" asChild>
                    <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                      Go to Dashboard <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                )}
              </div>

            </div>
          </div>
        )}

      </div>
    </header>
  )
}