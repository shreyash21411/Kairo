import { ProjectResponse } from "./project";

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface RegisterResult {
  userId: number;
  email: string;
  isEmailVerified: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthenticatedUserInfo {
  userId: number;
  email: string;
  isEmailVerified: boolean;
}

export interface LoginResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string;
  user: AuthenticatedUserInfo;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface TokenPair {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

export interface LogoutRequest {
  refreshToken: string;
}

export interface AccountMeResult {
  userId: number;
  email: string;
  isEmailVerified: boolean;
  projects: ProjectResponse[];
}
