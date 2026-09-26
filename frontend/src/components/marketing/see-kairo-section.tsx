"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  Check,
  Copy,
  Search,
  KeyRound,
  ShieldCheck,
  Database,
  Bot,
  Terminal,
  Layers,
  Sparkles,
  ArrowRight,
  Lock,
  Brain,
  LayoutDashboard,
  CheckCircle2,
  FolderGit2,
  Plus,
  Code2,
} from "lucide-react"

// ─── Step Metadata ────────────────────────────────────────────────────────────
export interface DemoStep {
  id: "workspace" | "apikey" | "memory" | "search" | "mcp"
  num: string
  title: string
  subtitle: string
  route: string
}

export const DEMO_STEPS: DemoStep[] = [
  {
    id: "workspace",
    num: "01",
    title: "Create your workspace",
    subtitle: "Default Project & Engine",
    route: "app.kairo.dev/dashboard",
  },
  {
    id: "apikey",
    num: "02",
    title: "Generate an API key",
    subtitle: "Provision Bearer token",
    route: "app.kairo.dev/dashboard/api-keys",
  },
  {
    id: "memory",
    num: "03",
    title: "Store a memory",
    subtitle: "Ingest structured context",
    route: "app.kairo.dev/dashboard/memories",
  },
  {
    id: "search",
    num: "04",
    title: "Recall it naturally",
    subtitle: "Vector semantic search",
    route: "app.kairo.dev/dashboard/search",
  },
  {
    id: "mcp",
    num: "05",
    title: "Connect your agent",
    subtitle: "Model Context Protocol",
    route: "app.kairo.dev/developers/mcp",
  },
]

export function SeeKairoSection() {
  const containerRef = React.useRef<HTMLDivElement>(null)

  // ── Active Step State ──
  const [activeStepId, setActiveStepId] = React.useState<DemoStep["id"]>("workspace")
  const activeStepIdRef = React.useRef<DemoStep["id"]>("workspace")

  React.useEffect(() => {
    activeStepIdRef.current = activeStepId
  }, [activeStepId])

  // ── Simulated Cursor State ──
  const [cursorPos, setCursorPos] = React.useState({ x: 220, y: 70 })
  const [isMoving, setIsMoving] = React.useState(false)
  const [isClicking, setIsClicking] = React.useState(false)
  const [hoveredTarget, setHoveredTarget] = React.useState<string | null>(null)

  // ── UI States within Walkthrough ──
  // Step 1: Workspace
  const [projectDropdownOpen, setProjectDropdownOpen] = React.useState(false)
  // Step 2: API Keys
  const [keyModalOpen, setKeyModalOpen] = React.useState(false)
  const [keyNameText, setKeyNameText] = React.useState("")
  const [keyRevealed, setKeyRevealed] = React.useState(false)
  const [keyCopied, setKeyCopied] = React.useState(false)
  // Step 3: Memories
  const [memoryModalOpen, setMemoryModalOpen] = React.useState(false)
  const [actorText, setActorText] = React.useState("")
  const [memoryType, setMemoryType] = React.useState("Preference")
  const [contentText, setContentText] = React.useState("")
  const [memoryCreated, setMemoryCreated] = React.useState(false)
  // Step 4: Search
  const [searchQueryText, setSearchQueryText] = React.useState("")
  const [searchExecuted, setSearchExecuted] = React.useState(false)
  // Step 5: MCP
  const [mcpStepState, setMcpStepState] = React.useState<"config" | "calling" | "resolved">("config")


  // Helper to move cursor to a data-target element smoothly
  const moveCursorTo = React.useCallback(
    (targetName: string, durationMs = 650): Promise<void> => {
      return new Promise((resolve) => {
        if (!containerRef.current) {
          setHoveredTarget(targetName)
          resolve()
          return
        }

        const container = containerRef.current
        const el = container.querySelector(`[data-target="${targetName}"]`) as HTMLElement | null

        if (el) {
          const cRect = container.getBoundingClientRect()
          const tRect = el.getBoundingClientRect()

          // Guard against hidden or collapsed targets (e.g. mobile hidden sidebar)
          if (tRect.width <= 0 || tRect.height <= 0) {
            setHoveredTarget(targetName)
            resolve()
            return
          }

          const x = tRect.left - cRect.left + tRect.width / 2
          const y = tRect.top - cRect.top + tRect.height / 2

          setIsMoving(true)
          setCursorPos({ x, y })

          setTimeout(() => {
            setIsMoving(false)
            setHoveredTarget(targetName)
            resolve()
          }, durationMs)
        } else {
          resolve()
        }
      })
    },
    []
  )

  // Helper to click at current target
  const clickCurrent = React.useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      setIsClicking(true)
      setTimeout(() => {
        setIsClicking(false)
        resolve()
      }, 250)
    })
  }, [])

  // Helper for typing text into a field
  const typeText = React.useCallback(
    (text: string, setter: (val: string) => void, speedMs = 35): Promise<void> => {
      return new Promise((resolve) => {
        let i = 0
        const interval = setInterval(() => {
          i++
          setter(text.slice(0, i))
          if (i >= text.length) {
            clearInterval(interval)
            setTimeout(resolve, 150)
          }
        }, speedMs)
      })
    },
    []
  )

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

  // Main Orchestration Loop
  const cancelRef = React.useRef(false)

  const runSequence = React.useCallback(
    async (startStep?: DemoStep["id"]) => {
      cancelRef.current = false

      const checkCancel = () => cancelRef.current

      // Determine starting step using ref to avoid cancelling when activeStepId updates
      const currentStepId = startStep ?? activeStepIdRef.current
      const stepIndex = DEMO_STEPS.findIndex((s) => s.id === currentStepId)
      const startIdx = stepIndex >= 0 ? stepIndex : 0

      // Run through steps in sequence
      for (let s = startIdx; s < DEMO_STEPS.length; s++) {
        if (checkCancel()) return
        const step = DEMO_STEPS[s]
        activeStepIdRef.current = step.id
        setActiveStepId(step.id)

        // ══════════════════════════════════════════════════════
        // STEP 1: WORKSPACE / ENTER KAIRO
        // ══════════════════════════════════════════════════════
        if (step.id === "workspace") {
          setProjectDropdownOpen(false)
          await sleep(300)
          if (checkCancel()) return

          // Move to project selector
          await moveCursorTo("project-selector", 700)
          await sleep(250)
          if (checkCancel()) return

          // Click project selector
          await clickCurrent()
          setProjectDropdownOpen(true)
          await sleep(400)
          if (checkCancel()) return

          // Move to Default Project item
          await moveCursorTo("project-item-default", 500)
          await sleep(200)
          if (checkCancel()) return

          // Click to confirm project
          await clickCurrent()
          setProjectDropdownOpen(false)
          await sleep(800)
        }

        // ══════════════════════════════════════════════════════
        // STEP 2: CREATE API KEY
        // ══════════════════════════════════════════════════════
        else if (step.id === "apikey") {
          setKeyModalOpen(false)
          setKeyRevealed(false)
          setKeyNameText("")
          setKeyCopied(false)
          await sleep(200)
          if (checkCancel()) return

          // Move to sidebar API Keys
          await moveCursorTo("nav-apikeys", 750)
          await sleep(200)
          if (checkCancel()) return
          await clickCurrent()
          await sleep(350)
          if (checkCancel()) return

          // Move to "New Key" button
          await moveCursorTo("btn-create-key", 650)
          await sleep(200)
          if (checkCancel()) return
          await clickCurrent()
          setKeyModalOpen(true)
          await sleep(400)
          if (checkCancel()) return

          // Move to Key Name input
          await moveCursorTo("input-key-name", 550)
          await sleep(150)
          if (checkCancel()) return
          await clickCurrent()

          // Type key name
          await typeText("production-agent", setKeyNameText, 35)
          await sleep(250)
          if (checkCancel()) return

          // Move to "Generate" button
          await moveCursorTo("btn-modal-generate", 550)
          await sleep(200)
          if (checkCancel()) return
          await clickCurrent()

          // Key reveal modal
          setKeyModalOpen(false)
          setKeyRevealed(true)
          await sleep(400)
          if (checkCancel()) return

          // Move to Copy button
          await moveCursorTo("btn-copy-revealed-key", 600)
          await sleep(250)
          if (checkCancel()) return
          await clickCurrent()
          setKeyCopied(true)
          await sleep(1000)
        }

        // ══════════════════════════════════════════════════════
        // STEP 3: STORE FIRST MEMORY
        // ══════════════════════════════════════════════════════
        else if (step.id === "memory") {
          setKeyRevealed(false)
          setMemoryModalOpen(false)
          setActorText("")
          setContentText("")
          setMemoryCreated(false)
          await sleep(200)
          if (checkCancel()) return

          // Move to sidebar Memories
          await moveCursorTo("nav-memories", 750)
          await sleep(200)
          if (checkCancel()) return
          await clickCurrent()
          await sleep(350)
          if (checkCancel()) return

          // Move to "+ Add Memory" button
          await moveCursorTo("btn-add-memory", 650)
          await sleep(200)
          if (checkCancel()) return
          await clickCurrent()
          setMemoryModalOpen(true)
          await sleep(400)
          if (checkCancel()) return

          // Move to Actor ID field
          await moveCursorTo("input-memory-actor", 500)
          await sleep(150)
          if (checkCancel()) return
          await clickCurrent()
          await typeText("user_alex", setActorText, 35)
          await sleep(200)
          if (checkCancel()) return

          // Move to Memory Content field
          await moveCursorTo("input-memory-content", 500)
          await sleep(150)
          if (checkCancel()) return
          await clickCurrent()
          await typeText("I prefer PostgreSQL for new projects.", setContentText, 30)
          await sleep(300)
          if (checkCancel()) return

          // Move to Store Memory button
          await moveCursorTo("btn-store-memory-submit", 550)
          await sleep(250)
          if (checkCancel()) return
          await clickCurrent()

          // Success state
          setMemoryModalOpen(false)
          setMemoryCreated(true)
          await sleep(1100)
        }

        // ══════════════════════════════════════════════════════
        // STEP 4: SEMANTIC SEARCH
        // ══════════════════════════════════════════════════════
        else if (step.id === "search") {
          setSearchQueryText("")
          setSearchExecuted(false)
          await sleep(200)
          if (checkCancel()) return

          // Move to sidebar Search
          await moveCursorTo("nav-search", 750)
          await sleep(200)
          if (checkCancel()) return
          await clickCurrent()
          await sleep(350)
          if (checkCancel()) return

          // Move to search input field
          await moveCursorTo("input-search-query", 600)
          await sleep(150)
          if (checkCancel()) return
          await clickCurrent()

          // Type search query
          await typeText("What database do I prefer?", setSearchQueryText, 35)
          await sleep(250)
          if (checkCancel()) return

          // Move to Search button
          await moveCursorTo("btn-run-search", 550)
          await sleep(200)
          if (checkCancel()) return
          await clickCurrent()

          // Show search execution & result
          setSearchExecuted(true)
          await sleep(1300)
        }

        // ══════════════════════════════════════════════════════
        // STEP 5: CONNECT AGENT / MCP
        // ══════════════════════════════════════════════════════
        else if (step.id === "mcp") {
          setMcpStepState("config")
          await sleep(200)
          if (checkCancel()) return

          // Move to sidebar Developers / MCP
          await moveCursorTo("nav-mcp", 750)
          await sleep(200)
          if (checkCancel()) return
          await clickCurrent()
          await sleep(400)
          if (checkCancel()) return

          // Move to Tool invocation test
          await moveCursorTo("btn-test-tool-call", 650)
          await sleep(200)
          if (checkCancel()) return
          await clickCurrent()

          setMcpStepState("calling")
          await sleep(600)
          if (checkCancel()) return

          setMcpStepState("resolved")
          await sleep(1800)
        }

        if (checkCancel()) return
      }

      // Loop back smoothly
      if (!cancelRef.current) {
        runSequence("workspace")
      }
    },
    [clickCurrent, moveCursorTo, typeText]
  )

  // Start sequence automatically on mount
  React.useEffect(() => {
    runSequence()
    return () => {
      cancelRef.current = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Direct Step Selection from user clicks
  const handleSelectStep = (stepId: DemoStep["id"]) => {
    cancelRef.current = true
    activeStepIdRef.current = stepId
    setActiveStepId(stepId)

    // Reset step UI states appropriate for the chosen step
    if (stepId === "workspace") {
      setProjectDropdownOpen(false)
    } else if (stepId === "apikey") {
      setKeyModalOpen(false)
      setKeyRevealed(false)
      setKeyNameText("production-agent")
      setKeyCopied(false)
    } else if (stepId === "memory") {
      setMemoryModalOpen(false)
      setActorText("user_alex")
      setContentText("I prefer PostgreSQL for new projects.")
      setMemoryCreated(true)
    } else if (stepId === "search") {
      setSearchQueryText("What database do I prefer?")
      setSearchExecuted(true)
    } else if (stepId === "mcp") {
      setMcpStepState("resolved")
    }

    setTimeout(() => {
      runSequence(stepId)
    }, 100)
  }

  const currentStep = DEMO_STEPS.find((s) => s.id === activeStepId) || DEMO_STEPS[0]

  return (
    <section id="see-in-action" className="relative py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-primary font-semibold mb-3">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Interactive Product Walkthrough</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            See Kairo in action.
          </h2>
          <p className="mt-3 text-base sm:text-lg text-muted-foreground leading-relaxed">
            Build with memory in a few simple steps.
          </p>
        </div>

        {/* Step Navigation Indicators (Clean, unobtrusive top bar) */}
        <div className="flex items-center justify-center mb-8">
          <div className="flex flex-wrap items-center justify-center gap-2 p-1.5 rounded-2xl border border-border/50 bg-surface-elevated/40 backdrop-blur-sm max-w-full">
            {DEMO_STEPS.map((step) => {
              const isActive = activeStepId === step.id
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => handleSelectStep(step.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-xl font-mono text-xs transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    isActive
                      ? "bg-primary text-primary-foreground font-medium shadow-sm shadow-primary/20 scale-[1.02]"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated/60"
                  )}
                >
                  <span className={cn("text-[11px] font-semibold", isActive ? "text-primary-foreground" : "text-primary")}>
                    {step.num}
                  </span>
                  <span className="hidden sm:inline font-sans">{step.title}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Realistic Product Demo Window ── */}
        <div
          ref={containerRef}
          className="relative mx-auto rounded-2xl border border-border/80 bg-surface-elevated/95 backdrop-blur-md shadow-2xl shadow-black/40 overflow-hidden min-h-[520px] select-none"
        >
          {/* Animated DOM Cursor */}
          <div
            className="pointer-events-none absolute top-0 left-0 z-50 will-change-transform"
            style={{
              transform: `translate3d(${cursorPos.x}px, ${cursorPos.y}px, 0)`,
              transition: isMoving ? "transform 0.65s cubic-bezier(0.22, 1, 0.36, 1)" : "none",
            }}
          >
            {/* Click Ripple Indicator */}
            {isClicking && (
              <span className="absolute -top-2.5 -left-2.5 h-8 w-8 rounded-full border-2 border-primary bg-primary/20 animate-ping pointer-events-none" />
            )}
            {/* Cursor Arrow Graphic with high-contrast dual-tone */}
            <svg
              className={`h-5 w-5 drop-shadow-md transition-transform duration-100 ${
                isClicking ? "scale-90" : "scale-100"
              }`}
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M4 3L11.5 21L14.5 13.5L22 10.5L4 3Z"
                fill="#09090b"
                stroke="#ffffff"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* Browser Chrome Bar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-background/80">
            {/* Window Controls */}
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80 inline-block" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80 inline-block" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80 inline-block" />
            </div>

            {/* Dynamic URL Bar */}
            <div className="flex items-center gap-1.5 rounded-md border border-border/50 bg-surface-elevated/80 px-3 py-1 font-mono text-[11px] text-muted-foreground/90 max-w-[280px] sm:max-w-md truncate">
              <Lock className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
              <span className="truncate">{currentStep.route}</span>
            </div>

            {/* Auto-playing walkthrough indicator */}
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 px-2 py-0.5 rounded border border-primary/30 bg-primary/10 text-[10px] font-mono text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse inline-block" />
                live
              </span>
            </div>
          </div>

          {/* ── Internal Kairo Dashboard Canvas ── */}
          <div className="grid grid-cols-1 md:grid-cols-12 min-h-[480px]">
            
            {/* Miniature Dashboard Sidebar */}
            <aside className="hidden md:flex md:col-span-3 border-r border-border/50 bg-surface-elevated/50 p-4 flex-col justify-between text-xs">
              <div className="space-y-4">
                {/* Logo & Version */}
                <div className="flex items-center gap-2 px-1">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground font-mono text-xs font-bold">
                    K
                  </div>
                  <span className="font-semibold text-foreground text-sm tracking-tight">Kairo</span>
                  <span className="rounded bg-surface-elevated border border-border/60 px-1 py-0.2 font-mono text-[9px] text-muted-foreground">
                    v1.0
                  </span>
                </div>

                {/* Project Selector Trigger */}
                <div className="relative">
                  <div
                    data-target="project-selector"
                    className={cn(
                      "flex items-center justify-between rounded-lg border border-border/60 bg-background/80 px-2.5 py-1.5 transition-colors cursor-pointer",
                      hoveredTarget === "project-selector" && "border-primary/60 bg-primary/5"
                    )}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <FolderGit2 className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="font-medium text-foreground truncate text-[11px]">Default Project</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">▾</span>
                  </div>

                  {/* Dropdown Menu Simulation */}
                  {projectDropdownOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-border bg-surface-elevated p-1 shadow-lg animate-in fade-in duration-150">
                      <div
                        data-target="project-item-default"
                        className={cn(
                          "flex items-center justify-between px-2 py-1.5 rounded text-[11px] font-medium transition-colors",
                          hoveredTarget === "project-item-default"
                            ? "bg-primary text-primary-foreground"
                            : "bg-surface-elevated/80 text-foreground"
                        )}
                      >
                        <span>Default Project</span>
                        <Check className="h-3 w-3" />
                      </div>
                      <div className="px-2 py-1 text-[10px] text-muted-foreground">+ New Project</div>
                    </div>
                  )}
                </div>

                {/* Navigation Links */}
                <div className="space-y-1">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 px-1 pt-1">
                    Workspace
                  </div>
                  
                  <div
                    data-target="nav-overview"
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors cursor-pointer text-[11px]",
                      activeStepId === "workspace"
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    <span>Overview</span>
                  </div>

                  <div
                    data-target="nav-memories"
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors cursor-pointer text-[11px]",
                      activeStepId === "memory"
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground",
                      hoveredTarget === "nav-memories" && "bg-primary/15 text-primary"
                    )}
                  >
                    <Brain className="h-3.5 w-3.5" />
                    <span>Memories</span>
                  </div>

                  <div
                    data-target="nav-search"
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors cursor-pointer text-[11px]",
                      activeStepId === "search"
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground",
                      hoveredTarget === "nav-search" && "bg-primary/15 text-primary"
                    )}
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span>Semantic Search</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 px-1 pt-1">
                    Developers
                  </div>

                  <div
                    data-target="nav-apikeys"
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors cursor-pointer text-[11px]",
                      activeStepId === "apikey"
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground",
                      hoveredTarget === "nav-apikeys" && "bg-primary/15 text-primary"
                    )}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>API Keys</span>
                  </div>

                  <div
                    data-target="nav-mcp"
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors cursor-pointer text-[11px]",
                      activeStepId === "mcp"
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground",
                      hoveredTarget === "nav-mcp" && "bg-primary/15 text-primary"
                    )}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    <span>MCP &amp; Agent</span>
                  </div>
                </div>
              </div>

              {/* Bottom actor tag */}
              <div className="pt-3 border-t border-border/40 font-mono text-[10px] text-muted-foreground truncate">
                Actor: <span className="text-foreground">user_alex</span>
              </div>
            </aside>

            {/* Main Stage Panel */}
            <main className="md:col-span-9 p-5 sm:p-6 flex flex-col justify-between bg-background/50">
              
              {/* ── STEP 1: Overview / Workspace ── */}
              {activeStepId === "workspace" && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between pb-3 border-b border-border/40">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Project Overview</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Project: Default Project · PostgreSQL + pgvector</p>
                    </div>
                    <span className="flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-mono text-emerald-500 font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Active
                    </span>
                  </div>

                  {/* Welcome banner */}
                  <div className="rounded-xl border border-border/60 bg-surface-elevated/40 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" />
                      <span className="text-xs font-semibold text-foreground">Persistent Memory Engine Ready</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Start from your Kairo workspace. Dedicated memory partition provisioned with actor scoping and HNSW vector index.
                    </p>
                  </div>

                  {/* Metrics grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div className="rounded-lg border border-border/40 bg-surface-elevated/30 p-3">
                      <div className="text-[10px] font-mono uppercase text-muted-foreground">Active Projects</div>
                      <div className="text-sm font-semibold text-foreground mt-1">1</div>
                    </div>
                    <div className="rounded-lg border border-border/40 bg-surface-elevated/30 p-3">
                      <div className="text-[10px] font-mono uppercase text-muted-foreground">Vector Store</div>
                      <div className="text-sm font-semibold text-emerald-500 mt-1 flex items-center gap-1">
                        <Check className="h-3 w-3" /> pgvector
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/40 bg-surface-elevated/30 p-3 col-span-2 sm:col-span-1">
                      <div className="text-[10px] font-mono uppercase text-muted-foreground">Stored Memories</div>
                      <div className="text-sm font-semibold text-foreground mt-1">0 memories</div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── STEP 2: API Keys ── */}
              {activeStepId === "apikey" && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between pb-3 border-b border-border/40">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">API Keys</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Provision Bearer authentication tokens</p>
                    </div>
                    <button
                      type="button"
                      data-target="btn-create-key"
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border border-primary/60 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-all",
                        hoveredTarget === "btn-create-key" && "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                      )}
                    >
                      <Plus className="h-3 w-3" />
                      <span>New Key</span>
                    </button>
                  </div>

                  {/* Simulated Create Key Modal */}
                  {keyModalOpen && (
                    <div className="rounded-xl border border-border bg-surface-elevated p-4 shadow-xl space-y-3 animate-in zoom-in-95 duration-150">
                      <div className="flex items-center justify-between border-b border-border/40 pb-2">
                        <span className="text-xs font-semibold text-foreground">Create API Key</span>
                        <span className="text-[10px] font-mono text-muted-foreground">Default Project</span>
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase text-muted-foreground block mb-1">
                          Key Name
                        </label>
                        <div
                          data-target="input-key-name"
                          className={cn(
                            "rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground flex items-center min-h-[30px]",
                            hoveredTarget === "input-key-name" && "border-primary ring-1 ring-primary/30"
                          )}
                        >
                          <span>{keyNameText}</span>
                          <span className="inline-block w-1.5 h-3.5 bg-primary ml-0.5 animate-pulse" />
                        </div>
                      </div>
                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          data-target="btn-modal-generate"
                          className={cn(
                            "rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-all",
                            hoveredTarget === "btn-modal-generate" && "ring-2 ring-primary/40 scale-95"
                          )}
                        >
                          Create key
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Simulated Key Reveal Modal */}
                  {keyRevealed && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3 animate-in fade-in duration-150">
                      <div className="flex items-start gap-2.5">
                        <ShieldCheck className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <div className="text-xs font-semibold text-foreground">Save your new Kairo API key</div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            ⚠️ This key will never be shown again. Stored securely on the server.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1 rounded-md border border-border bg-background/90 px-3 py-1.5 font-mono text-xs text-primary font-medium truncate">
                          kairo_live_demo_9a4f2b18c7e0
                        </div>
                        <button
                          type="button"
                          data-target="btn-copy-revealed-key"
                          className={cn(
                            "flex items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium transition-all",
                            keyCopied
                              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-500"
                              : "text-foreground",
                            hoveredTarget === "btn-copy-revealed-key" && "border-primary text-primary"
                          )}
                        >
                          {keyCopied ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-500" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Keys table preview */}
                  {!keyModalOpen && (
                    <div className="rounded-lg border border-border/50 bg-background/50 overflow-hidden text-xs">
                      <div className="grid grid-cols-3 px-3 py-2 font-mono text-[10px] text-muted-foreground uppercase border-b border-border/40">
                        <span>Name</span>
                        <span>Prefix</span>
                        <span className="text-right">Status</span>
                      </div>
                      <div className="grid grid-cols-3 px-3 py-2.5 items-center font-mono text-[11px]">
                        <span className="text-foreground font-sans font-medium">production-agent</span>
                        <span className="text-muted-foreground">kairo_live_demo…</span>
                        <span className="text-right text-emerald-500 flex items-center justify-end gap-1 font-sans">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── STEP 3: Store First Memory ── */}
              {activeStepId === "memory" && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between pb-3 border-b border-border/40">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Memory Explorer</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Manage and inspect persistent knowledge</p>
                    </div>
                    <button
                      type="button"
                      data-target="btn-add-memory"
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border border-primary/60 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-all",
                        hoveredTarget === "btn-add-memory" && "bg-primary text-primary-foreground"
                      )}
                    >
                      <Plus className="h-3 w-3" />
                      <span>Add Memory</span>
                    </button>
                  </div>

                  {/* Add Memory Modal Simulation */}
                  {memoryModalOpen && (
                    <div className="rounded-xl border border-border bg-surface-elevated p-4 shadow-xl space-y-3 animate-in zoom-in-95 duration-150">
                      <div className="text-xs font-semibold text-foreground border-b border-border/40 pb-2">
                        Create New Memory
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-mono uppercase text-muted-foreground block mb-1">
                            Actor ID
                          </label>
                          <div
                            data-target="input-memory-actor"
                            className={cn(
                              "rounded-md border border-border bg-background px-2.5 py-1 font-mono text-xs text-foreground flex items-center min-h-[28px]",
                              hoveredTarget === "input-memory-actor" && "border-primary"
                            )}
                          >
                            <span>{actorText}</span>
                            <span className="inline-block w-1.5 h-3 bg-primary ml-0.5 animate-pulse" />
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] font-mono uppercase text-muted-foreground block mb-1">
                            Type
                          </label>
                          <div className="rounded-md border border-border bg-background px-2.5 py-1 font-mono text-xs text-primary font-medium flex items-center justify-between min-h-[28px]">
                            <span>{memoryType}</span>
                            <span className="text-[10px] text-muted-foreground">▾</span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-mono uppercase text-muted-foreground block mb-1">
                          Memory Content
                        </label>
                        <div
                          data-target="input-memory-content"
                          className={cn(
                            "rounded-md border border-border bg-background px-3 py-1.5 font-sans text-xs text-foreground min-h-[44px] flex items-start",
                            hoveredTarget === "input-memory-content" && "border-primary"
                          )}
                        >
                          <span>{contentText}</span>
                          <span className="inline-block w-1.5 h-3.5 bg-primary ml-0.5 animate-pulse mt-0.5" />
                        </div>
                      </div>

                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          data-target="btn-store-memory-submit"
                          className={cn(
                            "rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-all",
                            hoveredTarget === "btn-store-memory-submit" && "ring-2 ring-primary/40 scale-95"
                          )}
                        >
                          Store Memory
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Stored Memory Specimen Card */}
                  {memoryCreated && (
                    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-2 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border bg-blue-500/10 text-blue-500 border-blue-500/20">
                            Preference
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">Actor: user_alex</span>
                        </div>
                        <span className="text-[11px] font-mono text-emerald-500 flex items-center gap-1 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Memory Stored
                        </span>
                      </div>
                      <p className="text-xs text-foreground font-sans font-medium">
                        &quot;I prefer PostgreSQL for new projects.&quot;
                      </p>
                      <div className="text-[10px] font-mono text-muted-foreground pt-1 border-t border-primary/15">
                        Indexed in pgvector · Isolated to tenant
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── STEP 4: Semantic Search ── */}
              {activeStepId === "search" && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between pb-3 border-b border-border/40">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Semantic Search</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Recall memories by natural language meaning</p>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">Actor: user_alex</span>
                  </div>

                  {/* Search Query Bar */}
                  <div className="flex items-center gap-2">
                    <div
                      data-target="input-search-query"
                      className={cn(
                        "flex-1 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono transition-colors",
                        hoveredTarget === "input-search-query" && "border-primary ring-1 ring-primary/30"
                      )}
                    >
                      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-foreground">{searchQueryText}</span>
                      <span className="inline-block w-1.5 h-3.5 bg-primary ml-0.5 animate-pulse" />
                    </div>

                    <button
                      type="button"
                      data-target="btn-run-search"
                      className={cn(
                        "rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-all shrink-0",
                        hoveredTarget === "btn-run-search" && "ring-2 ring-primary/40 scale-95"
                      )}
                    >
                      Search
                    </button>
                  </div>

                  {/* Highlighted Search Results */}
                  {searchExecuted && (
                    <div className="space-y-2 animate-in fade-in duration-200">
                      <div className="text-[10px] font-mono uppercase text-muted-foreground">
                        Retrieved Context (1 Result)
                      </div>

                      <div className="rounded-xl border border-primary/50 bg-primary/10 p-3.5 space-y-2 shadow-sm shadow-primary/5">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border bg-blue-500/10 text-blue-500 border-blue-500/20">
                            Preference
                          </span>
                          <span className="text-[10px] font-mono text-emerald-500 font-semibold">
                            Semantic Match
                          </span>
                        </div>
                        <p className="text-xs text-foreground font-sans font-medium">
                          &quot;I prefer PostgreSQL for new projects.&quot;
                        </p>
                        <div className="text-[10px] font-mono text-muted-foreground pt-1 border-t border-primary/20">
                          Matched query: &quot;What database do I prefer?&quot;
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── STEP 5: Connect Agent / MCP ── */}
              {activeStepId === "mcp" && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between pb-3 border-b border-border/40">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Model Context Protocol (MCP)</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Connect AI coding agents and desktop clients</p>
                    </div>
                    <button
                      type="button"
                      data-target="btn-test-tool-call"
                      className={cn(
                        "flex items-center gap-1 rounded bg-primary/10 border border-primary/30 px-2 py-1 text-[11px] font-mono text-primary transition-all",
                        hoveredTarget === "btn-test-tool-call" && "bg-primary text-primary-foreground"
                      )}
                    >
                      <span>Simulate Call</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Tool Call & Context Resolution Specimen */}
                  <div className="space-y-3 font-mono text-xs">
                    {/* Tool Invocation */}
                    <div className="rounded-lg border border-border/60 bg-background/80 p-3 space-y-1">
                      <div className="flex items-center justify-between text-primary font-semibold text-[11px]">
                        <span>⚡ Tool: kairo_recall</span>
                        <span className="text-[10px] text-muted-foreground">Actor: user_alex</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        query=&quot;database preference&quot;
                      </div>
                    </div>

                    {/* Agent Conversation Experience */}
                    <div className="rounded-lg border border-primary/30 bg-surface-elevated/80 p-3.5 space-y-2 font-sans">
                      <div className="text-[10px] font-mono uppercase text-muted-foreground flex items-center gap-1.5">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                        <span>AI Assistant Response with Recalled Context</span>
                      </div>
                      <p className="text-xs text-foreground leading-relaxed">
                        &quot;I remember that you prefer <span className="text-primary font-semibold">PostgreSQL</span> for new projects. I will initialize the service database accordingly.&quot;
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Mini Footer within Dashboard viewport */}
              <div className="pt-3 border-t border-border/30 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Database className="h-3 w-3 text-primary" />
                  Kairo Engine · PostgreSQL + pgvector
                </span>
                <span className="text-primary font-medium">
                  Step {DEMO_STEPS.findIndex((s) => s.id === activeStepId) + 1} of 5
                </span>
              </div>

            </main>

          </div>

        </div>

      </div>
    </section>
  )
}
