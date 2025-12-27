"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import type { Profile, Ticket } from "@/lib/types";
import { isDemoMode } from "@/lib/demo";
import { listTickets as demoListTickets } from "@/lib/demoStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionItem, MotionList } from "@/components/motion/MotionList";
import { TicketPriorityBadge, TicketStatusBadge, TicketTypeBadge } from "@/components/tickets/TicketBadges";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Ticket as TicketIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

export function UserDashboard({ profile }: { profile: Profile }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [catalogQuery, setCatalogQuery] = useState("");

  const canSearchCatalog = useMemo(() => catalogQuery.trim().length >= 2, [catalogQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (isDemoMode()) {
      setTickets((demoListTickets({ requester_id: profile.id }) as unknown) as Ticket[]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("tickets")
      .select(
        "id,department_id,type,title,description,status,priority,category_id,subcategory_id,metadata,requester_id,assignee_id,created_at,updated_at,sla_deadline,first_response_at,resolved_at,closed_at"
      )
      .eq("requester_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) setError(error.message);
    setTickets((data ?? []) as Ticket[]);
    setLoading(false);
  }, [profile.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    if (isDemoMode()) return;
    const channel = supabase
      .channel(`rt-user-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `requester_id=eq.${profile.id}` }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, profile.id]);

  const catalogHref = canSearchCatalog ? `/app/catalog?q=${encodeURIComponent(catalogQuery.trim())}` : "/app/catalog";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mis tickets"
        description="Crea solicitudes desde el catálogo y da seguimiento al estado."
        actions={
          <Button asChild>
            <Link href="/app/catalog">Nuevo ticket</Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="tech-border tech-glow">
          <CardHeader>
            <CardTitle>Service Catalog</CardTitle>
            <CardDescription>Selecciona una casuística y completa un formulario inteligente (campos por servicio).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Input value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder="Buscar en el catálogo (vpn, permisos, software…)" />
              <Button asChild variant="secondary" className="md:shrink-0">
                <Link href={catalogHref}>Abrir catálogo</Link>
              </Button>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Tip: usa <code className="text-foreground">Ctrl/⌘K</code> para navegación rápida.
            </div>
          </CardContent>
        </Card>

        <Card className="tech-border">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recientes</CardTitle>
              <CardDescription>Últimos tickets creados por ti.</CardDescription>
            </div>
            <Button variant="outline" onClick={() => void load()}>
              Actualizar
            </Button>
          </CardHeader>
          <CardContent>
            {error ? (
              <InlineAlert variant="error" description={error} />
            ) : null}

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : tickets.length === 0 ? (
              <EmptyState title="Aún no tienes tickets" description="Crea uno desde el catálogo para comenzar." icon={<TicketIcon className="h-5 w-5" />} />
            ) : (
              <MotionList className="divide-y divide-border">
                {tickets.map((t) => (
                  <MotionItem key={t.id} id={t.id}>
                    <Link href={`/app/tickets/${t.id}`} className="block rounded-lg py-3 transition-colors hover:bg-accent/40">
                      <div className="flex items-center justify-between gap-3 px-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{t.title}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <TicketTypeBadge type={t.type} />
                            <TicketPriorityBadge priority={t.priority} />
                            <TicketStatusBadge status={t.status} />
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</div>
                      </div>
                    </Link>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
