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
  sessionApiKeyError: string | null;
  isVerifyingKey: boolean;
  activeActorId: string;
  projectGeneration: number;
  selectProject: (project: ProjectResponse | null) => void;
  setSessionApiKey: (key: string | null) => Promise<{ success: boolean; error?: string }>;
  activateSessionApiKey: (key: string) => Promise<{ success: boolean; error?: string }>;
  clearSessionApiKey: () => void;
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
  const [sessionApiKey, setSessionApiKeyInternal] = useState<string | null>(null);
  const [sessionApiKeyError, setSessionApiKeyError] = useState<string | null>(null);
  const [isVerifyingKey, setIsVerifyingKey] = useState(false);
  const [activeActorId, setActiveActorId] = useState<string>("agent-user-1");
  const [projectGeneration, setProjectGeneration] = useState(0);

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
      setSessionApiKeyInternal(null);
      setSessionApiKeyError(null);
    }
  }, [isAuthenticated, reloadProjects]);

  useEffect(() => {
    reloadApiKeys();
  }, [selectedProject, reloadApiKeys]);

  const clearSessionApiKey = useCallback(() => {
    setSessionApiKeyInternal(null);
    setSessionApiKeyError(null);
  }, []);

  const selectProject = useCallback((project: ProjectResponse | null) => {
    if (project?.projectId === selectedProject?.projectId) return;

    // RULE: Immediately purge previous project's in-memory key and invalidate state
    setSessionApiKeyInternal(null);
    setSessionApiKeyError(null);
    setProjectApiKeys([]);
    setSelectedProject(project);
    setProjectGeneration((prev) => prev + 1);
  }, [selectedProject?.projectId]);

  /**
   * Hardened API Key activation:
   * Validates key against the server, verifies exact project ownership,
   * rejects cross-project keys, and prevents stale project data exposure.
   */
  const activateSessionApiKey = useCallback(async (key: string): Promise<{ success: boolean; error?: string }> => {
    const trimmed = key.trim();
    if (!trimmed) {
      setSessionApiKeyInternal(null);
      const err = "API key cannot be empty.";
      setSessionApiKeyError(err);
      return { success: false, error: err };
    }

    if (!selectedProject) {
      setSessionApiKeyInternal(null);
      const err = "No project selected.";
      setSessionApiKeyError(err);
      return { success: false, error: err };
    }

    setIsVerifyingKey(true);
    setSessionApiKeyError(null);

    try {
      // 1. Authoritative server-side validation using authenticated JWT endpoint
      const validation = await apiKeysApi.validate(trimmed);

      if (!validation.isValid) {
        setSessionApiKeyInternal(null);
        const errMsg = validation.message || "Invalid or expired API key.";
        setSessionApiKeyError(errMsg);
        return { success: false, error: errMsg };
      }

      // 2. Strict Project Alignment Check
      if (validation.projectId !== selectedProject.projectId) {
        setSessionApiKeyInternal(null);
        const mismatchMsg = "This API key belongs to a different project. Select the correct project or use a key created for this project.";
        setSessionApiKeyError(mismatchMsg);
        return { success: false, error: mismatchMsg };
      }

      // 3. Key is valid and confirmed to belong to current selected project
      setSessionApiKeyInternal(trimmed);
      setSessionApiKeyError(null);
      return { success: true };
    } catch (err) {
      setSessionApiKeyInternal(null);
      const errMsg = err instanceof Error ? err.message : "Failed to verify API key with server.";
      setSessionApiKeyError(errMsg);
      return { success: false, error: errMsg };
    } finally {
      setIsVerifyingKey(false);
    }
  }, [selectedProject]);

  const setSessionApiKey = useCallback(
    async (key: string | null): Promise<{ success: boolean; error?: string }> => {
      if (key === null) {
        clearSessionApiKey();
        return { success: true };
      }
      return await activateSessionApiKey(key);
    },
    [clearSessionApiKey, activateSessionApiKey]
  );

  return (
    <ProjectContext.Provider
      value={{
        projects,
        selectedProject,
        isLoadingProjects,
        projectApiKeys,
        isLoadingApiKeys,
        sessionApiKey,
        sessionApiKeyError,
        isVerifyingKey,
        activeActorId,
        projectGeneration,
        selectProject,
        setSessionApiKey,
        activateSessionApiKey,
        clearSessionApiKey,
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
