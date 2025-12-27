"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import { fadeIn, fast, staggerContainer } from "./presets";

export function MotionList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={reduce ? false : "hidden"} animate="show" variants={reduce ? undefined : staggerContainer} className={className}>
      <AnimatePresence mode="popLayout" initial={false}>
        {children}
      </AnimatePresence>
    </motion.div>
  );
}

export function MotionItem({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={id}
      variants={reduce ? undefined : fadeIn(10)}
      initial={reduce ? false : "hidden"}
      animate="show"
      exit={reduce ? undefined : "exit"}
      transition={reduce ? undefined : fast}
      className={cn(className)}
      layout={!reduce}
    >
      {children}
    </motion.div>
  );
}
