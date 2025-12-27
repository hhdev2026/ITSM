"use client";

import type { Profile } from "./types";

type DemoRole = "user" | "agent" | "supervisor" | "admin";

const KEY = "itsm_demo_auth_v1";

const DemoUsers: Record<DemoRole, Profile> = {
  user: {
    id: "demo-user-00000000-0000-0000-0000-000000000001",
    email: "user@demo.local",
    full_name: "Demo User",
    role: "user",
    department_id: "11111111-1111-1111-1111-111111111111",
    manager_id: null,
    points: 0,
    rank: "Bronce",
  },
  agent: {
    id: "demo-agent-00000000-0000-0000-0000-000000000001",
    email: "agent@demo.local",
    full_name: "Demo Agent",
    role: "agent",
    department_id: "11111111-1111-1111-1111-111111111111",
    manager_id: null,
    points: 320,
    rank: "Plata",
  },
  supervisor: {
    id: "demo-supervisor-0000-0000-0000-000000000001",
    email: "supervisor@demo.local",
    full_name: "Demo Supervisor",
    role: "supervisor",
    department_id: "11111111-1111-1111-1111-111111111111",
    manager_id: null,
    points: 1200,
    rank: "Platino",
  },
  admin: {
    id: "demo-admin-00000000-0000-0000-0000-000000000001",
    email: "admin@demo.local",
    full_name: "Demo Admin",
    role: "admin",
    department_id: "11111111-1111-1111-1111-111111111111",
    manager_id: null,
    points: 2500,
    rank: "Diamante",
  },
};

export function getDemoProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { role?: DemoRole } | null;
    const role = parsed?.role;
    if (!role) return null;
    return DemoUsers[role] ?? null;
  } catch {
    return null;
  }
}

export function setDemoRole(role: DemoRole) {
  localStorage.setItem(KEY, JSON.stringify({ role }));
}

export function clearDemoAuth() {
  localStorage.removeItem(KEY);
}

export function listDemoAgents(departmentId: string) {
  const all = Object.values(DemoUsers);
  return all.filter((p) => (p.role === "agent" || p.role === "supervisor") && p.department_id === departmentId);
}
