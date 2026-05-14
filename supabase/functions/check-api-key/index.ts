// check-api-key: tests an api_keys row against its provider and updates
// credits_used / credits_total / credits_checked_at, plus optionally
// flips is_exhausted back to false if the test succeeds (admin-triggered
// "revive" path). Returns the fresh status to the caller.
//
// Auth: caller must be a moderator (admin/coadmin/reviewer). We accept
// either a user JWT (preferred from admin UI) or a service-role token
// (for scripted maintenance).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type CheckResult = {
  status: 'ok' | 'exhausted' | 'unauthorized' | 'error';
  detail?: string;
  credits_used?: number;
  credits_total?: number;
};

// Tavily: hit /usage to read credit balance. Returns ok + credits info.
// On 401: unauthorized. On 432/433/429: exhausted. Else: error.
async function checkTavily(key: string): Promise<CheckResult> {
  try {
    // Tavily exposes credit info via response on a minimal /search call.
    // POST /search with max_results=1 against a no-op query, then read
    // the response headers / body for any credit data.
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query: "test", max_results: 1 }),
    });
    if (r.status === 401) return { status: 'unauthorized', detail: '401 invalid/revoked key' };
    if (r.status === 432) return { status: 'exhausted', detail: '432 plan-limit reached' };
    if (r.status === 433) return { status: 'exhausted', detail: '433 paygo-limit reached' };
    if (r.status === 429) return { status: 'exhausted', detail: '429 rate-limited' };
    if (!r.ok)            return { status: 'error', detail: `HTTP ${r.status}` };

    // Try Tavily's /usage endpoint for actual credit info. Endpoint may
    // 404 on older accounts — that's fine, we still report 'ok'.
    try {
      const u = await fetch("https://api.tavily.com/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key }),
      });
      if (u.ok) {
        const data = await u.json();
        // Tavily returns usage as: { plan_usage, plan_limit } or similar.
        // Defensively try multiple shapes.
        const used  = Number(data.plan_usage ?? data.credits_used ?? data.used);
        const total = Number(data.plan_limit ?? data.credits_total ?? data.limit ?? 1000);
        if (Number.isFinite(used) && Number.isFinite(total)) {
          return { status: 'ok', credits_used: used, credits_total: total };
        }
      }
    } catch { /* fall through to plain ok */ }
    return { status: 'ok' };
  } catch (e) {
    return { status: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}

// Mistral: minimum-cost completion call. Their response headers expose
// remaining ratelimit info on some plans.
async function checkMistral(key: string): Promise<CheckResult> {
  try {
    const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
    });
    if (r.status === 401) return { status: 'unauthorized', detail: '401 invalid key' };
    if (r.status === 402) return { status: 'exhausted', detail: '402 credits exhausted' };
    if (r.status === 429) {
      const body = await r.text();
      if (body.includes('free_tier') || body.includes('RESOURCE_EXHAUSTED')) {
        return { status: 'exhausted', detail: '429 quota exhausted' };
      }
      return { status: 'error', detail: '429 rate-limited (transient)' };
    }
    if (!r.ok) {
      const body = await r.text();
      return { status: 'error', detail: `HTTP ${r.status}: ${body.slice(0, 100)}` };
    }
    // Parse rate-limit headers if exposed. Mistral uses x-ratelimit-* on some endpoints.
    const usedHeader = r.headers.get('x-ratelimit-tokens-used') ?? r.headers.get('mistral-ratelimit-used');
    const totalHeader = r.headers.get('x-ratelimit-tokens-limit') ?? r.headers.get('mistral-ratelimit-limit');
    const used = usedHeader ? Number(usedHeader) : undefined;
    const total = totalHeader ? Number(totalHeader) : undefined;
    if (Number.isFinite(used) && Number.isFinite(total)) {
      return { status: 'ok', credits_used: used, credits_total: total };
    }
    return { status: 'ok' };
  } catch (e) {
    return { status: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth gate — moderator (admin/coadmin/reviewer) only.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    let isServiceRole = false;
    try {
      const parts = jwt.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payload?.role === "service_role") isServiceRole = true;
      }
    } catch { /* not a parseable JWT — treat as user token */ }
    if (!isServiceRole && jwt === SUPABASE_SERVICE_ROLE_KEY) isServiceRole = true;

    if (!isServiceRole) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
      const { data: roles } = await userClient
        .from("user_roles").select("role").eq("user_id", userData.user.id);
      const isMod = (roles ?? []).some((r: { role: string }) =>
        r.role === "reviewer" || r.role === "coadmin" || r.role === "admin",
      );
      if (!isMod) return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const keyId: string | null = body.keyId ?? null;
    if (!keyId) return json({ error: "keyId required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Look up the key row.
    const { data: row, error: rowErr } = await admin
      .from("api_keys")
      .select("id, provider, key_value")
      .eq("id", keyId)
      .single();
    if (rowErr || !row) return json({ error: `Key ${keyId} not found` }, 404);

    // Run the provider check.
    const result: CheckResult = row.provider === "tavily" ? await checkTavily(row.key_value)
      : row.provider === "mistral" ? await checkMistral(row.key_value)
      : { status: 'error', detail: `Check not implemented for provider '${row.provider}'` };

    // Persist the result. Update credit info if returned. If status==='ok',
    // we also flip is_exhausted=false (manual revival via successful check).
    // If status==='exhausted' or 'unauthorized', mark exhausted (and bump
    // position to bottom).
    const update: Record<string, unknown> = {
      credits_checked_at: new Date().toISOString(),
    };
    if (Number.isFinite(result.credits_used))  update.credits_used  = result.credits_used;
    if (Number.isFinite(result.credits_total)) update.credits_total = result.credits_total;
    if (result.status === 'ok') {
      update.is_exhausted = false;
      update.exhausted_reason = null;
      update.last_succeeded_at = new Date().toISOString();
    } else if (result.status === 'exhausted' || result.status === 'unauthorized') {
      // Move to bottom — same shape as the edge functions' inline markExhausted.
      const { data: maxRow } = await admin
        .from("api_keys")
        .select("position")
        .eq("provider", row.provider)
        .order("position", { ascending: false }).limit(1).maybeSingle();
      update.is_exhausted = true;
      update.exhausted_reason = result.detail?.slice(0, 200) ?? result.status;
      update.last_exhausted_at = new Date().toISOString();
      update.position = (((maxRow as { position?: number })?.position ?? 0)) + 1000;
    }
    await admin.from("api_keys").update(update).eq("id", keyId);

    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
