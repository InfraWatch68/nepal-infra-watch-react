// generate-daily-briefs: orchestrator triggered by the pg_cron job
// `daily-briefs-5am-nepal` (23:15 UTC = 5:00 AM NPT). Generates 8 briefs in
// sequence: 1 national (scope='global') + 7 provincial. Persists them via
// the existing ai-generate-global-brief function, then emails a consolidated
// digest to ALERT_EMAIL.
//
// Auth: three accepted modes (in order)
//   1. X-Internal-Token header == INTERNAL_NOTIFIER_TOKEN env — for pg_cron
//      paths that don't have a service-role JWT handy.
//   2. Authorization: Bearer <service-role JWT> — for the standard pg_cron
//      pattern that reuses the same app.sherlock_key setting.
//   3. Authorization: Bearer <user JWT> with moderator role — admin button
//      trigger for ad-hoc testing.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendAlert } from "../_shared/notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const PROVINCES = ["Koshi", "Madhesh", "Bagmati", "Gandaki", "Lumbini", "Karnali", "Sudurpashchim"] as const;
type Scope = { kind: "global" } | { kind: "province"; name: string };
const SCOPES: Scope[] = [
  { kind: "global" },
  ...PROVINCES.map(p => ({ kind: "province" as const, name: p })),
];

type BriefResult = {
  scope: string;
  province: string | null;
  ok: boolean;
  headline?: string;
  body?: string;
  importance?: number;
  error?: string;
};

// Format the digest email body. Sorted by importance desc so the most
// newsworthy brief lands at the top of the operator's inbox.
function formatDigest(results: BriefResult[]): { subject: string; text: string } {
  const successes = results.filter(r => r.ok);
  const failures = results.filter(r => !r.ok);
  const top = successes.length > 0
    ? successes.reduce((a, b) => ((a.importance ?? 0) > (b.importance ?? 0) ? a : b))
    : null;
  const today = new Date().toISOString().slice(0, 10);
  const subject = `Nepal Infra Watch — Daily briefs ${today} (${successes.length}/${results.length} generated${top ? `, top ${top.importance?.toFixed(2)} ${top.province ?? 'National'}` : ''})`;
  const sortedSuccesses = [...successes].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  const parts = [
    `Generated ${successes.length} of ${results.length} briefs for ${today} at ~05:00 NPT.`,
    failures.length > 0 ? `${failures.length} failed (see end of email).` : '',
    '',
  ];
  for (const r of sortedSuccesses) {
    const label = r.province ?? 'National';
    const score = (r.importance ?? 0).toFixed(2);
    parts.push(`────────────────────────────────────────────────────────`);
    parts.push(`${label.toUpperCase()} · importance ${score}`);
    parts.push(`"${r.headline ?? ''}"`);
    parts.push('');
    parts.push(r.body ?? '');
    parts.push('');
  }
  if (failures.length > 0) {
    parts.push(`────────────────────────────────────────────────────────`);
    parts.push(`FAILED (${failures.length}):`);
    for (const f of failures) {
      parts.push(`  ${f.province ?? 'National'}: ${f.error ?? 'unknown error'}`);
    }
  }
  parts.push('');
  parts.push(`— sent automatically by generate-daily-briefs (cron daily-briefs-5am-nepal)`);
  return { subject, text: parts.join('\n') };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const INTERNAL_TOKEN = Deno.env.get("INTERNAL_NOTIFIER_TOKEN") ?? "";

    // Tri-mode auth gate.
    const headerInternal = req.headers.get("X-Internal-Token") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const isInternal = INTERNAL_TOKEN.length > 0 && headerInternal === INTERNAL_TOKEN;

    let isAuthorized = isInternal;
    let triggeredBy = isInternal ? "cron(internal-token)" : "";

    if (!isAuthorized && jwt) {
      // Try service-role JWT or sb_secret_ direct match.
      try {
        const parts = jwt.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
          if (payload?.role === "service_role") { isAuthorized = true; triggeredBy = "cron(service-role)"; }
        }
      } catch { /* not a JWT */ }
      if (!isAuthorized && jwt === SUPABASE_SERVICE_ROLE_KEY) { isAuthorized = true; triggeredBy = "cron(sb_secret)"; }

      if (!isAuthorized) {
        // Try moderator user JWT.
        const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${jwt}` } },
        });
        const { data: userData } = await userClient.auth.getUser();
        if (userData?.user) {
          const { data: roles } = await userClient.from("user_roles").select("role").eq("user_id", userData.user.id);
          const isMod = (roles ?? []).some((r: { role: string }) =>
            r.role === "admin" || r.role === "coadmin" || r.role === "reviewer");
          if (isMod) { isAuthorized = true; triggeredBy = `user:${userData.user.email ?? userData.user.id}`; }
        }
      }
    }
    if (!isAuthorized) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const childAuthHeader = INTERNAL_TOKEN
      ? { "X-Internal-Token": INTERNAL_TOKEN }
      : { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

    // Sequential fan-out to ai-generate-global-brief. Sequential, not parallel
    // — 8 simultaneous Mistral calls would crash through quota and the key
    // rotator wouldn't see results between calls. Pacing also gives the
    // rate-limiter a chance to roll over keys cleanly.
    const results: BriefResult[] = [];
    for (let i = 0; i < SCOPES.length; i++) {
      const s = SCOPES[i];
      const body: Record<string, unknown> = { maxProjects: 30 };
      if (s.kind === "province") body.province = s.name;
      const province = s.kind === "province" ? s.name : null;

      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-generate-global-brief`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...childAuthHeader },
          body: JSON.stringify(body),
        });
        const txt = await r.text();
        if (!r.ok) {
          results.push({ scope: s.kind === "global" ? "global" : `province:${s.name}`, province, ok: false, error: `HTTP ${r.status}: ${txt.slice(0, 200)}` });
        } else {
          const j = JSON.parse(txt);
          results.push({
            scope: j.scope,
            province,
            ok: true,
            headline: j.headline,
            body: j.body,
            importance: j.importance,
          });
        }
      } catch (e) {
        results.push({ scope: s.kind === "global" ? "global" : `province:${s.name}`, province, ok: false, error: e instanceof Error ? e.message : String(e) });
      }

      // Pace 4s between calls — keeps us well under Mistral's free-tier RPM
      // and gives the rate limiter visibility per call. 8 × ~6s avg per call
      // ≈ 50s total wall time, comfortably under the edge-function ceiling.
      if (i < SCOPES.length - 1) await new Promise(res => setTimeout(res, 4000));
    }

    // Email the digest. cooldownMinutes=0 because we want every daily run to
    // produce one email (cooldown is for spammy retry loops, not daily cadence).
    const { subject, text } = formatDigest(results);
    const emailResult = await sendAlert(admin, "daily_briefs_generated", subject, text, {
      cooldownMinutes: 0,
      details: { triggeredBy, generated: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length },
    });

    return json({
      triggered_by: triggeredBy,
      generated: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      email_sent: emailResult.sent,
      email_reason: emailResult.reason ?? null,
      briefs: results.map(r => ({ scope: r.scope, importance: r.importance, ok: r.ok, error: r.error })),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
