"use client";

import React, { useState } from "react";
import { useProject } from "@/providers/project-provider";
import { apiKeysApi } from "@/lib/api/apiKeysApi";
import { ApiKeyResponse, CreatedApiKeyResponse } from "@/types/apiKey";
import { ApiError } from "@/types/api";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/dashboard/status-banner";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LoadingState } from "@/components/dashboard/loading-state";
import { KeyRevealModal } from "@/components/dashboard/key-reveal-modal";
import {
  KeyRound,
  Plus,
  Ban,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  X,
  Shield,
} from "lucide-react";

// ─── Revoke confirmation modal ────────────────────────────────────────────────
function ConfirmRevokeModal({
  apiKey,
  onConfirm,
  onCancel,
  isLoading,
}: {
  apiKey: ApiKeyResponse;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface-elevated p-5 shadow-2xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-md bg-destructive/10 border border-destructive/20 flex items-center justify-center shrink-0">
            <Ban className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Revoke API Key</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Applications using{" "}
              <code className="font-mono text-foreground">{apiKey.keyPrefix}…</code> will
              immediately receive HTTP 401. This cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={isLoading} className="text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={isLoading}
            className="text-xs bg-destructive hover:bg-destructive/90 text-destructive-foreground gap-1.5"
          >
            {isLoading ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Revoking…</>
            ) : (
              <><Ban className="h-3.5 w-3.5" />Revoke Key</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function KeyStatusBadge({ isActive, expiresAt }: { isActive: boolean; expiresAt?: string | null }) {
  const isExpired = expiresAt && new Date(expiresAt) <= new Date();

  if (!isActive) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border bg-destructive/10 text-destructive border-destructive/20">
        <XCircle className="h-2.5 w-2.5" />
        revoked
      </span>
    );
  }
  if (isExpired) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-500 border-amber-500/20">
        <Clock className="h-2.5 w-2.5" />
        expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
      <CheckCircle2 className="h-2.5 w-2.5" />
      active
    </span>
  );
}

// ─── Create Key Panel ─────────────────────────────────────────────────────────
function CreateKeyPanel({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: number;
  onClose: () => void;
  onCreated: (key: CreatedApiKeyResponse) => void;
}) {
  const [keyName, setKeyName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await apiKeysApi.create({
        projectId,
        name: keyName.trim(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      onCreated(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate API key.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-surface-subtle/30">
        <span className="text-xs font-semibold text-foreground">Generate API Key</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        {error && (
          <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Label</label>
            <input
              type="text"
              required
              autoFocus
              placeholder="e.g. Production, Local Dev"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Expires (optional)</label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              className="w-full px-3 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={isSubmitting} className="text-xs">
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting || !keyName.trim()} className="text-xs gap-1.5">
            {isSubmitting ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating…</>
            ) : (
              <>Generate Key</>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ApiKeysPage() {
  const {
    selectedProject,
    projectApiKeys,
    isLoadingApiKeys,
    reloadApiKeys,
    setSessionApiKey,
  } = useProject();

  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [confirmRevokeKey, setConfirmRevokeKey] = useState<ApiKeyResponse | null>(null);
  const [createdKey, setCreatedKey] = useState<CreatedApiKeyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleRevoke = async (key: ApiKeyResponse) => {
    setRevokingId(key.apiKeyId);
    try {
      await apiKeysApi.revoke(key.apiKeyId);
      setSuccess(`Key "${key.name}" revoked.`);
      setConfirmRevokeKey(null);
      await reloadApiKeys();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to revoke API key.");
    } finally {
      setRevokingId(null);
    }
  };

  const handleKeyCreated = async (key: CreatedApiKeyResponse) => {
    setIsCreating(false);
    setCreatedKey(key);
    await reloadApiKeys();
  };

  if (!selectedProject) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">API Keys</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Provision and manage project API keys</p>
        </div>
        <EmptyState
          icon={KeyRound}
          title="No project selected"
          description="Select or create a project to manage its API keys."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">API Keys</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Project:{" "}
            <span className="font-medium text-foreground font-mono">{selectedProject.name}</span>
            {" · "}Bearer token authentication for Memory V1 API
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => { setIsCreating(!isCreating); setError(null); }}
          className="text-xs h-7 gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          {isCreating ? "Cancel" : "New Key"}
        </Button>
      </div>

      {/* ── Notifications ── */}
      <StatusBanner type="error" message={error} onDismiss={() => setError(null)} />
      <StatusBanner type="success" message={success} onDismiss={() => setSuccess(null)} />

      {/* ── One-time key reveal ── */}
      <KeyRevealModal
        createdKey={createdKey}
        onClose={() => setCreatedKey(null)}
        onSetAsSessionKey={(rawKey) => {
          setSessionApiKey(rawKey);
          setSuccess("Key loaded into ephemeral session state for testing.");
        }}
      />

      {/* ── Create Panel ── */}
      {isCreating && (
        <CreateKeyPanel
          projectId={selectedProject.projectId}
          onClose={() => setIsCreating(false)}
          onCreated={handleKeyCreated}
        />
      )}

      {/* ── Security notice ── */}
      <div className="flex items-start gap-2.5 text-[11px] text-muted-foreground">
        <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/60" />
        <span>
          Keys are shown in full exactly once on creation and are never stored in plaintext. Only prefixes are displayed here.
          Never commit raw keys to version control.
        </span>
      </div>

      {/* ── Keys table ── */}
      {isLoadingApiKeys ? (
        <LoadingState message="Loading API keys…" />
      ) : projectApiKeys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys provisioned"
          description="Generate an API key to authenticate Memory V1 and Chat Pipeline requests."
          actionLabel="Generate Key"
          onAction={() => setIsCreating(true)}
        />
      ) : (
        <div className="border border-border/60 rounded-lg overflow-hidden">
          {/* Column header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-4 py-2 border-b border-border/40 bg-surface-subtle/30 gap-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Name / Prefix</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-16 text-center">Status</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-20 text-right hidden sm:block">Created</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-20 text-right hidden md:block">Last Used</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-16 text-right">Action</span>
          </div>

          <div className="divide-y divide-border/30">
            {projectApiKeys.map((key) => (
              <div
                key={key.apiKeyId}
                className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-4 py-3 hover:bg-surface-subtle/20 transition-colors gap-4"
              >
                {/* Name / Prefix */}
                <div>
                  <div className="text-xs font-medium text-foreground">{key.name}</div>
                  <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                    {key.keyPrefix}…
                  </div>
                </div>

                {/* Status */}
                <div className="w-16 flex justify-center">
                  <KeyStatusBadge isActive={key.isActive} expiresAt={key.expiresAt} />
                </div>

                {/* Created */}
                <div className="hidden sm:block w-20 text-right">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Last Used */}
                <div className="hidden md:block w-20 text-right">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "never"}
                  </span>
                </div>

                {/* Action */}
                <div className="w-16 flex justify-end">
                  {key.isActive && (
                    <button
                      onClick={() => setConfirmRevokeKey(key)}
                      disabled={revokingId === key.apiKeyId}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Revoke key"
                    >
                      {revokingId === key.apiKeyId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Ban className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="px-4 py-2 border-t border-border/30 bg-surface-subtle/20">
            <span className="text-[10px] font-mono text-muted-foreground/50">
              GET /api/v1/api-keys · JWT authenticated
            </span>
          </div>
        </div>
      )}

      {/* ── Revoke modal ── */}
      {confirmRevokeKey && (
        <ConfirmRevokeModal
          apiKey={confirmRevokeKey}
          isLoading={revokingId === confirmRevokeKey.apiKeyId}
          onConfirm={() => handleRevoke(confirmRevokeKey)}
          onCancel={() => setConfirmRevokeKey(null)}
        />
      )}
    </div>
  );
}
