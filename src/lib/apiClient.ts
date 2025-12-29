type ApiErrorBody = { error?: unknown; details?: unknown };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function apiOrigin() {
  if (typeof window === "undefined") return null;
  try {
    return window.location.origin;
  } catch {
    return null;
  }
}

export function apiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

export function wsBaseUrl() {
  const base = apiBaseUrl();
  return base.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}

function extractApiError(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const err = (data as ApiErrorBody).error;
  const raw = typeof err === "string" ? err.trim() : "";
  if (!raw) return null;

  const friendly: Record<string, string> = {
    forbidden: "No tienes permiso para esta acción.",
    netlock_not_configured:
      "NetLock RMM no está configurado en la API (revisa NETLOCK_FILE_SERVER_URL / NETLOCK_FILE_SERVER_API_KEY / NETLOCK_* y RMM_INSTALLER_JWT_SECRET).",
    service_role_required: "La API requiere SUPABASE_SERVICE_ROLE_KEY para esta acción.",
    rmm_installer_jwt_secret_required: "Falta configurar RMM_INSTALLER_JWT_SECRET en la API.",
    invalid_body: "Datos inválidos.",
    device_not_found: "El equipo no existe o no es accesible.",
  };

  const base = friendly[raw] ?? raw;
  const details = (data as ApiErrorBody).details;
  const detailStr =
    typeof details === "string" && details.trim()
      ? details.trim()
      : isRecord(details) && typeof details.message === "string" && details.message.trim()
        ? details.message.trim()
        : null;
  if (detailStr) return `${base} (${detailStr})`;
  return base;
}

function summarizeNetworkError(baseUrl: string) {
  const origin = apiOrigin();
  const originHint = origin ? `Origen web: ${origin} (agrega a CORS_ORIGIN si no está).` : "";

  let mixedContentHint = "";
  try {
    if (origin) {
      const page = new URL(origin);
      const api = new URL(baseUrl);
      if (page.protocol === "https:" && api.protocol === "http:") {
        mixedContentHint = "Estás en HTTPS pero la API es HTTP (el navegador bloquea la llamada).";
      }
    }
  } catch {
    // ignore
  }

  const parts = [
    `No se pudo conectar a la API (${baseUrl}).`,
    `Revisa que la API esté levantada (npm run dev:api) y que ${baseUrl}/api/health responda.`,
    originHint,
    mixedContentHint,
  ].filter(Boolean);
  return parts.join(" ");
}

export class ApiFetchError extends Error {
  kind: "network" | "http";
  url: string;
  status?: number;
  body?: unknown;

  constructor(message: string, opts: { kind: "network" | "http"; url: string; status?: number; body?: unknown; cause?: unknown }) {
    super(message);
    this.name = "ApiFetchError";
    this.kind = opts.kind;
    this.url = opts.url;
    this.status = opts.status;
    this.body = opts.body;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).cause = opts.cause;
  }
}

export async function apiFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBaseUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err: unknown) {
    throw new ApiFetchError(summarizeNetworkError(apiBaseUrl()), { kind: "network", url, cause: err });
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = extractApiError(data) ?? `HTTP ${res.status}`;
    throw new ApiFetchError(msg, { kind: "http", url, status: res.status, body: data });
  }
  return data as T;
}
