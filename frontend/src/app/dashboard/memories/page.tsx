"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useProject } from "@/providers/project-provider";
import { memoriesApi } from "@/lib/api/memoriesApi";
import {
  CreateMemoryOutcome,
  MemoryListItem,
  MemoryResponse,
  MemoryType,
  VALID_MEMORY_TYPES,
} from "@/types/memory";
import { ApiError } from "@/types/api";
import { Button } from "@/components/ui/button";
import { SessionKeyBar } from "@/components/dashboard/session-key-bar";
import { StatusBanner } from "@/components/dashboard/status-banner";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LoadingState } from "@/components/dashboard/loading-state";
import {
  Brain,
  Plus,
  Trash2,
  Edit,
  Eye,
  AlertTriangle,
  Loader2,
  RefreshCw,
  X,
  Clock,
  User,
  Save,
  ChevronRight,
  Activity,
} from "lucide-react";

// ─── Memory Type Color Map ────────────────────────────────────────────────────
const MEMORY_TYPE_STYLES: Record<string, string> = {
  Preference:   "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Fact:         "bg-amber-500/10 text-amber-500 border-amber-500/20",
  Goal:         "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  Context:      "bg-purple-500/10 text-purple-500 border-purple-500/20",
  Skill:        "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  Relationship: "bg-rose-500/10 text-rose-500 border-rose-500/20",
};

function MemoryTypeBadge({ type }: { type: string }) {
  const style = MEMORY_TYPE_STYLES[type] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${style}`}>
      {type}
    </span>
  );
}

function formatRelativeTime(date: string) {
  const d = new Date(date);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

// ─── Deactivate Confirmation Modal ───────────────────────────────────────────
function ConfirmDeactivateModal({
  memoryId,
  onConfirm,
  onCancel,
  isLoading,
}: {
  memoryId: number;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface-elevated p-5 shadow-2xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-md bg-destructive/10 border border-destructive/20 flex items-center justify-center shrink-0">
            <Trash2 className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Deactivate Memory #{memoryId}</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              This memory will be soft-deactivated and excluded from recall and search.
              The record is preserved for audit purposes and can be restored via the API.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={isLoading} className="text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={isLoading}
            className="text-xs bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            {isLoading ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Deactivating…</>
            ) : (
              "Deactivate"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Memory Detail Drawer ─────────────────────────────────────────────────────
function MemoryDetailDrawer({
  memory,
  onClose,
  onEdit,
  onDeactivate,
}: {
  memory: MemoryResponse;
  onClose: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Scrim */}
      <div className="flex-1 bg-background/60 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer panel */}
      <div className="w-full max-w-md bg-surface-elevated border-l border-border flex flex-col h-full overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs font-semibold text-muted-foreground">MEM</span>
            <span className="font-mono text-sm font-bold text-foreground">#{memory.memoryId}</span>
            <MemoryTypeBadge type={memory.memoryType || "Other"} />
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Memory Content */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Content</div>
            <p className="text-sm text-foreground leading-relaxed font-sans">
              {memory.content}
            </p>
          </div>

          <div className="border-t border-border/40" />

          {/* Metadata grid */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Metadata</div>
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs text-muted-foreground">Status</span>
                <span className={`text-xs font-mono font-medium ${memory.isActive ? "text-emerald-500" : "text-muted-foreground line-through"}`}>
                  {memory.isActive ? "active" : "deactivated"}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs text-muted-foreground">Type</span>
                <MemoryTypeBadge type={memory.memoryType || "Other"} />
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Created
                </span>
                <span className="text-xs font-mono text-foreground">
                  {new Date(memory.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Activity className="h-3 w-3" /> Updated
                </span>
                <span className="text-xs font-mono text-foreground">
                  {new Date(memory.updatedAt).toLocaleString()}
                </span>
              </div>

            </div>
          </div>


        </div>

        {/* Actions footer */}
        <div className="px-5 py-3.5 border-t border-border/60 flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onEdit} className="text-xs gap-1.5">
            <Edit className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDeactivate}
            className="text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 ml-auto"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Deactivate
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Memory Modal ────────────────────────────────────────────────────────
function EditMemoryModal({
  memory,
  onClose,
  onSave,
  isLoading,
}: {
  memory: MemoryListItem;
  onClose: () => void;
  onSave: (content: string, type: MemoryType) => Promise<void>;
  isLoading: boolean;
}) {
  const [content, setContent] = useState(memory.content);
  const [type, setType] = useState<MemoryType>((memory.memoryType as MemoryType) || "Preference");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(content.trim(), type);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface-elevated shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Edit Memory #{memory.memoryId}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Updating archives current state and regenerates embeddings.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Content</label>
            <textarea
              required
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring font-sans leading-relaxed resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Memory Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MemoryType)}
              className="w-full px-3 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {VALID_MEMORY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/40">
            <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={isLoading} className="text-xs">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isLoading || !content.trim()} className="text-xs gap-1.5">
              {isLoading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Updating…</>
              ) : (
                <><Save className="h-3.5 w-3.5" />Save Changes</>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Create Memory Panel ──────────────────────────────────────────────────────
function CreateMemoryPanel({
  activeActorId,
  onClose,
  onCreated,
  sessionApiKey,
}: {
  activeActorId: string;
  onClose: () => void;
  onCreated: () => void;
  sessionApiKey: string;
}) {
  const [content, setContent] = useState("");
  const [type, setType] = useState<MemoryType>("Preference");
  const [actorId, setActorId] = useState(activeActorId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !actorId.trim()) {
      setError("Content and Actor ID are required.");
      return;
    }
    setError(null);
    setDuplicateNotice(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const outcome: CreateMemoryOutcome = await memoriesApi.create(sessionApiKey, {
        content: content.trim(),
        memoryType: type,
        actorId: actorId.trim(),
      });

      if (outcome.isDuplicate) {
        setDuplicateNotice(`Deduplication triggered — ${outcome.duplicate.reason}`);
      } else {
        setSuccess(`Memory #${outcome.memory.memoryId} stored and embedded.`);
        setTimeout(() => {
          onCreated();
          onClose();
        }, 1000);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create memory.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-surface-subtle/30">
        <span className="text-xs font-semibold text-foreground">Store Memory</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}
        {duplicateNotice && (
          <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span><strong>Deduplicated:</strong> {duplicateNotice}</span>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
            <Activity className="h-3.5 w-3.5 shrink-0" />
            {success}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Content</label>
          <textarea
            required
            rows={3}
            placeholder="e.g. User prefers Python for backend development and uses VS Code with the Dracula theme."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring font-sans leading-relaxed resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MemoryType)}
              className="w-full px-3 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {VALID_MEMORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground flex items-center gap-1">
              <User className="h-3 w-3 text-muted-foreground" />
              Actor ID
            </label>
            <input
              type="text"
              required
              placeholder="user-123"
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={isSubmitting} className="text-xs">
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting || !content.trim() || !actorId.trim()} className="text-xs gap-1.5">
            {isSubmitting ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Embedding…</>
            ) : (
              <>Store Memory</>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MemoriesPage() {
  const { selectedProject, sessionApiKey, activeActorId } = useProject();

  const [memories, setMemories] = useState<MemoryListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Panels/Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [inspectingMemory, setInspectingMemory] = useState<MemoryResponse | null>(null);
  const [isLoadingInspect, setIsLoadingInspect] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryListItem | null>(null);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);

  const fetchMemories = useCallback(async () => {
    if (!sessionApiKey) { setMemories([]); return; }
    setIsLoading(true);
    setError(null);
    try {
      const data = await memoriesApi.list(sessionApiKey);
      setMemories(data.memories || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load project memories.");
      setMemories([]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionApiKey]);

  useEffect(() => { fetchMemories(); }, [fetchMemories, selectedProject]);

  const handleInspect = async (memoryId: number) => {
    if (!sessionApiKey) return;
    setIsLoadingInspect(true);
    try {
      const full = await memoriesApi.getById(sessionApiKey, memoryId);
      setInspectingMemory(full);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to fetch memory.");
    } finally {
      setIsLoadingInspect(false);
    }
  };

  const handleUpdate = async (content: string, type: MemoryType) => {
    if (!sessionApiKey || !editingMemory) return;
    setIsSubmittingEdit(true);
    try {
      const updated = await memoriesApi.update(sessionApiKey, editingMemory.memoryId, { content, memoryType: type });
      setSuccess(`Memory #${updated.memoryId} updated. Historical state archived.`);
      setEditingMemory(null);
      // Close detail drawer if open for same memory
      if (inspectingMemory?.memoryId === editingMemory.memoryId) setInspectingMemory(null);
      await fetchMemories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update memory.");
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleDeactivate = async (memoryId: number) => {
    if (!sessionApiKey) return;
    setDeactivatingId(memoryId);
    try {
      const res = await memoriesApi.delete(sessionApiKey, memoryId);
      setSuccess(res.message || `Memory #${memoryId} deactivated.`);
      setConfirmDeactivateId(null);
      if (inspectingMemory?.memoryId === memoryId) setInspectingMemory(null);
      await fetchMemories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to deactivate memory.");
    } finally {
      setDeactivatingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">Memories</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Project:{" "}
            <span className="font-medium text-foreground font-mono">
              {selectedProject?.name ?? "—"}
            </span>
            {" · "}memory records scoped via API key
          </p>
        </div>

        <div className="flex items-center gap-2">
          {sessionApiKey && (
            <Button
              size="sm"
              variant="ghost"
              onClick={fetchMemories}
              disabled={isLoading}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => { setIsCreateOpen(!isCreateOpen); setError(null); }}
            disabled={!sessionApiKey}
            className="text-xs h-7 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {isCreateOpen ? "Cancel" : "Add Memory"}
          </Button>
        </div>
      </div>

      {/* ── API Key Bar ── */}
      <SessionKeyBar />

      {/* ── Notifications ── */}
      <StatusBanner type="error" message={error} onDismiss={() => setError(null)} />
      <StatusBanner type="success" message={success} onDismiss={() => setSuccess(null)} />

      {/* ── Create Memory Panel (inline, no card nesting) ── */}
      {isCreateOpen && sessionApiKey && (
        <CreateMemoryPanel
          activeActorId={activeActorId}
          sessionApiKey={sessionApiKey}
          onClose={() => setIsCreateOpen(false)}
          onCreated={fetchMemories}
        />
      )}

      {/* ── Memory Data Browser ── */}
      {!sessionApiKey ? (
        <EmptyState
          icon={Brain}
          title="API Key Required"
          description="Provide a project API key to view and manage durable memory records."
        />
      ) : isLoading ? (
        <LoadingState message="Fetching project memories…" />
      ) : memories.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="No memories stored"
          description={`No active memories found for this project. Add a memory to get started.`}
          actionLabel="Add Memory"
          onAction={() => setIsCreateOpen(true)}
        />
      ) : (
        <div className="border border-border/60 rounded-lg overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-2 border-b border-border/40 bg-surface-subtle/30">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Content</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hidden sm:block w-20 text-center">Type</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hidden md:block w-24 text-right">Created</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-24 text-right">Actions</span>
          </div>

          {/* Memory rows */}
          <div className="divide-y divide-border/30">
            {memories.map((m) => (
              <div
                key={m.memoryId}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-3 hover:bg-surface-subtle/20 transition-colors group"
              >
                {/* Content column */}
                <div className="min-w-0 pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[10px] text-muted-foreground">#{m.memoryId}</span>
                    <span className="sm:hidden">
                      <MemoryTypeBadge type={m.memoryType || "Other"} />
                    </span>
                  </div>
                  <p className="text-xs text-foreground leading-relaxed line-clamp-2 font-sans">
                    {m.content}
                  </p>
                </div>

                {/* Type column */}
                <div className="hidden sm:flex w-20 justify-center">
                  <MemoryTypeBadge type={m.memoryType || "Other"} />
                </div>

                {/* Created column */}
                <div className="hidden md:flex w-24 justify-end">
                  <span className="text-[10px] font-mono text-muted-foreground" title={new Date(m.createdAt).toLocaleString()}>
                    {formatRelativeTime(m.createdAt)}
                  </span>
                </div>

                {/* Actions column */}
                <div className="flex items-center gap-0.5 justify-end w-24">
                  <button
                    onClick={() => handleInspect(m.memoryId)}
                    disabled={isLoadingInspect}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                    title="Inspect"
                  >
                    {isLoadingInspect ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={() => setEditingMemory(m)}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                    title="Edit"
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setConfirmDeactivateId(m.memoryId)}
                    className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                    title="Deactivate"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleInspect(m.memoryId)}
                    className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                    title="View details"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-border/30 bg-surface-subtle/20 flex items-center justify-between">
            <span className="text-[10px] font-mono text-muted-foreground">
              {memories.length} active record{memories.length !== 1 ? "s" : ""}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground/50 hidden sm:block">
              GET /api/v1/memories
            </span>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {confirmDeactivateId !== null && (
        <ConfirmDeactivateModal
          memoryId={confirmDeactivateId}
          isLoading={deactivatingId === confirmDeactivateId}
          onConfirm={() => handleDeactivate(confirmDeactivateId)}
          onCancel={() => setConfirmDeactivateId(null)}
        />
      )}

      {inspectingMemory && (
        <MemoryDetailDrawer
          memory={inspectingMemory}
          onClose={() => setInspectingMemory(null)}
          onEdit={() => {
            const listItem = memories.find(m => m.memoryId === inspectingMemory.memoryId);
            if (listItem) {
              setEditingMemory(listItem);
              setInspectingMemory(null);
            }
          }}
          onDeactivate={() => {
            setConfirmDeactivateId(inspectingMemory.memoryId);
            setInspectingMemory(null);
          }}
        />
      )}

      {editingMemory && (
        <EditMemoryModal
          memory={editingMemory}
          isLoading={isSubmittingEdit}
          onClose={() => setEditingMemory(null)}
          onSave={handleUpdate}
        />
      )}
    </div>
  );
}
