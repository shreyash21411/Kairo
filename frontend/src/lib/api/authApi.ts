import {
  AccountMeResult,
  LoginRequest,
  LoginResult,
  LogoutRequest,
  RefreshTokenRequest,
  RegisterRequest,
  RegisterResult,
  TokenPair,
} from "@/types/auth";
import { anonymousRequest, jwtRequest } from "./client";

export const authApi = {
  /**
   * Registers a new developer account.
   * POST /api/auth/register (Rate limited)
   */
  async register(data: RegisterRequest): Promise<RegisterResult> {
    return anonymousRequest<RegisterResult>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  /**
   * Authenticates with email and password.
   * POST /api/auth/login (Rate limited)
   */
  async login(data: LoginRequest): Promise<LoginResult> {
    return anonymousRequest<LoginResult>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  /**
   * Rotates a refresh token and returns a new token pair.
   * POST /api/auth/refresh (Rate limited)
   */
  async refresh(data: RefreshTokenRequest): Promise<TokenPair> {
    return anonymousRequest<TokenPair>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  /**
   * Revokes the refresh token family for the supplied token.
   * POST /api/auth/logout (Rate limited)
   */
  async logout(data: LogoutRequest): Promise<{ message: string }> {
    return anonymousRequest<{ message: string }>("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  /**
   * Returns profile information and owned projects for the authenticated developer.
   * GET /api/auth/me (Scheme: KairoJwt)
   */
  async getMe(): Promise<AccountMeResult> {
    return jwtRequest<AccountMeResult>("/api/auth/me", {
      method: "GET",
    });
  },
};
