/**
 * voidzoneTypes.ts
 *
 * TypeScript contracts matching the ASP.NET Core VoidzoneController endpoints:
 *   POST /api/voidzone/memory/extract
 *   POST /api/voidzone/continuity/generate
 *
 * Sourced directly from backend DTOs:
 *   - Kairo.Application.DTOs.MetaMemoryDtos
 *   - Kairo.Application.DTOs.MetaContinuityDtos
 *   - Kairo.Application.Abstractions.Meta.MetaTokenUsage
 */

export interface MetaTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface MetaConversationMessage {
  role: string;
  content: string;
}

export interface MemoryExtractRequest {
  rawTranscript: string;
  messages?: MetaConversationMessage[];
}

export interface MetaMemoryResult {
  decisions: string[];
  requirements: string[];
  constraints: string[];
  goals: string[];
  technicalContext: string;
  pendingTasks: string[];
  projectFacts: string[];
  tokenUsage: MetaTokenUsage;
  extractedAt: string;
}

export interface MetaMemoryResponse {
  userId: number;
  projectId: number;
  result: MetaMemoryResult;
}

export interface ContinuityGenerateRequest {
  rawTranscript: string;
  platform?: string;
  title?: string;
}

export interface MetaContinuityResult {
  projectName: string;
  currentObjective: string;
  importantDecisions: string[];
  constraints: string[];
  completedWork: string[];
  outstandingTasks: string[];
  blockers: string[];
  recommendedNextAction: string;
  technicalContext: string;
  tokenUsage: MetaTokenUsage;
  generatedAt: string;
}

export interface MetaContinuityResponse {
  userId: number;
  projectId: number;
  result: MetaContinuityResult;
}

export interface BackendConfig {
  backendBaseUrl: string;
  kairoApiKey: string;
}

export type VoidzoneErrorCode =
  | "meta_ai_disabled"
  | "raw_transcript_required"
  | "input_too_large"
  | "meta_ai_auth_failure"
  | "meta_ai_rate_limited"
  | "meta_ai_malformed_response"
  | "meta_ai_error"
  | "unauthorized"
  | "network_error"
  | "unknown";

export class VoidzoneApiError extends Error {
  readonly statusCode: number;
  readonly errorCode: VoidzoneErrorCode;
  readonly estimatedTokens?: number;
  readonly maxTokens?: number;

  constructor(
    message: string,
    statusCode: number,
    errorCode: VoidzoneErrorCode,
    details?: { estimatedTokens?: number; maxTokens?: number }
  ) {
    super(message);
    this.name = "VoidzoneApiError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.estimatedTokens = details?.estimatedTokens;
    this.maxTokens = details?.maxTokens;
  }
}

