export interface CreateProjectRequest {
  name: string;
}

export interface ProjectResponse {
  projectId: number;
  userId: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}
