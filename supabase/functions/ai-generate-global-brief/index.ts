// Generates an aggregate AI brief across approved projects, optionally filtered by
// province or sector. Stores the brief in global_briefs so the homepage hero can
// display the latest one. Auth-gated to moderators (reviewer / coadmin / admin).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const stripFences = (s: string) =>
  s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function callChatModel(
  messages: ChatMessage[],
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const mistral = Deno.env.get("MISTRAL_API_KEY");
  const google = Deno.env.get("GOOGLE_AI_API_KEY");
  const lovable = Deno.env.get("LOVABLE_API_KEY");
  let endpoint: string;
  let apiKey: string;
  let model: string;
  if (mistral) {
    endpoint = "https://api.mistral.ai/v1/chat/completions";
    apiKey = mistral;
    model = "mistral-small-latest";
  } else if (google) {
    endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    apiKey = google;
    model = "gemini-2.0-flash-lite";
  } else if (lovable) {
    endpoint = "https://ai.gateway.lovable.dev/v1/chat/completions";
    apiKey = lovable;
    model = "google/gemini-3-flash-preview";
  } else {
    return { ok: false, status: 500, error: "No AI key configured (set MISTRAL_API_KEY, GOOGLE_AI_API_KEY, or LOVABLE_API_KEY)" };
  }
  // One retry on 429 with a 30s backoff smooths over transient free-tier RPM bursts.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages }),
    });
    if (r.status === 402) return { ok: false, status: 402, error: "AI credits exhausted" };
    if (r.status === 429) {
      const body429 = await r.text();
      console.log(`AI 429 attempt ${attempt} body: ${body429}`);
      if (attempt === 0) { await new Promise(res => setTimeout(res, 30000)); continue; }
      return { ok: false, status: 429, error: `AI rate limit (after retry): ${body429.slice(0, 400)}` };
    }
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, status: r.status, error: `AI provider error ${r.status}: ${body.slice(0, 200)}` };
    }
    const j = await r.json();
    const text: string = j.choices?.[0]?.message?.content ?? "";
    return { ok: true, text };
  }
  return { ok: false, status: 500, error: "AI call failed" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!Deno.env.get("MISTRAL_API_KEY") && !Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("GOOGLE_AI_API_KEY")) {
      return json({ error: "No AI key configured (set MISTRAL_API_KEY, LOVABLE_API_KEY, or GOOGLE_AI_API_KEY)" }, 500);
    }

    // Auth gate accepts three modes:
    //   (a) X-Internal-Token header matching INTERNAL_NOTIFIER_TOKEN — used by
    //       the daily-briefs orchestrator + pg_cron path.
    //   (b) Authorization: Bearer <service-role JWT> — also for cron/scripted.
    //   (c) Authorization: Bearer <user JWT> with moderator role — admin button.
    const INTERNAL_TOKEN = Deno.env.get("INTERNAL_NOTIFIER_TOKEN") ?? "";
    const headerInternal = req.headers.get("X-Internal-Token") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const isInternal = INTERNAL_TOKEN.length > 0 && headerInternal === INTERNAL_TOKEN;

    let isServiceRole = false;
    let createdByUserId: string | null = null;
    if (!isInternal) {
      if (!jwt) return json({ error: "Unauthorized" }, 401);
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
        const isReviewer = (roles ?? []).some(
          (r: { role: string }) => r.role === "reviewer" || r.role === "coadmin" || r.role === "admin",
        );
        if (!isReviewer) return json({ error: "Forbidden" }, 403);
        createdByUserId = userData.user.id;
      }
    }

    const body = await req.json().catch(() => ({}));
    const province: string | undefined = body.province?.toString().trim() || undefined;
    const sector: string | undefined = body.sector?.toString().trim() || undefined;
    const maxProjects = Math.min(Math.max(Number(body.maxProjects) || 30, 1), 60);

    let scope = "global";
    if (province) scope = `province:${province}`;
    else if (sector) scope = `sector:${sector}`;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let q = admin.from("projects")
      .select("id, title, slug, sector, province, district, status, progress_percent, budget_npr, implementing_agency, contractor, start_date, expected_completion, description")
      .eq("approval_status", "approved")
      .order("created_at", { ascending: false })
      .limit(maxProjects);
    if (province) q = q.eq("province", province);
    if (sector) q = q.eq("sector", sector);

    const { data: projects, error: pErr } = await q;
    if (pErr) return json({ error: pErr.message }, 500);
    if (!projects || projects.length === 0) {
      return json({ error: "No approved projects matched the requested scope" }, 404);
    }

    const blocks = projects.map((p: any) =>
      `## ${p.title}
- Sector: ${p.sector}
- Location: ${p.district ?? "—"}, ${p.province ?? "—"}
- Status: ${p.status} (${p.progress_percent ?? 0}% complete)
- Budget (NPR): ${p.budget_npr ?? "—"}
- Agency: ${p.implementing_agency ?? "—"} | Contractor: ${p.contractor ?? "—"}
- Timeline: ${p.start_date ?? "—"} → ${p.expected_completion ?? "—"}`,
    ).join("\n\n");

    const scopeLabel = province
      ? `${province} province`
      : sector
        ? `the ${sector} sector`
        : "all tracked Nepal infrastructure projects";

    const systemPrompt = `You are an analyst writing a single aggregate brief over ${scopeLabel}.
STRICT RULES: Use ONLY the structured data provided below — ${projects.length} project record(s). Do NOT invent or import outside knowledge. Treat titles as opaque labels. If the data is too sparse, say so plainly.

Aim for an at-a-glance read suitable for a homepage hero card. The headline should be one short, factual observation that an editor would put above the fold.

You must also score the brief's IMPORTANCE — how newsworthy is the underlying data right now?

IMPORTANCE RUBRIC — required, 0.00-1.00:
- 0.90-1.00: high-stakes news — a flagship project just slipped, a major audit finding landed, a large budget commitment changed, a critical risk opened, or completion of a National Pride Project.
- 0.70-0.89: notable shift — a sector saw multiple project status changes, several delays clustered in one province, a funder disbursement milestone.
- 0.50-0.69: moderate signal — sector overview with one or two meaningful new facts, baseline updates.
- 0.30-0.49: low signal — mostly summary of stable data, few changes.
- Below 0.30: filler — nothing newsworthy. Score honestly even if data is sparse; do NOT inflate to make the brief feel important. A quiet day in a small province should score 0.20-0.35; that's fine.

Return ONLY a JSON object (no prose, no markdown, no code fence):
{
  "headline":   string,         // <=140 chars, one factual observation, no surrounding quotes
  "body":       string,         // 2-4 short paragraphs, plain prose, no markdown headings
  "importance": number          // 0.00-1.00 per rubric above
}`;

    const ai = await callChatModel([
      { role: "system", content: systemPrompt },
      { role: "user", content: blocks },
    ]);
    if (!ai.ok) return json({ error: ai.error }, ai.status);
    const raw = stripFences(ai.text);
    if (!raw) return json({ error: "Empty AI response" }, 500);
    let parsed: { headline?: string; body?: string; importance?: number };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: "AI returned non-JSON output" }, 500);
    }
    const headline = (parsed.headline ?? "").toString().trim().slice(0, 220);
    const bodyText = (parsed.body ?? "").toString().trim();
    if (!headline || !bodyText) return json({ error: "AI response missing headline or body" }, 500);
    // Clamp importance to [0,1]; default to 0.5 if AI omitted it (older Mistral
    // calls or schema-deviant responses). Round to 2dp for clean display.
    const importanceRaw = Number(parsed.importance);
    const importance = Number.isFinite(importanceRaw)
      ? Math.max(0, Math.min(1, Math.round(importanceRaw * 100) / 100))
      : 0.5;

    const sources = projects.map((p: any) => ({ id: p.id, title: p.title, slug: p.slug }));

    const { data: ins, error: iErr } = await admin.from("global_briefs").insert({
      scope,
      scope_province: province ?? null,
      scope_sector: sector ?? null,
      headline,
      body: bodyText,
      sources,
      importance,
      created_by: createdByUserId,
    }).select("id").single();
    if (iErr) return json({ error: iErr.message }, 500);

    // Retention: keep the 5 most recent briefs per scope. Earlier the function
    // kept 10; reduced to 5 because the new daily cron produces 8 rows/day
    // (1 national + 7 provincial) and we want a tighter archive — last week
    // of national + last week of each province is enough context.
    const { data: toDelete } = await admin
      .from("global_briefs")
      .select("id")
      .eq("scope", scope)
      .order("created_at", { ascending: false })
      .range(5, 100);
    if (toDelete && toDelete.length > 0) {
      await admin.from("global_briefs").delete().in("id", toDelete.map((r: any) => r.id));
    }

    return json({ id: ins.id, scope, headline, body: bodyText, importance, sourceCount: sources.length });
  } catch (e) {
    console.error("ai-generate-global-brief error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
