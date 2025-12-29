"use client";

import { InlineAlert } from "@/components/feedback/InlineAlert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Monitor, Copy } from "lucide-react";
import { toast } from "sonner";

function joinUrl(base: string, path: string) {
  const normalized = base.endsWith("/") ? base : `${base}/`;
  return new URL(path.replace(/^\//, ""), normalized).toString();
}

function resolveBase(consoleUrl: string, origin: string) {
  try {
    return new URL(consoleUrl, origin);
  } catch {
    return null;
  }
}

export function NetlockRemotePanel({
  accessKey,
  className,
  heightClassName,
}: {
  accessKey: string | null;
  className?: string;
  heightClassName?: string;
}) {
  const consoleUrl = (process.env.NEXT_PUBLIC_NETLOCK_CONSOLE_URL ?? "").trim();

  // Avoid manual memoization here; the React Compiler lint rule flags it.
  const { canEmbed, embedUrl, baseHref } = (() => {
    if (typeof window === "undefined") return { canEmbed: false, embedUrl: null as string | null, baseHref: null as string | null };
    if (!consoleUrl) return { canEmbed: false, embedUrl: null as string | null, baseHref: null as string | null };

    const base = resolveBase(consoleUrl, window.location.origin);
    if (!base) return { canEmbed: false, embedUrl: null as string | null, baseHref: null as string | null };

    const sameOrigin = base.origin === window.location.origin;
    const href = base.toString().replace(/\/+$/, "") + "/";
    const url = joinUrl(href, "devices");
    return { canEmbed: sameOrigin, embedUrl: url, baseHref: base.toString() };
  })();

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">Soporte remoto (NetLock)</div>
        <div className="flex flex-wrap items-center gap-2">
          {accessKey ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(accessKey);
                toast.message("Copiado", { description: "Access Key copiado al portapapeles." });
              }}
            >
              <Copy className="h-4 w-4" />
              Copiar Access Key
            </Button>
          ) : null}
          {accessKey ? <Badge variant="outline" className="font-mono">{accessKey}</Badge> : null}
        </div>
      </div>

      {!consoleUrl ? (
        <InlineAlert variant="error" title="Falta configuración" description="Configura `NEXT_PUBLIC_NETLOCK_CONSOLE_URL` para usar soporte remoto." />
      ) : !canEmbed ? (
        <InlineAlert
          variant="info"
          title="Embed bloqueado por seguridad"
          description={
            baseHref
              ? `NetLock envía X-Frame-Options/CSP (SAMEORIGIN). Para embeber dentro de la app, publica NetLock bajo el MISMO origen (mismo dominio y puerto) que la UI, por ejemplo con reverse-proxy en /netlock, y apunta NEXT_PUBLIC_NETLOCK_CONSOLE_URL a esa URL (actual: ${baseHref}).`
              : "NetLock envía X-Frame-Options/CSP (SAMEORIGIN). Para embeber dentro de la app, publica NetLock bajo el MISMO origen (mismo dominio y puerto) que la UI, por ejemplo con reverse-proxy en /netlock."
          }
        />
      ) : embedUrl ? (
        <div className={cn("overflow-hidden rounded-2xl border border-border bg-black/20", heightClassName ?? "h-[70vh]")}>
          <iframe
            title="NetLock Remote"
            src={embedUrl}
            className="h-full w-full"
            referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write; fullscreen; microphone; camera"
          />
        </div>
      ) : (
        <InlineAlert variant="error" title="No se pudo preparar el embed" description="Revisa NEXT_PUBLIC_NETLOCK_CONSOLE_URL." />
      )}

      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <Monitor className="h-4 w-4" />
        Dentro de NetLock: ve a “Devices”, busca por Access Key y usa “Remote Screen Control”.
      </div>
    </div>
  );
}
