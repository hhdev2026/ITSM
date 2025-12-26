"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ComboboxOption = {
  value: string;
  label: string;
  description?: string | null;
  keywords?: string;
};

export function Combobox({
  value,
  onValueChange,
  options,
  disabled,
  placeholder = "Seleccionar…",
  searchPlaceholder = "Buscar…",
  emptyText = "Sin resultados.",
  className,
}: {
  value: string | null;
  onValueChange: (next: string | null) => void;
  options: ComboboxOption[];
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = value ? options.find((o) => o.value === value) ?? null : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between", className)}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
        <CommandPrimitive>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <CommandPrimitive.Input
              placeholder={searchPlaceholder}
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <CommandPrimitive.List className="max-h-64 overflow-auto p-1">
            <CommandPrimitive.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </CommandPrimitive.Empty>
            <CommandPrimitive.Group>
              {options.map((o) => (
                <CommandPrimitive.Item
                  key={o.value}
                  value={`${o.label} ${o.description ?? ""} ${o.keywords ?? ""}`}
                  onSelect={() => {
                    onValueChange(o.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex cursor-default select-none items-start gap-2 rounded-lg px-3 py-2 text-sm",
                    "aria-selected:bg-accent aria-selected:text-accent-foreground"
                  )}
                >
                  <Check className={cn("mt-0.5 h-4 w-4", selected?.value === o.value ? "opacity-100" : "opacity-0")} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{o.label}</div>
                    {o.description ? <div className="truncate text-xs text-muted-foreground">{o.description}</div> : null}
                  </div>
                </CommandPrimitive.Item>
              ))}
              {value && (
                <CommandPrimitive.Item
                  value="__clear__"
                  onSelect={() => {
                    onValueChange(null);
                    setOpen(false);
                  }}
                  className={cn(
                    "mt-1 flex cursor-default select-none items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground",
                    "aria-selected:bg-accent aria-selected:text-accent-foreground"
                  )}
                >
                  <div className="h-4 w-4" />
                  Limpiar
                </CommandPrimitive.Item>
              )}
            </CommandPrimitive.Group>
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}

