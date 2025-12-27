"use client";

import type { Transition, Variants } from "framer-motion";

export const easeOutQuint: Transition["ease"] = [0.22, 1, 0.36, 1];

export const fast: Transition = { duration: 0.18, ease: easeOutQuint };
export const normal: Transition = { duration: 0.26, ease: easeOutQuint };

export function fadeIn(y: number = 10): Variants {
  return {
    hidden: { opacity: 0, y, filter: "blur(4px)" },
    show: { opacity: 1, y: 0, filter: "blur(0px)" },
    exit: { opacity: 0, y: -6, filter: "blur(4px)" },
  };
}

export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};

