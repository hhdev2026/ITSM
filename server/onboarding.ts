import type express from "express";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireRole, type AuthedRequest } from "./auth";

const TechOnboardingSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  full_name: z.string().trim().min(2).max(120),
  role: z.enum(["agent", "supervisor"]).default("agent"),
});

export function registerOnboardingRoutes(app: express.Express, opts: { supabaseAdmin: SupabaseClient | null }) {
  if (!opts.supabaseAdmin) return;

  app.post("/api/onboarding/tech", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const parsed = TechOnboardingSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

      const authed = req as AuthedRequest;
      const deptId = authed.auth.departmentId;
      if (!deptId) return res.status(400).json({ error: "department_required" });

      const { email, full_name, role } = parsed.data;

      const created = await opts.supabaseAdmin!.auth.admin.inviteUserByEmail(email, { data: { full_name } });
      if (created.error) return res.status(502).json({ error: created.error.message });
      const userId = created.data.user?.id ?? null;
      if (!userId) return res.status(502).json({ error: "could_not_create_user" });

      const { error: profErr } = await opts.supabaseAdmin!.from("profiles").upsert(
        { id: userId, email, full_name, role, department_id: deptId },
        { onConflict: "id" }
      );
      if (profErr) return res.status(502).json({ error: profErr.message });

      res.setHeader("Cache-Control", "no-store");
      return res.json({ itsm: { userId, email, full_name, role, department_id: deptId } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "bad_request";
      res.status(400).json({ error: message });
    }
  });
}

