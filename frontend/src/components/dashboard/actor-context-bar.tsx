"use client";

import React, { useState } from "react";
import { useProject } from "@/providers/project-provider";
import { User, Check, Edit2 } from "lucide-react";

export function ActorContextBar() {
  const { activeActorId, setActiveActorId, selectedProject } = useProject();
  const [isEditing, setIsEditing] = useState(false);
  const [tempActor, setTempActor] = useState(activeActorId);

  const handleSave = () => {
    if (tempActor.trim()) {
      setActiveActorId(tempActor.trim());
    } else {
      setTempActor(activeActorId);
    }
    setIsEditing(false);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/60 bg-card/40 backdrop-blur-xs text-xs">
      <User className="h-3.5 w-3.5 text-primary" />
      <span className="text-muted-foreground font-mono">Actor Scope:</span>

      {isEditing ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={tempActor}
            onChange={(e) => setTempActor(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="w-32 px-2 py-0.5 text-xs font-mono rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          <button
            onClick={handleSave}
            className="p-1 rounded hover:bg-muted text-foreground transition-colors"
            title="Save actor"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-medium text-foreground px-1.5 py-0.5 rounded bg-muted/60">
            {activeActorId}
          </span>
          <button
            onClick={() => {
              setTempActor(activeActorId);
              setIsEditing(true);
            }}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Change active actor ID"
          >
            <Edit2 className="h-3 w-3" />
          </button>
        </div>
      )}

      {selectedProject && (
        <span className="hidden lg:inline text-[11px] text-muted-foreground/70 pl-2 border-l border-border/50">
          Scope: Project #{selectedProject.projectId} + &apos;{activeActorId}&apos;
        </span>
      )}
    </div>
  );
}
