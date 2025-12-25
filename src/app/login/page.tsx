"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { Logo } from "@/components/Logo";
import { errorMessage } from "@/lib/error";
import { isDemoMode } from "@/lib/demo";
import { setDemoRole } from "@/lib/demoAuth";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = useMemo(() => email.includes("@") && password.length >= 6 && (mode === "login" || fullName.trim().length >= 3), [email, password, mode, fullName]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (isDemoMode()) {
        setDemoRole("admin");
        router.replace("/app");
        return;
      }
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
      }
      router.replace("/app");
    } catch (e: unknown) {
      setError(errorMessage(e) ?? "No se pudo autenticar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-50">
      <div className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <Logo />
        {isDemoMode() && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-medium">Modo DEMO (sin Supabase)</div>
            <div className="mt-2 text-xs text-zinc-400">Entra con un rol para probar la UI. Datos guardados en localStorage.</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => (setDemoRole("user"), router.replace("/app"))} className="rounded-xl bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10 hover:bg-white/10">
                User
              </button>
              <button onClick={() => (setDemoRole("agent"), router.replace("/app"))} className="rounded-xl bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10 hover:bg-white/10">
                Agent
              </button>
              <button onClick={() => (setDemoRole("supervisor"), router.replace("/app"))} className="rounded-xl bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10 hover:bg-white/10">
                Supervisor
              </button>
              <button onClick={() => (setDemoRole("admin"), router.replace("/app"))} className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-zinc-900">
                Admin
              </button>
            </div>
          </div>
        )}
        <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode("login")}
              className={["flex-1 rounded-xl px-3 py-2 text-sm", mode === "login" ? "bg-white text-zinc-900" : "bg-white/5 text-white ring-1 ring-white/10 hover:bg-white/10"].join(" ")}
            >
              Ingresar
            </button>
            <button
              onClick={() => setMode("signup")}
              className={["flex-1 rounded-xl px-3 py-2 text-sm", mode === "signup" ? "bg-white text-zinc-900" : "bg-white/5 text-white ring-1 ring-white/10 hover:bg-white/10"].join(" ")}
            >
              Crear cuenta
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {mode === "signup" && (
              <label className="block">
                <div className="text-xs text-zinc-400">Nombre completo</div>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
                />
              </label>
            )}
            <label className="block">
              <div className="text-xs text-zinc-400">Email</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
              />
            </label>
            <label className="block">
              <div className="text-xs text-zinc-400">Contraseña</div>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
              />
              <div className="mt-1 text-xs text-zinc-500">Mínimo 6 caracteres.</div>
            </label>
            {error && <div className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-200 ring-1 ring-rose-500/25">{error}</div>}
            <button
              disabled={!canSubmit || busy}
              onClick={submit}
              className="w-full rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
            >
              {busy ? "Procesando..." : mode === "login" ? "Ingresar" : "Crear cuenta"}
            </button>
          </div>
        </div>
        <div className="text-xs text-zinc-500">
          Nota: el rol y el departamento se asignan en la tabla <code className="text-zinc-200">profiles</code> (admin).
        </div>
      </div>
    </div>
  );
}
