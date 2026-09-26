"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  className?: string
}

export function Dialog({ open, onOpenChange, children, className }: DialogProps) {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onOpenChange(false)
      }
    }
    if (open) {
      document.body.style.overflow = "hidden"
      window.addEventListener("keydown", handleKeyDown)
    }
    return () => {
      document.body.style.overflow = "unset"
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-xs transition-opacity duration-150 animate-in fade-in"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Modal Surface */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-50 w-full max-w-lg rounded-lg border border-border/80 bg-card p-5 text-foreground shadow-2xl transition-all duration-150 animate-in fade-in zoom-in-98",
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function DialogHeader({
  className,
  children,
  onClose,
}: {
  className?: string
  children: React.ReactNode
  onClose?: () => void
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 pb-3 border-b border-border/50", className)}>
      <div className="space-y-0.5">{children}</div>
      {onClose && (
        <button
          onClick={onClose}
          className="p-1 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export function DialogTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h2 className={cn("text-sm font-semibold tracking-tight text-foreground", className)}>{children}</h2>
}

export function DialogDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-xs text-muted-foreground", className)}>{children}</p>
}

export function DialogFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex items-center justify-end gap-2 pt-3 border-t border-border/50", className)}>{children}</div>
}
