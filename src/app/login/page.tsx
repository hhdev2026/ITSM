"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { Logo } from "@/components/Logo";
import { errorMessage } from "@/lib/error";
import { isDemoMode } from "@/lib/demo";
import { getDemoProfile, setDemoRole } from "@/lib/demoAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { InlineAlert } from "@/components/feedback/InlineAlert";

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
        const p = getDemoProfile();
        if (!p) setDemoRole("user");
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
    <div className="min-h-dvh tech-app-bg">
      <div className="mx-auto flex max-w-md flex-col gap-6 px-6 py-14">
        <div className="flex items-center justify-between">
          <Logo />
          <Badge variant="outline">Acceso</Badge>
        </div>

        {isDemoMode() ? (
          <Card className="tech-border tech-glow">
            <CardHeader>
              <CardTitle>Modo DEMO</CardTitle>
              <CardDescription>Selecciona un rol para probar la UI (sin Supabase).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => (setDemoRole("user"), router.replace("/app"))}>
                  Usuario
                </Button>
                <Button variant="outline" onClick={() => (setDemoRole("agent"), router.replace("/app"))}>
                  Agente
                </Button>
                <Button variant="outline" onClick={() => (setDemoRole("supervisor"), router.replace("/app"))}>
                  Supervisor
                </Button>
                <Button onClick={() => (setDemoRole("admin"), router.replace("/app"))}>Admin</Button>
              </div>
              <div className="text-xs text-muted-foreground">Datos guardados en localStorage.</div>
            </CardContent>
          </Card>
        ) : (
          <Card className="tech-border tech-glow">
            <CardHeader>
              <CardTitle>Iniciar sesión</CardTitle>
              <CardDescription>Accede a tu mesa de servicios.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Button variant={mode === "login" ? "default" : "outline"} onClick={() => setMode("login")}>
                  Ingresar
                </Button>
                <Button variant={mode === "signup" ? "default" : "outline"} onClick={() => setMode("signup")}>
                  Crear cuenta
                </Button>
              </div>

              <div className="grid gap-3">
                {mode === "signup" ? (
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Nombre completo</div>
                    <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </label>
                ) : null}
                <label className="block">
                  <div className="text-xs text-muted-foreground">Email</div>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
                </label>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Contraseña</div>
                  <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
                  <div className="mt-1 text-xs text-muted-foreground">Mínimo 6 caracteres.</div>
                </label>

                {error ? (
                  <InlineAlert variant="error" description={error} />
                ) : null}

                <Button disabled={!canSubmit || busy} onClick={submit} className={cn("w-full", busy && "opacity-90")}>
                  {busy ? "Procesando…" : mode === "login" ? "Ingresar" : "Crear cuenta"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="text-xs text-muted-foreground">
          Nota: rol y departamento se administran en <code className="text-foreground">profiles</code>.
        </div>
      </div>
    </div>
  );
}
