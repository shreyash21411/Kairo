export type MemoryType =
  | "Preference"
  | "Fact"
  | "Goal"
  | "Context"
  | "Skill"
  | "Relationship"
  | "Other";

export const VALID_MEMORY_TYPES: MemoryType[] = [
  "Preference",
  "Fact",
  "Goal",
  "Context",
  "Skill",
  "Relationship",
  "Other",
];

/**
 * Request body for POST /api/v1/memories
 * NOTE: Zero authority fields (UserId, ProjectId, ScopeId) are accepted or sent.
 */
export interface CreateMemoryRequest {
  content: string;
  memoryType: MemoryType | string;
  actorId: string;
}

/**
 * Request body for PUT /api/v1/memories/{memoryId}
 */
export interface UpdateMemoryRequest {
  content: string;
  memoryType: MemoryType | string;
}

/**
 * Full memory object returned from single GET, POST, or PUT.
 */
export interface MemoryResponse {
  memoryId: number;
  userId: number;
  content: string;
  memoryType: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Item in the array returned by GET /api/v1/memories.
 * NOTE: The backend does NOT include actorId or scopeId here.
 */
export interface MemoryListItem {
  memoryId: number;
  content: string;
  memoryType: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListMemoriesResponse {
  userId: number;
  count: number;
  memories: MemoryListItem[];
}

export interface DeleteMemoryResponse {
  memoryId: number;
  message: string;
}

export interface MemoryDuplicateResult {
  isDuplicate: boolean;
  reason: string;
}

/**
 * Response for POST /api/v1/memories:
 * Can be either a successfully created MemoryResponse (201)
 * or a duplicate detection result (200).
 */
export type CreateMemoryOutcome =
  | { success: true; memory: MemoryResponse; isDuplicate: false }
  | { success: false; duplicate: MemoryDuplicateResult; isDuplicate: true };

/**
 * Request body for POST /api/v1/memories/search
 */
export interface MemorySearchRequest {
  query: string;
  topK?: number;
  actorId: string;
}

/**
 * Single item in semantic search results.
 * Similarity is the server-calculated cosine similarity float (0.0 to 1.0).
 */
export interface RetrievedMemory {
  memoryId: number;
  content: string;
  memoryType: string;
  similarity: number;
}

export interface MemorySearchResponse {
  query: string;
  count: number;
  memories: RetrievedMemory[];
}
