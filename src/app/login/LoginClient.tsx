"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { supabase } from "@/lib/supabaseBrowser";
import { errorMessage } from "@/lib/error";
import { cn } from "@/lib/cn";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function HpLogo() {
  return (
    <div className="flex items-center gap-4">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-white text-[#0096d6] shadow-[0_18px_45px_rgb(15_23_42/0.18)] ring-1 ring-slate-200">
        <svg viewBox="0 0 64 64" aria-label="HP" className="h-11 w-11" role="img">
          <text
            x="31.5"
            y="42"
            fill="currentColor"
            fontFamily="Arial, Helvetica, sans-serif"
            fontSize="31"
            fontStyle="italic"
            fontWeight="700"
            letterSpacing="-4"
            textAnchor="middle"
          >
            hp
          </text>
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-xl font-semibold tracking-tight text-slate-950">Gestión de Ticket HP</div>
        <div className="mt-1 text-sm text-slate-500">Portal de acceso</div>
      </div>
    </div>
  );
}

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
    <main className="min-h-dvh bg-[#f4f7fb] text-[#111827]">
      <div className="mx-auto grid min-h-dvh w-full max-w-6xl grid-rows-[auto_1fr_auto] px-6 py-8">
        <header className="border-b border-[#d9e0ea] pb-6">
          <HpLogo />
        </header>

        <section className="flex items-center justify-center py-12">
          <div className="w-full max-w-[430px] rounded-lg border border-[#d7dee8] bg-white shadow-[0_24px_80px_rgb(15_23_42/0.10)]">
            <div className="space-y-2 px-7 pt-7">
              <div className="mb-2 grid h-11 w-11 place-items-center rounded-md bg-slate-950 text-white">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-[#111827]">Iniciar sesión</h1>
              <p className="text-sm leading-6 text-[#4b5563]">
                Ingresa con las credenciales autorizadas para acceder a la gestión de tickets.
              </p>
            </div>

            <div className="px-7 pb-7 pt-5">
              <form className="grid gap-4" onSubmit={submit}>
                <label className="block">
                  <div className="mb-1.5 text-sm font-medium text-[#374151]">Correo electrónico</div>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    autoComplete="email"
                    spellCheck={false}
                    placeholder="usuario@empresa.com"
                    className="h-11 border-[#c4ccd8] bg-white text-[#111827] placeholder:text-[#8a97ab] focus-visible:ring-[#0096d6]"
                  />
                </label>

                <label className="block">
                  <div className="mb-1.5 text-sm font-medium text-[#374151]">Contraseña</div>
                  <div className="relative">
                    <Input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      className="h-11 border-[#c4ccd8] bg-white pr-10 text-[#111827] placeholder:text-[#8a97ab] focus-visible:ring-[#0096d6]"
                      placeholder="Ingresa tu contraseña"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-[#516179] hover:bg-[#eef3f8] hover:text-[#111827]"
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </label>

                {error ? <InlineAlert variant="error" description={error} /> : null}

                <Button
                  type="submit"
                  disabled={!canSubmit || busy}
                  className={cn(
                    "mt-1 h-11 w-full bg-[#111827] text-white hover:bg-[#243042] disabled:bg-[#c8d0dc] disabled:text-[#5f6b7d]",
                    busy && "opacity-90"
                  )}
                >
                  {busy ? "Verificando..." : "Ingresar"}
                </Button>
              </form>
            </div>
          </div>
        </section>

        <footer className="border-t border-[#d9e0ea] pt-5 text-center text-sm text-[#64748b]">
          Desarrollado por <span className="font-semibold text-[#334155]">Geimser</span>
        </footer>
      </div>
    </main>
  );
}
