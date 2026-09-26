"use client";

import React from "react";
import { useProject } from "@/providers/project-provider";
import { FolderGit2, ChevronDown, Plus } from "lucide-react";
import Link from "next/link";

export function ProjectSelector() {
  const { projects, selectedProject, selectProject, isLoadingProjects } = useProject();

  if (isLoadingProjects) {
    return (
      <div className="h-8 w-44 rounded-md bg-muted/40 animate-pulse" />
    );
  }

  if (projects.length === 0) {
    return (
      <Link
        href="/dashboard/projects"
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Create First Project
      </Link>
    );
  }

  return (
    <div className="relative inline-block text-left">
      <div className="flex items-center gap-2">
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider hidden sm:inline">
          Project:
        </label>
        <div className="relative">
          <select
            value={selectedProject?.projectId ?? ""}
            onChange={(e) => {
              const projId = Number(e.target.value);
              const found = projects.find((p) => p.projectId === projId);
              selectProject(found ?? null);
            }}
            className="appearance-none pl-8 pr-8 py-1 text-xs font-semibold rounded-md border border-border bg-card/80 text-foreground hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer transition-colors shadow-xs"
            aria-label="Select Project"
          >
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.name} (ID: {project.projectId})
              </option>
            ))}
          </select>
          <FolderGit2 className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <ChevronDown className="absolute right-2 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        </div>
      </div>
    </div>
  );
}
