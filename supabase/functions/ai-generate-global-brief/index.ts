// Generates an aggregate AI brief across approved projects, optionally filtered by
// province or sector. Stores the brief in global_briefs so the homepage hero can
// display the latest one. Auth-gated to moderators (reviewer / coadmin / admin).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { tryParseJsonObject } from "../_shared/json_repair.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
      // response_format=json_object forces valid JSON; max_tokens=8000 fits
      // the multi-brief payload — up to 10 briefs × 2-4 paragraphs each plus
      // headline/importance, with comfortable headroom for the JSON wrapper.
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 8000,
        response_format: { type: "json_object" },
      }),
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
    // Optional batch id from the orchestrator. When generate-daily-briefs
    // fans out across 8 scopes it threads the same UUID through every child
    // call so admins can group "everything from this run" in one query.
    const batchId: string | null = (() => {
      const raw = typeof body.batchId === "string" ? body.batchId.trim() : "";
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
    })();
    // Display-eligibility threshold. Briefs scoring at or above this go on the
    // homepage carousel; below this they're archived but invisible. 0.65 puts
    // the cut at the bottom of the "notable shift" band in the rubric below —
    // enough to filter out filler ("quiet day in a small province" → 0.25)
    // without demanding every slide be a 0.90+ flagship-slip headline.
    const DISPLAY_THRESHOLD = 0.65;

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

    // Multi-brief mode: ask the AI for a SET of distinct briefs covering
    // different angles, each self-scored on importance. The caller filters
    // by `display_eligible` (importance >= DISPLAY_THRESHOLD) to decide
    // which appear on the homepage carousel.
    const systemPrompt = `You are an analyst writing a BATCH of distinct aggregate briefs over ${scopeLabel}.
STRICT RULES: Use ONLY the structured data provided below — ${projects.length} project record(s). Do NOT invent or import outside knowledge. Treat titles as opaque labels.

Produce BETWEEN 3 AND 10 briefs. Each brief must cover a DIFFERENT angle: do not repeat headlines, do not paraphrase the same observation, do not cluster around the same project unless several different facts about it actually warrant it. Examples of distinct angles:
  - sector-wide delay pattern (e.g. "4 of 6 hydropower projects past expected completion")
  - single flagship slip with stated budget impact
  - funding-commitment shift (a large new disbursement, or a fall-off)
  - status churn (multiple projects moving from in_progress → delayed in one province)
  - critical-risk cluster
  - audit/compliance finding
  - completion milestone
  - geographic concentration (e.g. "all 3 new approvals in the last quarter are in Bagmati")
  - contractor concentration ("Agency X holds 60% of in-progress projects in this scope")
Pick angles the data ACTUALLY supports. If only 3 distinct stories exist, return 3 — do not pad to hit 10.

Each brief gets its own IMPORTANCE score, 0.00-1.00:
- 0.90-1.00: high-stakes news — a flagship project just slipped, a major audit finding landed, a large budget commitment changed, a critical risk opened, or completion of a National Pride Project.
- 0.70-0.89: notable shift — a sector saw multiple project status changes, several delays clustered in one province, a funder disbursement milestone.
- 0.50-0.69: moderate signal — sector overview with one or two meaningful new facts, baseline updates.
- 0.30-0.49: low signal — mostly summary of stable data, few changes.
- Below 0.30: filler — only emit if the angle is genuinely thin but still distinct.
Score honestly. Do NOT inflate to push briefs over the display threshold; the homepage will simply show fewer slides, which is fine.

Return ONLY a JSON object (no prose, no markdown, no code fence):
{
  "briefs": [
    {
      "headline":   string,   // <=140 chars, one factual observation, no surrounding quotes
      "body":       string,   // 2-4 short paragraphs, plain prose, no markdown headings, no bullet lists
      "importance": number    // 0.00-1.00 per rubric above
    },
    ...
  ]
}`;

    const ai = await callChatModel([
      { role: "system", content: systemPrompt },
      { role: "user", content: blocks },
    ]);
    if (!ai.ok) return json({ error: ai.error }, ai.status);
    const parseResult = tryParseJsonObject<{ briefs?: Array<{ headline?: string; body?: string; importance?: number }> }>(ai.text ?? "");
    if (!parseResult.ok) {
      return json({ error: `AI returned non-JSON output (${parseResult.reason})`, raw: (ai.text ?? "").slice(0, 300) }, 500);
    }
    const rawBriefs = Array.isArray(parseResult.value?.briefs) ? parseResult.value.briefs : [];
    if (rawBriefs.length === 0) {
      return json({ error: "AI returned no briefs", raw: (ai.text ?? "").slice(0, 300) }, 500);
    }

    const sources = projects.map((p: any) => ({ id: p.id, title: p.title, slug: p.slug }));
    const effectiveBatchId = batchId ?? crypto.randomUUID();

    // Normalise + cap to 10. Each brief gets a clamped importance and a
    // display_eligible flag derived from the threshold.
    type Normalised = { headline: string; body: string; importance: number; display_eligible: boolean };
    const seen = new Set<string>();
    const normalised: Normalised[] = [];
    for (const b of rawBriefs.slice(0, 10)) {
      const headline = String(b?.headline ?? "").trim().slice(0, 220);
      const bodyText = String(b?.body ?? "").trim();
      if (!headline || !bodyText) continue;
      // De-dupe by case-insensitive headline within this batch — the AI
      // occasionally repeats an angle despite the prompt.
      const key = headline.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const importanceRaw = Number(b?.importance);
      const importance = Number.isFinite(importanceRaw)
        ? Math.max(0, Math.min(1, Math.round(importanceRaw * 100) / 100))
        : 0.5;
      normalised.push({
        headline,
        body: bodyText,
        importance,
        display_eligible: importance >= DISPLAY_THRESHOLD,
      });
    }
    if (normalised.length === 0) {
      return json({ error: "All AI-returned briefs missing headline or body" }, 500);
    }

    // Atomically swap the display set for this scope: demote everything from
    // earlier batches BEFORE inserting the new ones. The homepage carousel
    // queries `display_eligible = true`, so if the demote step fails the worst
    // case is one batch of overlap (acceptable). If insert then fails we re-
    // promote nothing — the homepage just shows fewer briefs until the next
    // run, which is also acceptable.
    const { error: demoteErr } = await admin
      .from("global_briefs")
      .update({ display_eligible: false })
      .eq("scope", scope)
      .eq("display_eligible", true);
    if (demoteErr) console.warn(`demote prior display rows failed for scope=${scope}:`, demoteErr.message);

    const inserts = normalised.map(n => ({
      scope,
      scope_province: province ?? null,
      scope_sector: sector ?? null,
      headline: n.headline,
      body: n.body,
      sources,
      importance: n.importance,
      display_eligible: n.display_eligible,
      batch_id: effectiveBatchId,
      created_by: createdByUserId,
    }));
    const { data: insRows, error: iErr } = await admin
      .from("global_briefs")
      .insert(inserts)
      .select("id, headline, importance, display_eligible");
    if (iErr) return json({ error: iErr.message }, 500);

    // Retention: keep the last 30 briefs per scope. With 3-10 per run and the
    // daily cron, that's roughly the last 3-5 batches — enough history for
    // admins to compare runs without unbounded growth.
    const { data: toDelete } = await admin
      .from("global_briefs")
      .select("id")
      .eq("scope", scope)
      .order("created_at", { ascending: false })
      .range(30, 500);
    if (toDelete && toDelete.length > 0) {
      await admin.from("global_briefs").delete().in("id", toDelete.map((r: any) => r.id));
    }

    const displayCount = normalised.filter(n => n.display_eligible).length;
    return json({
      scope,
      batchId: effectiveBatchId,
      generated: normalised.length,
      displayEligible: displayCount,
      briefs: insRows ?? [],
      sourceCount: sources.length,
    });
  } catch (e) {
    console.error("ai-generate-global-brief error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
