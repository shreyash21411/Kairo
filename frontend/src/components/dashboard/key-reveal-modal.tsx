"use client";

import React, { useState } from "react";
import { CreatedApiKeyResponse } from "@/types/apiKey";
import { Button } from "@/components/ui/button";
import { Copy, Check, AlertTriangle, ShieldCheck } from "lucide-react";

interface KeyRevealModalProps {
  createdKey: CreatedApiKeyResponse | null;
  onClose: () => void;
  onSetAsSessionKey?: (key: string) => void;
}

export function KeyRevealModal({
  createdKey,
  onClose,
  onSetAsSessionKey,
}: KeyRevealModalProps) {
  const [copied, setCopied] = useState(false);

  if (!createdKey) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(createdKey.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Save Your New Kairo API Key
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Key name: <span className="font-medium text-foreground">{createdKey.name}</span> (Project #{createdKey.projectId})
            </p>
          </div>
        </div>

        <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs text-amber-600 dark:text-amber-400 space-y-1">
          <p className="font-semibold">⚠️ This key will never be shown again.</p>
          <p className="text-muted-foreground leading-relaxed">
            The raw API key is a sensitive credential hashed on the server. If lost, you will need to revoke it and generate a new key.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-mono font-medium text-foreground">
            Secret Key Value
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 p-2.5 font-mono text-xs rounded-md border border-input bg-background/80 break-all select-all text-primary font-medium">
              {createdKey.apiKey}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="h-10 px-3 shrink-0"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-emerald-500 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-1" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-end gap-2 border-t border-border/50">
          {onSetAsSessionKey && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                onSetAsSessionKey(createdKey.apiKey);
                onClose();
              }}
              className="w-full sm:w-auto text-xs"
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
              Use in Session &amp; Close
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={onClose}
            className="w-full sm:w-auto text-xs"
          >
            I Have Saved This Key
          </Button>
        </div>
      </div>
    </div>
  );
}
