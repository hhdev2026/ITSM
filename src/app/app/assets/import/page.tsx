"use client";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/error";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import Link from "next/link";
import { useMemo, useState } from "react";

type RawRow = Record<string, string>;

type Target = {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
};

const TARGETS: Target[] = [
  { key: "name", label: "Nombre del activo", required: true, hint: 'Ej: "Laptop-Santiago-001"' },
  { key: "serial_number", label: "Serial", hint: "Único por activo (si aplica)." },
  { key: "asset_type", label: "Tipo", hint: "Laptop, Impresora, Switch…" },
  { key: "category", label: "Categoría", hint: "Hardware, Software, Licencia…" },
  { key: "subcategory", label: "Subcategoría", hint: "Dell, HP, Kyocera…" },
  { key: "manufacturer", label: "Marca" },
  { key: "model", label: "Modelo" },
  { key: "lifecycle_status", label: "Estado (ciclo de vida)", hint: "Activo / En reparación / Retirado / Descartado" },
  { key: "region", label: "Región" },
  { key: "comuna", label: "Comuna" },
  { key: "building", label: "Edificio/Sucursal" },
  { key: "floor", label: "Piso" },
  { key: "room", label: "Sala/Cubículo" },
  { key: "address", label: "Dirección" },
  { key: "latitude", label: "Latitud" },
  { key: "longitude", label: "Longitud" },
  { key: "barcode", label: "Código de barras" },
  { key: "cost_center", label: "Centro de costo" },
  { key: "department_name", label: "Departamento" },
  { key: "description", label: "Descripción" },
  { key: "admin_notes", label: "Notas internas" },
];

function normalizeHeader(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replaceAll("á", "a")
    .replaceAll("é", "e")
    .replaceAll("í", "i")
    .replaceAll("ó", "o")
    .replaceAll("ú", "u")
    .replaceAll("ü", "u")
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
}

function csvEscape(value: unknown) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function downloadCsv(filename: string, header: string[], rows: Array<Array<unknown>>) {
  const lines: string[] = [];
  lines.push(header.map(csvEscape).join(","));
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AssetsImportPage() {
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);
  const canManage = profile?.role === "admin" || profile?.role === "supervisor";

  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; updated: number; errors: Array<{ row: number; error: string }> } | null>(null);

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const headerOptions = useMemo<ComboboxOption[]>(() => {
    const opts = headers.map((h) => ({ value: h, label: h }));
    return [{ value: "__skip__", label: "— No usar —" }, ...opts];
  }, [headers]);

  const preview = useMemo(() => rows.slice(0, 10), [rows]);

  const computed = useMemo(() => {
    const valid: Array<Record<string, unknown>> = [];
    const invalid: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const out: Record<string, unknown> = {};
      for (const t of TARGETS) {
        const sel = mapping[t.key];
        if (!sel || sel === "__skip__") continue;
        out[t.key] = raw[sel] ?? "";
      }
      const name = String(out.name ?? "").trim();
      if (!name) {
        invalid.push({ row: i + 1, error: "name_required" });
        continue;
      }
      out.name = name;
      valid.push(out);
    }
    return { valid, invalid };
  }, [rows, mapping]);

  async function onPickFile(file: File | null) {
    if (!file) return;
    setError(null);
    setResult(null);
    setParsing(true);
    try {
      const text = await file.text();
      const Papa = (await import("papaparse")).default;
      const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
      if (parsed.errors?.length) {
        throw new Error(parsed.errors[0]?.message ?? "csv_parse_error");
      }
      const data = (parsed.data ?? []) as Array<Record<string, unknown>>;
      const first = data[0] ?? {};
      const hdrs = Object.keys(first);
      setHeaders(hdrs);

      const cleanRows: RawRow[] = data.slice(0, 5000).map((r) => {
        const rr: RawRow = {};
        for (const h of hdrs) rr[h] = String(r[h] ?? "").trim();
        return rr;
      });
      setRows(cleanRows);

      const normToHeader = new Map<string, string>();
      for (const h of hdrs) normToHeader.set(normalizeHeader(h), h);

      const next: Record<string, string> = {};
      for (const t of TARGETS) {
        const direct = normToHeader.get(t.key);
        if (direct) {
          next[t.key] = direct;
          continue;
        }
        const alt = [
          t.key,
          t.key.replaceAll("_", ""),
          t.key === "serial_number" ? "serial" : "",
          t.key === "asset_type" ? "tipo" : "",
          t.key === "name" ? "nombre" : "",
          t.key === "building" ? "edificio" : "",
          t.key === "room" ? "sala" : "",
          t.key === "address" ? "direccion" : "",
          t.key === "latitude" ? "lat" : "",
          t.key === "longitude" ? "lng" : "",
        ]
          .filter(Boolean)
          .map((s) => normalizeHeader(String(s)));
        const found = alt.map((k) => normToHeader.get(k)).find(Boolean);
        next[t.key] = found ?? "__skip__";
      }
      setMapping(next);
    } catch (e) {
      setError(errorMessage(e));
      setHeaders([]);
      setRows([]);
      setMapping({});
    } finally {
      setParsing(false);
    }
  }

  async function onImport() {
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const { data, error } = await supabase.rpc("asset_upsert_many", { p_rows: computed.valid });
      if (error) throw error;
      setResult(data as typeof result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setImporting(false);
    }
  }

  if (sessionLoading || profileLoading) return <AppBootScreen />;
  if (!session) return <AppNoticeScreen title="Inicia sesión" description="Debes iniciar sesión para importar activos." />;
  if (!profile) return <AppNoticeScreen title="No se pudo cargar tu perfil" description={profileError ?? "Intenta nuevamente."} />;
  if (!canManage) return <AppNoticeScreen title="Sin permisos" description="Solo supervisor/admin puede importar activos." />;

  return (
    <AppShell profile={profile}>
      <div className="space-y-5">
        <PageHeader
          kicker={
            <Link href="/app/assets" className="hover:underline">
              ← Volver a activos
            </Link>
          }
          title="Importar activos (CSV)"
          description="Carga masiva con validación y mapeo de columnas. Puedes importar parcial: se cargan solo filas válidas."
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => {
                  const header = TARGETS.map((t) => t.key);
                  const sample = [[
                    "Laptop-Santiago-001",
                    "ABC123XYZ",
                    "Laptop",
                    "Hardware",
                    "Dell",
                    "Dell",
                    "XPS 13",
                    "Activo",
                    "Metropolitana",
                    "Santiago",
                    "Torre A",
                    "3",
                    "301-B",
                    "Av. Siempre Viva 123",
                    "-33.44",
                    "-70.65",
                    "",
                    "CC-001",
                    "TI",
                    "Equipo asignado a usuario",
                    ""
                  ]];
                  downloadCsv("plantilla-activos.csv", header, sample);
                }}
              >
                Descargar plantilla
              </Button>
              <Button asChild variant="outline">
                <Link href="/app/assets/map">Ver mapa</Link>
              </Button>
            </>
          }
        />

        {error ? <InlineAlert variant="error" title="Error" description={error} /> : null}
        {result ? (
          <InlineAlert
            variant={result.errors?.length ? "warning" : "success"}
            title="Importación finalizada"
            description={`Insertados: ${result.inserted ?? 0} · Actualizados: ${result.updated ?? 0} · Errores: ${result.errors?.length ?? 0}`}
          />
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
          <Card className="tech-border">
            <CardHeader>
              <CardTitle>Archivo</CardTitle>
              <CardDescription>Selecciona un CSV. El primer encabezado se usará para el mapeo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                disabled={parsing || importing}
              />
              {parsing ? <Skeleton className="h-10 w-full" /> : null}
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Validación</div>
                <div className="mt-1 text-muted-foreground">
                  Filas detectadas: <span className="font-semibold text-foreground">{rows.length}</span> · Válidas:{" "}
                  <span className="font-semibold text-foreground">{computed.valid.length}</span> · Con error:{" "}
                  <span className="font-semibold text-foreground">{computed.invalid.length}</span>
                </div>
                {computed.invalid.length ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Ejemplo de errores: {computed.invalid.slice(0, 3).map((e) => `#${e.row} ${e.error}`).join(" · ")}
                  </div>
                ) : null}
              </div>
              <Button onClick={onImport} disabled={importing || computed.valid.length === 0}>
                {importing ? "Importando…" : `Importar ${computed.valid.length} filas`}
              </Button>
              <div className="text-xs text-muted-foreground">
                API (para integraciones): <span className="font-mono">POST /api/assets/sync</span> (ver README para ejemplo).
              </div>
            </CardContent>
          </Card>

          <Card className="tech-border">
            <CardHeader>
              <CardTitle>Mapeo de columnas</CardTitle>
              <CardDescription>Asocia columnas del CSV a campos estándar. “Nombre” es obligatorio.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {headers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Sube un CSV para ver el mapeo y la vista previa.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {TARGETS.map((t) => (
                      <label key={t.key} className="block">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="text-xs text-muted-foreground">
                            {t.label} {t.required ? <span className="text-rose-300">*</span> : null}
                          </div>
                          {t.hint ? <div className="text-[11px] text-muted-foreground/80">{t.hint}</div> : null}
                        </div>
                        <Combobox
                          value={mapping[t.key] ?? "__skip__"}
                          onValueChange={(v) => setMapping((m) => ({ ...m, [t.key]: v ?? "__skip__" }))}
                          options={headerOptions}
                          placeholder="—"
                        />
                      </label>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-border bg-muted/20 p-4">
                    <div className="text-sm font-medium">Vista previa</div>
                    <div className="mt-2 overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-xs text-muted-foreground">
                          <tr>
                            {headers.slice(0, 6).map((h) => (
                              <th key={h} className="px-2 py-2 text-left font-medium">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.map((r, i) => (
                            <tr key={i} className="border-t border-border/60">
                              {headers.slice(0, 6).map((h) => (
                                <td key={h} className="px-2 py-2 text-muted-foreground">
                                  {r[h] || <span className="text-muted-foreground/50">—</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Consejo: en una primera carga masiva, importa nombre/serial/tipo/ubicación. Luego puedes completar el resto con una segunda carga (upsert).
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
