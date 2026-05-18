// AI verification pass for a single project. Runs targeted Tavily searches
// across news + .gov.np, hands the corpus + the project's own description to
// the chat model, and returns a structured verification report covering:
// supported claims, unsupported claims, contradicted claims, and overall
// confidence. Read-only — never writes data.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getKeys, markExhausted, markSucceeded } from "../_shared/api_keys.ts";
import { tryParseJsonObject } from "../_shared/json_repair.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TAVILY_EXHAUSTION_CODES = new Set([429, 432, 433]);
const TAVILY_UNAUTHORIZED_CODE = 401;
function tavilyExhaustionReason(status: number): string {
  if (status === 432) return "432 plan-limit";
  if (status === 433) return "433 paygo-limit";
  if (status === 429) return "429 rate-limit";
  return `HTTP ${status}`;
}

async function tavily(admin: unknown, keys: string[], payload: Record<string, unknown>) {
  let lastStatus = 0;
  let quotaFailures = 0;
  let authFailures = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, api_key: keys[i] }),
      });

      if (res.status >= 500) {
        lastStatus = res.status;
        if (attempt === 0) {
          await res.text().catch(() => "");
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        return { res };
      }

      if (res.status === TAVILY_UNAUTHORIZED_CODE) {
        authFailures += 1;
        lastStatus = res.status;
        const body = await res.text().catch(() => "");
        console.warn(`Tavily key index ${i} unauthorized; rotating without exhaustion mark: ${body.slice(0, 120)}`);
        break;
      }

      if (TAVILY_EXHAUSTION_CODES.has(res.status)) {
        quotaFailures += 1;
        lastStatus = res.status;
        const body = await res.text().catch(() => "");
        markExhausted(admin, "tavily", keys[i], `${tavilyExhaustionReason(res.status)} ${body.slice(0, 100)}`).catch(() => {});
        break;
      }

      if (res.ok) markSucceeded(admin, "tavily", keys[i]).catch(() => {});
      return { res };
    }
  }
  if (quotaFailures > 0 && quotaFailures + authFailures >= keys.length) {
    return { exhausted: true, lastStatus } as const;
  }
  return { unavailable: true, lastStatus } as const;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
async function callChat(messages: ChatMessage[]): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const mistral = Deno.env.get("MISTRAL_API_KEY");
  const google = Deno.env.get("GOOGLE_AI_API_KEY");
  const lovable = Deno.env.get("LOVABLE_API_KEY");
  let endpoint: string, apiKey: string, model: string;
  if (mistral) { endpoint = "https://api.mistral.ai/v1/chat/completions"; apiKey = mistral; model = "mistral-small-latest"; }
  else if (google) { endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"; apiKey = google; model = "gemini-2.0-flash-lite"; }
  else if (lovable) { endpoint = "https://ai.gateway.lovable.dev/v1/chat/completions"; apiKey = lovable; model = "google/gemini-3-flash-preview"; }
  else return { ok: false, status: 500, error: "No AI key configured" };

  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, response_format: { type: "json_object" } }),
    });
    if (r.status === 402) return { ok: false, status: 402, error: "AI credits exhausted" };
    if (r.status === 429) {
      const b = await r.text();
      if (attempt === 0) { await new Promise(res => setTimeout(res, 5000)); continue; }
      return { ok: false, status: 429, error: `AI rate limit (after retry): ${b.slice(0, 300)}` };
    }
    if (!r.ok) { const b = await r.text(); return { ok: false, status: r.status, error: `AI provider error ${r.status}: ${b.slice(0, 300)}` }; }
    const j = await r.json();
    return { ok: true, text: j.choices?.[0]?.message?.content ?? "" };
  }
  return { ok: false, status: 500, error: "AI call failed" };
}

const SYSTEM = `You are a fact-checking auditor for Nepal infrastructure project records.
Compare a project's claimed details against a corpus of search-result excerpts.
Return ONLY a JSON object matching this schema:
{
  "confidence": "high"|"medium"|"low",                // overall confidence the project as described is real and accurate
  "summary": string,                                   // 1-2 sentence verdict
  "supported": [string, ...],                          // claims you found explicit evidence for
  "unsupported": [string, ...],                        // claims with no corroboration in the corpus
  "contradicted": [{ "claim": string, "evidence": string, "source_url": string }, ...],
  "missing_data": [string, ...]                        // important facts the corpus mentions that aren't yet in the record
}
Rules:
- Use ONLY corpus excerpts. Do NOT pull in outside knowledge.
- Treat the project title as an opaque label. Don't assume same-name projects are the same project.
- If the corpus is empty or off-topic, return confidence "low" with a brief summary saying so.
- Be concise. Each list capped at 6 items.
- Output ONLY JSON, no prose, no markdown fences.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const { data: roles } = await userClient.from("user_roles").select("role").eq("user_id", userData.user.id);
    const isReviewer = (roles ?? []).some((r: any) => r.role === "reviewer" || r.role === "coadmin" || r.role === "admin");
    if (!isReviewer) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const projectId = Number(body.projectId);
    if (!Number.isFinite(projectId) || projectId <= 0) return json({ error: "projectId required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const tavilyKeys = await getKeys(admin, "tavily");
    if (tavilyKeys.length === 0) return json({ error: "No Tavily API keys configured" }, 500);

    const { data: project, error: pErr } = await admin
      .from("projects")
      .select("id, title, sector, province, district, description, implementing_agency, contractor, budget_npr, start_date, expected_completion")
      .eq("id", projectId).single();
    if (pErr || !project) return json({ error: "Project not found" }, 404);

    // Two targeted searches: news + Nepal government domains.
    const subject = `"${(project.title ?? "").replace(/"/g, "")}" Nepal ${project.sector ?? ""} ${project.province ?? ""}`.trim();
    const buckets = [
      { name: "news", payload: { query: subject, topic: "news", days: 365, search_depth: "advanced", max_results: 4, include_answer: false } },
      { name: "government", payload: { query: `${subject} ministry OR department OR government`, search_depth: "advanced", max_results: 3,
        include_domains: ["gov.np", "mof.gov.np", "moenv.gov.np", "moewri.gov.np", "mopit.gov.np", "ppmo.gov.np", "oag.gov.np"], include_answer: false } },
    ];
    const hits: Array<{ title: string; url: string; content: string; bucket: string }> = [];
    const warnings: string[] = [];
    for (const b of buckets) {
      const r = await tavily(admin, tavilyKeys, b.payload);
      if ("exhausted" in r) throw new Error("All Tavily keys exhausted");
      if ("unavailable" in r) { warnings.push(`Tavily ${b.name}: all keys unavailable (last status ${r.lastStatus})`); continue; }
      if (!r.res.ok) { warnings.push(`Tavily ${b.name}: HTTP ${r.res.status}`); continue; }
      const j = await r.res.json();
      for (const item of (j.results ?? []) as any[]) {
        if (!item?.url || !item?.content) continue;
        hits.push({ title: item.title ?? "", url: item.url, content: String(item.content).slice(0, 1500), bucket: b.name });
      }
    }
    if (hits.length === 0) {
      return json({
        ok: true,
        confidence: "low",
        summary: "No supporting sources found via web search. Verify manually.",
        supported: [], unsupported: [], contradicted: [], missing_data: [],
        warnings,
      });
    }

    const ctx = `## Project record (claims to verify)
Title: ${project.title}
Sector: ${project.sector ?? "—"}
Location: ${project.district ?? "—"}, ${project.province ?? "—"}
Implementing agency: ${project.implementing_agency ?? "—"}
Contractor: ${project.contractor ?? "—"}
Budget (NPR): ${project.budget_npr ?? "—"}
Timeline: ${project.start_date ?? "—"} → ${project.expected_completion ?? "—"}
Description: ${(project.description ?? "").slice(0, 800)}

## Search corpus (use ONLY this evidence)
${hits.map((h, i) => `### [${i + 1}] (${h.bucket}) ${h.title}\nURL: ${h.url}\n${h.content}`).join("\n\n")}`;

    const ai = await callChat([
      { role: "system", content: SYSTEM },
      { role: "user", content: ctx },
    ]);
    if (!ai.ok) return json({ error: ai.error, warnings }, ai.status);
    const parseResult = tryParseJsonObject<any>(ai.text ?? "");
    if (!parseResult.ok) {
      return json({ error: `AI returned non-JSON (${parseResult.reason})`, raw: (ai.text ?? "").slice(0, 500), warnings }, 502);
    }
    const parsed = parseResult.value;

    return json({
      ok: true,
      project_id: projectId,
      confidence: parsed.confidence ?? "low",
      summary: parsed.summary ?? "",
      supported: parsed.supported ?? [],
      unsupported: parsed.unsupported ?? [],
      contradicted: parsed.contradicted ?? [],
      missing_data: parsed.missing_data ?? [],
      sources_checked: hits.length,
      warnings,
    });
  } catch (e) {
    console.error("ai-verify-project:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
