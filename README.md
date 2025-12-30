Aplicación web de **Service Desk / Mesa de Servicios (ITSM)** inspirada en ITIL, con:

- Supabase (Postgres) como backend principal: Auth + RLS + Realtime + PostgREST.
- UI moderna (Next.js + Tailwind) con dashboard tipo Kanban para agentes.
- Analytics para supervisión (KPIs: volumen, MTTR, SLA, pendientes, carga, FCR).
- Automatizaciones (workflows) con un worker Node.js.
- Inventario de activos con sincronización/import + monitoreo de conectividad (alertas básicas).
- Chat de soporte con disponibilidad del agente + soporte remoto (RMM NetLock).

## Getting Started

### 1) Variables de entorno

Copia `.env.example` a:

- `.env.local` (Next.js)
- `.env` (API/Workers)

Completa los valores:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_API_BASE_URL` (por defecto `http://localhost:4000`)
- `CORS_ORIGIN` (por defecto `http://localhost:3000`)
- `ASSETS_WEBHOOK_SECRET` (ingesta de activos sin login vía header `x-assets-secret`)

### 2) Base de datos (Supabase)

En tu proyecto Supabase ejecuta (SQL Editor o Supabase CLI) **todas** las migraciones en orden:

- `supabase/migrations/*` (001…035)

Opcional (datos ejemplo):

- `supabase/seed.sql`

### 2.1) RMM (NetLock) [dev]

- Levanta NetLock local: `docker compose up -d` (Web Console: `http://localhost:8080`, Server/Files: `http://localhost:7080`).
- En `docker-compose.yml` los puertos se publican solo en `127.0.0.1` (localhost). Si necesitas acceso desde otra máquina, ajusta el bind.
- En dev, `docker-compose.yml` expone MySQL en `127.0.0.1:3307` para que la API pueda verificar equipos contra la tabla `devices` (ver `NETLOCK_MYSQL_URL` en `.env.example`).
- En Mac Apple Silicon (ARM), las imágenes de NetLock se ejecutan como `linux/amd64` (emulación), puede ser más lento.
- Tip (macOS): si el agente no logra conectar usando `localhost`, usa `127.0.0.1` en `NETLOCK_*_SERVERS` y `NETLOCK_FILE_SERVER_URL` (evita problemas de IPv6 `::1`).
- Tip (macOS Apple Silicon): el instalador descargado puede ser bloqueado por AMFI si está completamente sin firma. Solución rápida: `xattr -dr com.apple.quarantine <archivo>` y `codesign --force --sign - --no-strict <archivo>`.
- Tip (macOS Apple Silicon): los servicios del agente (`/usr/local/bin/0x101_Cyber_Security/NetLock_RMM/*_Agent/NetLock_RMM_Agent_*`) también pueden quedar sin firma y ser “killed”. Fírmalos y reinicia servicios: `sudo codesign --force --sign - --no-strict /usr/local/bin/0x101_Cyber_Security/NetLock_RMM/*_Agent/NetLock_RMM_Agent_*` + `sudo launchctl kickstart -k system/com.netlock.rmm.agentcomm` (repite para `agentremote`/`agenthealth`).
- Configura variables `NETLOCK_*` + `NEXT_PUBLIC_NETLOCK_CONSOLE_URL` (ver `.env.example`).
- Onboarding usuario: `http://localhost:3000/app/connect-device` (genera instalador, instala y luego “Verificar”).
- Soporte remoto: en el chat, botón “Tomar control” abre `NEXT_PUBLIC_NETLOCK_CONSOLE_URL/devices`.

### 2.1.1) RMM (NetLock) [prod / VM]

Patrón recomendado: NetLock detrás de Nginx con **dos hostnames** (evita routing por path; el agente espera host:puerto).

- Web Console (UI NetLock): `https://netlock.<IP>.cloud-xip.com`
- Server/Files (API + descargas): `https://netlock-files.<IP>.cloud-xip.com`

En la **VM**:

- NetLock expuesto solo en `127.0.0.1` (Docker) y Nginx publica 80/443.
- Ajusta `PublicOverrideUrl` en `netlock/web_console/appsettings.json` al URL público HTTPS del console.

En la **UI (Vercel)**:

- `NEXT_PUBLIC_NETLOCK_CONSOLE_URL=https://netlock.<IP>.cloud-xip.com`

En la **API (.env)** (donde esté corriendo tu Express API):

- `NETLOCK_FILE_SERVER_URL=https://netlock-files.<IP>.cloud-xip.com`
- `NETLOCK_INSECURE_TLS=false`
- `NETLOCK_SSL=true`
- `NETLOCK_COMMUNICATION_SERVERS=netlock-files.<IP>.cloud-xip.com:443`
- `NETLOCK_REMOTE_SERVERS=netlock-files.<IP>.cloud-xip.com:443`
- `NETLOCK_UPDATE_SERVERS=netlock-files.<IP>.cloud-xip.com:443`
- `NETLOCK_TRUST_SERVERS=netlock-files.<IP>.cloud-xip.com:443`
- `NETLOCK_FILE_SERVERS=netlock-files.<IP>.cloud-xip.com:443`

Nota: si tu API corre fuera de la VM, no podrá usar `NETLOCK_MYSQL_URL` (MySQL está dentro del Docker). Para sync confiable (hardware/software/eventos) lo ideal es correr el worker `dev:netlock-sync` en la misma VM o en un contenedor con acceso a MySQL.

#### Troubleshooting (RMM)

- Error `netlock_create_installer_failed:401`: la API key de NetLock no coincide. Revisa `NETLOCK_FILE_SERVER_API_KEY` vs `files_api_key` en la DB de NetLock.
- Error `netlock_installer_packages_missing`: NetLock no tiene cargados los `installer.package.*`. Configura tu **Members Portal API key** en NetLock y reinicia los contenedores.

### 2.2) Importar catálogo real (Tier 1..4)

Exporta tu Excel a CSV y asegúrate de tener columnas:

- `Tipo de Ticket` (Incidente/Requerimiento)
- `Tier 1`, `Tier 2`, `Tier 3`, `Tier 4`

Luego importa (requiere `.env` con `SUPABASE_*` service role):

```bash
npm run import:catalog -- ./ruta/al/catalogo.csv --department <DEPARTMENT_UUID>
```

Para que Realtime funcione en la UI (suscripciones `postgres_changes`), habilita la replicación de:

- `tickets`, `comments`, `ticket_approvals`, `ticket_events`
- `knowledge_base`
- `chat_threads`, `chat_messages`, `chat_events`, `agent_presence`, `agent_work_status`
- `asset_assignments`

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

Worker de monitoreo de activos (conectividad + alertas):

```bash
npm run dev:assets-monitor
```

Worker NetLock sync (inventario/telemetría desde NetLock -> Supabase):

```bash
npm run dev:netlock-sync
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
  - `server/workers/assets-monitor.ts`: recalcula conectividad por `last_seen_at` y abre/cierra alertas de activos.
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
- Export (inventario CSV): API `GET /api/assets/export.csv` (requiere supervisor/admin).

## Screens principales

- Solicitante: creación de tickets + seguimiento + comentarios + autoservicio (KB).
- Agente: Kanban por estado + indicador SLA + asignación/estado.
- Supervisor/Admin: dashboard de KPIs + configuración de SLAs.
