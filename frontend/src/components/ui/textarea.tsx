import * as React from "react"
import { cn } from "@/lib/utils"

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  isMono?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, isMono = false, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[70px] w-full rounded-md border border-border/80 bg-background/60 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus-visible:outline-none focus-visible:border-primary/80 focus-visible:ring-1 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 resize-y",
          isMono && "font-mono tracking-tight",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
