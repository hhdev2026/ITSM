import "../dotenv";
import { createSupabaseAdmin } from "../supabase";

type Workflow = {
  id: string;
  department_id: string;
  name: string;
  trigger_condition: unknown;
  action: unknown;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function matchesTrigger(ticket: Record<string, unknown>, triggerCondition: unknown) {
  if (!isRecord(triggerCondition)) return false;
  const ticketCond = triggerCondition.ticket;
  if (!isRecord(ticketCond)) return false;
  for (const [key, expected] of Object.entries(ticketCond)) {
    if (ticket[key] !== expected) return false;
  }
  return true;
}

async function pickLeastLoadedAgent(supabase: ReturnType<typeof createSupabaseAdmin>, departmentId: string) {
  const { data: agents, error: agentsErr } = await supabase
    .from("profiles")
    .select("id,full_name")
    .in("role", ["agent", "supervisor"])
    .eq("department_id", departmentId);
  if (agentsErr) throw agentsErr;
  if (!agents || agents.length === 0) return null;

  const { data: openTickets, error: openErr } = await supabase
    .from("tickets")
    .select("assignee_id")
    .eq("department_id", departmentId)
    .in("status", ["Nuevo", "Asignado", "En Progreso", "Pendiente Info", "Planificado"]);
  if (openErr) throw openErr;

  const loadByAgent = new Map<string, number>();
  for (const a of agents) loadByAgent.set(a.id, 0);
  for (const t of openTickets ?? []) {
    if (t.assignee_id && loadByAgent.has(t.assignee_id)) loadByAgent.set(t.assignee_id, (loadByAgent.get(t.assignee_id) ?? 0) + 1);
  }

  let best: { id: string; load: number } | null = null;
  for (const [id, load] of loadByAgent.entries()) {
    if (!best || load < best.load) best = { id, load };
  }
  return best?.id ?? null;
}

async function runWorkflowAction(supabase: ReturnType<typeof createSupabaseAdmin>, workflow: Workflow, ticket: Record<string, unknown>) {
  if (!isRecord(workflow.action)) return;
  const type = workflow.action.type;
  if (type === "assign_least_loaded_agent") {
    if (ticket.assignee_id) return;
    const agentId = await pickLeastLoadedAgent(supabase, workflow.department_id);
    if (!agentId) return;
    await supabase
      .from("tickets")
      .update({ assignee_id: agentId, status: ticket.status === "Nuevo" ? "Asignado" : ticket.status })
      .eq("id", ticket.id as string);
    return;
  }

  if (type === "set_status") {
    const status = workflow.action.status;
    if (typeof status !== "string") return;
    await supabase.from("tickets").update({ status }).eq("id", ticket.id as string);
    return;
  }

  if (type === "add_internal_comment") {
    const body = workflow.action.body;
    const authorId = workflow.action.author_id;
    if (typeof body !== "string" || typeof authorId !== "string") return;
    await supabase.from("comments").insert({ ticket_id: ticket.id as string, author_id: authorId, body, is_internal: true });
  }
}

async function main() {
  const supabase = createSupabaseAdmin();

  const channel = supabase.channel("workflow-engine");
  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "tickets" },
    async (payload) => {
      const ticket = (payload.new ?? {}) as Record<string, unknown>;
      const departmentId = ticket.department_id;
      if (typeof departmentId !== "string") return;

      const { data: workflows, error } = await supabase
        .from("workflows")
        .select("id,department_id,name,trigger_condition,action")
        .eq("department_id", departmentId)
        .eq("is_active", true);
      if (error) return;

      for (const wf of (workflows ?? []) as Workflow[]) {
        try {
          if (!matchesTrigger(ticket, wf.trigger_condition)) continue;
          await runWorkflowAction(supabase, wf, ticket);
        } catch {
          // ignore workflow failures to keep stream alive
        }
      }
    }
  );

  await channel.subscribe();
  console.log("[workflows] subscribed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
