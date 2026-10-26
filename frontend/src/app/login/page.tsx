"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/types/api";
import {
  Lock,
  Mail,
  ArrowRight,
  Loader2,
  Eye,
  EyeOff,
  Shield,
  Layers,
  Cpu,
  ArrowLeft,
} from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      await login({ email: email.trim(), password });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Invalid email or password. Please verify your credentials.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-background text-foreground selection:bg-primary/20">
      {/* Left Column: Technical Infrastructure Editorial (Desktop) */}
      <div className="hidden lg:flex flex-col justify-between p-12 border-r border-border/60 bg-surface-elevated/40 relative overflow-hidden">
        {/* Subtle technical background grid */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
            backgroundSize: "24px 24px",
          }}
          aria-hidden="true"
        />

        {/* Brand Top Header */}
        <div className="relative z-10">
          <Link href="/" className="inline-flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity">
            <div className="h-6 w-6 rounded-[5px] bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Shield className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="font-semibold tracking-tight text-sm">VOIDZONE</span>
            <span className="text-[10px] font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-[4px] border border-border/50">
              v1.0
            </span>
          </Link>
        </div>

        {/* Technical Architecture Editorial Visualization */}
        <div className="relative z-10 my-auto max-w-md space-y-8">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-[10px] font-mono text-primary uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Developer Memory Subsystem
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground leading-snug">
              Persistent context for stateful AI agents and applications.
            </h1>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Store durable memories, resolve multi-tenant project actor partitions, and recall semantic context with deterministic reliability.
            </p>
          </div>

          {/* Infrastructure Flow Nodes */}
          <div className="p-4 rounded-md border border-border/70 bg-surface-subtle/40 font-mono text-[11px] space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-border/40 text-[10px] text-muted-foreground uppercase tracking-wider">
              <span>Pipeline Architecture</span>
              <span className="text-emerald-500 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </span>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5 text-foreground/90">
                <span className="text-[10px] text-muted-foreground/60 w-4">01</span>
                <span className="text-primary font-semibold">Agent Ingestion</span>
                <span className="text-[10px] text-muted-foreground truncate">Direct Memory Ingestion</span>
              </div>
              <div className="h-3 w-px bg-border/80 ml-5" />

              <div className="flex items-center gap-2.5 text-foreground/90">
                <span className="text-[10px] text-muted-foreground/60 w-4">02</span>
                <span className="text-foreground font-semibold">Vector Embedding</span>
                <span className="text-[10px] text-muted-foreground truncate">Mistral-embed (1024-d)</span>
              </div>
              <div className="h-3 w-px bg-border/80 ml-5" />

              <div className="flex items-center gap-2.5 text-foreground/90">
                <span className="text-[10px] text-muted-foreground/60 w-4">03</span>
                <span className="text-foreground font-semibold">Scope Derivation</span>
                <span className="text-[10px] text-muted-foreground truncate">ProjectId + ActorId</span>
              </div>
              <div className="h-3 w-px bg-border/80 ml-5" />

              <div className="flex items-center gap-2.5 text-foreground/90">
                <span className="text-[10px] text-muted-foreground/60 w-4">04</span>
                <span className="text-emerald-400 font-semibold">Semantic Recall</span>
                <span className="text-[10px] text-muted-foreground truncate">Cosine Similarity</span>
              </div>
            </div>
          </div>
        </div>

        {/* Telemetry Footer */}
        <div className="relative z-10 flex items-center justify-between text-[11px] font-mono text-muted-foreground/80 border-t border-border/40 pt-4">
          <span>PLATFORM: VOIDZONE Cloud</span>
          <span>PROTOCOL: REST + MCP</span>
        </div>
      </div>

      {/* Right Column: Authentication Form Canvas */}
      <div className="flex flex-col justify-between p-6 sm:p-12 md:p-16 lg:p-20">
        {/* Mobile Header / Back Link */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Home</span>
          </Link>
          <div className="lg:hidden flex items-center gap-1.5 font-semibold text-xs text-foreground">
            <Shield className="h-3.5 w-3.5 text-primary" />
            <span>VOIDZONE</span>
          </div>
        </div>

        {/* Center Form Container */}
        <div className="my-auto w-full max-w-sm mx-auto space-y-6">
          <div className="space-y-1.5">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Sign in to VOIDZONE
            </h2>
            <p className="text-xs text-muted-foreground">
              Enter your developer credentials to manage your workspaces, API keys, and memory scopes.
            </p>
          </div>

          {error && (
            <div className="p-3 text-xs rounded-md bg-destructive/10 text-destructive border border-destructive/25 flex items-start gap-2 animate-in fade-in duration-150">
              <span className="font-semibold shrink-0">Error:</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-foreground tracking-tight">
                Developer Email
              </label>
              <div className="relative">
                <Mail className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
                <Input
                  type="email"
                  required
                  placeholder="developer@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-8"
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-foreground tracking-tight">
                  Password
                </label>
              </div>
              <div className="relative">
                <Lock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
                <Input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-8 pr-8"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-2 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Authenticating...
                </>
              ) : (
                <>
                  Continue to Workspace
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </form>

          <div className="pt-2 border-t border-border/40 text-center text-xs text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="text-foreground font-medium underline underline-offset-4 hover:text-primary transition-colors"
            >
              Create a workspace
            </Link>
          </div>
        </div>

        {/* Footer Note */}
        <div className="text-center text-[11px] text-muted-foreground/60 font-mono">
          Single-flight JWT token session • Zero tracking telemetry
        </div>
      </div>
    </div>
  );
}
