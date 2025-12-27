"use client";

import * as React from "react";
import { toast } from "sonner";
import type { Profile } from "@/lib/types";
import { useAccessToken } from "@/lib/hooks";
import { isDemoMode } from "@/lib/demo";
import { supabase } from "@/lib/supabaseBrowser";
import { errorMessage } from "@/lib/error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/cn";
import { Check, ChevronDown, Plus, RefreshCcw, ShieldBan, ShieldCheck } from "lucide-react";
import { MotionItem, MotionList } from "@/components/motion/MotionList";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Users } from "lucide-react";

type Role = "user" | "agent" | "supervisor" | "admin";
const Roles: Role[] = ["user", "agent", "supervisor", "admin"];

type Department = { id: string; name: string; description: string | null };

type ManagedUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  department_id: string | null;
  manager_id: string | null;
  points: number;
  rank: string;
  created_at?: string;
  updated_at?: string;
  is_disabled: boolean | null;
  banned_until: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
};

function roleLabel(role: Role) {
  if (role === "user") return "Usuario";
  if (role === "agent") return "Agente";
  if (role === "supervisor") return "Supervisor";
  return "Admin";
}

function rankForPoints(points: number) {
  if (points >= 2000) return "Diamante";
  if (points >= 1000) return "Platino";
  if (points >= 500) return "Oro";
  if (points >= 200) return "Plata";
  return "Bronce";
}

function statusBadge(isDisabled: boolean | null) {
  if (isDisabled === true) return "bg-rose-500/15 text-rose-200 border-rose-500/30";
  if (isDisabled === false) return "bg-emerald-500/15 text-emerald-200 border-emerald-500/30";
  return "bg-zinc-800/60 text-zinc-200 border-zinc-700";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function extractApiError(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const err = data["error"];
  if (typeof err === "string" && err.trim()) return err;
  return null;
}

async function apiFetch<T>(url: string, token: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = extractApiError(data) ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export function UserAdmin({ adminProfile }: { adminProfile: Profile }) {
  const token = useAccessToken();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [managers, setManagers] = React.useState<Array<{ id: string; label: string; department_id: string | null }>>([]);
  const [users, setUsers] = React.useState<ManagedUser[]>([]);

  const [q, setQ] = React.useState("");
  const [role, setRole] = React.useState<Role | "all">("all");
  const [departmentId, setDepartmentId] = React.useState<string | "all">("all");

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createEmail, setCreateEmail] = React.useState("");
  const [createName, setCreateName] = React.useState("");
  const [createRole, setCreateRole] = React.useState<Role>("user");
  const [createDeptId, setCreateDeptId] = React.useState<string>("");
  const [createManagerId, setCreateManagerId] = React.useState<string>("");
  const [createInvite, setCreateInvite] = React.useState(true);
  const [createPassword, setCreatePassword] = React.useState("");
  const [createPoints, setCreatePoints] = React.useState(0);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ManagedUser | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editRole, setEditRole] = React.useState<Role>("user");
  const [editDeptId, setEditDeptId] = React.useState<string>("");
  const [editManagerId, setEditManagerId] = React.useState<string | null>(null);
  const [editPoints, setEditPoints] = React.useState(0);
  const [editDisabled, setEditDisabled] = React.useState<boolean | null>(null);
  const [resetPassword, setResetPassword] = React.useState("");

  const deptNameById = React.useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const managerOptions = React.useMemo(() => managers.map((m) => ({ value: m.id, label: m.label })), [managers]);

  async function loadLookups() {
    const { data: depts, error } = await supabase.from("departments").select("id,name,description").order("name");
    if (!error) setDepartments((depts ?? []) as Department[]);

    const { data: mgrs } = await supabase
      .from("profiles")
      .select("id,full_name,email,role,department_id")
      .in("role", ["supervisor", "admin"])
      .order("email");
    const list = (mgrs ?? []) as Array<{ id: string; full_name: string | null; email: string; role: string; department_id: string | null }>;
    setManagers(list.map((m) => ({ id: m.id, label: `${m.full_name || m.email} · ${m.role}`, department_id: m.department_id })));
  }

  async function load() {
    if (!token) return;
    if (isDemoMode()) {
      setError("El mantenedor de usuarios requiere Supabase (no disponible en DEMO).");
      setUsers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (role !== "all") params.set("role", role);
      if (departmentId !== "all") params.set("department_id", departmentId);
      params.set("limit", "80");
      const data = await apiFetch<{ users: ManagedUser[] }>(`/api/admin/users?${params.toString()}`, token);
      setUsers(data.users);
      setLoading(false);
    } catch (e: unknown) {
      setError(errorMessage(e) ?? "No se pudieron cargar usuarios");
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadLookups();
  }, []);

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, role, departmentId]);

  async function create() {
    if (!token) return;
    const email = createEmail.trim().toLowerCase();
    if (!email.includes("@")) {
      toast.error("Email inválido");
      return;
    }
    if (!createInvite && createPassword.trim().length < 8) {
      toast.error("Password mínimo 8 caracteres");
      return;
    }

    setSaving(true);
    try {
      await apiFetch<{ ok: true; id: string }>(
        "/api/admin/users",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            email,
            full_name: createName.trim() || null,
            role: createRole,
            department_id: createDeptId || null,
            manager_id: createManagerId || null,
            invite: createInvite,
            password: createInvite ? null : createPassword.trim(),
            points: createPoints,
          }),
        }
      );
      toast.success(createInvite ? "Invitación enviada" : "Usuario creado");
      setCreateOpen(false);
      setCreateEmail("");
      setCreateName("");
      setCreateRole("user");
      setCreateDeptId("");
      setCreateManagerId("");
      setCreateInvite(true);
      setCreatePassword("");
      setCreatePoints(0);
      await load();
    } catch (e: unknown) {
      toast.error("No se pudo crear", { description: errorMessage(e) ?? "Error" });
    } finally {
      setSaving(false);
    }
  }

  function openEdit(u: ManagedUser) {
    setEditing(u);
    setEditName(u.full_name ?? "");
    setEditRole(u.role);
    setEditDeptId(u.department_id ?? "");
    setEditManagerId(u.manager_id ?? null);
    setEditPoints(u.points ?? 0);
    setEditDisabled(u.is_disabled);
    setResetPassword("");
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!token || !editing) return;
    setSaving(true);
    try {
      await apiFetch<{ ok: true }>(
        `/api/admin/users/${editing.id}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            full_name: editName.trim() || null,
            role: editRole,
            department_id: editDeptId || null,
            manager_id: editManagerId,
            points: editPoints,
            disabled: editDisabled ?? undefined,
            password: resetPassword.trim() ? resetPassword.trim() : undefined,
          }),
        }
      );
      toast.success("Usuario actualizado");
      setEditOpen(false);
      await load();
    } catch (e: unknown) {
      toast.error("No se pudo actualizar", { description: errorMessage(e) ?? "Error" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleDisabled(u: ManagedUser, disabled: boolean) {
    if (!token) return;
    try {
      await apiFetch<{ ok: true }>(`/api/admin/users/${u.id}`, token, { method: "PATCH", body: JSON.stringify({ disabled }) });
      toast.success(disabled ? "Usuario deshabilitado" : "Usuario habilitado");
      await load();
    } catch (e: unknown) {
      toast.error("No se pudo cambiar estado", { description: errorMessage(e) ?? "Error" });
    }
  }

  const filteredManagers = React.useMemo(() => {
    if (!editDeptId) return managerOptions;
    const allowed = managers.filter((m) => m.department_id === editDeptId || m.department_id === null);
    return allowed.map((m) => ({ value: m.id, label: m.label }));
  }, [editDeptId, managers, managerOptions]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Usuarios</div>
          <div className="mt-1 text-sm text-muted-foreground">Crear, asignar roles/niveles y habilitar/deshabilitar cuentas.</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading || !token}>
            <RefreshCcw className="h-4 w-4" />
            Actualizar
          </Button>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" />
                Nuevo usuario
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <div className="space-y-4">
                <div>
                  <div className="text-lg font-semibold">Crear usuario</div>
                  <div className="mt-1 text-sm text-muted-foreground">Invita por email o crea con password inicial.</div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Email</div>
                    <Input value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} placeholder="usuario@empresa.com" />
                  </label>
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Nombre</div>
                    <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Nombre Apellido" />
                  </label>

                  <label className="block">
                    <div className="text-xs text-muted-foreground">Rol</div>
                    <select
                      value={createRole}
                      onChange={(e) => setCreateRole(e.target.value as Role)}
                      className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                    >
                      {Roles.map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <div className="text-xs text-muted-foreground">Departamento</div>
                    <select
                      value={createDeptId}
                      onChange={(e) => setCreateDeptId(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                    >
                      <option value="">(Auto)</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <div className="text-xs text-muted-foreground">Manager (opcional)</div>
                    <select
                      value={createManagerId}
                      onChange={(e) => setCreateManagerId(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                    >
                      <option value="">(Ninguno)</option>
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <div className="text-xs text-muted-foreground">Puntos (nivel)</div>
                    <Input
                      value={String(createPoints)}
                      onChange={(e) => setCreatePoints(Number(e.target.value || 0))}
                      inputMode="numeric"
                    />
                    <div className="mt-1 text-xs text-muted-foreground">Rank: {rankForPoints(createPoints)}</div>
                  </label>
                </div>

                <div className="rounded-2xl border border-border bg-background/40 p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={createInvite} onChange={(e) => setCreateInvite(e.target.checked)} />
                    <span className="text-muted-foreground">Enviar invitación por email (recomendado)</span>
                  </label>
                  {!createInvite ? (
                    <div className="mt-3">
                      <div className="text-xs text-muted-foreground">Password inicial</div>
                      <Input value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} type="password" placeholder="Mínimo 8 caracteres" />
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">Se enviará un link de activación al correo.</div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">Admin: {adminProfile.email}</div>
                  <Button disabled={saving || !token} onClick={() => void create()}>
                    {saving ? "Creando…" : "Crear"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error ? <InlineAlert variant="error" description={error} /> : null}

      <Card className="tech-border">
        <CardHeader>
          <CardTitle>Directorio</CardTitle>
          <CardDescription>Busca por email/nombre y filtra por rol o departamento.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1.2fr_0.45fr_0.55fr_auto]">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar usuario…" />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value === "all" ? "all" : (e.target.value as Role))}
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
          >
            <option value="all">Todos</option>
            {Roles.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value === "all" ? "all" : e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
          >
            <option value="all">Todos los deptos</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={() => void load()} disabled={loading || !token}>
            Aplicar
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-sm text-muted-foreground">Cargando…</div>
      ) : users.length === 0 ? (
        <EmptyState title="Sin resultados" description="No hay usuarios que coincidan con el filtro." icon={<Users className="h-5 w-5" />} />
      ) : (
        <MotionList className="grid gap-3 lg:grid-cols-2">
          {users.map((u) => (
            <MotionItem key={u.id} id={u.id}>
              <Card className={cn("tech-border", u.is_disabled ? "" : "tech-glow")}>
                <CardHeader className="gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{u.full_name || u.email}</CardTitle>
                      <CardDescription className="truncate">{u.email}</CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" aria-label="Acciones">
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openEdit(u)}>
                          <Check className="h-4 w-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {u.is_disabled ? (
                          <DropdownMenuItem onSelect={() => void toggleDisabled(u, false)}>
                            <ShieldCheck className="h-4 w-4" />
                            Habilitar
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onSelect={() => void toggleDisabled(u, true)} className="text-destructive-foreground">
                            <ShieldBan className="h-4 w-4" />
                            Deshabilitar
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{roleLabel(u.role)}</Badge>
                    <Badge variant="outline">{u.department_id ? deptNameById.get(u.department_id) ?? "—" : "Sin depto"}</Badge>
                    <Badge variant="outline" className={statusBadge(u.is_disabled)}>
                      {u.is_disabled === true ? "Deshabilitado" : u.is_disabled === false ? "Activo" : "—"}
                    </Badge>
                    <Badge variant="outline">
                      {u.rank} · {u.points} pts
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>Último acceso</span>
                    <span>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "—"}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span>Email verificado</span>
                    <span>{u.email_confirmed_at ? "Sí" : "—"}</span>
                  </div>
                </CardContent>
              </Card>
            </MotionItem>
          ))}
        </MotionList>
      )}

      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="tech-app-bg">
          <div className="h-dvh overflow-auto p-6">
            {!editing ? (
              <div className="text-sm text-muted-foreground">Selecciona un usuario.</div>
            ) : (
              <div className="space-y-5">
                <div>
                  <div className="text-xl font-semibold tracking-tight">Editar usuario</div>
                  <div className="mt-1 text-sm text-muted-foreground">{editing.email}</div>
                </div>

                <div className="tech-border rounded-2xl p-[1px]">
                  <div className="rounded-2xl bg-background/70 p-4 backdrop-blur">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block md:col-span-2">
                        <div className="text-xs text-muted-foreground">Nombre</div>
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </label>

                      <label className="block">
                        <div className="text-xs text-muted-foreground">Rol</div>
                        <select
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value as Role)}
                          className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                        >
                          {Roles.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <div className="text-xs text-muted-foreground">Departamento</div>
                        <select
                          value={editDeptId}
                          onChange={(e) => setEditDeptId(e.target.value)}
                          className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                        >
                          <option value="">(Sin depto)</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="md:col-span-2">
                        <div className="text-xs text-muted-foreground">Manager</div>
                        <div className="mt-1">
                          <Combobox
                            value={editManagerId}
                            onValueChange={setEditManagerId}
                            options={filteredManagers}
                            placeholder="Seleccionar…"
                            emptyText="Sin resultados."
                          />
                        </div>
                      </div>

                      <label className="block">
                        <div className="text-xs text-muted-foreground">Puntos</div>
                        <Input value={String(editPoints)} onChange={(e) => setEditPoints(Number(e.target.value || 0))} inputMode="numeric" />
                        <div className="mt-1 text-xs text-muted-foreground">Rank: {rankForPoints(editPoints)}</div>
                      </label>

                      <label className="block">
                        <div className="text-xs text-muted-foreground">Estado</div>
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editDisabled === false}
                            onChange={(e) => setEditDisabled(e.target.checked ? false : true)}
                          />
                          <span className="text-sm text-muted-foreground">Cuenta activa</span>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-background/40 p-4">
                  <div className="text-sm font-semibold">Reset password</div>
                  <div className="mt-1 text-xs text-muted-foreground">Opcional. Define un password nuevo (mín. 8) y guarda.</div>
                  <div className="mt-3">
                    <Input value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} type="password" placeholder="Nuevo password" />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">ID: {editing.id.slice(0, 8)}</div>
                  <Button disabled={saving || !token} onClick={() => void saveEdit()}>
                    {saving ? "Guardando…" : "Guardar"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
