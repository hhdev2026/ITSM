Aplicación web de **Service Desk / Mesa de Servicios (ITSM)** inspirada en ITIL, con:

- Supabase (Postgres) como backend principal: Auth + RLS + Realtime + PostgREST.
- UI moderna (Next.js + Tailwind) con dashboard tipo Kanban para agentes.
- Analytics para supervisión (KPIs: volumen, MTTR, SLA, pendientes, carga, FCR).
- Automatizaciones (workflows) con un worker Node.js.

## Getting Started

### 1) Variables de entorno

Copia `.env.example` a:

- `.env.local` (Next.js)
- `.env` (API/Workers)

Completa los valores:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### 2) Base de datos (Supabase)

En tu proyecto Supabase ejecuta (SQL Editor o Supabase CLI) las migraciones:

- `supabase/migrations/001_init.sql`
- `supabase/migrations/002_analytics.sql`
- `supabase/migrations/003_profiles_rls.sql`
- `supabase/migrations/006_service_catalog.sql`
- `supabase/migrations/015_service_catalog_user_friendly.sql`
- `supabase/migrations/017_sla_business_hours.sql`
- `supabase/migrations/018_kpi_sla_exclusions.sql`
- `supabase/migrations/019_service_catalog_tiers.sql`

Opcional (datos ejemplo):

- `supabase/seed.sql`

### 2.1) Control remoto (Guacamole + MeshCentral) [dev]

- Aplica la migración `supabase/migrations/029_remote_devices.sql`.
- Levanta servicios locales: `docker compose up -d` (MeshCentral queda en `https://localhost:4430`).
- Configura en `.env` (API) las variables `GUACD_*`, `REMOTE_TUNNEL_*` y `REMOTE_CREDENTIALS_KEY` (ver `.env.example`).
- Para generar el JSON encriptado de `remote_devices.credentials`, usa `tsx server/scripts/encrypt-remote-credentials.ts '<JSON>'`.
- Para sincronizar inventario desde MeshCentral a `assets`, configura `MESHCENTRAL_*` y ejecuta `npm run dev:meshcentral-sync`.
- Onboarding UI (botones): `http://localhost:3000/app/onboarding` (crear link de agente + crear técnico ITSM+MeshCentral).
  - Tip: si tu `docker-compose` expone MeshCentral en `https://localhost:4430`, define `MESHCENTRAL_PUBLIC_URL=https://localhost:4430` para que los links de invitación salgan con el puerto correcto.

### 2.1.1) NetLock RMM (migración en curso)

- Configura variables `NETLOCK_*` + `RMM_PROVIDER=netlock` (ver `.env.example`).
- Endpoints API:
  - `POST /api/netlock/enroll/self` (genera instalador one-click y devuelve un link temporal de descarga).
  - `POST /api/netlock/verify/self` (verifica si el dispositivo quedó conectado y lo registra en `assets`).

### 2.2) Importar catálogo real (Tier 1..4)

Exporta tu Excel a CSV y asegúrate de tener columnas:

- `Tipo de Ticket` (Incidente/Requerimiento)
- `Tier 1`, `Tier 2`, `Tier 3`, `Tier 4`

Luego importa (requiere `.env` con `SUPABASE_*` service role):

```bash
npm run import:catalog -- ./ruta/al/catalogo.csv --department <DEPARTMENT_UUID>
```

Para que Realtime funcione en la UI (suscripciones `postgres_changes`), habilita la replicación de:

- `tickets`, `comments`, `knowledge_base`

### 3) Roles y multi-departamento

Al registrarse un usuario se crea su fila en `profiles` con `role='user'`.
Para operar por departamento/rol, un **admin** puede ajustar `department_id` y, si aplica, el `role`:

- `user`: solicitante
- `agent`: agente
- `supervisor`: supervisor
- `admin`: admin (todo)

### 4) Ejecutar en desarrollo

Instala dependencias:

```bash
npm install
```

### 4.1) Crear usuario superadmin (bootstrap)

Una vez que tengas tu proyecto Supabase y variables `.env` completas, ejecuta:

```bash
npm run seed:superadmin
```

Variables usadas (ver `.env.example`):

- `SUPERADMIN_EMAIL`
- `SUPERADMIN_PASSWORD`
- `SUPERADMIN_FULL_NAME`
- `SUPERADMIN_DEPARTMENT_ID` (opcional; si no se define, crea/usa el departamento `TI`)

Web (Next.js):

```bash
npm run dev
```

API (Express):

```bash
npm run dev:api
```

Todo junto (web + API + workflows):

```bash
npm run dev:all
```

Worker de workflows (automatizaciones):

```bash
npm run dev:workflows
```

Worker de problemas (detección básica de recurrencia):

```bash
npm run dev:problem-linker
```

Luego abre `http://localhost:3000`.

## Arquitectura (alto nivel)

- **Supabase**: fuente de verdad para tickets, comentarios, KB, SLAs, workflows, problemas y cambios (RLS por departamento/rol).
- **Next.js**: UI (solicitante, agente, supervisor).
- **Express API**: endpoints de analytics (usa `rpc(kpi_dashboard)`) y base para servicios backend.
- **Workers**:
  - `server/workers/workflows.ts`: monitorea `tickets` (Realtime) y ejecuta acciones según `workflows`.
  - `server/workers/problem-linker.ts`: crea `problems` por recurrencia (scaffold).

## Notas

- La gamificación se actualiza automáticamente en DB al pasar tickets a `Cerrado` (puntos + rank).
- SLA en **horas hábiles**:
  - Configuración por departamento en `business_calendars` + feriados en `business_holidays` (por defecto 08:00–18:00 lun–vie).
  - Los deadlines (`response_deadline`, `sla_deadline`, `ola_*`) se calculan en DB al crear el ticket usando horas hábiles.
  - Estado `Planificado` **pausa** el contador (se extienden deadlines al salir de `Planificado`).
  - Campo de exclusión/justificación para tickets fuera de SLA: RPC `ticket_set_sla_exclusion(ticket_id, excluded, reason)`.
  - Vista `tickets_sla_live` expone semáforo/termómetro (`*_traffic_light`, `*_pct_used`, `*_remaining_minutes`).
  - Retroactividad: por defecto los cambios de calendario/SLA no son retroactivos (deadlines quedan almacenados); el despliegue recalcula solo tickets abiertos.
- Export (sábana CSV): API `GET /api/tickets/export.csv` (requiere supervisor/admin).

## Screens principales

- Solicitante: creación de tickets + seguimiento + comentarios + autoservicio (KB).
- Agente: Kanban por estado + indicador SLA + asignación/estado.
- Supervisor/Admin: dashboard de KPIs + configuración de SLAs.
