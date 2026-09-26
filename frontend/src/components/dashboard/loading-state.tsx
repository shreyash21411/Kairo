"use client";

import React from "react";
import { Loader2 } from "lucide-react";

export function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary mb-2.5" />
      <p className="text-xs text-muted-foreground font-medium">{message}</p>
    </div>
  );
}
