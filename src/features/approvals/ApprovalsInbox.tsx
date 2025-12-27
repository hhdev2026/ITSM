"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { Profile, Ticket } from "@/lib/types";
import { supabase } from "@/lib/supabaseBrowser";
import { errorMessage } from "@/lib/error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionItem, MotionList } from "@/components/motion/MotionList";
import { TicketPriorityBadge, TicketStatusBadge, TicketTypeBadge } from "@/components/tickets/TicketBadges";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Inbox } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

type ApprovalRow = {
  id: string;
  ticket_id: string;
  step_order: number;
  kind: string;
  required: boolean;
  approver_profile_id?: string | null;
  approver_role?: string | null;
  status: "pending" | "approved" | "rejected" | "skipped";
  created_at?: string;
};

function kindLabel(kind: string) {
  if (kind === "requester_manager") return "Manager";
  if (kind === "service_owner") return "Owner";
  if (kind === "specific_user") return "Aprobador";
  if (kind === "role") return "Rol";
  return kind;
}

export function ApprovalsInbox({ profile }: { profile: Profile }) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [approvals, setApprovals] = React.useState<ApprovalRow[]>([]);
  const [ticketsById, setTicketsById] = React.useState<Record<string, Ticket>>({});
  const [commentByTicketId, setCommentByTicketId] = React.useState<Record<string, string>>({});
  const [actingTicketId, setActingTicketId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("ticket_approvals")
        .select("id,ticket_id,step_order,kind,required,status,created_at,approver_profile_id,approver_role")
        .eq("status", "pending")
        .or(`approver_profile_id.eq.${profile.id},and(approver_profile_id.is.null,approver_role.eq.${profile.role})`)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as ApprovalRow[];
      setApprovals(rows);

      const ids = Array.from(new Set(rows.map((r) => r.ticket_id)));
      if (ids.length === 0) {
        setTicketsById({});
        setLoading(false);
        return;
      }

      const { data: tix, error: tErr } = await supabase
        .from("tickets")
        .select("id,department_id,type,title,description,status,priority,category_id,subcategory_id,metadata,requester_id,assignee_id,created_at,updated_at,sla_deadline,response_deadline,ola_deadline,ola_response_deadline,first_response_at,resolved_at,closed_at")
        .in("id", ids);
      if (tErr) throw tErr;
      const byId: Record<string, Ticket> = {};
      for (const t of (tix ?? []) as Ticket[]) byId[t.id] = t;
      setTicketsById(byId);
      setLoading(false);
    } catch (e: unknown) {
      setError(errorMessage(e) ?? "No se pudieron cargar aprobaciones");
      setLoading(false);
    }
  }, [profile.id, profile.role]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function decide(ticketId: string, action: "approve" | "reject") {
    setActingTicketId(ticketId);
    try {
      const comment = commentByTicketId[ticketId]?.trim() || null;
      const { error } = await supabase.rpc("approval_decide", {
        p_ticket_id: ticketId,
        p_action: action,
        p_comment: comment,
      });
      if (error) throw error;
      toast.success(action === "approve" ? "Aprobado" : "Rechazado");
      await load();
    } catch (e: unknown) {
      toast.error("No se pudo decidir", { description: errorMessage(e) ?? "Error" });
    } finally {
      setActingTicketId(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Aprobaciones"
        description="Solicitudes que requieren tu decisión."
        actions={
          <Button variant="outline" onClick={() => void load()}>
            Actualizar
          </Button>
        }
      />

      {error ? (
        <InlineAlert variant="error" description={error} />
      ) : null}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="tech-border">
              <CardHeader>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : approvals.length === 0 ? (
        <EmptyState title="Sin pendientes" description="No tienes aprobaciones pendientes por ahora." icon={<Inbox className="h-5 w-5" />} />
      ) : (
        <MotionList className="grid gap-3 md:grid-cols-2">
          {approvals.map((a) => {
            const t = ticketsById[a.ticket_id];
            return (
              <MotionItem key={a.id} id={a.id}>
                <Card className="tech-border tech-glow">
                  <CardHeader className="gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="truncate">{t?.title ?? "Ticket"}</CardTitle>
                        {t ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <TicketTypeBadge type={t.type} />
                            <TicketPriorityBadge priority={t.priority} />
                            <TicketStatusBadge status={t.status} />
                          </div>
                        ) : (
                          <CardDescription className="line-clamp-2">Cargando datos…</CardDescription>
                        )}
                      </div>
                      <Badge variant="outline">Paso {a.step_order}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{kindLabel(a.kind)}</Badge>
                      {a.required ? <Badge variant="outline">Requerida</Badge> : <Badge variant="outline">Opcional</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Input
                      value={commentByTicketId[a.ticket_id] ?? ""}
                      onChange={(e) => setCommentByTicketId((cur) => ({ ...cur, [a.ticket_id]: e.target.value }))}
                      placeholder="Comentario (opcional)"
                    />
                    <div className="flex items-center gap-2">
                      <Button disabled={actingTicketId === a.ticket_id} onClick={() => void decide(a.ticket_id, "approve")}>
                        Aprobar
                      </Button>
                      <Button disabled={actingTicketId === a.ticket_id} variant="destructive" onClick={() => void decide(a.ticket_id, "reject")}>
                        Rechazar
                      </Button>
                      <Button asChild variant="outline" className="ml-auto">
                        <Link href={`/app/tickets/${a.ticket_id}`}>Ver</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </MotionItem>
            );
          })}
        </MotionList>
      )}
    </div>
  );
}
