import "../dotenv";

import fs from "node:fs";
import path from "node:path";
import { createSupabaseAdmin } from "../supabase";

type Row = {
  ticket_type: "Incidente" | "Requerimiento";
  tier1: string;
  tier2: string;
  tier3: string;
  tier4: string;
};

function usage(): never {
  console.error("Usage: tsx server/scripts/import-tiered-catalog.ts <csvPath> --department <uuid>");
  process.exit(1);
}

function normalizeHeader(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^\w ]+/g, "");
}

function detectDelimiter(line: string) {
  const candidates = [",", ";", "\t"] as const;
  const counts = candidates.map((d) => ({ d, n: line.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0]?.d ?? ",";
}

function parseDelimitedLine(line: string, delimiter: string) {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function toRow(rec: Record<string, string>): Row | null {
  const rawType = rec["ticket_type"]?.trim();
  const ticket_type = rawType === "Incidente" || rawType === "Requerimiento" ? rawType : null;
  if (!ticket_type) return null;
  const tier1 = (rec["tier1"] ?? "").trim();
  const tier2 = (rec["tier2"] ?? "").trim();
  const tier3 = (rec["tier3"] ?? "").trim();
  const tier4 = (rec["tier4"] ?? "").trim();
  if (!tier1 || !tier2 || !tier3 || !tier4) return null;
  return { ticket_type, tier1, tier2, tier3, tier4 };
}

function inferIconKey(tier1: string) {
  const t = tier1.toLowerCase();
  if (t.includes("hard")) return "hardware";
  if (t.includes("red") || t.includes("network")) return "network";
  if (t.includes("soft")) return "software";
  if (t.includes("seg")) return "security";
  return "apps";
}

function buildServiceName(r: Row) {
  return `${r.tier2} · ${r.tier3} · ${r.tier4}`;
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const csvPath = args[0];
  if (!csvPath) usage();
  let departmentId: string | null = null;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--department") {
      departmentId = args[i + 1] ?? null;
      i++;
      continue;
    }
  }
  if (!departmentId) usage();
  return { csvPath, departmentId };
}

async function ensureCategory(supabase: ReturnType<typeof createSupabaseAdmin>, departmentId: string, name: string) {
  const { data: existing, error: selErr } = await supabase
    .from("categories")
    .select("id,name")
    .eq("department_id", departmentId)
    .eq("name", name)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing?.id) return existing.id as string;

  const { data: inserted, error: insErr } = await supabase
    .from("categories")
    .insert({ department_id: departmentId, name, description: null })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return inserted.id as string;
}

async function ensureSubcategory(supabase: ReturnType<typeof createSupabaseAdmin>, categoryId: string, name: string) {
  const { data: existing, error: selErr } = await supabase.from("subcategories").select("id,name").eq("category_id", categoryId).eq("name", name).maybeSingle();
  if (selErr) throw selErr;
  if (existing?.id) return existing.id as string;

  const { data: inserted, error: insErr } = await supabase.from("subcategories").insert({ category_id: categoryId, name, description: null }).select("id").single();
  if (insErr) throw insErr;
  return inserted.id as string;
}

async function main() {
  const { csvPath, departmentId } = parseArgs(process.argv);
  const abs = path.resolve(process.cwd(), csvPath);
  const raw = fs.readFileSync(abs, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("CSV vacío");

  const delimiter = detectDelimiter(lines[0]!);
  const headersRaw = parseDelimitedLine(lines[0]!, delimiter);
  const headers = headersRaw.map(normalizeHeader);

  const idxByKey = new Map<string, number>();
  headers.forEach((h, i) => idxByKey.set(h, i));

  const headerKeys = new Map<string, string>([
    ["tipo de ticket", "ticket_type"],
    ["tipo ticket", "ticket_type"],
    ["ticket type", "ticket_type"],
    ["tier 1", "tier1"],
    ["tier1", "tier1"],
    ["tier 2", "tier2"],
    ["tier2", "tier2"],
    ["tier 3", "tier3"],
    ["tier3", "tier3"],
    ["tier 4", "tier4"],
    ["tier4", "tier4"],
  ]);

  const colIndex: Record<string, number> = {};
  for (const [hdr, key] of headerKeys.entries()) {
    const idx = idxByKey.get(normalizeHeader(hdr));
    if (idx != null) colIndex[key] = idx;
  }
  for (const req of ["ticket_type", "tier1", "tier2", "tier3", "tier4"]) {
    if (typeof colIndex[req] !== "number") {
      throw new Error(`Falta columna requerida: ${req} (headers: ${headersRaw.join(" | ")})`);
    }
  }

  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseDelimitedLine(lines[i]!, delimiter);
    const rec: Record<string, string> = {
      ticket_type: cols[colIndex.ticket_type] ?? "",
      tier1: cols[colIndex.tier1] ?? "",
      tier2: cols[colIndex.tier2] ?? "",
      tier3: cols[colIndex.tier3] ?? "",
      tier4: cols[colIndex.tier4] ?? "",
    };
    const r = toRow(rec);
    if (r) rows.push(r);
  }
  if (rows.length === 0) throw new Error("No se encontraron filas válidas (verifica formato y columnas)");

  const supabase = createSupabaseAdmin();

  let inserted = 0;
  let updated = 0;

  const categoryCache = new Map<string, string>();
  const subcategoryCache = new Map<string, string>();

  for (const r of rows) {
    const categoryKey = `${departmentId}::${r.tier1}`;
    let categoryId = categoryCache.get(categoryKey) ?? null;
    if (!categoryId) {
      categoryId = await ensureCategory(supabase, departmentId, r.tier1);
      categoryCache.set(categoryKey, categoryId);
    }

    const subKey = `${categoryId}::${r.tier2}`;
    let subcategoryId = subcategoryCache.get(subKey) ?? null;
    if (!subcategoryId) {
      subcategoryId = await ensureSubcategory(supabase, categoryId, r.tier2);
      subcategoryCache.set(subKey, subcategoryId);
    }

    const name = buildServiceName(r);
    const payload = {
      department_id: departmentId,
      name,
      user_name: name,
      description: null,
      user_description: null,
      keywords: [r.tier1, r.tier2, r.tier3, r.tier4],
      category_id: categoryId,
      subcategory_id: subcategoryId,
      tier1: r.tier1,
      tier2: r.tier2,
      tier3: r.tier3,
      tier4: r.tier4,
      ticket_type: r.ticket_type,
      default_priority: "Media",
      default_impact: "Medio",
      default_urgency: "Media",
      icon_key: inferIconKey(r.tier1),
      is_active: true,
    };

    const { error } = await supabase
      .from("service_catalog_items")
      .upsert(payload, { onConflict: "department_id,ticket_type,tier1,tier2,tier3,tier4" })
      .select("id")
      .single();
    if (error) throw error;

    // Supabase doesn't expose whether row was inserted vs updated in a simple way here; keep it approximate.
    updated++;
  }

  inserted = Math.max(0, rows.length - updated);

  console.log("[import-tiered-catalog] OK");
  console.log(`- department_id: ${departmentId}`);
  console.log(`- rows: ${rows.length}`);
  console.log(`- updated: ${updated}`);
  console.log(`- inserted (approx): ${inserted}`);
}

main().catch((e) => {
  console.error("[import-tiered-catalog] FAILED");
  console.error(e);
  process.exit(1);
});

