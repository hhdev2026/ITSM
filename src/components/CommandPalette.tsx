"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

export type CommandPaletteItem = {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string;
  onSelect: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandPaletteItem[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        <CommandPrimitive className="w-full">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <CommandPrimitive.Input
              autoFocus
              placeholder="Buscar (tickets, KB, navegación)…"
              className={cn(
                "h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              )}
            />
            <div className="hidden rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground sm:block">
              Esc
            </div>
          </div>

          <CommandPrimitive.List className="max-h-[60vh] overflow-y-auto p-2">
            <CommandPrimitive.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
              Sin resultados.
            </CommandPrimitive.Empty>

            <CommandPrimitive.Group heading="Acciones" className="px-1">
              {items.map((item) => (
                <CommandPrimitive.Item
                  key={item.id}
                  value={`${item.title} ${item.subtitle ?? ""} ${item.keywords ?? ""}`}
                  onSelect={() => item.onSelect()}
                  className={cn(
                    "flex cursor-default select-none items-center justify-between gap-4 rounded-lg px-3 py-2 text-sm",
                    "aria-selected:bg-accent aria-selected:text-accent-foreground"
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{item.title}</div>
                    {item.subtitle && <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>}
                  </div>
                </CommandPrimitive.Item>
              ))}
            </CommandPrimitive.Group>
          </CommandPrimitive.List>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}

export function useCommandPalette({
  isDisabled,
}: {
  isDisabled?: boolean;
} = {}) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (isDisabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDisabled]);

  return { open, setOpen };
}

export function createAppCommandPaletteItems({
  role,
  onNavigate,
  onSignOut,
  onToggleTheme,
}: {
  role: string;
  onNavigate: (href: string) => void;
  onSignOut: () => void;
  onToggleTheme: () => void;
}): CommandPaletteItem[] {
  const items: CommandPaletteItem[] = [
    {
      id: "nav-home",
      title: "Ir al dashboard",
      subtitle: "Abrir vista principal",
      keywords: "inicio dashboard home",
      onSelect: () => onNavigate("/app"),
    },
    {
      id: "nav-catalog",
      title: "Catálogo de servicios",
      subtitle: "Solicitudes y casuísticas",
      keywords: "catalogo servicios solicitudes",
      onSelect: () => onNavigate("/app/catalog"),
    },
    {
      id: "nav-approvals",
      title: "Aprobaciones",
      subtitle: "Pendientes de aprobar",
      keywords: "aprobaciones approvals pending",
      onSelect: () => onNavigate("/app/approvals"),
    },
    {
      id: "nav-kb",
      title: "Base de conocimiento",
      subtitle: "Autoservicio · artículos",
      keywords: "kb autoservicio articulos",
      onSelect: () => onNavigate("/app/kb"),
    },
  ];

  if (role === "supervisor" || role === "admin") {
    items.push({
      id: "nav-slas",
      title: "SLAs",
      subtitle: "Configurar tiempos por prioridad",
      keywords: "sla olas tiempos",
      onSelect: () => onNavigate("/app/slas"),
    });
  }

  items.push(
    {
      id: "theme-toggle",
      title: "Cambiar tema",
      subtitle: "Alternar claro/oscuro",
      keywords: "tema dark light",
      onSelect: () => onToggleTheme(),
    },
    {
      id: "signout",
      title: "Cerrar sesión",
      subtitle: "Salir de la aplicación",
      keywords: "logout salir",
      onSelect: () => onSignOut(),
    }
  );

  return items;
}
