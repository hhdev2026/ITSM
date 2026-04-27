import "../dotenv";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";

const DATASET_ID = "establecimientos_minsal_demo_2026_04";
const DEFAULT_SOURCE = "data/demo/establecimientos-muestra.csv";
const DEFAULT_DEPARTMENT_ID = "11111111-1111-1111-1111-111111111111";
const DEFAULT_PASSWORD = "DemoTicketera2026!";

type EstablishmentRow = {
  zona: string;
  servicio_salud: string;
  establecimiento: string;
  direccion: string;
  region: string;
  comuna: string;
  encargado_deploy: string;
  correo_encargado: string;
  telefono_contacto: string;
  filas_origen: string;
};

type DemoUser = {
  id: string;
  email: string;
  full_name: string;
  role: "user" | "agent" | "supervisor";
};

type CategoryMap = Map<string, { id: string; subcategories: Map<string, string> }>;
type DemoTable = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};
type DemoDatabase = {
  public: {
    Tables: Record<string, DemoTable>;
    Views: Record<string, DemoTable>;
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, unknown>;
  };
};
type DemoSupabaseClient = ReturnType<typeof createClient<DemoDatabase>>;

const regionCoordinates: Record<string, [number, number]> = {
  "Arica y Parinacota": [-18.4783, -70.3126],
  Tarapacá: [-20.2133, -70.1524],
  Antofagasta: [-23.6509, -70.3975],
  Atacama: [-27.3668, -70.3323],
  Coquimbo: [-29.9533, -71.3436],
  Valparaíso: [-33.0472, -71.6127],
  Metropolitana: [-33.4489, -70.6693],
  "Libertador B. O'Higgins": [-34.1701, -70.7406],
  Maule: [-35.4264, -71.6554],
  Ñuble: [-36.6063, -72.1024],
  Biobío: [-36.8269, -73.0498],
  "La Araucanía": [-38.7359, -72.5904],
  "Los Ríos": [-39.8196, -73.2452],
  "Los Lagos": [-41.4693, -72.9424],
  Aysén: [-45.5712, -72.0685],
  "Magallanes y Antártica": [-53.1638, -70.9171],
};

const demoUsers: DemoUser[] = [
  { id: uuidFor("user:supervisor"), email: "supervisor.demo@nuestravticketera.local", full_name: "Supervisora Demo Salud", role: "supervisor" },
  { id: uuidFor("user:agent:norte"), email: "agente.norte.demo@nuestravticketera.local", full_name: "Agente Zona Norte", role: "agent" },
  { id: uuidFor("user:agent:centro"), email: "agente.centro.demo@nuestravticketera.local", full_name: "Agente Zona Centro", role: "agent" },
  { id: uuidFor("user:agent:sur"), email: "agente.sur.demo@nuestravticketera.local", full_name: "Agente Zona Sur", role: "agent" },
  { id: uuidFor("user:requester"), email: "mesa.salud.demo@nuestravticketera.local", full_name: "Mesa Salud Demo", role: "user" },
];

const ticketScenarios = [
  { category: "Red", subcategory: "LAN / Cable", title: "Caída de enlace en {site}", priority: "Alta", type: "Incidente" },
  { category: "Hardware", subcategory: "Impresora no imprime", title: "Impresora sin respuesta en SOME de {site}", priority: "Media", type: "Incidente" },
  { category: "Software", subcategory: "Actualización", title: "Actualización de agente remoto en {site}", priority: "Baja", type: "Requerimiento" },
  { category: "Accesos", subcategory: "Permisos y roles", title: "Habilitar acceso a inventario para encargado de {site}", priority: "Media", type: "Requerimiento" },
  { category: "Seguridad", subcategory: "Incidente de seguridad", title: "Equipo crítico sin telemetría en {site}", priority: "Crítica", type: "Incidente" },
] as const;

const assetProfiles = [
  { suffix: "router", type: "Router", category: "Red", subcategory: "Borde WAN", manufacturer: "Cisco", model: "ISR 1100" },
  { suffix: "switch", type: "Switch", category: "Red", subcategory: "Acceso", manufacturer: "Cisco", model: "Catalyst 1000" },
  { suffix: "ap", type: "Access Point", category: "Red", subcategory: "WiFi", manufacturer: "Ubiquiti", model: "UniFi 6" },
  { suffix: "printer", type: "Impresora", category: "Hardware", subcategory: "Multifuncional", manufacturer: "HP", model: "LaserJet M428" },
  { suffix: "workstation", type: "PC", category: "Hardware", subcategory: "Puesto clínico", manufacturer: "Lenovo", model: "ThinkCentre M70q" },
  { suffix: "notebook", type: "Laptop", category: "Hardware", subcategory: "Encargado", manufacturer: "Dell", model: "Latitude 5440" },
] as const;

function uuidFor(input: string) {
  const hex = createHash("sha1").update(`${DATASET_ID}:${input}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

function stableInt(input: string, max: number) {
  return parseInt(createHash("sha1").update(input).digest("hex").slice(0, 8), 16) % max;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function slug(value: string) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function parseRows(pathname: string) {
  const full = resolve(process.cwd(), pathname);
  if (!existsSync(full)) throw new Error(`No existe el archivo de muestra: ${full}`);
  const parsed = Papa.parse<EstablishmentRow>(readFileSync(full, "utf8"), { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(parsed.errors[0]?.message ?? "csv_parse_error");
  return parsed.data
    .map((row) => ({
      zona: normalizeText(row.zona),
      servicio_salud: normalizeText(row.servicio_salud),
      establecimiento: normalizeText(row.establecimiento),
      direccion: normalizeText(row.direccion),
      region: normalizeText(row.region),
      comuna: normalizeText(row.comuna),
      encargado_deploy: normalizeText(row.encargado_deploy),
      correo_encargado: normalizeText(row.correo_encargado).toLowerCase(),
      telefono_contacto: normalizeText(row.telefono_contacto),
      filas_origen: normalizeText(row.filas_origen),
    }))
    .filter((row) => row.establecimiento && row.region && row.comuna);
}

function coordinatesFor(row: EstablishmentRow, index: number) {
  const base = regionCoordinates[row.region] ?? [-33.4489, -70.6693];
  const jitterA = (stableInt(`${row.establecimiento}:${index}:lat`, 900) - 450) / 10000;
  const jitterB = (stableInt(`${row.establecimiento}:${index}:lng`, 900) - 450) / 10000;
  return { latitude: Number((base[0] + jitterA).toFixed(6)), longitude: Number((base[1] + jitterB).toFixed(6)) };
}

function statusFor(seed: string) {
  const n = stableInt(seed, 100);
  if (n < 54) return "Online";
  if (n < 72) return "Durmiente";
  if (n < 88) return "Offline";
  if (n < 94) return "Crítico";
  return "Desconocido";
}

function lifecycleFor(seed: string) {
  const n = stableInt(seed, 100);
  if (n < 84) return "Activo";
  if (n < 93) return "En reparación";
  if (n < 98) return "Retirado";
  return "Descartado";
}

function isoHoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function chunks<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function pickAgent(row: EstablishmentRow) {
  const zona = row.zona.toUpperCase();
  if (zona.includes("NORTE")) return demoUsers[1];
  if (zona.includes("SUR") || zona.includes("AUSTRAL")) return demoUsers[3];
  return demoUsers[2];
}

async function ensureDemoUsers(supabase: DemoSupabaseClient, departmentId: string) {
  for (const user of demoUsers) {
    const { data: profile } = await supabase.from("profiles").select("id").eq("email", user.email).maybeSingle();
    let id = profile?.id as string | undefined;

    if (!id) {
      const created = await supabase.auth.admin.createUser({
        email: user.email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: user.full_name },
      });
      if (created.error && !created.error.message.toLowerCase().includes("already")) throw created.error;
      id = created.data.user?.id;
    }

    if (!id) {
      const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      id = data.users.find((item) => item.email?.toLowerCase() === user.email)?.id;
    }

    if (!id) throw new Error(`No se pudo crear/encontrar usuario demo ${user.email}`);
    user.id = id;
    const updated = await supabase.auth.admin.updateUserById(id, {
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: user.full_name },
    });
    if (updated.error) throw updated.error;

    const { error } = await supabase.from("profiles").upsert(
      {
        id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        department_id: departmentId,
        rank: "Demo",
        points: user.role === "user" ? 25 : 250,
      },
      { onConflict: "id" }
    );
    if (error) throw error;
  }
}

async function ensureCategories(supabase: DemoSupabaseClient, departmentId: string): Promise<CategoryMap> {
  const needed = new Map<string, Set<string>>();
  for (const scenario of ticketScenarios) {
    if (!needed.has(scenario.category)) needed.set(scenario.category, new Set());
    needed.get(scenario.category)?.add(scenario.subcategory);
  }

  for (const [name] of needed) {
    const { error } = await supabase.from("categories").upsert({ department_id: departmentId, name, description: `Demo ${name}` }, { onConflict: "department_id,name" });
    if (error) throw error;
  }

  const { data: categories, error: catError } = await supabase.from("categories").select("id,name").eq("department_id", departmentId);
  if (catError) throw catError;
  const result: CategoryMap = new Map();
  for (const cat of categories ?? []) result.set(String(cat.name), { id: String(cat.id), subcategories: new Map() });

  for (const [categoryName, subcategories] of needed) {
    const category = result.get(categoryName);
    if (!category) continue;
    for (const name of subcategories) {
      const { error } = await supabase.from("subcategories").upsert({ category_id: category.id, name, description: `Demo ${name}` }, { onConflict: "category_id,name" });
      if (error) throw error;
    }
    const { data, error } = await supabase.from("subcategories").select("id,name").eq("category_id", category.id);
    if (error) throw error;
    for (const sub of data ?? []) category.subcategories.set(String(sub.name), String(sub.id));
  }

  return result;
}

async function cleanupDemoData(supabase: DemoSupabaseClient) {
  console.log("  - buscando activos demo previos");
  const { data: assets } = await supabase.from("assets").select("id").contains("metadata", { demo_dataset: DATASET_ID });
  const assetIds = (assets ?? []).map((row) => row.id as string);
  if (assetIds.length) {
    console.log(`  - eliminando ${assetIds.length} activos demo previos`);
    for (const ids of chunks(assetIds, 80)) {
      await supabase.from("asset_alerts").delete().in("asset_id", ids);
      await supabase.from("asset_connectivity_events").delete().in("asset_id", ids);
      await supabase.from("asset_assignments").delete().in("asset_id", ids);
      const { error } = await supabase.from("assets").delete().in("id", ids);
      if (error) throw error;
    }
  }

  console.log("  - buscando tickets demo previos");
  const { data: tickets } = await supabase.from("tickets").select("id").contains("metadata", { demo_dataset: DATASET_ID });
  const ticketIds = (tickets ?? []).map((row) => row.id as string);
  if (ticketIds.length) {
    console.log(`  - eliminando ${ticketIds.length} tickets demo previos`);
    for (const ids of chunks(ticketIds, 80)) {
      await supabase.from("comments").delete().in("ticket_id", ids);
      await supabase.from("ticket_events").delete().in("ticket_id", ids);
      await supabase.from("ticket_approvals").delete().in("ticket_id", ids);
      const { error } = await supabase.from("tickets").delete().in("id", ids);
      if (error) throw error;
    }
  }

  console.log("  - eliminando sedes demo previas");
  const { error } = await supabase.from("asset_sites").delete().contains("metadata", { demo_dataset: DATASET_ID });
  if (error && error.code !== "PGRST205") throw error;
}

async function main() {
  const source = process.argv[2] ?? DEFAULT_SOURCE;
  const limit = Number(process.env.DEMO_ESTABLISHMENTS_LIMIT ?? "160");
  let departmentId = process.env.DEMO_DEPARTMENT_ID ?? "";
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Faltan SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env");

  const rows = parseRows(source).slice(0, limit);
  const supabase = createClient<DemoDatabase>(url, serviceRoleKey, { auth: { persistSession: false } });

  console.log("Preparando departamento demo...");
  if (!departmentId) {
    const { data: existingDept, error: existingDeptError } = await supabase.from("departments").select("id").eq("name", "TI").maybeSingle();
    if (existingDeptError) throw existingDeptError;
    departmentId = String(existingDept?.id ?? DEFAULT_DEPARTMENT_ID);
  }

  const { data: deptById, error: deptByIdError } = await supabase.from("departments").select("id").eq("id", departmentId).maybeSingle();
  if (deptByIdError) throw deptByIdError;
  if (!deptById) {
    const { error: deptError } = await supabase.from("departments").insert({ id: departmentId, name: "TI", description: "Departamento de Tecnología" });
    if (deptError) throw deptError;
  }

  console.log("Preparando usuarios y categorías demo...");
  await ensureDemoUsers(supabase, departmentId);
  const categories = await ensureCategories(supabase, departmentId);
  console.log("Limpiando datos demo previos...");
  await cleanupDemoData(supabase);

  const siteRows = rows.map((row, index) => {
    const coords = coordinatesFor(row, index);
    return {
      id: uuidFor(`site:${row.establecimiento}:${row.comuna}:${index}`),
      department_id: departmentId,
      name: `${row.establecimiento} - ${row.comuna} #${String(index + 1).padStart(3, "0")}`,
      region: row.region,
      comuna: row.comuna,
      address: row.direccion,
      latitude: coords.latitude,
      longitude: coords.longitude,
      radius_m: 350,
      metadata: { demo_dataset: DATASET_ID, zona: row.zona, servicio_salud: row.servicio_salud, source_count: Number(row.filas_origen || 0), contact: row.encargado_deploy, email: row.correo_encargado, phone: row.telefono_contacto },
    };
  });
  const { error: sitesError } = await supabase.from("asset_sites").insert(siteRows);
  const canUseSites = !sitesError;
  if (sitesError && sitesError.code !== "PGRST205") throw sitesError;

  const assetRows = rows.flatMap((row, index) => {
    const coords = coordinatesFor(row, index);
    const estimated = Math.max(3, Math.min(18, Math.ceil(Number(row.filas_origen || 1) / 8)));
    const profiles = assetProfiles.slice(0, Math.min(assetProfiles.length, estimated));
    return profiles.map((profile, assetIndex) => {
      const seed = `${row.establecimiento}:${row.comuna}:${profile.suffix}:${assetIndex}`;
      const connectivity = statusFor(seed);
      const lifecycle = lifecycleFor(seed);
      const risk = connectivity === "Crítico" ? 92 : connectivity === "Offline" ? 78 : lifecycle === "En reparación" ? 67 : stableInt(seed, 45);
      const asset: Record<string, unknown> = {
        department_id: departmentId,
        name: `${profile.type} ${row.establecimiento}`,
        serial_number: `DEMO-${String(index + 1).padStart(3, "0")}-${slug(row.comuna)}-${slug(row.establecimiento)}-${profile.suffix}`.toUpperCase().slice(0, 120),
        barcode: `BC-${stableInt(seed, 999999).toString().padStart(6, "0")}`,
        manufacturer: profile.manufacturer,
        model: profile.model,
        asset_type: profile.type,
        category: profile.category,
        subcategory: profile.subcategory,
        region: row.region,
        comuna: row.comuna,
        building: row.establecimiento,
        floor: String((stableInt(`${seed}:floor`, 4) + 1)),
        room: profile.suffix === "router" || profile.suffix === "switch" ? "Sala comunicaciones" : "Atención usuarios",
        address: row.direccion,
        latitude: coords.latitude,
        longitude: coords.longitude,
        cost_center: row.servicio_salud,
        department_name: row.zona,
        lifecycle_status: lifecycle,
        connectivity_status: connectivity,
        last_seen_at: connectivity === "Online" ? isoHoursAgo(stableInt(seed, 8) + 1) : connectivity === "Durmiente" ? isoHoursAgo(36 + stableInt(seed, 96)) : null,
        last_ip: `10.${stableInt(row.region, 200) + 20}.${stableInt(row.comuna, 200) + 20}.${stableInt(seed, 220) + 10}`,
        last_mac: `02:42:${createHash("sha1").update(seed).digest("hex").slice(0, 10).match(/../g)?.join(":")}`,
        last_hostname: `${profile.suffix}-${slug(row.comuna)}-${String(index + 1).padStart(3, "0")}`.slice(0, 64),
        last_network_type: profile.category === "Red" ? "LAN" : "LAN/WiFi",
        failure_risk_pct: risk,
        tags: ["demo", row.zona, row.region, row.servicio_salud].filter(Boolean),
        metadata: { demo_dataset: DATASET_ID, source: "listado establecimientos.xlsx", source_count: Number(row.filas_origen || 0), encargado_deploy: row.encargado_deploy, correo_encargado: row.correo_encargado, telefono_contacto: row.telefono_contacto },
        created_at: isoHoursAgo(24 * (stableInt(seed, 28) + 3)),
        updated_at: isoHoursAgo(stableInt(seed, 48) + 1),
      };
      if (canUseSites) asset.site_id = siteRows[index].id;
      return asset;
    });
  });
  console.log(`Insertando activos demo (${assetRows.length})...`);
  const { data: insertedAssets, error: assetsError } = await supabase.from("assets").insert(assetRows).select("id,serial_number,connectivity_status,failure_risk_pct");
  if (assetsError) throw assetsError;

  console.log("Insertando eventos de conectividad...");
  const eventRows = (insertedAssets ?? []).map((asset) => ({
    asset_id: asset.id,
    status: asset.connectivity_status,
    occurred_at: isoHoursAgo(stableInt(String(asset.serial_number), 72) + 1),
    meta: { demo_dataset: DATASET_ID, source: "demo-seed" },
  }));
  if (eventRows.length) {
    const { error } = await supabase.from("asset_connectivity_events").insert(eventRows);
    if (error) throw error;
  }

  console.log("Insertando alertas demo...");
  const alertRows = (insertedAssets ?? [])
    .filter((asset) => asset.connectivity_status === "Crítico" || asset.connectivity_status === "Offline" || Number(asset.failure_risk_pct) >= 80)
    .map((asset) => ({
      asset_id: asset.id,
      kind: asset.connectivity_status === "Crítico" ? "connectivity_critical" : "predictive_risk",
      severity: asset.connectivity_status === "Crítico" ? "critical" : "warning",
      status: "open",
      title: asset.connectivity_status === "Crítico" ? "Activo crítico sin conexión" : "Riesgo predictivo elevado",
      message: "Alerta de demo generada desde listado real de establecimientos.",
      opened_at: isoHoursAgo(stableInt(String(asset.serial_number), 96) + 1),
      meta: { demo_dataset: DATASET_ID },
    }));
  if (alertRows.length) {
    const { error } = await supabase.from("asset_alerts").insert(alertRows);
    if (error) throw error;
  }

  console.log("Insertando tickets demo...");
  const requester = demoUsers.find((user) => user.role === "user") ?? demoUsers[0];
  const ticketRows = rows.slice(0, Math.min(rows.length, 90)).map((row, index) => {
    const scenario = ticketScenarios[index % ticketScenarios.length];
    const category = categories.get(scenario.category);
    const agent = pickAgent(row);
    const ageHours = 4 + stableInt(`${row.establecimiento}:ticket:${index}`, 28 * 24);
    const isClosed = index % 5 === 0 || index % 7 === 0;
    const status = isClosed ? "Cerrado" : index % 6 === 0 ? "En Espera" : index % 4 === 0 ? "Planificado o Coordinado" : "En Curso";
    const createdAt = isoHoursAgo(ageHours);
    const firstResponseAt = isoHoursAgo(Math.max(1, ageHours - (1 + stableInt(`${index}:response`, 10))));
    const closedAt = isClosed ? isoHoursAgo(Math.max(1, ageHours - (4 + stableInt(`${index}:closed`, 48)))) : null;
    return {
      department_id: departmentId,
      type: scenario.type,
      title: scenario.title.replace("{site}", row.establecimiento),
      description: `Demo basada en establecimiento real: ${row.establecimiento}, ${row.comuna}, ${row.region}. Servicio: ${row.servicio_salud}. Encargado deploy: ${row.encargado_deploy || "sin dato"}.`,
      status,
      priority: scenario.priority,
      category_id: category?.id ?? null,
      subcategory_id: category?.subcategories.get(scenario.subcategory) ?? null,
      requester_id: requester.id,
      assignee_id: status === "En Curso" || status === "Planificado o Coordinado" || status === "Cerrado" ? agent.id : null,
      created_at: createdAt,
      updated_at: closedAt ?? isoHoursAgo(stableInt(`${index}:updated`, 12) + 1),
      first_response_at: firstResponseAt,
      resolved_at: closedAt,
      closed_at: closedAt,
      metadata: { demo_dataset: DATASET_ID, establecimiento: row.establecimiento, region: row.region, comuna: row.comuna, zona: row.zona, servicio_salud: row.servicio_salud },
    };
  });
  const { data: insertedTickets, error: ticketsError } = await supabase.from("tickets").insert(ticketRows).select("id,status,assignee_id,requester_id");
  if (ticketsError) throw ticketsError;

  const commentRows = (insertedTickets ?? []).flatMap((ticket, index) => {
    const author = ticket.assignee_id || demoUsers[0].id;
    return [
      { ticket_id: ticket.id, author_id: ticket.requester_id, body: "Se reporta caso desde establecimiento incluido en la muestra demo.", is_internal: false, created_at: isoHoursAgo(18 + index) },
      { ticket_id: ticket.id, author_id: author, body: "Se revisa contexto, activo asociado y criticidad para priorización.", is_internal: false, created_at: isoHoursAgo(12 + index) },
    ];
  });
  if (commentRows.length) {
    const { error } = await supabase.from("comments").insert(commentRows);
    if (error) throw error;
  }

  console.log(`Demo cargada: ${rows.length} establecimientos, ${assetRows.length} activos, ${alertRows.length} alertas, ${ticketRows.length} tickets.`);
  console.log(`Usuarios demo: ${demoUsers.map((user) => user.email).join(", ")}`);
  console.log(`Password demo: ${DEFAULT_PASSWORD}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
