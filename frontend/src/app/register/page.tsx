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
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      await register({ email: email.trim(), password });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Account creation failed. Please check your details and try again.");
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
              Infrastructure Onboarding
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground leading-snug">
              Build intelligent applications that remember.
            </h1>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Provision your isolated developer account with instant default project initialization and hardware-accelerated embedding pipelines.
            </p>
          </div>

          {/* Infrastructure Guarantee Checklist */}
          <div className="p-4 rounded-md border border-border/70 bg-surface-subtle/40 font-mono text-[11px] space-y-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider pb-1.5 border-b border-border/40">
              Core Guarantees
            </div>

            <div className="space-y-2">
              <div className="flex items-start gap-2 text-foreground/90">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Deterministic Tenant Isolation</span>
                  <div className="text-[10px] text-muted-foreground font-sans">
                    Zero cross-project or cross-actor memory data leakage.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 text-foreground/90">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Dual Authentication Boundary</span>
                  <div className="text-[10px] text-muted-foreground font-sans">
                    Control Plane (JWT) isolated from Data Plane API keys.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 text-foreground/90">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Mistral Vector Pipeline</span>
                  <div className="text-[10px] text-muted-foreground font-sans">
                    Synchronous embeddings generation with deduplication engine.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Telemetry Footer */}
        <div className="relative z-10 flex items-center justify-between text-[11px] font-mono text-muted-foreground/80 border-t border-border/40 pt-4">
          <span>SEC: PBKDF2 HMAC-SHA512</span>
          <span>SCOPES: (PROJECT, ACTOR)</span>
        </div>
      </div>

      {/* Right Column: Registration Form Canvas */}
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
              Create your workspace
            </h2>
            <p className="text-xs text-muted-foreground">
              Get started with persistent AI memory infrastructure in seconds.
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
              <label className="text-[11px] font-medium text-foreground tracking-tight">
                Master Password
              </label>
              <div className="relative">
                <Lock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
                <Input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-8 pr-8"
                  autoComplete="new-password"
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

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-foreground tracking-tight">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
                <Input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-8"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Provisioning Workspace...
                </>
              ) : (
                <>
                  Create Account &amp; Workspace
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </form>

          <div className="pt-2 border-t border-border/40 text-center text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-foreground font-medium underline underline-offset-4 hover:text-primary transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>

        {/* Footer Note */}
        <div className="text-center text-[11px] text-muted-foreground/60 font-mono">
          Automatic default project creation • PBKDF2 encrypted identity
        </div>
      </div>
    </div>
  );
}
