"use client";

import type { ChatEvent, ChatMessage, Profile } from "@/lib/types";
import { cn } from "@/lib/cn";
import { displayName } from "./chat-ui";

type ProfileLite = Pick<Profile, "id" | "full_name" | "email" | "role">;

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function closureLabel(code: string) {
  if (code === "resuelto") return "Resuelto";
  if (code === "informacion_entregada") return "Información entregada";
  if (code === "derivado") return "Derivado / escalado";
  if (code === "no_responde") return "Usuario no responde";
  if (code === "fuera_de_alcance") return "Fuera de alcance";
  if (code === "duplicado") return "Duplicado";
  return code;
}

export function ChatTranscript({
  meId,
  messages,
  events,
  profilesById,
}: {
  meId: string;
  messages: ChatMessage[];
  events: ChatEvent[];
  profilesById: Record<string, ProfileLite | undefined>;
}) {
  const eventByMessageId = new Set<string>();
  for (const e of events) {
    if (e.event_type !== "message") continue;
    const messageId = (e.details?.message_id as string | undefined) ?? undefined;
    if (messageId) eventByMessageId.add(messageId);
  }

  const lines: Array<
    | { kind: "day"; day: string; iso: string }
    | { kind: "event"; event: ChatEvent }
    | { kind: "message"; message: ChatMessage }
  > = [];

  const all = [
    ...messages.map((m) => ({ kind: "message" as const, at: m.created_at, message: m })),
    ...events.filter((e) => e.event_type !== "message").map((e) => ({ kind: "event" as const, at: e.created_at, event: e })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  let lastDay: Date | null = null;
  for (const item of all) {
    const d = new Date(item.at);
    if (!lastDay || !isSameDay(lastDay, d)) {
      lines.push({ kind: "day", day: dayLabel(item.at), iso: item.at });
      lastDay = d;
    }
    lines.push(item.kind === "message" ? { kind: "message", message: item.message } : { kind: "event", event: item.event });
  }

  return (
    <div className="space-y-3">
      {lines.length === 0 ? (
        <div className="rounded-2xl glass-surface p-6 text-sm text-muted-foreground">Aún no hay mensajes.</div>
      ) : null}

      {lines.map((line) => {
        if (line.kind === "day") {
          return (
            <div key={`day-${line.iso}`} className="flex items-center justify-center">
              <div className="rounded-full border border-border bg-background/60 px-3 py-1 text-[11px] text-muted-foreground">
                {line.day}
              </div>
            </div>
          );
        }
        if (line.kind === "event") {
          const e = line.event;
          const actor = e.actor_id ? profilesById[e.actor_id] : undefined;
          const label =
            e.event_type === "assigned"
              ? "Asignado"
              : e.event_type === "accepted"
                ? "Atendido"
                : e.event_type === "closed"
                  ? "Cerrado"
                  : "Creado";

          const closure =
            e.event_type === "closed" && isRecord(e.details) && isRecord(e.details.closure) ? (e.details.closure as Record<string, unknown>) : null;
          const closureCode = closure && typeof closure.code === "string" ? closure.code : null;
          const closureNotes = closure && typeof closure.notes === "string" ? closure.notes : null;
          const closureText = closureCode ? closureLabel(closureCode) : null;

          return (
            <div key={`event-${e.id}`} className="flex items-center justify-center">
              <div className="rounded-2xl border border-border bg-background/50 px-3 py-2 text-[12px] text-muted-foreground">
                <span className="text-foreground">
                  {label}
                  {closureText ? <span className="text-muted-foreground"> · {closureText}</span> : null}
                </span>
                {actor ? <span> · {displayName(actor)}</span> : null}
                <span className="ml-2 opacity-70">{timeLabel(e.created_at)}</span>
                {closureNotes ? <div className="mt-1 text-[11px] text-muted-foreground/90">{closureNotes}</div> : null}
              </div>
            </div>
          );
        }

        const m = line.message;
        const mine = m.author_id === meId;
        const author = m.author_id ? profilesById[m.author_id] : undefined;
        const authorLabel = author ? displayName(author) : "—";
        const role = author?.role ?? null;
        const side = mine ? "justify-end" : "justify-start";
        const bubble = mine
          ? "bg-[hsl(var(--brand-cyan))]/12 border-[hsl(var(--brand-cyan))]/25"
          : "bg-background/40 border-border";

        return (
          <div key={`msg-${m.id}`} className={cn("flex", side)}>
            <div className={cn("max-w-[85%] rounded-2xl border p-3", bubble)}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate text-[12px] font-medium">
                  {mine ? "Tú" : authorLabel}
                  {!mine && role ? <span className="ml-2 text-[11px] text-muted-foreground">{role}</span> : null}
                </div>
                <div className="shrink-0 text-[11px] text-muted-foreground">{timeLabel(m.created_at)}</div>
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{m.body}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
