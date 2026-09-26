"use client";

import React, { useState } from "react";
import { useProject } from "@/providers/project-provider";
import { KeyRound, ShieldAlert, Check, X } from "lucide-react";
import Link from "next/link";

export function SessionKeyBar() {
  const { sessionApiKey, setSessionApiKey, selectedProject, projectApiKeys } = useProject();
  const [inputKey, setInputKey] = useState("");
  const [isInputOpen, setIsInputOpen] = useState(false);

  if (!selectedProject) return null;

  return (
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
              Memory &amp; Chat operations require an active API key for Project #{selectedProject.projectId}.
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {sessionApiKey ? (
          <button
            onClick={() => setSessionApiKey(null)}
            className="flex items-center gap-1 px-2 py-1 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            Clear Key
          </button>
        ) : isInputOpen ? (
          <div className="flex items-center gap-1.5">
            <input
              type="password"
              placeholder="kairo_live_..."
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              className="px-2.5 py-1 text-xs font-mono rounded border border-input bg-background w-48 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={() => {
                if (inputKey.trim().startsWith("kairo_live_")) {
                  setSessionApiKey(inputKey.trim());
                  setInputKey("");
                  setIsInputOpen(false);
                }
              }}
              className="p-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
              title="Use key"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setIsInputOpen(false)}
              className="p-1 rounded hover:bg-muted text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsInputOpen(true)}
              className="px-2.5 py-1 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 font-medium transition-colors"
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
  );
}
