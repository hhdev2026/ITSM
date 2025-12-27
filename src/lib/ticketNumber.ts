export function normalizeTicketNumber(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
  }
  const s = String(value).trim();
  return s ? s : null;
}

export function formatTicketNumber(value: unknown, opts?: { prefix?: string; pad?: number }): string | null {
  const raw = normalizeTicketNumber(value);
  if (!raw) return null;
  const prefix = opts?.prefix ?? "TKT";
  const pad = opts?.pad ?? 6;
  const n = raw.replace(/^0+/, "") || "0";
  return `${prefix}-${n.padStart(pad, "0")}`;
}

