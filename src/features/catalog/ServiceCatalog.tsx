"use client";

import * as React from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import { isDemoMode } from "@/lib/demo";
import type { Category, Profile, ServiceCatalogField, ServiceCatalogItem, Subcategory } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TicketPriorities, type TicketPriority } from "@/lib/constants";
import {
  createTicket as demoCreateTicket,
  listCategories as demoListCategories,
  listServiceApprovalSteps as demoListServiceApprovalSteps,
  listServiceCatalogFields,
  listServiceCatalogItems,
  listSlas as demoListSlas,
  listSubcategories as demoListSubcategories,
} from "@/lib/demoStore";
import {
  IconAccess,
  IconApp,
  IconHardware,
  IconMail,
  IconNetwork,
  IconPhone,
  IconShield,
  IconSoftware,
  IconUsers,
} from "@/components/icons/catalog-icons";
import { MotionItem, MotionList } from "@/components/motion/MotionList";

type Impact = "Alto" | "Medio" | "Bajo";
type Urgency = "Alta" | "Media" | "Baja";

type SlaRow = {
  id: string;
  department_id: string | null;
  priority: TicketPriority;
  response_time_hours: number;
  resolution_time_hours: number;
  is_active: boolean;
  updated_at?: string;
};

type ServiceTimeTarget = {
  id: string;
  service_id: string;
  target: "SLA" | "OLA";
  priority: TicketPriority;
  response_time_hours: number;
  resolution_time_hours: number;
  is_active: boolean;
};

type ApprovalStep = {
  id: string;
  service_id: string;
  step_order: number;
  kind: string;
  required: boolean;
  approver_profile_id?: string | null;
  approver_role?: string | null;
};

function priorityFromImpactUrgency(impact: Impact, urgency: Urgency): TicketPriority {
  if (impact === "Alto" && urgency === "Alta") return "Crítica";
  if ((impact === "Alto" && urgency === "Media") || (impact === "Medio" && urgency === "Alta")) return "Alta";
  if ((impact === "Alto" && urgency === "Baja") || (impact === "Medio" && urgency === "Media") || (impact === "Bajo" && urgency === "Alta")) return "Media";
  return "Baja";
}

const iconByKey: Record<string, React.ComponentType<{ className?: string }>> = {
  access: IconAccess,
  mail: IconMail,
  network: IconNetwork,
  hardware: IconHardware,
  software: IconSoftware,
  security: IconShield,
  phone: IconPhone,
  users: IconUsers,
  apps: IconApp,
};

function parseSelectOptions(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

export function ServiceCatalog({ profile, initialQuery }: { profile: Profile; initialQuery?: string }) {
  const [services, setServices] = React.useState<ServiceCatalogItem[]>([]);
  const [fieldsByServiceId, setFieldsByServiceId] = React.useState<Record<string, ServiceCatalogField[]>>({});
  const [approvalStepsByServiceId, setApprovalStepsByServiceId] = React.useState<Record<string, ApprovalStep[]>>({});
  const [timeTargetsByServiceId, setTimeTargetsByServiceId] = React.useState<Record<string, ServiceTimeTarget[]>>({});
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [subcategories, setSubcategories] = React.useState<Subcategory[]>([]);
  const [slas, setSlas] = React.useState<SlaRow[]>([]);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState(initialQuery ?? "");
  const [open, setOpen] = React.useState(false);
  const [selectedServiceId, setSelectedServiceId] = React.useState<string | null>(null);

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [impact, setImpact] = React.useState<Impact>("Medio");
  const [urgency, setUrgency] = React.useState<Urgency>("Media");
  const [priorityManual, setPriorityManual] = React.useState(false);
  const [priority, setPriority] = React.useState<TicketPriority>("Media");
  const [meta, setMeta] = React.useState<{
    context: { location: string; asset_tag: string; contact: string };
    fields: Record<string, unknown>;
  }>({ context: { location: "", asset_tag: "", contact: "" }, fields: {} });
  const [creating, setCreating] = React.useState(false);

  const selectedService = React.useMemo(
    () => (selectedServiceId ? services.find((s) => s.id === selectedServiceId) ?? null : null),
    [selectedServiceId, services]
  );

  const categoryNameById = React.useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const subcategoryNameById = React.useMemo(() => new Map(subcategories.map((s) => [s.id, s.name])), [subcategories]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => {
      const hay = `${s.name} ${s.description ?? ""} ${categoryNameById.get(s.category_id ?? "") ?? ""} ${subcategoryNameById.get(s.subcategory_id ?? "") ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [services, query, categoryNameById, subcategoryNameById]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, ServiceCatalogItem[]>();
    for (const svc of filtered) {
      const cat = svc.category_id ? categoryNameById.get(svc.category_id) : null;
      const key = cat ?? "Otros";
      const list = map.get(key) ?? [];
      list.push(svc);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, categoryNameById]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (isDemoMode()) {
        const cats = (demoListCategories(profile.department_id!) as unknown) as Category[];
        setCategories(cats);
        const subs: Subcategory[] = [];
        for (const c of cats) {
          subs.push(...(((demoListSubcategories(c.id) as unknown) as Subcategory[]) ?? []));
        }
        setSubcategories(subs);

        const items = (listServiceCatalogItems(profile.department_id!) as unknown) as ServiceCatalogItem[];
        setServices(items);
        setSlas((demoListSlas(profile.department_id!) as unknown) as SlaRow[]);
        setLoading(false);
        return;
      }

      const { data: cats, error: catErr } = await supabase
        .from("categories")
        .select("id,name,description,department_id")
        .eq("department_id", profile.department_id!)
        .order("name");
      if (catErr) throw catErr;
      setCategories((cats ?? []) as Category[]);

      const catIds = (cats ?? []).map((c) => c.id);
      if (catIds.length) {
        const { data: subs, error: subErr } = await supabase
          .from("subcategories")
          .select("id,category_id,name,description")
          .in("category_id", catIds)
          .order("name");
        if (subErr) throw subErr;
        setSubcategories((subs ?? []) as Subcategory[]);
      } else {
        setSubcategories([]);
      }

      const { data: svc, error: svcErr } = await supabase
        .from("service_catalog_items")
        .select("id,department_id,name,description,category_id,subcategory_id,ticket_type,default_priority,default_impact,default_urgency,icon_key,is_active")
        .eq("is_active", true)
        .or(`department_id.is.null,department_id.eq.${profile.department_id}`)
        .order("name");
      if (svcErr) throw svcErr;
      setServices((svc ?? []) as ServiceCatalogItem[]);

      const { data: sl, error: slErr } = await supabase
        .from("slas")
        .select("id,department_id,priority,response_time_hours,resolution_time_hours,is_active,updated_at")
        .eq("is_active", true)
        .or(`department_id.is.null,department_id.eq.${profile.department_id}`)
        .order("priority", { ascending: true })
        .order("updated_at", { ascending: false });
      if (slErr) throw slErr;
      setSlas((sl ?? []) as SlaRow[]);

      setLoading(false);
    } catch (e: unknown) {
      const msg = errorMessage(e) ?? "No se pudo cargar el catálogo";
      if (msg.toLowerCase().includes("service_catalog_items") || msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("relation")) {
        setError("Tu base de datos aún no tiene Service Catalog. Aplica `supabase/migrations/006_service_catalog.sql` y luego `supabase/seed.sql`.");
      } else {
        setError(msg);
      }
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.department_id]);

  React.useEffect(() => {
    if (typeof initialQuery !== "string") return;
    setQuery(initialQuery);
  }, [initialQuery]);

  React.useEffect(() => {
    if (priorityManual) return;
    setPriority(priorityFromImpactUrgency(impact, urgency));
  }, [impact, urgency, priorityManual]);

  async function loadFields(serviceId: string) {
    if (fieldsByServiceId[serviceId]) return;
    if (isDemoMode()) {
      setFieldsByServiceId((cur) => ({ ...cur, [serviceId]: (listServiceCatalogFields(serviceId) as unknown) as ServiceCatalogField[] }));
      return;
    }
    const { data, error } = await supabase
      .from("service_catalog_fields")
      .select("id,service_id,key,label,field_type,required,placeholder,help_text,options,sort_order")
      .eq("service_id", serviceId)
      .order("sort_order", { ascending: true });
    if (error) {
      toast.error("No se pudieron cargar campos del servicio", { description: error.message });
      setFieldsByServiceId((cur) => ({ ...cur, [serviceId]: [] }));
      return;
    }
    setFieldsByServiceId((cur) => ({ ...cur, [serviceId]: (data ?? []) as ServiceCatalogField[] }));
  }

  async function loadApprovalSteps(serviceId: string) {
    if (approvalStepsByServiceId[serviceId]) return;
    if (isDemoMode()) {
      setApprovalStepsByServiceId((cur) => ({ ...cur, [serviceId]: (demoListServiceApprovalSteps(serviceId) as unknown) as ApprovalStep[] }));
      return;
    }
    const { data, error } = await supabase
      .from("service_catalog_approval_steps")
      .select("id,service_id,step_order,kind,required,approver_profile_id,approver_role")
      .eq("service_id", serviceId)
      .order("step_order", { ascending: true });
    if (error) {
      toast.error("No se pudieron cargar aprobaciones del servicio", { description: error.message });
      setApprovalStepsByServiceId((cur) => ({ ...cur, [serviceId]: [] }));
      return;
    }
    setApprovalStepsByServiceId((cur) => ({ ...cur, [serviceId]: (data ?? []) as ApprovalStep[] }));
  }

  async function loadTimeTargets(serviceId: string) {
    if (timeTargetsByServiceId[serviceId]) return;
    if (isDemoMode()) {
      setTimeTargetsByServiceId((cur) => ({ ...cur, [serviceId]: [] }));
      return;
    }
    const { data, error } = await supabase
      .from("service_time_targets")
      .select("id,service_id,target,priority,response_time_hours,resolution_time_hours,is_active")
      .eq("service_id", serviceId)
      .eq("is_active", true);
    if (error) {
      toast.error("No se pudieron cargar SLA/OLA del servicio", { description: error.message });
      setTimeTargetsByServiceId((cur) => ({ ...cur, [serviceId]: [] }));
      return;
    }
    setTimeTargetsByServiceId((cur) => ({ ...cur, [serviceId]: (data ?? []) as ServiceTimeTarget[] }));
  }

  function openService(service: ServiceCatalogItem) {
    setSelectedServiceId(service.id);
    setOpen(true);
    void loadFields(service.id);
    void loadApprovalSteps(service.id);
    void loadTimeTargets(service.id);

    setTitle(service.name);
    setDescription("");
    setImpact(service.default_impact);
    setUrgency(service.default_urgency);
    setPriorityManual(false);
    setPriority(service.default_priority);
    setMeta({ context: { location: "", asset_tag: "", contact: "" }, fields: {} });
  }

  const selectedFields = selectedService ? fieldsByServiceId[selectedService.id] ?? [] : [];

  function updateField(key: string, value: unknown) {
    setMeta((cur) => ({ ...cur, fields: { ...cur.fields, [key]: value } }));
  }

  function updateContext(key: string, value: unknown) {
    setMeta((cur) => ({ ...cur, context: { ...cur.context, [key]: value as string } }));
  }

  async function submit() {
    if (!selectedService) return;
    if (!title.trim()) {
      toast.error("Completa el título");
      return;
    }
    if (!selectedService.category_id || !selectedService.subcategory_id) {
      toast.error("Servicio sin categoría/subcategoría");
      return;
    }

    const fieldsPayload = meta.fields;
    const missingRequired = selectedFields
      .filter((f) => f.required)
      .filter((f) => {
        const v = fieldsPayload[f.key];
        if (typeof v === "boolean") return false;
        return v === null || v === undefined || String(v).trim() === "";
      })
      .map((f) => f.label);
    if (missingRequired.length) {
      toast.error("Faltan campos requeridos", { description: missingRequired.slice(0, 3).join(", ") });
      return;
    }

    setCreating(true);
    try {
      const steps = approvalStepsByServiceId[selectedService.id] ?? [];
      const needsApproval = steps.length > 0;
      const metadata = {
        service_catalog: {
          service_id: selectedService.id,
          service_name: selectedService.name,
        },
        impact,
        urgency,
        context: (meta.context as Record<string, unknown> | undefined) ?? {},
        fields: fieldsPayload,
      };

      if (isDemoMode()) {
        demoCreateTicket({
          requester_id: profile.id,
          title: title.trim(),
          description: description.trim() || null,
          type: selectedService.ticket_type,
          priority,
          category_id: selectedService.category_id,
          subcategory_id: selectedService.subcategory_id,
          metadata,
        });
        toast.success(needsApproval ? "Ticket creado (Pendiente Aprobación)" : "Ticket creado");
        setOpen(false);
        setCreating(false);
        return;
      }

      const { error } = await supabase.from("tickets").insert({
        requester_id: profile.id,
        title: title.trim(),
        description: description.trim() || null,
        type: selectedService.ticket_type,
        priority,
        category_id: selectedService.category_id,
        subcategory_id: selectedService.subcategory_id,
        metadata,
      });
      if (error) throw error;
      toast.success(needsApproval ? "Ticket creado (Pendiente Aprobación)" : "Ticket creado");
      setOpen(false);
    } catch (e: unknown) {
      const msg = errorMessage(e) ?? "No se pudo crear el ticket";
      toast.error("No se pudo crear", { description: msg });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Catálogo de servicios</div>
          <div className="mt-1 text-sm text-muted-foreground">Solicitudes e incidencias estandarizadas (Service Catalog).</div>
        </div>
        <div className="flex items-center gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar (vpn, permisos, software…)" className="md:w-96" />
          <Button variant="outline" onClick={() => void load()}>
            Actualizar
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">{error}</div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="tech-border">
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-56" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.length === 0 ? (
            <Card className="tech-border">
              <CardHeader>
                <CardTitle>Sin servicios</CardTitle>
                <CardDescription>No hay ítems activos en el catálogo para tu departamento.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Verifica que existan registros en <code className="text-foreground">service_catalog_items</code> (y sus categorías/subcategorías) o ejecuta{" "}
                <code className="text-foreground">supabase/seed.sql</code>.
              </CardContent>
            </Card>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold">{group}</div>
                  <Badge variant="outline">{items.length}</Badge>
                </div>
                <MotionList className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {items.map((svc) => {
                    const Icon = (svc.icon_key && iconByKey[svc.icon_key]) || IconApp;
                    const sub = svc.subcategory_id ? subcategoryNameById.get(svc.subcategory_id) : null;
                    return (
                      <MotionItem key={svc.id} id={svc.id}>
                        <Card className="tech-border">
                          <CardHeader className="flex-row items-start justify-between gap-3">
                            <div className="min-w-0">
                              <CardTitle className="truncate">{svc.name}</CardTitle>
                              <CardDescription className="line-clamp-2">{svc.description ?? "—"}</CardDescription>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{svc.ticket_type}</Badge>
                                <Badge variant="outline">{svc.default_priority}</Badge>
                                {sub ? <Badge variant="outline">{sub}</Badge> : null}
                              </div>
                            </div>
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--brand-cyan))]/12 text-[hsl(var(--brand-cyan))]">
                              <Icon className="h-5 w-5" />
                            </div>
                          </CardHeader>
                          <CardContent>
                            <Button className="w-full" onClick={() => openService(svc)}>
                              Solicitar
                            </Button>
                          </CardContent>
                        </Card>
                      </MotionItem>
                    );
                  })}
                </MotionList>
              </div>
            ))
          )}
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="tech-app-bg">
          <div className="h-dvh overflow-auto p-6">
            {!selectedService ? (
              <div className="text-sm text-muted-foreground">Selecciona un servicio.</div>
            ) : (
              <div className="space-y-5">
                <div className="pr-10">
                  <div className="text-xl font-semibold tracking-tight">{selectedService.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{selectedService.description ?? "—"}</div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{selectedService.ticket_type}</Badge>
                    <Badge variant="outline">Prioridad: {priority}</Badge>
                  </div>
                </div>

                <div className="tech-border rounded-2xl p-[1px]">
                  <div className="rounded-2xl bg-background/80 p-4 backdrop-blur">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">Flujo y tiempos</div>
                        <div className="mt-1 text-xs text-muted-foreground">Aprobaciones (si aplica) y SLA/OLA por servicio.</div>
                      </div>
                      <Badge variant="outline">Prioridad {priority}</Badge>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-border bg-background/40 p-3">
                        <div className="text-xs text-muted-foreground">Aprobaciones</div>
                        {(() => {
                          const steps = selectedService ? approvalStepsByServiceId[selectedService.id] ?? [] : [];
                          if (steps.length === 0) {
                            return <div className="mt-2 text-sm">No requiere aprobación.</div>;
                          }
                          return (
                            <div className="mt-2 space-y-2 text-sm">
                              {steps.map((s) => (
                                <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background/50 px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline">Paso {s.step_order}</Badge>
                                    <Badge variant="outline">{s.kind === "requester_manager" ? "Manager" : s.kind === "service_owner" ? "Owner" : s.kind}</Badge>
                                  </div>
                                  {s.required ? <Badge variant="outline">Requerida</Badge> : <Badge variant="outline">Opcional</Badge>}
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="rounded-2xl border border-border bg-background/40 p-3">
                        <div className="text-xs text-muted-foreground">SLA / OLA</div>
                        {(() => {
                          if (!selectedService) return null;
                          const targets = timeTargetsByServiceId[selectedService.id] ?? [];
                          const slaOverride = targets.find((t) => t.target === "SLA" && t.priority === priority) ?? null;
                          const olaOverride = targets.find((t) => t.target === "OLA" && t.priority === priority) ?? null;
                          const baseSla = slas.find((s) => s.is_active && s.priority === priority) ?? null;

                          const slaResp = slaOverride?.response_time_hours ?? baseSla?.response_time_hours ?? null;
                          const slaRes = slaOverride?.resolution_time_hours ?? baseSla?.resolution_time_hours ?? null;

                          return (
                            <div className="mt-2 space-y-2 text-sm">
                              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/50 px-3 py-2">
                                <div className="text-muted-foreground">SLA</div>
                                <div className="text-right">
                                  <div>
                                    Resp: <span className="font-medium">{slaResp !== null ? `${slaResp}h` : "n/a"}</span>
                                  </div>
                                  <div>
                                    Res: <span className="font-medium">{slaRes !== null ? `${slaRes}h` : "n/a"}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/50 px-3 py-2">
                                <div className="text-muted-foreground">OLA</div>
                                {olaOverride ? (
                                  <div className="text-right">
                                    <div>
                                      Resp: <span className="font-medium">{olaOverride.response_time_hours}h</span>
                                    </div>
                                    <div>
                                      Res: <span className="font-medium">{olaOverride.resolution_time_hours}h</span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-right text-muted-foreground">No definido</div>
                                )}
                              </div>
                              {slaOverride ? (
                                <div className="text-xs text-muted-foreground">Este servicio tiene override de SLA para {priority}.</div>
                              ) : (
                                <div className="text-xs text-muted-foreground">SLA usa tabla SLAs (departamento/global).</div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="tech-border rounded-2xl p-[1px]">
                  <div className="rounded-2xl bg-background/80 p-4 backdrop-blur">
                    <div className="grid gap-3">
                      <label className="block">
                        <div className="text-xs text-muted-foreground">Título</div>
                        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                      </label>

                      <label className="block">
                        <div className="text-xs text-muted-foreground">Descripción</div>
                        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contexto adicional, pasos, capturas…" />
                      </label>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="block">
                          <div className="text-xs text-muted-foreground">Impacto</div>
                          <select
                            value={impact}
                            onChange={(e) => setImpact(e.target.value as Impact)}
                            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                          >
                            {(["Alto", "Medio", "Bajo"] as const).map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <div className="text-xs text-muted-foreground">Urgencia</div>
                          <select
                            value={urgency}
                            onChange={(e) => setUrgency(e.target.value as Urgency)}
                            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                          >
                            {(["Alta", "Media", "Baja"] as const).map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <input type="checkbox" checked={priorityManual} onChange={(e) => setPriorityManual(e.target.checked)} />
                          Prioridad manual
                        </label>
                        <div>
                          <div className="text-xs text-muted-foreground">Prioridad</div>
                          <select
                            value={priority}
                            disabled={!priorityManual}
                            onChange={(e) => setPriority(e.target.value as TicketPriority)}
                            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:opacity-60"
                          >
                            {TicketPriorities.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-background/50 p-4">
                  <div className="text-sm font-semibold">Contexto</div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Ubicación</div>
                      <Input value={meta.context.location} onChange={(e) => updateContext("location", e.target.value)} />
                    </label>
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Asset tag / equipo</div>
                      <Input value={meta.context.asset_tag} onChange={(e) => updateContext("asset_tag", e.target.value)} />
                    </label>
                    <label className="block md:col-span-2">
                      <div className="text-xs text-muted-foreground">Contacto</div>
                      <Input value={meta.context.contact} onChange={(e) => updateContext("contact", e.target.value)} />
                    </label>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-background/50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Datos del servicio</div>
                      <div className="mt-1 text-xs text-muted-foreground">Campos específicos para esta solicitud.</div>
                    </div>
                    <Badge variant="outline">{selectedFields.length}</Badge>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {selectedFields.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground md:col-span-2">
                        Sin campos adicionales.
                      </div>
                    ) : (
                      selectedFields.map((f) => {
                        const value = meta.fields[f.key];
                        const requiredMark = f.required ? " *" : "";

                        if (f.field_type === "textarea") {
                          return (
                            <label key={f.id} className="block md:col-span-2">
                              <div className="text-xs text-muted-foreground">
                                {f.label}
                                {requiredMark}
                              </div>
                              <Textarea
                                value={String(value ?? "")}
                                onChange={(e) => updateField(f.key, e.target.value)}
                                placeholder={f.placeholder ?? undefined}
                              />
                              {f.help_text ? <div className="mt-1 text-xs text-muted-foreground">{f.help_text}</div> : null}
                            </label>
                          );
                        }

                        if (f.field_type === "select") {
                          const options = parseSelectOptions(f.options);
                          return (
                            <label key={f.id} className="block">
                              <div className="text-xs text-muted-foreground">
                                {f.label}
                                {requiredMark}
                              </div>
                              <select
                                value={String(value ?? "")}
                                onChange={(e) => updateField(f.key, e.target.value)}
                                className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                              >
                                <option value="">(Seleccionar)</option>
                                {options.map((o) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
                              </select>
                              {f.help_text ? <div className="mt-1 text-xs text-muted-foreground">{f.help_text}</div> : null}
                            </label>
                          );
                        }

                        if (f.field_type === "boolean") {
                          return (
                            <label key={f.id} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={Boolean(value)} onChange={(e) => updateField(f.key, e.target.checked)} />
                              <span className="text-muted-foreground">{f.label}</span>
                            </label>
                          );
                        }

                        return (
                          <label key={f.id} className="block">
                            <div className="text-xs text-muted-foreground">
                              {f.label}
                              {requiredMark}
                            </div>
                            <Input
                              value={String(value ?? "")}
                              onChange={(e) => updateField(f.key, e.target.value)}
                              placeholder={f.placeholder ?? undefined}
                              inputMode={f.field_type === "number" ? "numeric" : undefined}
                            />
                            {f.help_text ? <div className="mt-1 text-xs text-muted-foreground">{f.help_text}</div> : null}
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {selectedService.category_id ? (
                      <span>
                        {categoryNameById.get(selectedService.category_id) ?? "—"} →{" "}
                        {selectedService.subcategory_id ? subcategoryNameById.get(selectedService.subcategory_id) ?? "—" : "—"}
                      </span>
                    ) : null}
                  </div>
                  <Button disabled={creating} onClick={() => void submit()}>
                    {creating ? "Creando..." : "Crear"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
