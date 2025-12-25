"use client";

export function isDemoMode() {
  return (process.env.NEXT_PUBLIC_DEMO_MODE ?? "false").toLowerCase() === "true";
}

