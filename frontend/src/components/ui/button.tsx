import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs",
        secondary:
          "bg-secondary text-secondary-foreground border border-border/60 hover:bg-muted hover:border-border",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-muted/40 hover:border-border/80",
        ghost:
          "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        destructive:
          "bg-destructive/15 text-destructive border border-destructive/25 hover:bg-destructive/25 shadow-xs",
        link:
          "text-primary underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 rounded-[5px] px-2.5 text-[11px]",
        lg: "h-9 rounded-md px-4 text-sm",
        icon: "h-8 w-8 p-0",
        "icon-sm": "h-7 w-7 p-0 rounded-[5px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
