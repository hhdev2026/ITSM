"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Profile } from "@/lib/types";
import { Logo } from "./Logo";
import { signOut } from "@/lib/hooks";
import { CommandPalette, createAppCommandPaletteItems, useCommandPalette } from "@/components/CommandPalette";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { ChevronLeft, ChevronRight, LogOut, Menu, Moon, Plus, Search, Sun } from "lucide-react";
import { IconAnalytics, IconApprovals, IconAssets, IconCatalog, IconChat, IconKanban, IconKb, IconSla, IconTickets, IconUsers } from "@/components/icons/nav-icons";
import * as React from "react";

function initialsFromName(nameOrEmail: string) {
  const parts = nameOrEmail.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((p) => p[0]).join("");
  return initials.toUpperCase();
}

function NavItem({
  href,
  label,
  icon: Icon,
  collapsed,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm",
        "transition-[background,box-shadow,color] duration-200",
        "text-sidebar-muted-foreground hover:bg-sidebar-muted/70 hover:text-sidebar-foreground hover:shadow-sm",
        active && "bg-sidebar-muted/70 text-sidebar-foreground shadow-sm ring-1 ring-[hsl(var(--brand-cyan))]/15"
      )}
    >
      <span
        className={cn(
          "absolute left-1 top-2.5 bottom-2.5 w-1 rounded-full bg-gradient-to-b from-[hsl(var(--brand-cyan))] via-[hsl(var(--brand-blue))] to-[hsl(var(--brand-violet))]",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-60"
        )}
      />
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "text-sidebar-foreground" : "text-sidebar-muted-foreground group-hover:text-sidebar-foreground"
        )}
      />
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            className="min-w-0 truncate"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}

export function AppShell({ profile, children, wide = true }: { profile: Profile; children: React.ReactNode; wide?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const { open, setOpen } = useCommandPalette();
  const [collapsed, setCollapsed] = React.useState(false);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    const raw = localStorage.getItem("itsm.sidebarCollapsed");
    if (raw === "1") setCollapsed(true);
  }, []);

  React.useEffect(() => {
    localStorage.setItem("itsm.sidebarCollapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const nav =
    profile.role === "user"
      ? [
          { href: "/app", label: "Inicio", icon: IconTickets },
          { href: "/app/assets", label: "Mis activos", icon: IconAssets },
          { href: "/app/catalog", label: "Crear ticket", icon: IconCatalog },
          { href: "/app/chat", label: "Chat con soporte", icon: IconChat },
          { href: "/app/kb", label: "Guías y ayuda", icon: IconKb },
        ]
      : profile.role === "agent"
        ? [
            { href: "/app", label: "Mi trabajo", icon: IconKanban },
            { href: "/app/assets", label: "Activos", icon: IconAssets },
            { href: "/app/chats", label: "Chats", icon: IconChat },
            { href: "/app/kb", label: "Base de conocimiento", icon: IconKb },
            { href: "/app/approvals", label: "Aprobaciones", icon: IconApprovals },
          ]
        : [
            { href: "/app", label: "Panel", icon: IconAnalytics },
            { href: "/app/dispatch", label: "Centro de mando", icon: IconKanban },
            { href: "/app/tickets", label: "Seguimiento", icon: IconTickets },
            { href: "/app/assets", label: "Activos", icon: IconAssets },
            { href: "/app/chats", label: "Chats", icon: IconChat },
            { href: "/app/slas", label: "SLAs", icon: IconSla },
            { href: "/app/kb", label: "Base de conocimiento", icon: IconKb },
            { href: "/app/approvals", label: "Aprobaciones", icon: IconApprovals },
          ];

  const secondaryNav = profile.role === "admin" ? [{ href: "/app/admin/users", label: "Usuarios", icon: IconUsers }] : [];

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

  function onToggleTheme() {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  function onCreate() {
    // Always take user/admin/agent/supervisor to the guided catalog flow.
    router.push("/app/catalog");
  }

  const createLabel = profile.role === "user" ? "Crear ticket" : "Nuevo ticket";
  const roleLabel =
    profile.role === "user"
      ? "Usuario"
      : profile.role === "agent"
        ? "Agente"
        : profile.role === "supervisor"
          ? "Supervisor"
          : "Admin";

  const paletteItems = createAppCommandPaletteItems({
    role: profile.role,
    onNavigate: (href) => {
      setOpen(false);
      router.push(href);
    },
    onSignOut: () => {
      setOpen(false);
      void onSignOut();
    },
    onToggleTheme: () => {
      onToggleTheme();
      setOpen(false);
    },
  });

  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-background tech-app-bg">
        <div
          className={cn(
            "mx-auto grid min-h-dvh w-full grid-cols-1 md:grid-cols-[auto_1fr]",
            wide ? "max-w-none" : "max-w-7xl"
          )}
        >
          <motion.aside
            initial={false}
            animate={{ width: collapsed ? 84 : 300 }}
            transition={{ type: "spring", stiffness: 340, damping: 35 }}
            className={cn(
              "relative hidden shrink-0 flex-col bg-sidebar/55 backdrop-blur-md md:flex",
              "px-3 py-4",
              "before:pointer-events-none before:absolute before:inset-y-8 before:right-0 before:w-px before:bg-gradient-to-b before:from-[hsl(var(--brand-cyan))]/35 before:via-[hsl(var(--brand-blue))]/15 before:to-transparent",
              "after:pointer-events-none after:absolute after:inset-y-10 after:right-0 after:w-24 after:bg-gradient-to-l after:from-[hsl(var(--brand-cyan))]/10 after:to-transparent"
            )}
          >
            <div className={cn("flex items-center gap-3", collapsed ? "justify-center" : "justify-between")}>
              <div className={cn("min-w-0", collapsed && "hidden")}>
                <Logo />
              </div>

              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={onToggleTheme} aria-label="Cambiar tema">
                  {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCollapsed((v) => !v)}
                  aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
                >
                  {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {profile.role !== "user" ? (
              <div className="mt-4">
                <Button onClick={onCreate} className={cn("w-full justify-start", collapsed && "justify-center")}>
                  <Plus className="h-4 w-4" />
                  <AnimatePresence initial={false}>
                    {!collapsed && (
                      <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
                        {createLabel}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Button>
              </div>
            ) : null}

            <div className={cn("mt-4 rounded-2xl glass-surface", collapsed ? "p-2" : "p-3")}>
              <div className={cn("flex items-center gap-3", collapsed ? "justify-center" : "justify-between")}>
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[hsl(var(--brand-cyan))] via-[hsl(var(--brand-blue))] to-[hsl(var(--brand-violet))] text-sm font-semibold text-white">
                    {initialsFromName(profile.full_name || profile.email)}
                  </div>
                  {!collapsed && (
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{profile.full_name || profile.email}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{roleLabel}</Badge>
                        <Badge variant="outline">
                          {profile.rank} · {profile.points} pts
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {!collapsed && (
                <div className="mt-2 text-xs text-sidebar-muted-foreground">
                  Área:{" "}
                  <span className="text-sidebar-foreground">
                    {profile.department_id ? (profile.role === "user" ? "Asignada" : profile.department_id) : "Sin asignar"}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-4">
              {!collapsed && <div className="px-3 pb-2 text-[11px] font-medium tracking-wide text-sidebar-muted-foreground">NAVEGACIÓN</div>}
              <nav className="flex flex-col gap-1">
                {nav.map((i) => (
                  <NavItem key={i.href} href={i.href} label={i.label} icon={i.icon} collapsed={collapsed} />
                ))}
              </nav>
            </div>

            {secondaryNav.length > 0 ? (
              <div className="mt-4">
                {!collapsed && <div className="px-3 pb-2 text-[11px] font-medium tracking-wide text-sidebar-muted-foreground">ADMIN</div>}
                <nav className="flex flex-col gap-1">
                  {secondaryNav.map((i) => (
                    <NavItem key={i.href} href={i.href} label={i.label} icon={i.icon} collapsed={collapsed} />
                  ))}
                </nav>
              </div>
            ) : null}

            <div className="mt-auto pt-4">
              <Button variant="outline" className={cn("w-full justify-start", collapsed && "justify-center")} onClick={() => void onSignOut()}>
                <LogOut className="h-4 w-4" />
                {!collapsed && "Salir"}
              </Button>
            </div>
          </motion.aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-40 relative border-b border-border/60 bg-background/55 backdrop-blur-md">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--brand-cyan))]/25 to-transparent" />
              <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
                <div className="flex items-center gap-2 md:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" aria-label="Menú">
                        <Menu className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {nav.map((i) => {
                        const Icon = i.icon;
                        return (
                          <DropdownMenuItem key={i.href} onSelect={() => router.push(i.href)}>
                            <Icon className="h-4 w-4" />
                            {i.label}
                          </DropdownMenuItem>
                        );
                      })}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={onToggleTheme}>
                        {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        Cambiar tema
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void onSignOut()}>
                        <LogOut className="h-4 w-4" />
                        Salir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 text-muted-foreground md:max-w-xl"
                  onClick={() => setOpen(true)}
                >
                  <Search className="h-4 w-4" />
                  <span className="truncate">Buscar…</span>
                  <span className="ml-auto hidden rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground md:block">
                    ⌘K
                  </span>
                </Button>

                <div className="flex items-center gap-2">
                  {profile.role !== "user" ? (
                    <Button className="hidden md:inline-flex" onClick={onCreate}>
                      <Plus className="h-4 w-4" />
                      Nuevo
                    </Button>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="hidden max-w-[220px] justify-start md:inline-flex">
                        <span className="truncate">{profile.full_name || profile.email}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => router.push("/app")}>
                        <IconTickets className="h-4 w-4" />
                        Inicio
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={onToggleTheme}>
                        {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        Cambiar tema
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void onSignOut()}>
                        <LogOut className="h-4 w-4" />
                        Salir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </header>

            <main className="min-w-0 flex-1 px-4 py-6 md:px-6">
              <div className="tech-border tech-glow rounded-2xl p-[1px]">
                <div className="glass-surface rounded-2xl">
                  <div className="p-4 md:p-6">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={pathname}
                        initial={reduceMotion ? false : { opacity: 0, y: 10, filter: "blur(4px)" }}
                        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(4px)" }}
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      >
                        {children}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
      <CommandPalette open={open} onOpenChange={setOpen} items={paletteItems} />
    </TooltipProvider>
  );
}
