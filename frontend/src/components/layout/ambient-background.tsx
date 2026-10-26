"use client"

import * as React from "react"

// VOIDZONE Global Ambient Background
// Near-black canvas + very large soft blue light fields + extreme blur + subtle organic movement
// Pure blue palette only (no purple/violet/pink), continuous across entire page.

export function AmbientBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
    >
      {/* 8 soft glowing blue bokeh dots distributed across the background */}
      <div className="ambient-dot ambient-dot-1" />
      <div className="ambient-dot ambient-dot-2" />
      <div className="ambient-dot ambient-dot-3" />
      <div className="ambient-dot ambient-dot-4" />
      <div className="ambient-dot ambient-dot-5" />
      <div className="ambient-dot ambient-dot-6" />
      <div className="ambient-dot ambient-dot-7" />
      <div className="ambient-dot ambient-dot-8" />
    </div>
  )
}