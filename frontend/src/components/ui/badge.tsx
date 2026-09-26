import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10px] font-mono font-medium tracking-tight transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-primary/30 bg-primary/10 text-primary",
        secondary:
          "border-border bg-muted/60 text-muted-foreground",
        outline:
          "border-border/80 bg-transparent text-foreground",
        success:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        warning:
          "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive",
        // Memory Type specific styling: restrained & technical
        preference:
          "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
        fact:
          "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
        goal:
          "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        context:
          "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
        skill:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        relationship:
          "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
