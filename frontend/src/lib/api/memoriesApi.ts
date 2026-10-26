import {
  CreateMemoryOutcome,
  CreateMemoryRequest,
  DeleteMemoryResponse,
  ListMemoriesResponse,
  MemoryDuplicateResult,
  MemoryResponse,
  MemorySearchRequest,
  MemorySearchResponse,
  UpdateMemoryRequest,
} from "@/types/memory";
import { apiKeyRequest } from "./client";

export const memoriesApi = {
  /**
   * Creates a new memory.
   * POST /api/v1/memories (Scheme: VoidzoneApiKey)
   *
   * Note on return type:
   * Status 201 Created: returns MemoryResponse
   * Status 200 OK: returns MemoryDuplicateResult (isDuplicate: true, reason: string)
   */
  async create(apiKey: string, data: CreateMemoryRequest): Promise<CreateMemoryOutcome> {
    const res = await apiKeyRequest<MemoryResponse | MemoryDuplicateResult>(
      "/api/v1/memories",
      apiKey,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );

    if (res.status === 200 && "isDuplicate" in res.data && res.data.isDuplicate) {
      return {
        success: false,
        isDuplicate: true,
        duplicate: res.data as MemoryDuplicateResult,
      };
    }

    return {
      success: true,
      isDuplicate: false,
      memory: res.data as MemoryResponse,
    };
  },

  /**
   * Retrieves a single memory by ID.
   * GET /api/v1/memories/{memoryId} (Scheme: VoidzoneApiKey)
   */
  async getById(apiKey: string, memoryId: number): Promise<MemoryResponse> {
    const res = await apiKeyRequest<MemoryResponse>(
      `/api/v1/memories/${memoryId}`,
      apiKey,
      {
        method: "GET",
      }
    );
    return res.data;
  },

  /**
   * Lists all active memories for the authenticated project.
   * GET /api/v1/memories (Scheme: VoidzoneApiKey)
   * NOTE: The backend takes NO parameters (no actorId parameter exists).
   */
  async list(apiKey: string, signal?: AbortSignal): Promise<ListMemoriesResponse> {
    const res = await apiKeyRequest<ListMemoriesResponse>("/api/v1/memories", apiKey, {
      method: "GET",
      signal,
    });
    return res.data;
  },

  /**
   * Updates a memory content and memoryType.
   * PUT /api/v1/memories/{memoryId} (Scheme: VoidzoneApiKey)
   */
  async update(
    apiKey: string,
    memoryId: number,
    data: UpdateMemoryRequest
  ): Promise<MemoryResponse> {
    const res = await apiKeyRequest<MemoryResponse>(
      `/api/v1/memories/${memoryId}`,
      apiKey,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );
    return res.data;
  },

  /**
   * Soft-deactivates a memory.
   * DELETE /api/v1/memories/{memoryId} (Scheme: VoidzoneApiKey)
   */
  async delete(apiKey: string, memoryId: number): Promise<DeleteMemoryResponse> {
    const res = await apiKeyRequest<DeleteMemoryResponse>(
      `/api/v1/memories/${memoryId}`,
      apiKey,
      {
        method: "DELETE",
      }
    );
    return res.data;
  },

  /**
   * Performs semantic vector search scoped to the project and actorId.
   * POST /api/v1/memories/search (Scheme: VoidzoneApiKey)
   */
  async search(
    apiKey: string,
    data: MemorySearchRequest,
    signal?: AbortSignal
  ): Promise<MemorySearchResponse> {
    const res = await apiKeyRequest<MemorySearchResponse>(
      "/api/v1/memories/search",
      apiKey,
      {
        method: "POST",
        body: JSON.stringify(data),
        signal,
      }
    );
    return res.data;
  },
};
