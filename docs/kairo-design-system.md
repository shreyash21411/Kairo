# Kairo Design System

> **Mandatory Rule for Future Pages:**
> "Before creating a new Kairo page, inspect and reuse the existing Kairo Design System. Do not introduce new colors, fonts, icon libraries, radii, shadows, or spacing conventions unless the design system is intentionally extended."

This document establishes the frozen, centralized visual language and design token specifications for all Kairo user interfaces (Dashboard, Marketing, Developer Documentation, SDK References, MCP Pages, and Playground).

---

## 1. Single Source of Truth Architecture

The Kairo Design System is implemented across two synchronized layers without duplicated hardcoding:

1. **CSS Source of Truth**: [`frontend/src/app/globals.css`](file:///f:/AI-Memory-Platform/frontend/src/app/globals.css)
   - Native CSS custom properties (`--kairo-*`, `--background`, etc.)
   - Tailwind v4 `@theme` mappings (`--color-kairo-*`, `--radius-*`)
   - Semantic typography scale classes (`.text-display`, `.text-heading-xl`, etc.)
2. **TypeScript Runtime / Component Specs**: [`frontend/src/lib/design-system.ts`](file:///f:/AI-Memory-Platform/frontend/src/lib/design-system.ts)
   - Strongly-typed `KairoDesignSystem` object
   - Semantic icon assignments (Lucide React)
   - Semantic badge mappings for Memory Types (`code`, `architecture`, `decision`, `pattern`, etc.)
   - Surface style recipes (`card`, `cardInteractive`, `panel`, `input`, etc.)

---

## 2. Brand & Semantic Colors

The primary brand accent is **Kairo Blue** (`#3b5bf5` / `hsl(226 70% 58%)`).  
**Rule**: There is only **one Kairo Blue system** across all marketing pages, dashboard screens, and developer documentation.

### Core Color Palette Tokens

| Semantic Token | CSS Variable | Dark Theme (Primary) | Light Theme | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Canvas Background** | `--kairo-background` | `#09090b` (`hsl(240 10% 3.5%)`) | `#ffffff` | Page viewport background |
| **Elevated Canvas** | `--kairo-background-elevated` | `#0f0f12` | `#fcfcfd` | Section or modal underlays |
| **Surface** | `--kairo-surface` | `#18181b` (`hsl(240 5% 10%)`) | `#f4f4f5` | Cards, panels, toolbars |
| **Surface Elevated** | `--kairo-surface-elevated` | `#27272a` (`hsl(240 5% 15%)`) | `#e4e4e7` | Flyouts, popovers, dropdowns |
| **Primary Accent** | `--kairo-primary` | `#3b5bf5` (`hsl(226 70% 58%)`) | `#2551ec` | Main CTAs, active tabs, brand badges |
| **Primary Hover** | `--kairo-primary-hover` | `#4f6ef7` | `#1d44d6` | Hover state for primary buttons/links |
| **Primary Muted** | `--kairo-primary-muted` | `rgba(59, 91, 245, 0.12)` | `rgba(37, 81, 236, 0.10)` | Active tab/sidebar indicator, pill tint |
| **Text Primary** | `--kairo-text-primary` | `#fafafa` (`hsl(0 0% 98%)`) | `#09090b` | Headings, high-contrast labels |
| **Text Secondary** | `--kairo-text-secondary` | `#d4d4d8` (`hsl(240 5% 84%)`) | `#52525b` | Body text, readable secondary descriptions |
| **Text Muted** | `--kairo-text-muted` | `#a1a1aa` (`hsl(240 5% 65%)`) | `#71717a` | Captions, metadata, placeholders |
| **Border Subtle** | `--kairo-border-subtle` | `#1f1f23` | `#f0f0f2` | Inner dividers, table row borders |
| **Border** | `--kairo-border` | `#27272a` (`hsl(240 5% 15%)`) | `#e4e4e7` | Standard card and input hairline borders |
| **Border Strong** | `--kairo-border-strong` | `#3f3f46` | `#d4d4d8` | Hover card borders, focused inputs |
| **Success** | `--kairo-success` | `#22c55e` | `#16a34a` | Healthy status, verification checks, 200 OK |
| **Warning** | `--kairo-warning` | `#f59e0b` | `#d97706` | Pending state, rate limit caution, warning badges |
| **Danger** | `--kairo-danger` | `#ef4444` | `#dc2626` | Destructive actions, errors, 500 status |

---

## 3. Typography System

Kairo uses **Geist Sans** for UI/headings and **Geist Mono** for code and technical data.

- **Display / Heading Font**: Geist Sans (`var(--font-geist-sans)`, fallback `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`)
- **Body & UI Font**: Geist Sans
- **Monospace / Code Font**: Geist Mono (`var(--font-geist-mono)`, fallback `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas`)

### Typography Hierarchy Scale

| Semantic Style | Tailwind / CSS Utility | Size / Line Height | Weight | Letter Spacing | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display** | `.text-display` / `text-4xl md:text-5xl` | `2.5rem - 3.25rem` / `1.1` | Bold (`700`) | `-0.035em` | Hero marketing titles |
| **Heading XL** | `.text-heading-xl` / `text-2xl md:text-3xl`| `1.75rem - 2rem` / `1.2` | SemiBold (`600`) | `-0.025em` | Page titles, primary dashboard heads |
| **Heading LG** | `.text-heading-lg` / `text-xl` | `1.25rem` / `1.3` | SemiBold (`600`) | `-0.02em` | Section headers, card titles |
| **Heading MD** | `.text-heading-md` / `text-lg` | `1.125rem` / `1.35` | Medium (`500`) | `-0.015em` | Subsection titles, modal headers |
| **Body** | `.text-body` / `text-sm md:text-base` | `0.875rem - 1rem` / `1.6` | Regular (`400`) | `normal` | Primary documentation and long copy |
| **Body SM** | `.text-body-sm` / `text-xs md:text-sm` | `0.75rem - 0.875rem` / `1.5` | Regular (`400`) | `normal` | Secondary descriptions, list descriptions |
| **Label** | `.text-label` / `text-xs font-medium` | `0.75rem` / `1.4` | Medium (`500`) | `0.01em` | Form labels, table headers, tab titles |
| **Caption** | `.text-caption` / `text-[11px]` | `0.6875rem` / `1.3` | Regular (`400`) | `0.02em` | Timestamps, counters, footer fine print |
| **Code** | `.text-code` / `font-mono text-xs` | `0.75rem - 0.8125rem` / `1.5` | Regular (`400`) | `normal` | Inline code, memory hash keys, API endpoints |

---

## 4. Icon System

Kairo standardizes strictly on **`lucide-react`**.  
**Rule**: Do NOT introduce Font Awesome, Heroicons, or ad-hoc custom SVGs unless explicitly mandated for third-party brand logos (e.g. GitHub, Python, Discord).

### Standard Icon Specifications
- **Stroke Width**: `1.75` (or `1.5` for large decorative icons)
- **Sizing Scale**:
  - `xs`: `12px` (`h-3 w-3`) — Inline status tags, dropdown carets
  - `sm`: `14px` (`h-3.5 w-3.5`) — Buttons, breadcrumbs, table row actions
  - `md`: `16px` (`h-4 w-4`) — Standard navigation, card headers, input leading icons
  - `lg`: `20px` (`h-5 w-5`) — Section headers, feature highlights
  - `xl`: `24px` (`h-6 w-6`) — Marketing feature hero cards

### Standardized Semantic Mappings (`KairoDesignSystem.icons`)
```typescript
import { KairoDesignSystem } from "@/lib/design-system";

// Usage in components:
const MemoryIcon = KairoDesignSystem.icons.memory; // Database
const SearchIcon = KairoDesignSystem.icons.search; // Search
const ApiIcon = KairoDesignSystem.icons.api;       // Code2
const McpIcon = KairoDesignSystem.icons.mcp;       // Cpu
const SettingsIcon = KairoDesignSystem.icons.settings; // Settings
```

---

## 5. Radius System

Kairo avoids arbitrary radii like `rounded-[13px]` or `rounded-[19px]`. All components must adhere to the standard radius scale:

| Token | Class | Value | Usage |
| :--- | :--- | :--- | :--- |
| **`radius-xs`** | `rounded-xs` | `4px` / `0.25rem` | Tooltips, code chips, micro badges |
| **`radius-sm`** | `rounded-sm` | `6px` / `0.375rem` | Inputs, sub-items, small buttons |
| **`radius-md`** | `rounded-md` | `8px` / `0.5rem` | Standard buttons, select menus, dropdown items |
| **`radius-lg`** | `rounded-lg` | `10px` / `0.625rem` | Cards, panels, modal dialogs |
| **`radius-xl`** | `rounded-xl` | `14px` / `0.875rem` | Outer marketing hero cards, feature enclosures |
| **`radius-pill`** | `rounded-full` | `9999px` | Badges, avatars, status indicator dots |

---

## 6. Shadow System

Kairo favors clean, restrained hairline borders (`border border-kairo-border`) over heavy skeuomorphic shadows or exaggerated neon glows.

| Token | Class | Value | Usage |
| :--- | :--- | :--- | :--- |
| **`shadow-subtle`** | `shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.15)` | Subtle card elevation |
| **`shadow-card`** | `shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.2), 0 2px 4px -2px rgb(0 0 0 / 0.2)` | Interactive cards, hover states |
| **`shadow-overlay`** | `shadow-xl` | `0 20px 25px -5px rgb(0 0 0 / 0.3), 0 8px 10px -6px rgb(0 0 0 / 0.3)` | Dropdowns, popovers, command palette |
| **`shadow-modal`** | `shadow-2xl` | `0 25px 50px -12px rgb(0 0 0 / 0.45)` | Floating dialogs, modals |

---

## 7. Spacing & Layout Conventions

### Layout Containers
- **Dashboard Canvas**: `max-w-6xl` (`1152px`) centered with `mx-auto`
- **Marketing Page Content**: `max-w-6xl` (`1152px`) centered with `mx-auto`
- **Top Navigation Bar**: `max-w-5xl` (`1024px`) or `max-w-6xl` (`1152px`)
- **Documentation & SDK Guides**: `max-w-5xl` (`1024px`) with sticky sidebar (`260px`) + main content (`max-w-3xl`)
- **Focused Longform Reading**: `max-w-3xl` (`768px`)
- **Modals / Sheets**: `max-w-md` (`448px`) or `max-w-lg` (`512px`)

### Responsive Page Padding
- **Mobile (< 768px)**: `px-4 py-6`
- **Tablet (768px - 1024px)**: `px-6 py-8`
- **Desktop (>= 1024px)**: `px-8 py-10`

### Element Gap Conventions
- **Form stack**: `space-y-4` or `gap-4`
- **Card grid**: `grid gap-4 md:gap-6`
- **Button inline pair**: `gap-2.5` or `gap-3`
- **Section vertical spacing**: `py-16 md:py-24` (Marketing) / `space-y-8` (Dashboard)

---

## 8. Component Conventions

### Button (`frontend/src/components/ui/button.tsx`)
- **Primary**: `bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm rounded-md`
- **Secondary**: `bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md`
- **Outline**: `border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md`
- **Ghost**: `hover:bg-accent hover:text-accent-foreground rounded-md`
- **Sizes**: `sm` (`h-8 px-3 text-xs`), `default` (`h-9 px-4 py-2 text-sm`), `lg` (`h-10 px-8 text-base`), `icon` (`h-9 w-9`)

### Card (`frontend/src/components/ui/card.tsx`)
- **Base Style**: `rounded-lg border border-border bg-card text-card-foreground shadow-sm`
- **Interactive Variant**: `hover:border-kairo-border-strong hover:bg-kairo-surface/80 transition-colors`

### Input & Textarea (`frontend/src/components/ui/input.tsx`)
- **Base Style**: `h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50`

### Badges (`frontend/src/components/ui/badge.tsx`)
- Standard variants: `default`, `secondary`, `destructive`, `outline`
- Memory Type Badges (use `KairoDesignSystem.memoryTypes[type]`):
  - `code`: Cyan tint (`text-cyan-400 bg-cyan-950/40 border-cyan-800/40`)
  - `architecture`: Violet tint (`text-violet-400 bg-violet-950/40 border-violet-800/40`)
  - `decision`: Amber tint (`text-amber-400 bg-amber-950/40 border-amber-800/40`)
  - `pattern`: Emerald tint (`text-emerald-400 bg-emerald-950/40 border-emerald-800/40`)
  - `preference`: Pink tint (`text-pink-400 bg-pink-950/40 border-pink-800/40`)

### Code Block (`frontend/src/components/ui/code-block.tsx`)
- Jet-black surface (`bg-zinc-950` / `bg-[#0d0d10]`)
- Hairline border (`border border-zinc-800`)
- Header toolbar with language label, dot indicators, and one-click copy button

---

## 9. Dark Mode vs. Light Mode Behavior

1. **Dark Mode is Primary**: Kairo is built first as an engineering-focused dark environment. Default canvas is `#09090b`.
2. **Ambient Background is Marketing-Only**:
   - The moving soft blue light field (`AmbientBackground`) is strictly a **marketing visual layer** for the public landing page.
   - Do **NOT** attach full-page ambient animated blobs to developer documentation, settings pages, or dense dashboard views. Dashboard surfaces must remain crisp and readable with high contrast.
3. **Light Mode Consistency**:
   - Light mode is fully supported via CSS variables mapped under `:root` and `@theme`.
   - Never hardcode `#ffffff` or `#000000` directly in component JSX. Always use semantic Tailwind classes (`bg-background`, `text-foreground`, `border-border`, `bg-kairo-surface`).

---

## 10. Checklist for Creating New Pages

When developing any new page (e.g. SDK documentation, API references, MCP setup page):

- [ ] Import semantic constants and icon definitions from `@/lib/design-system`.
- [ ] Use `max-w-5xl` or `max-w-6xl` containers with standard responsive padding (`px-4 sm:px-6 lg:px-8`).
- [ ] Apply semantic color classes (`bg-kairo-background`, `bg-kairo-surface`, `text-kairo-text-primary`, `border-kairo-border`).
- [ ] Render icons exclusively from `lucide-react` with stroke `1.75`.
- [ ] Use existing shared primitives (`Button`, `Card`, `Badge`, `Input`, `CodeBlock`) rather than rebuilding one-off elements.
- [ ] Ensure dark mode and light mode render seamlessly without contrast regression.
