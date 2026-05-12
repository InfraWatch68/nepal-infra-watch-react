// Email-alert helper shared across edge functions. Wraps Resend's HTTP API
// and applies per-kind cooldown via `notification_log` so a flapping upstream
// (Tavily 429 every minute) doesn't spam the operator inbox.
//
// Required Supabase secret:
//   RESEND_API_KEY   sign up at https://resend.com (free tier covers 100/day)
//
// Optional Supabase secrets:
//   ALERT_EMAIL      destination (default: infrawatch068@gmail.com)
//   ALERT_FROM       sender; default uses Resend's onboarding sender. For
//                    production, configure a verified domain.
//
// All failures are non-fatal — the caller logs and continues, since the
// alert is a side-channel that shouldn't block primary work.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type AlertKind =
  | "tavily_exhausted"
  | "mistral_exhausted"
  | "go_live_on"
  | "go_live_off"
  | "projects_milestone_500";

const DEFAULT_FROM  = "Nepal Infra Watch <onboarding@resend.dev>";
const DEFAULT_EMAIL = "infrawatch068@gmail.com";

export async function sendAlert(
  admin: SupabaseClient,
  kind: AlertKind,
  subject: string,
  body: string,
  options: { cooldownMinutes?: number; details?: Record<string, unknown> } = {},
): Promise<{ sent: boolean; reason?: string }> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return { sent: false, reason: "RESEND_API_KEY not set" };
  const to   = Deno.env.get("ALERT_EMAIL") ?? DEFAULT_EMAIL;
  const from = Deno.env.get("ALERT_FROM")  ?? DEFAULT_FROM;
  const cooldownMinutes = options.cooldownMinutes ?? 30;

  // Cooldown check. Milestone alerts pass cooldown=0 so they always fire
  // (the milestone-vs-last-milestone check provides the natural deduping).
  if (cooldownMinutes > 0) {
    const cutoff = new Date(Date.now() - cooldownMinutes * 60_000).toISOString();
    const { data: recent } = await admin
      .from("notification_log")
      .select("id")
      .eq("kind", kind)
      .gte("sent_at", cutoff)
      .limit(1)
      .maybeSingle();
    if (recent) return { sent: false, reason: `cooldown (${cooldownMinutes}m)` };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text: body }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { sent: false, reason: `Resend ${res.status}: ${errText.slice(0, 200)}` };
    }
    await admin.from("notification_log").insert({
      kind,
      details: { subject, ...(options.details ?? {}) },
    });
    return { sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { sent: false, reason: `fetch failed: ${msg}` };
  }
}
