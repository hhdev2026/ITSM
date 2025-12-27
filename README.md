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

Opcional (datos ejemplo):

- `supabase/seed.sql`

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
- `sla_deadline` se calcula en DB en el `insert` según `slas` activo (prefiere SLA por departamento y usa global como fallback).

## Screens principales

- Solicitante: creación de tickets + seguimiento + comentarios + autoservicio (KB).
- Agente: Kanban por estado + indicador SLA + asignación/estado.
- Supervisor/Admin: dashboard de KPIs + configuración de SLAs.
