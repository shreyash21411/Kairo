"use client";

import React, { useState } from "react";
import { useProject } from "@/providers/project-provider";
import { KeyRound, ShieldAlert, Check, X, Loader2 } from "lucide-react";
import Link from "next/link";

export function SessionKeyBar() {
  const {
    sessionApiKey,
    sessionApiKeyError,
    isVerifyingKey,
    activateSessionApiKey,
    clearSessionApiKey,
    selectedProject,
    projectApiKeys,
  } = useProject();
  const [inputKey, setInputKey] = useState("");
  const [isInputOpen, setIsInputOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!selectedProject) return null;

  const handleActivate = async () => {
    const trimmed = inputKey.trim();
    if (!trimmed) {
      setLocalError("Please enter an API key.");
      return;
    }

    setLocalError(null);
    const result = await activateSessionApiKey(trimmed);
    if (result.success) {
      setInputKey("");
      setIsInputOpen(false);
      setLocalError(null);
    } else {
      setLocalError(result.error || "Failed to verify key.");
    }
  };

  const displayError = localError || sessionApiKeyError;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary shrink-0" />
          <div>
            <span className="font-semibold text-foreground">API Key Authentication: </span>
            {sessionApiKey ? (
              <span className="text-muted-foreground font-mono">
                Active key: <code className="text-foreground bg-muted px-1.5 py-0.5 rounded font-mono">{sessionApiKey.slice(0, 16)}...</code> (Session only)
              </span>
            ) : (
              <span className="text-muted-foreground">
                Memory operations require an active VOIDZONE API key for Project #{selectedProject.projectId} ({selectedProject.name}).
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {sessionApiKey ? (
            <button
              onClick={clearSessionApiKey}
              className="flex items-center gap-1 px-2 py-1 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              Clear Key
            </button>
          ) : isInputOpen ? (
            <div className="flex items-center gap-1.5">
              <input
                type="password"
                placeholder="vz_live_sec_..."
                value={inputKey}
                onChange={(e) => {
                  setInputKey(e.target.value);
                  if (localError) setLocalError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleActivate();
                  }
                }}
                disabled={isVerifyingKey}
                className="px-2.5 py-1 text-xs font-mono rounded border border-input bg-background w-56 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={handleActivate}
                disabled={isVerifyingKey || !inputKey.trim()}
                className="p-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
                title="Verify and activate key"
              >
                {isVerifyingKey ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={() => {
                  setIsInputOpen(false);
                  setLocalError(null);
                }}
                disabled={isVerifyingKey}
                className="p-1 rounded hover:bg-muted text-muted-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setIsInputOpen(true);
                  setLocalError(null);
                }}
                className="px-2.5 py-1 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 font-medium transition-colors cursor-pointer"
              >
                Provide API Key
              </button>
              <Link
                href="/dashboard/api-keys"
                className="px-2.5 py-1 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground font-medium transition-colors"
              >
                Manage Keys ({projectApiKeys.length})
              </Link>
            </div>
          )}
        </div>
      </div>

      {displayError && (
        <div className="flex items-start gap-2 p-2.5 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1 font-medium leading-relaxed">
            {displayError}
          </div>
          <button
            onClick={() => setLocalError(null)}
            className="text-destructive/70 hover:text-destructive cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
