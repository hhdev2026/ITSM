import "../dotenv";
import { createSupabaseAdmin } from "../supabase";

function normalizeTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const supabase = createSupabaseAdmin();

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: tickets, error } = await supabase
    .from("tickets")
    .select("id,department_id,category_id,title,created_at")
    .gte("created_at", since.toISOString());
  if (error) throw error;

  const groups = new Map<string, { departmentId: string; title: string; ticketIds: string[] }>();
  for (const t of tickets ?? []) {
    const key = `${t.department_id}:${t.category_id ?? "none"}:${normalizeTitle(t.title)}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { departmentId: t.department_id, title: t.title, ticketIds: [t.id] });
    } else {
      existing.ticketIds.push(t.id);
    }
  }

  for (const g of groups.values()) {
    if (g.ticketIds.length < 3) continue;
    const title = `Problema recurrente: ${g.title}`;

    const { data: existing, error: existingErr } = await supabase
      .from("problems")
      .select("id")
      .eq("department_id", g.departmentId)
      .eq("title", title)
      .maybeSingle();
    if (existingErr) continue;
    if (existing?.id) continue;

    await supabase.from("problems").insert({
      department_id: g.departmentId,
      title,
      description: `Detectado automáticamente por recurrencia (>=3) en 30 días.`,
      related_ticket_ids: g.ticketIds,
      status: "En Investigación",
    });
  }

  console.log("[problem-linker] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
