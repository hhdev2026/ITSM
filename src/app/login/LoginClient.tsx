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
import { CheckCircle2, Clock, Eye, EyeOff, MessageSquare, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = useMemo(() => email.includes("@") && password.length >= 6, [email, password]);
  const nextPath = searchParams.get("next") || "/app";

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
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
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-14 lg:grid-cols-[1fr_420px] lg:items-start">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="space-y-6"
        >
          <div className="flex items-center justify-between">
            <Logo />
            <Badge variant="outline" className="border-[hsl(var(--brand-cyan))]/30 bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Acceso administrado
            </Badge>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                <Sparkles className="h-3.5 w-3.5" />
                Portal de soporte
              </Badge>
              <Badge variant="outline">Tickets</Badge>
              <Badge variant="outline">Catálogo</Badge>
              <Badge variant="outline">Chat</Badge>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Acceso al{" "}
              <span className="text-[hsl(var(--brand-cyan))]">Service Desk</span>
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground md:text-base">
              Solicitudes guiadas, comunicación en tiempo real y trazabilidad completa (SLA/OLA). Si no tienes cuenta, solicita acceso a tu administrador.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { title: "Seguimiento", desc: "Estados, responsables y trazabilidad.", icon: CheckCircle2 },
              { title: "Chat", desc: "Canal directo con la mesa de ayuda.", icon: MessageSquare },
              { title: "SLA/OLA", desc: "Prioridad y tiempo visible en cada caso.", icon: Clock },
            ].map((x) => {
              const Icon = x.icon;
              return (
                <div key={x.title} className="rounded-2xl glass-surface p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
                      <Icon className="h-4 w-4" />
                    </span>
                    {x.title}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{x.desc}</div>
                </div>
              );
            })}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut", delay: 0.05 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-end">
            <Badge variant="outline">Acceso</Badge>
          </div>

          <Card className="tech-border tech-glow">
            <CardHeader>
              <CardTitle>Iniciar sesión</CardTitle>
              <CardDescription>Ingresa con tu cuenta habilitada por TI.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form className="grid gap-3" onSubmit={submit}>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Email</div>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    autoComplete="email"
                    spellCheck={false}
                    placeholder="usuario@empresa.com"
                  />
                </label>
                <label className="block">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">Contraseña</div>
                    <div className="text-xs text-muted-foreground">Mínimo 6 caracteres</div>
                  </div>
                  <div className="relative mt-1">
                    <Input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      className="pr-10"
                      placeholder="••••••••"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </label>

                {error ? <InlineAlert variant="error" description={error} /> : null}

                <Button type="submit" disabled={!canSubmit || busy} className={cn("w-full", busy && "opacity-90")}>
                  {busy ? "Verificando…" : "Ingresar"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
