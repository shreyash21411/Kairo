"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { useProject } from "@/providers/project-provider";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { CommandMenu } from "@/components/ui/command-menu";
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
  LogOut,
  Menu,
  X,
  Shield,
  User,
  ChevronRight,
  Key,
  Edit2,
  Check,
} from "lucide-react";

interface NavLink {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const WORKSPACE_NAV: NavLink[] = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Memories", href: "/dashboard/memories", icon: Brain },
  { name: "Semantic Search", href: "/dashboard/search", icon: Search },
  { name: "Playground", href: "/dashboard/playground", icon: Terminal },
];

const DEVELOP_NAV: NavLink[] = [
  { name: "API Keys", href: "/dashboard/api-keys", icon: KeyRound },
  { name: "Chat Pipeline", href: "/dashboard/chat", icon: MessageSquareCode },
  { name: "API Reference", href: "/dashboard/docs", icon: BookOpen },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const {
    projects,
    selectedProject,
    selectProject,
    sessionApiKey,
    activeActorId,
    setActiveActorId,
  } = useProject();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  // Quick actor edit in top bar
  const [isEditingActor, setIsEditingActor] = useState(false);
  const [tempActor, setTempActor] = useState(activeActorId);

  // Global ⌘K shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSaveActor = () => {
    if (tempActor.trim()) {
      setActiveActorId(tempActor.trim());
    } else {
      setTempActor(activeActorId);
    }
    setIsEditingActor(false);
  };

  // Determine breadcrumb page title
  const getPageTitle = () => {
    if (pathname === "/dashboard") return "Overview";
    if (pathname === "/dashboard/memories") return "Memories";
    if (pathname === "/dashboard/search") return "Semantic Search";
    if (pathname === "/dashboard/playground") return "Playground";
    if (pathname === "/dashboard/projects") return "Projects";
    if (pathname === "/dashboard/api-keys") return "API Keys";
    if (pathname === "/dashboard/chat") return "Chat Pipeline";
    if (pathname === "/dashboard/docs") return "Documentation";
    return "Workspace";
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row antialiased">
      {/* ⌘K Command Palette */}
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />

      {/* Mobile Top Navigation Header */}
      <header className="md:hidden flex items-center justify-between px-4 h-12 border-b border-border bg-surface-elevated sticky top-0 z-40">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight text-xs">
          <div className="h-5 w-5 rounded-[4px] bg-primary/20 border border-primary/40 flex items-center justify-center">
            <Shield className="h-3 w-3 text-primary" />
          </div>
          <span>Kairo</span>
          <span className="text-[10px] font-mono text-muted-foreground">v1.0</span>
        </Link>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCommandOpen(true)}
            className="p-1.5 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-muted/60 text-xs font-mono flex items-center gap-1"
            title="Command Menu"
          >
            ⌘K
          </button>
          <ThemeToggle />
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 rounded-[5px] hover:bg-muted text-foreground"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Sidebar for Desktop & Mobile Overlay */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 border-r border-border bg-surface-elevated flex flex-col transition-transform duration-150 ease-in-out md:static md:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar Header: Brand & Status */}
        <div className="h-12 px-4 border-b border-border/60 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-xs text-foreground">
            <div className="h-5 w-5 rounded-[4px] bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Shield className="h-3 w-3 text-primary" />
            </div>
            <span>Kairo</span>
            <span className="text-[9px] font-mono text-muted-foreground bg-muted/60 px-1 py-0.2 rounded border border-border/40">
              v1.0
            </span>
          </Link>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="md:hidden p-1 rounded-[5px] hover:bg-muted text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Project Context Switcher */}
        <div className="px-3 pt-3 pb-2 border-b border-border/40 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground uppercase tracking-wider px-1">
            <span>Project</span>
            <Link
              href="/dashboard/projects"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-primary transition-colors flex items-center gap-0.5"
              title="Manage projects"
            >
              <Plus className="h-3 w-3" />
              <span>New</span>
            </Link>
          </div>

          <div className="relative">
            <select
              value={selectedProject?.projectId ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value);
                const match = projects.find((p) => p.projectId === id);
                selectProject(match ?? null);
              }}
              className="w-full pl-7 pr-6 py-1.5 text-xs font-medium rounded-md border border-border/80 bg-surface-subtle/70 text-foreground hover:border-border focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer transition-colors truncate"
            >
              {projects.length === 0 ? (
                <option value="">No Projects Found</option>
              ) : (
                projects.map((p) => (
                  <option key={p.projectId} value={p.projectId}>
                    {p.name}
                  </option>
                ))
              )}
            </select>
            <FolderGit2 className="absolute left-2.5 top-2.5 h-3 w-3 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 px-2.5 py-3 space-y-4 overflow-y-auto">
          {/* Workspace Section */}
          <div className="space-y-0.5">
            <div className="px-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
              Workspace
            </div>
            {WORKSPACE_NAV.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-[5px] text-xs transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground font-medium shadow-2xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </div>

          {/* Develop Section */}
          <div className="space-y-0.5">
            <div className="px-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
              Develop
            </div>
            {DEVELOP_NAV.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-[5px] text-xs transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground font-medium shadow-2xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Sidebar Footer: User Account */}
        <div className="p-2.5 border-t border-border/50 bg-surface-subtle/30 space-y-1.5">
          {user && (
            <div className="px-2 py-1 rounded-[5px] text-[11px] font-mono text-muted-foreground truncate flex items-center justify-between">
              <span className="truncate">{user.email}</span>
            </div>
          )}

          <button
            onClick={() => logout()}
            className="w-full flex items-center gap-2 px-2 py-1 rounded-[5px] text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Command Bar */}
        <div className="h-12 border-b border-border/60 bg-surface-elevated/40 backdrop-blur-xs px-4 sm:px-6 hidden md:flex items-center justify-between gap-4">
          {/* Left Breadcrumb Context */}
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="text-foreground">Kairo</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-foreground font-semibold">
              {selectedProject?.name || "No Project"}
            </span>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-muted-foreground">{getPageTitle()}</span>
          </div>

          {/* Right Controls: Actor Scope + Session Key + ⌘K + Theme */}
          <div className="flex items-center gap-3">
            {/* Actor Scope Pill */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-[5px] border border-border/70 bg-surface-subtle/60 text-[11px] font-mono">
              <User className="h-3 w-3 text-primary shrink-0" />
              <span className="text-muted-foreground">actor:</span>
              {isEditingActor ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={tempActor}
                    onChange={(e) => setTempActor(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveActor()}
                    className="w-20 px-1 py-0.2 text-[11px] font-mono rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveActor}
                    className="p-0.5 hover:text-foreground text-muted-foreground"
                    title="Save actor ID"
                  >
                    <Check className="h-3 w-3 text-emerald-400" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setTempActor(activeActorId);
                    setIsEditingActor(true);
                  }}
                  className="font-medium text-foreground hover:underline flex items-center gap-1"
                  title="Click to edit actor scope"
                >
                  <span>{activeActorId}</span>
                  <Edit2 className="h-2.5 w-2.5 text-muted-foreground/60" />
                </button>
              )}
            </div>

            {/* Session API Key Readiness Indicator */}
            <Link
              href="/dashboard/api-keys"
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-[5px] border text-[11px] font-mono transition-colors ${
                sessionApiKey
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:border-amber-500/50"
              }`}
              title={
                sessionApiKey
                  ? "Active API Key in session"
                  : "No API Key loaded. Click to configure."
              }
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  sessionApiKey ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
                }`}
              />
              <span>{sessionApiKey ? "Key Ready" : "Key Required"}</span>
            </Link>

            {/* Command Palette Trigger */}
            <button
              onClick={() => setCommandOpen(true)}
              className="flex items-center gap-2 px-2 py-1 rounded-[5px] border border-border/70 bg-surface-subtle/50 text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-colors font-mono"
            >
              <span>Search</span>
              <kbd className="px-1 py-0.2 rounded text-[9px] bg-muted border border-border/60">
                ⌘K
              </kbd>
            </button>

            <ThemeToggle />
          </div>
        </div>

        {/* Page Content Canvas */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          <div className="max-w-6xl mx-auto space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
