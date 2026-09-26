"use client";

import React from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

interface StatusBannerProps {
  type: "error" | "success" | "info";
  message: string | null;
  detail?: string | null;
  onDismiss?: () => void;
}

export function StatusBanner({
  type,
  message,
  detail,
  onDismiss,
}: StatusBannerProps) {
  if (!message) return null;

  const isError = type === "error";
  const isSuccess = type === "success";

  return (
    <div
      className={`p-3.5 rounded-lg border text-xs flex items-start justify-between gap-3 animate-in fade-in duration-150 ${
        isError
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : isSuccess
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-primary/30 bg-primary/10 text-primary"
      }`}
    >
      <div className="flex items-start gap-2.5">
        {isError ? (
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
        )}
        <div className="space-y-0.5">
          <p className="font-semibold">{message}</p>
          {detail && (
            <p className="text-muted-foreground opacity-90 leading-relaxed font-mono text-[11px]">
              {detail}
            </p>
          )}
        </div>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 opacity-70 hover:opacity-100 transition-opacity"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
