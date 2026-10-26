"use client";

import React, { useState } from "react";
import { useProject } from "@/providers/project-provider";
import { projectsApi } from "@/lib/api/projectsApi";
import { ProjectResponse } from "@/types/project";
import { ApiError } from "@/types/api";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/dashboard/status-banner";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LoadingState } from "@/components/dashboard/loading-state";
import {
  FolderGit2,
  Plus,
  Trash2,
  Loader2,
  X,
  Check,
  Calendar,
} from "lucide-react";

// ─── Delete confirmation modal ────────────────────────────────────────────────
function ConfirmDeleteModal({
  project,
  onConfirm,
  onCancel,
  isLoading,
}: {
  project: ProjectResponse;
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
            <h3 className="text-sm font-semibold text-foreground">Delete Project</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              <span className="font-medium text-foreground">{project.name}</span> and all its
              associated API keys will be permanently deleted. This cannot be undone.
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
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Deleting…</>
            ) : (
              <>Delete Project</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Create Project Panel ─────────────────────────────────────────────────────
function CreateProjectPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: ProjectResponse) => void;
}) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const created = await projectsApi.create({ name: name.trim() });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create project.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-surface-subtle/30">
        <span className="text-xs font-semibold text-foreground">New Project</span>
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
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Project Name</label>
          <input
            type="text"
            required
            autoFocus
            placeholder="e.g. Customer Support Agent, Coding Assistant"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={isSubmitting} className="text-xs">
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting || !name.trim()} className="text-xs gap-1.5">
            {isSubmitting ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Creating…</>
            ) : (
              <>Create Project</>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const {
    projects,
    selectedProject,
    selectProject,
    isLoadingProjects,
    reloadProjects,
  } = useProject();

  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<ProjectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleDelete = async (project: ProjectResponse) => {
    setDeletingId(project.projectId);
    try {
      await projectsApi.delete(project.projectId);
      setSuccess(`Project "${project.name}" deleted.`);
      setConfirmDeleteProject(null);
      await reloadProjects();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete project.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreated = async (p: ProjectResponse) => {
    setIsCreating(false);
    setSuccess(`Project "${p.name}" created.`);
    await reloadProjects();
    selectProject(p);
  };

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">Projects</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Workspace isolation units — each project scopes API keys and memory storage
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => { setIsCreating(!isCreating); setError(null); }}
          className="text-xs h-7 gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          {isCreating ? "Cancel" : "New Project"}
        </Button>
      </div>

      {/* ── Notifications ── */}
      <StatusBanner type="error" message={error} onDismiss={() => setError(null)} />
      <StatusBanner type="success" message={success} onDismiss={() => setSuccess(null)} />

      {/* ── Create Panel ── */}
      {isCreating && (
        <CreateProjectPanel
          onClose={() => setIsCreating(false)}
          onCreated={handleCreated}
        />
      )}

      {/* ── Projects List ── */}
      {isLoadingProjects ? (
        <LoadingState message="Loading projects…" />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No projects found"
          description="Create your first project to generate API keys and store memories."
          actionLabel="Create Project"
          onAction={() => setIsCreating(true)}
        />
      ) : (
        <div className="border border-border/60 rounded-lg overflow-hidden">
          {/* Column header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-2 border-b border-border/40 bg-surface-subtle/30 gap-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Project</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-24 text-right hidden sm:block">Created</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-16 text-center">Active</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-16 text-right">Action</span>
          </div>

          <div className="divide-y divide-border/30">
            {projects.map((project) => {
              const isSelected = selectedProject?.projectId === project.projectId;

              return (
                <div
                  key={project.projectId}
                  className={`grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-3.5 hover:bg-surface-subtle/20 transition-colors gap-4 ${
                    isSelected ? "bg-primary/5" : ""
                  }`}
                >
                  {/* Project info */}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{project.name}</span>
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                      #{project.projectId}
                    </div>
                  </div>

                  {/* Created */}
                  <div className="hidden sm:flex w-24 justify-end items-center gap-1">
                    <Calendar className="h-3 w-3 text-muted-foreground/50" />
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Active indicator / switch */}
                  <div className="w-16 flex justify-center">
                    {isSelected ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/20">
                        <Check className="h-2.5 w-2.5" />
                        active
                      </span>
                    ) : (
                      <button
                        onClick={() => selectProject(project)}
                        className="text-[10px] font-mono text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
                      >
                        select
                      </button>
                    )}
                  </div>

                  {/* Action */}
                  <div className="w-16 flex justify-end">
                    <button
                      onClick={() => setConfirmDeleteProject(project)}
                      disabled={deletingId === project.projectId}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete project"
                    >
                      {deletingId === project.projectId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-4 py-2 border-t border-border/30 bg-surface-subtle/20">
            <span className="text-[10px] font-mono text-muted-foreground/50">
              {projects.length} project{projects.length !== 1 ? "s" : ""} · Managed Workspaces
            </span>
          </div>
        </div>
      )}

      {/* ── Delete modal ── */}
      {confirmDeleteProject && (
        <ConfirmDeleteModal
          project={confirmDeleteProject}
          isLoading={deletingId === confirmDeleteProject.projectId}
          onConfirm={() => handleDelete(confirmDeleteProject)}
          onCancel={() => setConfirmDeleteProject(null)}
        />
      )}
    </div>
  );
}
