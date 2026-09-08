"use client"

import * as React from "react"
import { Moon, Sun, Monitor } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const emptySubscribe = () => () => {}
const getSnapshot = () => true
const getServerSnapshot = () => false

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    getSnapshot,
    getServerSnapshot
  )

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-9 w-9", className)}
        aria-label="Toggle theme"
        disabled
      >
        <Sun className="size-4" />
      </Button>
    )
  }

  function cycleTheme() {
    if (theme === "light") setTheme("dark")
    else if (theme === "dark") setTheme("system")
    else setTheme("light")
  }

  const Icon =
    theme === "light"
      ? Sun
      : theme === "dark"
        ? Moon
        : Monitor

  const label =
    theme === "light"
      ? "Switch to dark mode"
      : theme === "dark"
        ? "Switch to system theme"
        : "Switch to light mode"

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-9 w-9", className)}
      onClick={cycleTheme}
      aria-label={label}
      title={label}
    >
      <Icon className="size-4" />
    </Button>
  )
}
