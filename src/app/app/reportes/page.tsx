"use client";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useProfile, useSession } from "@/lib/hooks";
import { BarChart3, Download, FileText, PieChart, Users, Laptop, Activity, FileSpreadsheet } from "lucide-react";
import { useState } from "react";

// Mock Data for the Previews
const REPORT_PREVIEWS: Record<string, { headers: string[]; rows: string[][] }> = {
  sla: {
    headers: ["Mes", "Categoría", "Dentro de SLA", "Fuera de SLA", "Cumplimiento (%)"],
    rows: [
      ["Abril 2026", "Hardware", "142", "5", "96.5%"],
      ["Abril 2026", "Accesos", "89", "12", "88.1%"],
      ["Abril 2026", "Redes", "45", "1", "97.8%"],
      ["Abril 2026", "Software", "210", "15", "93.3%"],
    ],
  },
  agents: {
    headers: ["Agente", "Tickets Resueltos", "T. Promedio Resol.", "SLA Cumplido", "CSAT (1-5)"],
    rows: [
      ["Carlos Mendoza", "124", "1h 15m", "98%", "4.8"],
      ["Ana Valdés", "110", "1h 45m", "95%", "4.9"],
      ["Felipe Castro", "98", "2h 10m", "91%", "4.5"],
      ["Laura Gómez", "135", "55m", "99%", "5.0"],
    ],
  },
  incidents: {
    headers: ["Fecha", "Servicio Afectado", "Impacto", "Tiempo Caída", "Estado"],
    rows: [
      ["12/04/2026", "VPN Corporativa", "Alto", "45m", "Resuelto"],
      ["08/04/2026", "ERP Contabilidad", "Crítico", "2h 10m", "Resuelto (RCA Pendiente)"],
      ["01/04/2026", "Impresoras Planta 2", "Medio", "4h 0m", "Resuelto"],
    ],
  },
  assets: {
    headers: ["ID Activo", "Tipo", "Modelo", "Asignado a", "Fin Garantía"],
    rows: [
      ["PC-2024-001", "Laptop", "Lenovo ThinkPad", "Carlos Mendoza", "15/01/2027"],
      ["PC-2024-002", "Laptop", "MacBook Pro", "Ana Valdés", "22/03/2027"],
      ["MON-2023-014", "Monitor", "Dell 24''", "Sala Reuniones 1", "Vencida"],
      ["SRV-2022-005", "Servidor", "HP ProLiant", "Data Center", "10/11/2026"],
    ],
  },
  csat: {
    headers: ["Ticket", "Categoría", "Calificación", "Comentario", "Fecha"],
    rows: [
      ["TKT-001045", "Hardware", "⭐⭐⭐⭐⭐", "Muy rápida la atención", "15/04/2026"],
      ["TKT-001042", "Accesos", "⭐⭐⭐⭐", "Todo bien, pero demoró la aprobación", "14/04/2026"],
      ["TKT-001038", "Software", "⭐⭐", "El técnico no supo resolverlo", "13/04/2026"],
      ["TKT-001021", "Redes", "⭐⭐⭐⭐⭐", "Excelente servicio", "10/04/2026"],
    ],
  },
};

const REPORTS = [
  {
    id: "sla",
    title: "Rendimiento de SLAs",
    description: "Análisis de cumplimiento de tiempos de respuesta y resolución por categoría y prioridad.",
    icon: BarChart3,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  {
    id: "agents",
    title: "Productividad de Agentes",
    description: "Métricas de carga de trabajo, tiempos promedio y volumen de tickets resueltos por cada operador.",
    icon: Users,
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
  },
  {
    id: "incidents",
    title: "Resumen de Incidentes Críticos",
    description: "Historial de fallas mayores, servicios afectados y tiempos de caída (Downtime).",
    icon: Activity,
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
  },
  {
    id: "assets",
    title: "Inventario y Garantías",
    description: "Reporte consolidado del estado del equipamiento, asignaciones y equipos con garantía próxima a vencer.",
    icon: Laptop,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  {
    id: "csat",
    title: "Satisfacción del Usuario (CSAT)",
    description: "Resultados de encuestas enviadas al cierre de tickets, promedios y comentarios de feedback.",
    icon: PieChart,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
  },
];

export default function ReportsPage() {
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  const [selectedReport, setSelectedReport] = useState<string | null>(null);

  const canSee = profile?.role === "supervisor" || profile?.role === "admin";

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando…" />;
  if (!session) return null;
  if (profileError) return <AppNoticeScreen variant="error" title="Error" description={profileError} />;
  if (!profile) return null;

  if (!canSee) {
    return (
      <AppShell profile={profile}>
        <AppNoticeScreen title="Acceso denegado" description="Los reportes gerenciales son exclusivos para supervisores y administradores." />
      </AppShell>
    );
  }

  const activeReport = REPORTS.find((r) => r.id === selectedReport);
  const previewData = selectedReport ? REPORT_PREVIEWS[selectedReport] : null;

  return (
    <AppShell profile={profile}>
      <div className="space-y-6">
        <PageHeader
          title="Reportes Gerenciales"
          description="Selecciona un reporte para visualizar una muestra de los datos y exportarlos en el formato deseado."
        />

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {REPORTS.map((report) => (
            <Card
              key={report.id}
              className={`cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg tech-border ${report.border}`}
              onClick={() => setSelectedReport(report.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className={`rounded-xl p-3 ${report.bg}`}>
                    <report.icon className={`h-6 w-6 ${report.color}`} />
                  </div>
                  <CardTitle className="text-base">{report.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm text-muted-foreground min-h-[40px]">
                  {report.description}
                </CardDescription>
                <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-4">
                  <Badge variant="outline" className="font-normal text-xs">
                    Datos del Mes Actual
                  </Badge>
                  <Button variant="ghost" size="sm" className="text-xs h-8">
                    Vista Previa →
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}>
        <DialogContent className="max-w-4xl border-border bg-background/95 backdrop-blur-xl">
          {activeReport && previewData && (
            <>
              <div className="flex flex-col space-y-1.5 text-center sm:text-left mb-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className={`rounded-lg p-2 ${activeReport.bg}`}>
                    <activeReport.icon className={`h-5 w-5 ${activeReport.color}`} />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold leading-none tracking-tight">{activeReport.title}</h2>
                    <p className="text-sm text-muted-foreground mt-1">Previsualización de los primeros registros (Generado dinámicamente)</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-border bg-background shadow-inner overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/30 text-muted-foreground">
                      <tr>
                        {previewData.headers.map((h, i) => (
                          <th key={i} className="px-4 py-3 font-medium whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {previewData.rows.map((row, i) => (
                        <tr key={i} className="hover:bg-accent/10 transition-colors">
                          {row.map((cell, j) => (
                            <td key={j} className="px-4 py-3">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="bg-muted/10 px-4 py-2 border-t border-border/20 text-xs text-muted-foreground text-center">
                  Mostrando {previewData.rows.length} registros de muestra. El reporte completo contiene toda la información histórica aplicable.
                </div>
              </div>

              <div className="mt-6 flex flex-col sm:flex-row justify-end gap-3">
                <Button variant="outline" className="gap-2" onClick={() => setSelectedReport(null)}>
                  Cerrar
                </Button>
                <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white border-none" onClick={() => alert("Simulando descarga de Excel...")}>
                  <FileSpreadsheet className="h-4 w-4" />
                  Descargar Excel
                </Button>
                <Button className="gap-2 bg-red-600 hover:bg-red-700 text-white border-none" onClick={() => alert("Simulando descarga de PDF...")}>
                  <FileText className="h-4 w-4" />
                  Descargar PDF
                </Button>
                <Button variant="default" className="gap-2" onClick={() => alert("Simulando descarga de CSV...")}>
                  <Download className="h-4 w-4" />
                  Descargar CSV
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
