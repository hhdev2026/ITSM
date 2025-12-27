import "../dotenv";
import { createSupabaseAdmin } from "../supabase";

type AssetRow = {
  id: string;
  asset_tag: number;
  connectivity_status: "Online" | "Offline" | "Durmiente" | "Desconocido" | "Crítico";
  last_seen_at: string | null;
};

const supabase = createSupabaseAdmin();

function statusForLastSeen(lastSeenAt: string | null) {
  if (!lastSeenAt) return "Desconocido" as const;
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "Desconocido" as const;
  const minutes = ageMs / 60000;
  if (minutes <= 5) return "Online" as const;
  if (minutes <= 240) return "Offline" as const;
  return "Crítico" as const;
}

async function tick() {
  const { data, error } = await supabase
    .from("assets")
    .select("id,asset_tag,connectivity_status,last_seen_at")
    .limit(5000);
  if (error) throw error;

  const assets = (data ?? []) as unknown as AssetRow[];

  const updates: Array<{ id: string; connectivity_status: AssetRow["connectivity_status"] }> = [];
  for (const a of assets) {
    if (a.connectivity_status === "Durmiente") continue;
    const next = statusForLastSeen(a.last_seen_at);
    if (next !== a.connectivity_status) updates.push({ id: a.id, connectivity_status: next });
  }

  for (const u of updates) {
    await supabase.from("assets").update({ connectivity_status: u.connectivity_status, updated_at: new Date().toISOString() }).eq("id", u.id);
  }

  // Alerts: open/resolve offline_unexpected based on computed status
  for (const u of updates) {
    if (u.connectivity_status === "Offline" || u.connectivity_status === "Crítico") {
      const { data: existing } = await supabase
        .from("asset_alerts")
        .select("id,status")
        .eq("asset_id", u.id)
        .eq("kind", "offline_unexpected")
        .eq("status", "open")
        .limit(1);
      if (!existing || existing.length === 0) {
        await supabase.from("asset_alerts").insert({
          asset_id: u.id,
          kind: "offline_unexpected",
          severity: u.connectivity_status === "Crítico" ? "critical" : "warning",
          status: "open",
          title: "Activo sin conectividad",
          message: `Estado calculado: ${u.connectivity_status}`,
          meta: { source: "assets-monitor" },
        });
      }
    }
    if (u.connectivity_status === "Online") {
      await supabase
        .from("asset_alerts")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("asset_id", u.id)
        .eq("kind", "offline_unexpected")
        .eq("status", "open");
    }
  }

  return { total: assets.length, updated: updates.length };
}

async function main() {
  const intervalMs = Number(process.env.ASSETS_MONITOR_INTERVAL_MS ?? 60_000);
  console.log(`[assets-monitor] starting (interval=${intervalMs}ms)`);

  while (true) {
    try {
      const r = await tick();
      console.log(`[assets-monitor] tick ok total=${r.total} updated=${r.updated}`);
    } catch (e) {
      console.error("[assets-monitor] tick error", e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

void main();
