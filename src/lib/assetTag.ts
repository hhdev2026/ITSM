export function formatAssetTag(tag: unknown) {
  const n = typeof tag === "number" ? tag : typeof tag === "string" ? Number(tag) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const padded = String(Math.trunc(n)).padStart(6, "0");
  return `AST-${padded}`;
}

