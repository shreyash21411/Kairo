"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { projectsApi } from "@/lib/api/projectsApi";
import { apiKeysApi } from "@/lib/api/apiKeysApi";
import { ProjectResponse } from "@/types/project";
import { ApiKeyResponse } from "@/types/apiKey";
import { useAuth } from "./auth-provider";

interface ProjectContextType {
  projects: ProjectResponse[];
  selectedProject: ProjectResponse | null;
  isLoadingProjects: boolean;
  projectApiKeys: ApiKeyResponse[];
  isLoadingApiKeys: boolean;
  // Session-only API key for memory testing; NEVER saved to localStorage
  sessionApiKey: string | null;
  activeActorId: string;
  selectProject: (project: ProjectResponse | null) => void;
  setSessionApiKey: (key: string | null) => void;
  setActiveActorId: (actorId: string) => void;
  reloadProjects: () => Promise<void>;
  reloadApiKeys: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectResponse | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  const [projectApiKeys, setProjectApiKeys] = useState<ApiKeyResponse[]>([]);
  const [isLoadingApiKeys, setIsLoadingApiKeys] = useState(false);

  // In-memory ephemeral API key for the selected project
  const [sessionApiKey, setSessionApiKey] = useState<string | null>(null);
  const [activeActorId, setActiveActorId] = useState<string>("agent-user-1");

  const reloadProjects = useCallback(async () => {
    if (!isAuthenticated) {
      setProjects([]);
      setSelectedProject(null);
      return;
    }

    setIsLoadingProjects(true);
    try {
      const data = await projectsApi.list();
      setProjects(data);
      if (data.length > 0) {
        setSelectedProject((prev) => {
          if (prev && data.some((p) => p.projectId === prev.projectId)) {
            return prev;
          }
          return data[0];
        });
      } else {
        setSelectedProject(null);
      }
    } catch {
      setProjects([]);
      setSelectedProject(null);
    } finally {
      setIsLoadingProjects(false);
    }
  }, [isAuthenticated]);

  const reloadApiKeys = useCallback(async () => {
    if (!selectedProject) {
      setProjectApiKeys([]);
      return;
    }

    setIsLoadingApiKeys(true);
    try {
      const keys = await apiKeysApi.listByProject(selectedProject.projectId);
      setProjectApiKeys(keys);
    } catch {
      setProjectApiKeys([]);
    } finally {
      setIsLoadingApiKeys(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    if (isAuthenticated) {
      reloadProjects();
    } else {
      setProjects([]);
      setSelectedProject(null);
      setProjectApiKeys([]);
      setSessionApiKey(null);
    }
  }, [isAuthenticated, reloadProjects]);

  useEffect(() => {
    reloadApiKeys();
  }, [selectedProject, reloadApiKeys]);

  const selectProject = (project: ProjectResponse | null) => {
    if (project?.projectId === selectedProject?.projectId) return;

    // RULE: Immediately purge previous project's in-memory key and invalidate state
    setSessionApiKey(null);
    setProjectApiKeys([]);
    setSelectedProject(project);
  };

  return (
    <ProjectContext.Provider
      value={{
        projects,
        selectedProject,
        isLoadingProjects,
        projectApiKeys,
        isLoadingApiKeys,
        sessionApiKey,
        activeActorId,
        selectProject,
        setSessionApiKey,
        setActiveActorId,
        reloadProjects,
        reloadApiKeys,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextType {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return context;
}
