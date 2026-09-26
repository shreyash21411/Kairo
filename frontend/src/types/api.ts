/**
 * RFC 7807 / RFC 9457 Problem Details and Normalized API Error Representation
 */

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  message?: string;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly problemDetails?: ProblemDetails;

  constructor(status: number, message: string, problemDetails?: ProblemDetails) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.problemDetails = problemDetails;
  }
}
