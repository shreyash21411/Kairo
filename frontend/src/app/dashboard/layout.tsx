"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { LoadingState } from "@/components/dashboard/loading-state";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingState message="Authenticating session..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <DashboardShell>{children}</DashboardShell>;
}
