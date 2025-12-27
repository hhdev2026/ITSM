"use client";

import * as React from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
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
import { TicketTypeBadge } from "@/components/tickets/TicketBadges";
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
import { TicketPriorityBadge } from "@/components/tickets/TicketBadges";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { InlineEmpty } from "@/components/feedback/InlineEmpty";
import { SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

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
  const [selectedServiceFromCombo, setSelectedServiceFromCombo] = React.useState<string | null>(null);

  const [tierType, setTierType] = React.useState<string | null>(null);
  const [tier1, setTier1] = React.useState<string | null>(null);
  const [tier2, setTier2] = React.useState<string | null>(null);
  const [tier3, setTier3] = React.useState<string | null>(null);
  const [tier4, setTier4] = React.useState<string | null>(null);

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

  const isEndUser = profile.role === "user";

  const tierTitleFor = React.useCallback((service: ServiceCatalogItem) => {
    const parts = [service.tier2, service.tier3, service.tier4].filter((p) => typeof p === "string" && p.trim().length > 0) as string[];
    if (parts.length >= 2) return parts.join(" · ");
    const v = typeof service.user_name === "string" ? service.user_name.trim() : "";
    return v ? v : service.name;
  }, []);

  const tierPathLabelFor = React.useCallback((service: ServiceCatalogItem) => {
    const parts = [service.ticket_type, service.tier1, service.tier2, service.tier3, service.tier4]
      .filter((p) => typeof p === "string" && p.trim().length > 0) as string[];
    return parts.join(" → ");
  }, []);

  const selectedService = React.useMemo(
    () => (selectedServiceId ? services.find((s) => s.id === selectedServiceId) ?? null : null),
    [selectedServiceId, services]
  );

  const categoryNameById = React.useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const subcategoryNameById = React.useMemo(() => new Map(subcategories.map((s) => [s.id, s.name])), [subcategories]);

  const userNameFor = React.useCallback((service: ServiceCatalogItem): string | null => {
    const v = typeof service.user_name === "string" ? service.user_name.trim() : "";
    return v ? v : null;
  }, []);

  const userDescriptionFor = React.useCallback((service: ServiceCatalogItem): string | null => {
    const v = typeof service.user_description === "string" ? service.user_description.trim() : "";
    return v ? v : null;
  }, []);

  const keywordsFor = React.useCallback((service: ServiceCatalogItem): string[] => {
    return Array.isArray(service.keywords) ? service.keywords.map(String) : [];
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => {
      const uName = userNameFor(s) ?? "";
      const uDesc = userDescriptionFor(s) ?? "";
      const kw = keywordsFor(s).join(" ");
      const tiers = `${s.ticket_type ?? ""} ${s.tier1 ?? ""} ${s.tier2 ?? ""} ${s.tier3 ?? ""} ${s.tier4 ?? ""}`;
      const hay = `${s.name} ${s.description ?? ""} ${uName} ${uDesc} ${kw} ${tiers} ${categoryNameById.get(s.category_id ?? "") ?? ""} ${subcategoryNameById.get(s.subcategory_id ?? "") ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [services, query, categoryNameById, subcategoryNameById, keywordsFor, userDescriptionFor, userNameFor]);

  const comboOptions = React.useMemo(() => {
    const catalog = isEndUser
      ? services.filter((s) => Boolean(s.tier1 && s.tier2 && s.tier3 && s.tier4))
      : services;
    const opts: ComboboxOption[] = [];
    for (const svc of catalog) {
      const label = tierTitleFor(svc);
      const userDesc = userDescriptionFor(svc) ?? svc.description ?? null;
      const hasTiers = Boolean(svc.tier1 || svc.tier2 || svc.tier3 || svc.tier4);
      const desc = hasTiers ? tierPathLabelFor(svc) : userDesc;
      const keywords = [tierPathLabelFor(svc), userDesc ?? "", ...(keywordsFor(svc) ?? [])].join(" ");
      opts.push({ value: svc.id, label, description: desc, keywords });
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return opts;
  }, [isEndUser, keywordsFor, services, tierPathLabelFor, tierTitleFor, userDescriptionFor]);

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
        .select(
          "id,department_id,name,user_name,description,user_description,keywords,category_id,subcategory_id,tier1,tier2,tier3,tier4,ticket_type,default_priority,default_impact,default_urgency,icon_key,is_active"
        )
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
        setError(
          isEndUser
            ? "El catálogo aún no está habilitado para tu área. Contacta a tu administrador."
            : "Service Catalog no está configurado en la base de datos. Aplica las migraciones de Supabase y carga el seed."
        );
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

    const autoTitle = tierTitleFor(service);
    setTitle(isEndUser ? autoTitle : service.name);
    setDescription("");
    setImpact(service.default_impact);
    setUrgency(service.default_urgency);
    setPriorityManual(false);
    setPriority(service.default_priority);
    setMeta({ context: { location: "", asset_tag: "", contact: "" }, fields: {} });

    if (isEndUser) {
      setTierType(service.ticket_type ?? null);
      setTier1(service.tier1 ?? null);
      setTier2(service.tier2 ?? null);
      setTier3(service.tier3 ?? null);
      setTier4(service.tier4 ?? null);
    }
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
      const userName = userNameFor(selectedService) ?? selectedService.name;
      const userDescription = userDescriptionFor(selectedService) ?? selectedService.description ?? null;
      const computedTitle = tierTitleFor(selectedService);
      const metadata = {
        service_catalog: {
          service_id: selectedService.id,
          service_name: selectedService.name,
          user_name: userName,
          user_description: userDescription,
          ticket_type: selectedService.ticket_type,
          tier1: selectedService.tier1 ?? null,
          tier2: selectedService.tier2 ?? null,
          tier3: selectedService.tier3 ?? null,
          tier4: selectedService.tier4 ?? null,
        },
        impact,
        urgency,
        context: (meta.context as Record<string, unknown> | undefined) ?? {},
        fields: fieldsPayload,
      };

      const { error } = await supabase.from("tickets").insert({
        requester_id: profile.id,
        title: isEndUser ? computedTitle : title.trim(),
        description: description.trim() || null,
        type: selectedService.ticket_type,
        priority,
        category_id: selectedService.category_id,
        subcategory_id: selectedService.subcategory_id,
        metadata,
      });
      if (error) throw error;
      toast.success(needsApproval ? "Ticket creado (En espera)" : "Ticket creado");
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
      <PageHeader
        title={isEndUser ? "¿Qué necesitas?" : "Catálogo de servicios"}
        description={
          isEndUser
            ? "Te guiamos paso a paso para crear tu ticket. Puedes buscar por palabras (ej: no imprime, wifi, office, bitdefender…)."
            : "Solicitudes e incidencias estandarizadas (Service Catalog)."
        }
        actions={
          <div className="flex items-center gap-2">
            {isEndUser ? (
              <div className="md:w-[520px]">
                <Combobox
                  value={selectedServiceFromCombo}
                  onValueChange={(id) => {
                    setSelectedServiceFromCombo(id);
                    if (!id) return;
                    const svc = services.find((s) => s.id === id) ?? null;
                    if (svc) openService(svc);
                  }}
                  options={comboOptions}
                  disabled={comboOptions.length === 0}
                  placeholder="Busca tu problema y selecciónalo (ej: no imprime, wifi, office…)…"
                  searchPlaceholder="Buscar…"
                  emptyText={comboOptions.length === 0 ? "Catálogo no disponible." : "Sin resultados."}
                />
              </div>
            ) : (
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar (vpn, permisos, software…)"
                className="md:w-96"
              />
            )}
            <Button variant="outline" onClick={() => void load()}>
              Actualizar
            </Button>
          </div>
        }
      />

      {error ? (
        <InlineAlert variant="error" description={error} />
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
          {isEndUser && comboOptions.length === 0 ? (
            <Card className="tech-border">
              <CardHeader>
                <CardTitle>Catálogo no disponible</CardTitle>
                <CardDescription>Tu área aún no tiene opciones configuradas para crear tickets.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Contacta a tu supervisor/administrador para habilitar el catálogo de servicios.
              </CardContent>
            </Card>
          ) : null}
          {isEndUser && comboOptions.length > 0 ? (
            <Card className="tech-border">
              <CardHeader>
                <CardTitle>Atajos</CardTitle>
                <CardDescription>Accesos rápidos a solicitudes comunes.</CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const catalog = services.filter((s) => Boolean(s.tier1 && s.tier2 && s.tier3 && s.tier4));
                  const preferredTier2 = ["Conexión a Internet", "Impresora", "Aplicaciones de Escritorio", "Seguridad", "Sistema Operativo"];
                  const picks = [...catalog]
                    .sort((a, b) => {
                      const pa = preferredTier2.indexOf(String(a.tier2 ?? ""));
                      const pb = preferredTier2.indexOf(String(b.tier2 ?? ""));
                      const ra = pa === -1 ? 999 : pa;
                      const rb = pb === -1 ? 999 : pb;
                      if (ra !== rb) return ra - rb;
                      return tierTitleFor(a).localeCompare(tierTitleFor(b));
                    })
                    .slice(0, 8);

                  return (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {picks.map((svc) => (
                        <Button key={svc.id} variant="outline" className="h-auto justify-start whitespace-normal py-3 text-left" onClick={() => openService(svc)}>
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{tierTitleFor(svc)}</div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">{tierPathLabelFor(svc)}</div>
                          </div>
                        </Button>
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          ) : null}
          {isEndUser && comboOptions.length > 0 ? (
            <Card className="tech-border">
              <CardHeader>
                <CardTitle>Paso 1: Cuéntanos qué necesitas</CardTitle>
                <CardDescription>Selecciona estas opciones para dirigir tu solicitud al equipo correcto.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="md:col-span-2 text-xs text-muted-foreground">Tip: si sabes el nombre, usa el buscador de arriba para ir más rápido.</div>
                  {(() => {
                    const catalog = services.filter((s) => Boolean(s.tier1 && s.tier2 && s.tier3 && s.tier4));
                    const ticketTypeOptions: ComboboxOption[] = Array.from(new Set(catalog.map((s) => s.ticket_type)))
                      .sort()
                      .map((v) => ({
                        value: v,
                        label: v === "Incidente" ? "Incidente (algo no funciona)" : v === "Requerimiento" ? "Requerimiento (necesito algo)" : v,
                      }));

                    const selectedType = tierType;
                    const inType = selectedType ? catalog.filter((s) => s.ticket_type === selectedType) : catalog;

                    const tier1Options: ComboboxOption[] = Array.from(new Set(inType.map((s) => s.tier1).filter(Boolean) as string[]))
                      .sort()
                      .map((v) => ({ value: v, label: v }));
                    const inTier1 = tier1 ? inType.filter((s) => s.tier1 === tier1) : inType;

                    const tier2Options: ComboboxOption[] = Array.from(new Set(inTier1.map((s) => s.tier2).filter(Boolean) as string[]))
                      .sort()
                      .map((v) => ({ value: v, label: v }));
                    const inTier2 = tier2 ? inTier1.filter((s) => s.tier2 === tier2) : inTier1;

                    const tier3Options: ComboboxOption[] = Array.from(new Set(inTier2.map((s) => s.tier3).filter(Boolean) as string[]))
                      .sort()
                      .map((v) => ({ value: v, label: v }));
                    const inTier3 = tier3 ? inTier2.filter((s) => s.tier3 === tier3) : inTier2;

                    const tier4Options: ComboboxOption[] = Array.from(new Set(inTier3.map((s) => s.tier4).filter(Boolean) as string[]))
                      .sort()
                      .map((v) => ({ value: v, label: v }));

                    const leaf =
                      tierType && tier1 && tier2 && tier3 && tier4
                        ? catalog.find(
                            (s) =>
                              s.ticket_type === tierType && s.tier1 === tier1 && s.tier2 === tier2 && s.tier3 === tier3 && s.tier4 === tier4
                          ) ?? null
                        : null;

                    return (
                      <>
                        <label className="block md:col-span-2">
                          <div className="text-xs text-muted-foreground">Tipo de solicitud</div>
                          <Combobox
                            value={tierType}
                            onValueChange={(v) => {
                              setTierType(v);
                              setTier1(null);
                              setTier2(null);
                              setTier3(null);
                              setTier4(null);
                            }}
                            options={ticketTypeOptions}
                            placeholder="Seleccionar tipo…"
                          />
                        </label>
                        <label className="block">
                          <div className="text-xs text-muted-foreground">Área</div>
                          <Combobox
                            value={tier1}
                            onValueChange={(v) => {
                              setTier1(v);
                              setTier2(null);
                              setTier3(null);
                              setTier4(null);
                            }}
                            options={tier1Options}
                            disabled={!tierType}
                            placeholder="Seleccionar…"
                          />
                        </label>
                        <label className="block">
                          <div className="text-xs text-muted-foreground">Elemento</div>
                          <Combobox
                            value={tier2}
                            onValueChange={(v) => {
                              setTier2(v);
                              setTier3(null);
                              setTier4(null);
                            }}
                            options={tier2Options}
                            disabled={!tierType || !tier1}
                            placeholder="Seleccionar…"
                          />
                        </label>
                        <label className="block">
                          <div className="text-xs text-muted-foreground">Detalle</div>
                          <Combobox
                            value={tier3}
                            onValueChange={(v) => {
                              setTier3(v);
                              setTier4(null);
                            }}
                            options={tier3Options}
                            disabled={!tierType || !tier1 || !tier2}
                            placeholder="Seleccionar…"
                          />
                        </label>
                        <label className="block">
                          <div className="text-xs text-muted-foreground">Qué necesitas</div>
                          <Combobox
                            value={tier4}
                            onValueChange={(v) => setTier4(v)}
                            options={tier4Options}
                            disabled={!tierType || !tier1 || !tier2 || !tier3}
                            placeholder="Seleccionar…"
                          />
                        </label>
                        <div className="md:col-span-2 flex items-center justify-between gap-2">
                          <div className="text-xs text-muted-foreground">
                            {leaf ? (
                              <>
                                Seleccionado: <span className="text-foreground">{tierPathLabelFor(leaf)}</span>
                              </>
                            ) : (
                              "Completa la clasificación para continuar."
                            )}
                          </div>
                          <Button disabled={!leaf} onClick={() => leaf && openService(leaf)}>
                            Continuar
                          </Button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          ) : null}
          {!isEndUser ? (
            grouped.length === 0 ? (
            <Card className="tech-border">
              <CardHeader>
                <CardTitle>Sin servicios</CardTitle>
                <CardDescription>No hay ítems activos en el catálogo para tu departamento.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {isEndUser ? (
                  "Contacta a tu administrador para habilitar el catálogo."
                ) : (
                  <>
                    Verifica que existan registros en <code className="text-foreground">service_catalog_items</code> (y sus categorías/subcategorías) o ejecuta{" "}
                    <code className="text-foreground">supabase/seed.sql</code>.
                  </>
                )}
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
                    const displayName = isEndUser ? userNameFor(svc) ?? svc.name : svc.name;
                    const displayDesc = isEndUser ? userDescriptionFor(svc) ?? svc.description ?? null : svc.description ?? null;
                    const tierLabel = [svc.tier2, svc.tier3, svc.tier4].filter((p) => typeof p === "string" && p.trim().length > 0).join(" · ");
                    return (
                      <MotionItem key={svc.id} id={svc.id}>
                        <Card className="tech-border">
                          <CardHeader className="flex-row items-start justify-between gap-3">
                            <div className="min-w-0">
                              <CardTitle className="truncate">{displayName}</CardTitle>
                              <CardDescription className="line-clamp-2">{displayDesc ?? "—"}</CardDescription>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <TicketTypeBadge type={svc.ticket_type} />
                                <TicketPriorityBadge priority={svc.default_priority} />
                                {sub ? <Badge variant="outline">{sub}</Badge> : null}
                                {tierLabel ? <Badge variant="outline">{tierLabel}</Badge> : null}
                                {!isEndUser && userNameFor(svc) ? <Badge variant="outline">Usuario: {userNameFor(svc)}</Badge> : null}
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
            )
          ) : null}
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
                  <div className="text-xl font-semibold tracking-tight">
                    {isEndUser ? userNameFor(selectedService) ?? selectedService.name : selectedService.name}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {isEndUser
                      ? userDescriptionFor(selectedService) ?? selectedService.description ?? "—"
                      : selectedService.description ?? "—"}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{selectedService.ticket_type}</Badge>
                    <Badge variant="outline">Prioridad: {priority}</Badge>
                    {!isEndUser && userNameFor(selectedService) ? <Badge variant="outline">Vista usuario: {userNameFor(selectedService)}</Badge> : null}
                  </div>
                  {isEndUser && selectedService.tier1 && selectedService.tier2 && selectedService.tier3 && selectedService.tier4 ? (
                    <div className="mt-3 rounded-2xl glass-surface px-3 py-2 text-sm">
                      <div className="text-xs text-muted-foreground">Clasificación</div>
                      <div className="mt-1">{tierPathLabelFor(selectedService)}</div>
                    </div>
                  ) : null}
                </div>

                <div className="tech-border rounded-2xl p-[1px]">
                  <div className="glass-surface rounded-2xl p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">Flujo y tiempos</div>
                        <div className="mt-1 text-xs text-muted-foreground">Aprobaciones (si aplica) y SLA/OLA por servicio.</div>
                      </div>
                      <Badge variant="outline">Prioridad {priority}</Badge>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl glass-surface p-3">
                        <div className="text-xs text-muted-foreground">Aprobaciones</div>
                        {(() => {
                          const steps = selectedService ? approvalStepsByServiceId[selectedService.id] ?? [] : [];
                          if (steps.length === 0) {
                            return <div className="mt-2 text-sm">No requiere aprobación.</div>;
                          }
                          return (
                            <div className="mt-2 space-y-2 text-sm">
                              {steps.map((s) => (
                                <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl glass-surface px-3 py-2">
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

                      <div className="rounded-2xl glass-surface p-3">
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
                              <div className="flex items-center justify-between gap-3 rounded-xl glass-surface px-3 py-2">
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
                              <div className="flex items-center justify-between gap-3 rounded-xl glass-surface px-3 py-2">
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
                  <div className="glass-surface rounded-2xl p-4">
                    <div className="grid gap-3">
                      <label className="block">
                        <div className="text-xs text-muted-foreground">Título</div>
                        <Input value={title} readOnly={isEndUser} onChange={(e) => setTitle(e.target.value)} />
                        {isEndUser ? <div className="mt-1 text-xs text-muted-foreground">Se genera automáticamente según tu selección.</div> : null}
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

                <div className="rounded-2xl glass-surface p-4">
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

                <div className="rounded-2xl glass-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Datos del servicio</div>
                      <div className="mt-1 text-xs text-muted-foreground">Campos específicos para esta solicitud.</div>
                    </div>
                    <Badge variant="outline">{selectedFields.length}</Badge>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {selectedFields.length === 0 ? (
                      <div className="md:col-span-2">
                        <InlineEmpty title="Sin campos adicionales" description="Este servicio no requiere datos extra." icon={<SlidersHorizontal className="h-5 w-5" />} />
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
