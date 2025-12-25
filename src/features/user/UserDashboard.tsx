"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import type { Category, Profile, Ticket } from "@/lib/types";
import { TicketPriorities, TicketTypes } from "@/lib/constants";
import { errorMessage } from "@/lib/error";
import { isDemoMode } from "@/lib/demo";
import { createTicket as demoCreateTicket, listCategories as demoListCategories, listTickets as demoListTickets } from "@/lib/demoStore";

export function UserDashboard({ profile }: { profile: Profile }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<(typeof TicketTypes)[number]>("Incidente");
  const [priority, setPriority] = useState<(typeof TicketPriorities)[number]>("Media");
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const canCreate = useMemo(() => title.trim().length >= 5, [title]);

  async function load() {
    setLoading(true);
    setError(null);

    if (isDemoMode()) {
      setCategories((demoListCategories(profile.department_id!) as unknown) as Category[]);
      setTickets((demoListTickets({ requester_id: profile.id }) as unknown) as Ticket[]);
      setLoading(false);
      return;
    }

    const { data: cats, error: catErr } = await supabase
      .from("categories")
      .select("id,name,description,department_id")
      .eq("department_id", profile.department_id!)
      .order("name");
    if (catErr) setError(catErr.message);
    setCategories((cats ?? []) as Category[]);

    const { data: tix, error: tErr } = await supabase
      .from("tickets")
      .select("id,department_id,type,title,description,status,priority,category_id,requester_id,assignee_id,created_at,updated_at,sla_deadline,first_response_at,resolved_at,closed_at")
      .eq("requester_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (tErr) setError(tErr.message);
    setTickets((tix ?? []) as Ticket[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    if (isDemoMode()) return;
    const channel = supabase
      .channel(`rt-user-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `requester_id=eq.${profile.id}` }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  async function createTicket() {
    setCreating(true);
    setError(null);
    try {
      if (isDemoMode()) {
        demoCreateTicket({
          requester_id: profile.id,
          title: title.trim(),
          description: description.trim() || null,
          type,
          priority,
          category_id: categoryId,
        });
        setTitle("");
        setDescription("");
        setCategoryId(null);
        await load();
        return;
      }
      const { error } = await supabase.from("tickets").insert({
        requester_id: profile.id,
        title: title.trim(),
        description: description.trim() || null,
        type,
        priority,
        category_id: categoryId,
      });
      if (error) throw error;
      setTitle("");
      setDescription("");
      setCategoryId(null);
      await load();
    } catch (e: unknown) {
      setError(errorMessage(e) ?? "No se pudo crear el ticket");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div>
          <div className="text-xl font-semibold">Mis tickets</div>
          <div className="mt-1 text-sm text-zinc-400">Crea incidentes o requerimientos y da seguimiento al estado.</div>
        </div>
        <Link
          href="/app/kb"
          className="rounded-xl bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-white/10 hover:bg-white/10"
        >
          Autoservicio (KB)
        </Link>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="text-sm font-medium">Crear ticket</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block md:col-span-2">
            <div className="text-xs text-zinc-400">Título</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
              placeholder="Ej: No puedo acceder a VPN"
            />
          </label>
          <label className="block md:col-span-2">
            <div className="text-xs text-zinc-400">Descripción</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 min-h-24 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
              placeholder="Incluye contexto, equipo, error, capturas, etc."
            />
          </label>
          <label className="block">
            <div className="text-xs text-zinc-400">Tipo</div>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as (typeof TicketTypes)[number])}
              className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
            >
              {TicketTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="text-xs text-zinc-400">Prioridad</div>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as (typeof TicketPriorities)[number])}
              className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
            >
              {TicketPriorities.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block md:col-span-2">
            <div className="text-xs text-zinc-400">Categoría</div>
            <select
              value={categoryId ?? ""}
              onChange={(e) => setCategoryId(e.target.value ? e.target.value : null)}
              className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
            >
              <option value="">(Sin categoría)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {error && <div className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-200 ring-1 ring-rose-500/25 md:col-span-2">{error}</div>}
          <div className="md:col-span-2">
            <button
              disabled={!canCreate || creating}
              onClick={createTicket}
              className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
            >
              {creating ? "Creando..." : "Crear ticket"}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Tickets recientes</div>
          <button
            onClick={() => void load()}
            className="rounded-xl bg-white/5 px-3 py-2 text-xs text-white ring-1 ring-white/10 hover:bg-white/10"
          >
            Actualizar
          </button>
        </div>
        {loading ? (
          <div className="mt-4 text-sm text-zinc-400">Cargando...</div>
        ) : tickets.length === 0 ? (
          <div className="mt-4 text-sm text-zinc-400">Aún no tienes tickets.</div>
        ) : (
          <div className="mt-4 divide-y divide-white/10">
            {tickets.map((t) => (
              <Link key={t.id} href={`/app/tickets/${t.id}`} className="block py-3 hover:bg-white/5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    <div className="mt-1 text-xs text-zinc-400">
                      {t.type} · {t.priority} · {t.status}
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500">{new Date(t.created_at).toLocaleString()}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
