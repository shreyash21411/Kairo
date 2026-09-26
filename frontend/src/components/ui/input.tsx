import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  isMono?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, isMono = false, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-8 w-full rounded-md border border-border/80 bg-background/60 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors file:border-0 file:bg-transparent file:text-xs file:font-medium focus-visible:outline-none focus-visible:border-primary/80 focus-visible:ring-1 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50",
          isMono && "font-mono tracking-tight",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
