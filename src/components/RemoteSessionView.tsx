"use client";

import * as React from "react";
import Guacamole from "guacamole-common-js";
import type { Client, Keyboard, Mouse, MouseState, Status } from "guacamole-common-js";
import { useAccessToken } from "@/lib/hooks";
import { cn } from "@/lib/cn";

type RemoteSessionStatus = "idle" | "connecting" | "connected" | "error";

type RemoteTunnelResponse = { token: string; expiresInSeconds: number };

function apiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

function wsBaseUrl() {
  const base = apiBaseUrl();
  return base.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function RemoteSessionView({
  deviceId,
  title = "Sesión remota",
  className,
}: {
  deviceId: string;
  title?: string;
  className?: string;
}) {
  const accessToken = useAccessToken();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const focusRef = React.useRef<HTMLDivElement | null>(null);

  const clientRef = React.useRef<Client | null>(null);
  const keyboardRef = React.useRef<Keyboard | null>(null);
  const mouseRef = React.useRef<Mouse | null>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);

  const [status, setStatus] = React.useState<RemoteSessionStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState(false);

  const cleanup = React.useCallback(() => {
    try {
      resizeObserverRef.current?.disconnect();
    } catch {
      // ignore
    }
    resizeObserverRef.current = null;

    try {
      if (keyboardRef.current) {
        keyboardRef.current.onkeydown = null;
        keyboardRef.current.onkeyup = null;
      }
    } catch {}

    try {
      clientRef.current?.disconnect();
    } catch {
      // ignore
    }
    mouseRef.current = null;
    clientRef.current = null;

    const container = containerRef.current;
    if (container) {
      while (container.firstChild) container.removeChild(container.firstChild);
    }
  }, []);

  React.useEffect(() => {
    if (!accessToken) {
      setStatus("error");
      setError("Inicia sesión para abrir la sesión remota.");
      return;
    }

    let cancelled = false;
    setStatus("connecting");
    setError(null);

    async function start() {
      const focusEl = focusRef.current;
      const containerEl = containerRef.current;
      if (!focusEl || !containerEl) return;

      const rect = containerEl.getBoundingClientRect();
      const w = clampInt(rect.width || 1280, 320, 3840);
      const h = clampInt(rect.height || 720, 240, 2160);
      const dpi = clampInt((window.devicePixelRatio || 1) * 96, 72, 300);

      const res = await fetch(`${apiBaseUrl()}/api/remote/tunnel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });

      const data: unknown = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data !== "object") throw new Error("No se pudo iniciar el túnel remoto.");
      const { token } = data as RemoteTunnelResponse;
      if (!token) throw new Error("Token de túnel inválido.");

      const tunnel = new Guacamole.WebSocketTunnel(`${wsBaseUrl()}/api/remote/tunnel`);
      const client = new Guacamole.Client(tunnel);
      clientRef.current = client;

      client.onerror = (st?: Status) => {
        if (cancelled) return;
        setStatus("error");
        setError(st?.message || "Error en la sesión remota.");
      };

      client.onstatechange = (state: number) => {
        if (cancelled) return;
        if (state === Guacamole.Client.State.CONNECTED) setStatus("connected");
        if (state === Guacamole.Client.State.DISCONNECTED) {
          setStatus("error");
          setError((prev) => prev ?? "Sesión finalizada.");
        }
      };

      const displayEl: HTMLElement = client.getDisplay().getElement();
      displayEl.classList.add("h-full", "w-full");
      containerEl.appendChild(displayEl);

      const mouse = new Guacamole.Mouse(displayEl);
      mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = (mouseState: MouseState) => client.sendMouseState(mouseState);
      mouse.onmousewheel = (mouseState: MouseState) => client.sendMouseState(mouseState);
      mouseRef.current = mouse;

      if (!keyboardRef.current) keyboardRef.current = new Guacamole.Keyboard(focusEl);
      keyboardRef.current.onkeydown = (keysym: number) => client.sendKeyEvent(1, keysym);
      keyboardRef.current.onkeyup = (keysym: number) => client.sendKeyEvent(0, keysym);

      resizeObserverRef.current = new ResizeObserver(() => {
        const next = containerEl.getBoundingClientRect();
        const nw = clampInt(next.width || 1280, 320, 3840);
        const nh = clampInt(next.height || 720, 240, 2160);
        try {
          client.sendSize(nw, nh);
        } catch {
          // ignore
        }
      });
      resizeObserverRef.current.observe(containerEl);

      client.connect(`token=${encodeURIComponent(token)}&w=${w}&h=${h}&dpi=${dpi}`);
    }

    start().catch((e: unknown) => {
      if (cancelled) return;
      const msg = e instanceof Error ? e.message : "No se pudo abrir la sesión remota.";
      setStatus("error");
      setError(msg);
      cleanup();
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [accessToken, deviceId, cleanup]);

  return (
    <div className={cn("tech-border rounded-3xl p-[1px]", className)}>
      <div className="overflow-hidden rounded-3xl bg-background/70 backdrop-blur">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {status === "connecting" && "Conectando…"}
              {status === "connected" && (focused ? "Conectado · Entrada activa" : "Conectado · Haz click para controlar")}
              {status === "error" && "Error"}
              {status === "idle" && "Listo"}
            </div>
          </div>
          <div
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              status === "connected" ? "bg-emerald-400 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" : "bg-zinc-500/60"
            )}
            aria-hidden
          />
        </div>

        <div
          ref={focusRef}
          tabIndex={0}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onMouseDown={() => focusRef.current?.focus()}
          className={cn(
            "relative h-[70vh] min-h-[420px] w-full outline-none",
            focused ? "ring-2 ring-[hsl(var(--brand-cyan))]/40 ring-offset-0" : "ring-0"
          )}
        >
          <div ref={containerRef} className="absolute inset-0 bg-black" />

          {status === "connecting" && (
            <div className="absolute inset-0 grid place-items-center bg-black/30">
              <div className="rounded-2xl bg-background/70 px-4 py-3 text-sm text-foreground shadow-lg backdrop-blur">Conectando…</div>
            </div>
          )}

          {status === "error" && (
            <div className="absolute inset-0 grid place-items-center bg-black/30">
              <div className="max-w-md rounded-2xl bg-background/80 px-4 py-3 text-sm text-foreground shadow-lg backdrop-blur">
                <div className="font-semibold">No se pudo abrir la sesión</div>
                <div className="mt-1 text-xs text-muted-foreground">{error ?? "Error desconocido."}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
