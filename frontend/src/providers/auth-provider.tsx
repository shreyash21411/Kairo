"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { authApi } from "@/lib/api/authApi";
import {
  clearStoredTokens,
  getStoredAccessToken,
  getStoredRefreshToken,
  setStoredTokens,
} from "@/lib/api/client";
import { AuthenticatedUserInfo, LoginRequest, RegisterRequest } from "@/types/auth";
import { ApiError } from "@/types/api";

interface AuthContextType {
  user: AuthenticatedUserInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const handleLogoutEvent = useCallback(() => {
    setUser(null);
    clearStoredTokens();
    if (pathname?.startsWith("/dashboard")) {
      router.replace("/login");
    }
  }, [pathname, router]);

  const refreshProfile = useCallback(async () => {
    const token = getStoredAccessToken();
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const me = await authApi.getMe();
      setUser({
        userId: me.userId,
        email: me.email,
        isEmailVerified: me.isEmailVerified,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleLogoutEvent();
      }
    } finally {
      setIsLoading(false);
    }
  }, [handleLogoutEvent]);

  useEffect(() => {
    refreshProfile();

    const onCustomLogout = () => {
      handleLogoutEvent();
    };

    window.addEventListener("kairo:auth:logout", onCustomLogout);
    return () => {
      window.removeEventListener("kairo:auth:logout", onCustomLogout);
    };
  }, [refreshProfile, handleLogoutEvent]);

  const login = async (data: LoginRequest) => {
    const res = await authApi.login(data);
    setStoredTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
    router.replace("/dashboard");
  };

  const register = async (data: RegisterRequest) => {
    await authApi.register(data);
    // Registration does not issue tokens per backend contract; proceed to login
    await login(data);
  };

  const logout = async () => {
    const refreshToken = getStoredRefreshToken();
    if (refreshToken) {
      try {
        await authApi.logout({ refreshToken });
      } catch {
        // Ignore logout errors on network failure
      }
    }
    handleLogoutEvent();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
