import { CreateProjectRequest, ProjectResponse } from "@/types/project";
import { jwtRequest } from "./client";

export const projectsApi = {
  /**
   * Creates a new project for the authenticated developer account.
   * POST /api/v1/projects (Scheme: VoidzoneJwt)
   */
  async create(data: CreateProjectRequest): Promise<ProjectResponse> {
    return jwtRequest<ProjectResponse>("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  /**
   * Lists all projects belonging to the authenticated developer account.
   * GET /api/v1/projects (Scheme: VoidzoneJwt)
   */
  async list(): Promise<ProjectResponse[]> {
    return jwtRequest<ProjectResponse[]>("/api/v1/projects", {
      method: "GET",
    });
  },

  /**
   * Retrieves a single project by ID.
   * GET /api/v1/projects/{projectId} (Scheme: VoidzoneJwt)
   */
  async getById(projectId: number): Promise<ProjectResponse> {
    return jwtRequest<ProjectResponse>(`/api/v1/projects/${projectId}`, {
      method: "GET",
    });
  },

  /**
   * Deletes a project by ID.
   * DELETE /api/v1/projects/{projectId} (Scheme: VoidzoneJwt)
   */
  async delete(projectId: number): Promise<{ message: string }> {
    return jwtRequest<{ message: string }>(`/api/v1/projects/${projectId}`, {
      method: "DELETE",
    });
  },
};
