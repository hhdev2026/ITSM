import type { NextFunction, Request, Response } from "express";
import * as crypto from "node:crypto";

export function timingSafeEqualString(a: string, b: string) {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function sanitizeUrlForLogs(url: string) {
  if (!url) return url;
  const path = url.split("?", 1)[0] ?? url;

  // NetLock endpoints include ephemeral JWTs as path segments; don't log them.
  const redacted =
    path
      .replace(/^(\/api\/netlock\/installer\/)[^/]+/i, "$1:token")
      .replace(/^(\/api\/netlock\/server-config\/)[^/]+/i, "$1:token")
      .replace(/^(\/api\/netlock\/install-script\/(?:macos|linux)\/)[^/]+/i, "$1:token") ?? path;

  return redacted;
}

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  key?: (req: Request) => string;
};

export function createMemoryRateLimiter(opts: RateLimitOptions) {
  const buckets = new Map<string, { resetAt: number; count: number }>();
  const windowMs = Math.max(1, Math.floor(opts.windowMs));
  const max = Math.max(1, Math.floor(opts.max));
  const pruneThreshold = 10_000;

  function keyFor(req: Request) {
    const ip = (req.ip || "unknown").replace(/^::ffff:/, "");
    const base = opts.key ? opts.key(req) : ip;
    const prefix = opts.keyPrefix ? `${opts.keyPrefix}:` : "";
    return `${prefix}${base}`;
  }

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    if (buckets.size > pruneThreshold) {
      for (const [k, v] of buckets.entries()) {
        if (v.resetAt <= now) buckets.delete(k);
      }
    }
    const key = keyFor(req);
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { resetAt: now + windowMs, count: 1 });
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - 1)));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil((now + windowMs) / 1000)));
      return next();
    }

    current.count += 1;
    const remaining = Math.max(0, max - current.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));

    if (current.count > max) return res.status(429).json({ error: "rate_limited" });
    return next();
  };
}
