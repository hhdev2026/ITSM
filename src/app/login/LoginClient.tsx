"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { Logo } from "@/components/Logo";
import { errorMessage } from "@/lib/error";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { InlineAlert } from "@/components/feedback/InlineAlert";

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = useMemo(() => email.includes("@") && password.length >= 6, [email, password]);
  const nextPath = searchParams.get("next") || "/app";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace(nextPath);
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

        <Card className="tech-border tech-glow">
          <CardHeader>
            <CardTitle>Iniciar sesión</CardTitle>
            <CardDescription>Accede a tu portal de soporte. Si no tienes cuenta, solicita acceso a tu administrador.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              <label className="block">
                <div className="text-xs text-muted-foreground">Email</div>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground">Contraseña</div>
                <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
                <div className="mt-1 text-xs text-muted-foreground">Mínimo 6 caracteres.</div>
              </label>

              {error ? <InlineAlert variant="error" description={error} /> : null}

              <Button disabled={!canSubmit || busy} onClick={submit} className={cn("w-full", busy && "opacity-90")}>
                {busy ? "Procesando…" : "Ingresar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
