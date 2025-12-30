# Seguridad / Hardening (prod)

Este proyecto combina **Supabase (Auth + RLS)** + **Next.js** + **Express API/Workers**. Para operar como mesa de servicios (ITSM) sin “abrir la puerta”:

## 1) Secretos y llaves (crítico)

- Nunca expongas `SUPABASE_SERVICE_ROLE_KEY` al browser (solo API/Workers).
- Usa secretos **largos y aleatorios (32+ chars)** para: `ASSETS_WEBHOOK_SECRET`, `RMM_INSTALLER_JWT_SECRET`, `NETLOCK_FILE_SERVER_API_KEY`.
- Usa un *secret manager* (Vercel/Render/Fly/EC2 SSM/Secrets Manager, etc.) y rota secretos ante sospecha de filtración.
- Revisa que `.env` / `.env.local` no se suban al repo (ya están ignorados por `.gitignore`).

## 2) Supabase (RLS + permisos)

- Ejecuta **todas** las migraciones (incluye `supabase/migrations/036_security_hardening.sql`).
- Verifica que los usuarios **no** puedan escalar privilegios modificando `profiles.role` o `profiles.department_id`.
- Activa MFA para cuentas `admin` y define proceso de **revisión periódica de accesos**.
- No uses `service_role` desde UI; para operaciones admin usa endpoints server-side (ya existen en `src/app/api/admin/*` y `server/*`).

## 3) API (Express)

- `NODE_ENV=production`
- `CORS_ORIGIN` explícito (sin `*`), idealmente solo tu dominio web.
- `PUBLIC_API_BASE_URL` (HTTPS) para links/instaladores (evita host-header injection).
- Si hay reverse proxy: `TRUST_PROXY=true`.
- Mantén rate limiting/WAF a nivel edge (Cloudflare/Nginx) además del rate limit in-app.
- Webhook de activos: usa `ASSETS_WEBHOOK_IP_ALLOWLIST` y envía `asset_tag` o `serial_number` (se rechazan filas sin identificador).

## 4) NetLock (RMM)

- Nunca expongas NetLock directo a Internet: ponlo detrás de Nginx/HTTPS y restringe acceso.
- `NETLOCK_INSECURE_TLS=false` en prod (si usas HTTPS, certificados válidos).
- Trata el RMM como componente **de alto impacto**: logging, hardening de VM, firewall estricto, backups, rotación de API keys.

## 5) Logging, auditoría y continuidad

- Centraliza logs (API + workers) y evita registrar secretos/tokens (el servidor ya redacta headers sensibles).
- Define retención (p. ej. 90–180 días) y alertas (errores 5xx, spikes 401/403, rate-limit, cambios de rol).
- Backups/DR: define RPO/RTO, prueba restores y documenta procedimiento de emergencia.

## 6) Ciclo de vida (ITSM/Seguridad)

- Cambio (Change): todo cambio de schema/RLS pasa por PR + revisión + despliegue controlado.
- Incidentes: playbook para filtración de credenciales y abuso de tokens (revocación/rotación).
- Vulnerabilidades: `npm audit` regular + Dependabot/Renovate + revisión de imágenes Docker (pin de versiones en prod).
