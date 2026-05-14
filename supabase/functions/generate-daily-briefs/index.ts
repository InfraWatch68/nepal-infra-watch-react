// generate-daily-briefs: orchestrator triggered by the pg_cron job
// `daily-briefs-5am-nepal` (23:15 UTC = 5:00 AM NPT) and by the single
// "Generate AI briefs" admin button. Fans out across 8 scopes (1 national +
// 7 provincial); the child function now returns a BATCH of 3-10 briefs per
// scope, each scored for importance. Only briefs at or above the display
// threshold get marked display_eligible and appear on the homepage carousel.
// Persists them via ai-generate-global-brief, then emails a consolidated
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

type ChildBrief = { id: string; headline: string; importance: number; display_eligible: boolean };
type ScopeResult = {
  scope: string;
  province: string | null;
  ok: boolean;
  generated?: number;        // total briefs the AI produced for this scope
  displayEligible?: number;  // subset at/above the display threshold
  topImportance?: number;    // highest importance in this scope's batch
  briefs?: ChildBrief[];     // the actual rows inserted
  error?: string;
};

// Format the digest email body. Sorted by top importance per scope so the
// most newsworthy area lands at the top of the operator's inbox.
function formatDigest(results: ScopeResult[], batchId: string): { subject: string; text: string } {
  const successes = results.filter(r => r.ok);
  const failures = results.filter(r => !r.ok);
  const totalGenerated = successes.reduce((s, r) => s + (r.generated ?? 0), 0);
  const totalDisplay = successes.reduce((s, r) => s + (r.displayEligible ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const subject = `Nepal Infra Watch — AI briefs ${today} (${totalDisplay} display-eligible of ${totalGenerated} across ${successes.length}/${results.length} scopes)`;
  const sortedSuccesses = [...successes].sort((a, b) => (b.topImportance ?? 0) - (a.topImportance ?? 0));
  const parts = [
    `Run ${today}: ${totalGenerated} briefs generated across ${successes.length}/${results.length} scopes; ${totalDisplay} marked display-eligible (importance >= 0.65).`,
    `Batch: ${batchId}`,
    failures.length > 0 ? `${failures.length} scope(s) failed (see end).` : '',
    '',
  ];
  for (const r of sortedSuccesses) {
    const label = r.province ?? 'National';
    parts.push(`────────────────────────────────────────────────────────`);
    parts.push(`${label.toUpperCase()} · ${r.generated ?? 0} brief(s), ${r.displayEligible ?? 0} display-eligible, top ${(r.topImportance ?? 0).toFixed(2)}`);
    // Top 3 headlines per scope, in importance order.
    const top3 = [...(r.briefs ?? [])]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 3);
    for (const b of top3) {
      const marker = b.display_eligible ? '★' : '·';
      parts.push(`  ${marker} ${b.importance.toFixed(2)}  "${b.headline}"`);
    }
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
  parts.push(`— sent automatically by generate-daily-briefs`);
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

    // Single batch_id threaded through every child call so admins can group
    // "everything from this run" with one query.
    const batchId = crypto.randomUUID();

    // Sequential fan-out to ai-generate-global-brief. Sequential, not parallel
    // — 8 simultaneous Mistral calls would crash through quota and the key
    // rotator wouldn't see results between calls. Pacing also gives the
    // rate-limiter a chance to roll over keys cleanly.
    const results: ScopeResult[] = [];
    for (let i = 0; i < SCOPES.length; i++) {
      const s = SCOPES[i];
      const body: Record<string, unknown> = { maxProjects: 30, batchId };
      if (s.kind === "province") body.province = s.name;
      const province = s.kind === "province" ? s.name : null;
      const scopeStr = s.kind === "global" ? "global" : `province:${s.name}`;

      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-generate-global-brief`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...childAuthHeader },
          body: JSON.stringify(body),
        });
        const txt = await r.text();
        if (!r.ok) {
          results.push({ scope: scopeStr, province, ok: false, error: `HTTP ${r.status}: ${txt.slice(0, 200)}` });
        } else {
          const j = JSON.parse(txt);
          const briefs: ChildBrief[] = Array.isArray(j.briefs) ? j.briefs : [];
          const topImportance = briefs.reduce((m, b) => Math.max(m, Number(b.importance) || 0), 0);
          results.push({
            scope: j.scope ?? scopeStr,
            province,
            ok: true,
            generated: Number(j.generated) || briefs.length,
            displayEligible: Number(j.displayEligible) || briefs.filter(b => b.display_eligible).length,
            topImportance,
            briefs,
          });
        }
      } catch (e) {
        results.push({ scope: scopeStr, province, ok: false, error: e instanceof Error ? e.message : String(e) });
      }

      // Pace 4s between calls — keeps us well under Mistral's free-tier RPM
      // and gives the rate limiter visibility per call.
      if (i < SCOPES.length - 1) await new Promise(res => setTimeout(res, 4000));
    }

    const totalGenerated = results.reduce((s, r) => s + (r.generated ?? 0), 0);
    const totalDisplay = results.reduce((s, r) => s + (r.displayEligible ?? 0), 0);
    const okScopes = results.filter(r => r.ok).length;
    const failedScopes = results.filter(r => !r.ok).length;

    // Email the digest. cooldownMinutes=0 because we want every daily run to
    // produce one email (cooldown is for spammy retry loops, not daily cadence).
    const { subject, text } = formatDigest(results, batchId);
    const emailResult = await sendAlert(admin, "daily_briefs_generated", subject, text, {
      cooldownMinutes: 0,
      details: { triggeredBy, batchId, totalGenerated, totalDisplay, okScopes, failedScopes },
    });

    return json({
      triggered_by: triggeredBy,
      batch_id: batchId,
      scopes_total: results.length,
      scopes_ok: okScopes,
      scopes_failed: failedScopes,
      total_generated: totalGenerated,
      total_display_eligible: totalDisplay,
      email_sent: emailResult.sent,
      email_reason: emailResult.reason ?? null,
      per_scope: results.map(r => ({
        scope: r.scope,
        ok: r.ok,
        generated: r.generated ?? 0,
        displayEligible: r.displayEligible ?? 0,
        topImportance: r.topImportance ?? null,
        error: r.error ?? null,
      })),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
