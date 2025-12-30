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
        <div className="text-sm font-semibold">Soporte remoto</div>
        <div className="flex flex-wrap items-center gap-2">
          {accessKey ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(accessKey);
                toast.message("Copiado", { description: "Código del equipo copiado al portapapeles." });
              }}
            >
              <Copy className="h-4 w-4" />
              Copiar código
            </Button>
          ) : null}
          {accessKey ? <Badge variant="outline" className="font-mono">{accessKey}</Badge> : null}
        </div>
      </div>

      {!consoleUrl ? (
        <InlineAlert variant="error" title="No disponible" description="La consola de soporte remoto no está configurada." />
      ) : !canEmbed ? (
        <InlineAlert
          variant="info"
          title="Vista integrada no disponible"
          description={
            baseHref
              ? "Por políticas de seguridad del navegador, esta consola no se puede mostrar dentro de la app. Ábrela en una pestaña nueva."
              : "Por políticas de seguridad del navegador, esta consola no se puede mostrar dentro de la app."
          }
        />
      ) : embedUrl ? (
        <div className={cn("overflow-hidden rounded-2xl border border-border bg-black/20", heightClassName ?? "h-[70vh]")}>
          <iframe
            title="Soporte remoto"
            src={embedUrl}
            className="h-full w-full"
            referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write; fullscreen; microphone; camera"
          />
        </div>
      ) : (
        <InlineAlert variant="error" title="No se pudo abrir" description="La consola de soporte remoto no está disponible." />
      )}

      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <Monitor className="h-4 w-4" />
        En la consola: busca el equipo por el código y usa la opción de control remoto.
      </div>
    </div>
  );
}
