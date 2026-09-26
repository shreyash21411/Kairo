/**
 * KAIRO DESIGN SYSTEM FOUNDATION
 * Phase 15.3A — Centralized Design Tokens & Semantic UI Configuration
 *
 * Source of truth for CSS variables: src/app/globals.css
 *
 * This module provides typed TypeScript constants, semantic mappings,
 * and icon definitions to guarantee visual consistency across:
 * - Marketing Landing Page
 * - Dashboard & Management Console
 * - Developer Documentation & API References
 * - SDK Guides (Python, Node.js)
 * - MCP Server Protocol Pages
 * - Interactive Playground & Memory Explorer
 *
 * RULE: Before creating a new Kairo page or component, inspect and reuse
 * this system. Do not invent new colors, fonts, radii, or icons.
 */

import React from "react";
import {
  Brain,
  Search,
  Terminal,
  KeyRound,
  BookOpen,
  MessageSquareCode,
  FolderGit2,
  Cpu,
  Layers,
  Shield,
  ShieldCheck,
  User,
  Plus,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Sparkles,
  Bot,
  Settings,
  Database,
  Lock,
  Code2,
  FileCode,
  Network,
  LogOut,
  Menu,
  X,
  ExternalLink,
  Sliders,
  Play,
  RotateCcw,
  Key,
} from "lucide-react";

export const KairoDesignSystem = {
  /* ── Brand Identity ─────────────────────────────────────────────────────── */
  brand: {
    name: "Kairo",
    version: "v1.0",
    tagline: "Persistent memory infrastructure for autonomous AI agents & applications",
    motto: "Durable · Scoped · Semantic",
    accentName: "Cobalt Engineering Blue",
    heroQueryPlaceholder: "What database setup did I say I wanted for new projects?",
  },

  /* ── Color System (References CSS variables in globals.css) ─────────────── */
  colors: {
    // Semantic tokens referencing globals.css
    background: "var(--kairo-background)",
    backgroundElevated: "var(--kairo-surface-elevated)",
    surface: "var(--kairo-surface)",
    surfaceElevated: "var(--kairo-surface-elevated)",
    primary: "var(--kairo-primary)",
    primaryHover: "var(--kairo-primary-hover)",
    primaryMuted: "var(--kairo-primary-muted)",
    textPrimary: "var(--kairo-text-primary)",
    textSecondary: "var(--kairo-text-secondary)",
    textMuted: "var(--kairo-text-muted)",
    border: "var(--kairo-border)",
    borderSubtle: "var(--kairo-border-subtle)",
    borderStrong: "var(--kairo-border-strong)",
    success: "var(--kairo-success)",
    warning: "var(--kairo-warning)",
    danger: "var(--kairo-danger)",

    // Foundation values (for documentation and non-CSS contexts)
    palette: {
      dark: {
        background: "#09090b", // near-black / graphite foundation
        surface: "#18181b",    // zinc-900
        surfaceElevated: "#111113",
        border: "#26262a",     // hairline border
        primary: "#3b5bf5",    // precision cobalt blue
        foreground: "#fafafa",
        muted: "#a1a1aa",      // zinc-400
      },
      light: {
        background: "#ffffff",
        surface: "#f4f4f5",    // zinc-100
        surfaceElevated: "#fafafa",
        border: "#e4e4e7",     // zinc-200
        primary: "#2551ec",    // cobalt 600
        foreground: "#09090b",
        muted: "#71717a",      // zinc-500
      },
    },

    // Memory type classifications (Restrained & Technical)
    memoryTypes: {
      Preference:   { color: "text-blue-500",    border: "border-blue-500/30",    bg: "bg-blue-500/10" },
      Fact:         { color: "text-amber-500",   border: "border-amber-500/30",   bg: "bg-amber-500/10" },
      Goal:         { color: "text-emerald-500", border: "border-emerald-500/30", bg: "bg-emerald-500/10" },
      Context:      { color: "text-purple-500",  border: "border-purple-500/30",  bg: "bg-purple-500/10" },
      Skill:        { color: "text-cyan-500",    border: "border-cyan-500/30",    bg: "bg-cyan-500/10" },
      Relationship: { color: "text-rose-500",    border: "border-rose-500/30",    bg: "bg-rose-500/10" },
    },
  },

  /* ── Typography Scale & Font Families ───────────────────────────────────── */
  typography: {
    fonts: {
      sans: "var(--font-sans)",
      mono: "var(--font-mono)",
    },
    // Standard font pairings
    display: "text-display",
    headingXl: "text-heading-xl",
    headingLg: "text-heading-lg",
    headingMd: "text-heading-md",
    body: "text-body",
    bodySm: "text-body-sm",
    label: "text-label",
    caption: "text-caption",
    code: "text-code",
  },

  /* ── Border Radius System ───────────────────────────────────────────────── */
  radius: {
    xs: "rounded-xs",     // 4px  - badges, micro tags, status dots
    sm: "rounded-sm",     // 6px  - buttons, inputs, dropdown items, tooltips
    md: "rounded-md",     // 8px  - cards, table cells, code blocks
    lg: "rounded-lg",     // 10px - larger modals, elevated containers
    xl: "rounded-xl",     // 12px - signature cards, hero visualizer
    pill: "rounded-full", // 9999px - floating nav, status pills, avatars
  },

  /* ── Shadow System (Restrained & Architectural) ─────────────────────────── */
  shadows: {
    xs: "shadow-xs",
    sm: "shadow-sm",
    md: "shadow-md",
    lg: "shadow-lg",
    pill: "shadow-lg shadow-black/8",
  },

  /* ── Layout Conventions ─────────────────────────────────────────────────── */
  layout: {
    maxWidth: {
      dashboard: "max-w-6xl",      // 1152px - primary dashboard canvas
      marketing: "max-w-6xl",      // 1152px - marketing section container
      navbar: "max-w-5xl",         // 1024px - floating pill navbar
      documentation: "max-w-5xl",  // 1024px - docs layout container
      readingColumn: "max-w-3xl",  // 768px  - prose, guides, markdown
      modal: "max-w-md",           // 448px  - dialogs, key reveal
    },
    padding: {
      pageMobile: "px-4",
      pageDesktop: "px-6 lg:px-8",
      dashboardMain: "p-4 sm:p-6 lg:p-8",
      card: "p-4 sm:p-6",
      cardHeader: "p-4 sm:p-6 pb-2",
      section: "py-24 md:py-32",
    },
    gap: {
      section: "space-y-8",
      cardGrid: "gap-4 sm:gap-6",
      formRow: "gap-3 sm:gap-4",
      itemRow: "gap-2.5",
    },
  },

  /* ── Icon Standardization (Lucide React) ────────────────────────────────── */
  icons: {
    strokeWidth: 1.75,
    sizes: {
      xs: "h-3 w-3",
      sm: "h-3.5 w-3.5",
      md: "h-4 w-4",
      lg: "h-5 w-5",
      xl: "h-6 w-6",
    },
    semantic: {
      // Platform & Domain
      memory: Brain,
      search: Search,
      playground: Terminal,
      apiKeys: KeyRound,
      chat: MessageSquareCode,
      docs: BookOpen,
      project: FolderGit2,
      actor: User,
      security: Shield,
      securityVerified: ShieldCheck,
      mcp: Cpu,
      restApi: Terminal,
      python: FileCode,
      node: Code2,
      database: Database,
      vector: Network,
      layers: Layers,

      // Actions & Controls
      plus: Plus,
      arrowRight: ArrowRight,
      chevronRight: ChevronRight,
      chevronDown: ChevronDown,
      copy: Copy,
      check: Check,
      checkCircle: CheckCircle2,
      alert: AlertCircle,
      help: HelpCircle,
      sparkles: Sparkles,
      bot: Bot,
      settings: Settings,
      lock: Lock,
      logout: LogOut,
      menu: Menu,
      close: X,
      external: ExternalLink,
      sliders: Sliders,
      play: Play,
      reset: RotateCcw,
      key: Key,
    },
  },

  /* ── Reusable Component Surface Recipes ─────────────────────────────────── */
  surfaces: {
    // Standard dashboard card surface
    card: "rounded-lg border border-border/80 bg-surface-elevated/60 text-card-foreground shadow-xs",
    // Subdued card or panel
    cardSubtle: "rounded-lg border border-border/60 bg-surface-subtle/40 text-card-foreground",
    // Marketing translucent glass card
    cardGlass: "rounded-xl border border-border/60 bg-card/60 backdrop-blur-xl shadow-sm shadow-black/5",
    // Telemetry metric strip
    metricStrip: "grid grid-cols-2 md:grid-cols-4 rounded-lg border border-border/80 bg-surface-elevated/60 divide-y md:divide-y-0 md:divide-x divide-border/60 overflow-hidden",
    // Code block container
    codeBlock: "overflow-hidden rounded-md border border-border/80 bg-surface-elevated font-mono text-[12px] text-foreground shadow-xs",
  },
} as const;

export type KairoDesignSystemType = typeof KairoDesignSystem;
