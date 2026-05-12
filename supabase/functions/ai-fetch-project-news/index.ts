// TODO: extract auth gate + Lovable call to _shared if a third caller appears.
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

// Parses TAVILY_API_KEYS (comma-separated) with fallback to TAVILY_API_KEY.
// Tries each key in order; moves to the next on 429. Returns { response, keyIndex }
// so callers can log which key was used or detect total exhaustion.
// Rotate on Tavily quota/auth codes: 429 rate, 432 plan, 433 paygo, 401 unauth.
const TAVILY_ROTATE_CODES = new Set([401, 429, 432, 433]);
async function tavilySearch(
  keys: string[],
  payload: Record<string, unknown>,
): Promise<{ response: Response; keyIndex: number } | { exhausted: true; lastStatus: number }> {
  let lastStatus = 0;
  for (let i = 0; i < keys.length; i++) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, api_key: keys[i] }),
    });
    if (!TAVILY_ROTATE_CODES.has(res.status)) return { response: res, keyIndex: i };
    lastStatus = res.status;
    await res.text();
  }
  return { exhausted: true, lastStatus };
}

function parseTavilyKeys(): string[] {
  // TAVILY_API_KEYS takes priority (comma-separated list for rotation).
  // Falls back to the legacy TAVILY_API_KEY single-key secret.
  const multi = Deno.env.get("TAVILY_API_KEYS") ?? "";
  const keys = multi.split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length > 0) return keys;
  const single = Deno.env.get("TAVILY_API_KEY") ?? "";
  return single ? [single] : [];
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// Dual-provider chat: Lovable AI Gateway if LOVABLE_API_KEY is set,
// otherwise Google AI Studio's OpenAI-compatible endpoint via GOOGLE_AI_API_KEY.
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
  // One retry on transient 429s; skip retry immediately for quota-exhausted errors.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages }),
    });
    if (r.status === 402) return { ok: false, status: 402, error: "AI credits exhausted" };
    if (r.status === 429) {
      const body429 = await r.text();
      if (body429.includes("free_tier") || body429.includes("RESOURCE_EXHAUSTED")) {
        return { ok: false, status: 429, error: `AI quota exhausted (free tier limit hit). Use a Google AI Studio key for higher quota. Details: ${body429.slice(0, 200)}` };
      }
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

    const tavilyKeys = parseTavilyKeys();
    if (tavilyKeys.length === 0) return json({ error: "No Tavily API keys configured" }, 500);
    if (!Deno.env.get("MISTRAL_API_KEY") && !Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("GOOGLE_AI_API_KEY")) {
      return json({ error: "No AI key configured (set MISTRAL_API_KEY, LOVABLE_API_KEY, or GOOGLE_AI_API_KEY)" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const { data: roles } = await userClient
      .from("user_roles").select("role").eq("user_id", userData.user.id);
    const isReviewer = (roles ?? []).some(
      (r: any) => r.role === "reviewer" || r.role === "coadmin" || r.role === "admin",
    );
    if (!isReviewer) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const projectId: string | undefined = body.projectId;
    const maxResults = Math.min(Math.max(Number(body.maxResults) || 3, 1), 5);
    if (!projectId) return json({ error: "projectId required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: project, error: pErr } = await admin
      .from("projects")
      .select("id, title, sector, province")
      .eq("id", projectId)
      .single();
    if (pErr || !project) return json({ error: "Project not found" }, 404);

    const query = `${project.title} Nepal ${project.sector ?? ""}`.trim();

    const tavResult = await tavilySearch(tavilyKeys, {
      query,
      topic: "news",
      days: 30,
      search_depth: "advanced",
      max_results: maxResults,
      include_answer: false,
    });

    if ("exhausted" in tavResult) {
      const reason = tavResult.lastStatus === 432 ? "plan-limit"
        : tavResult.lastStatus === 433 ? "paygo-limit"
        : tavResult.lastStatus === 401 ? "unauthorized"
        : tavResult.lastStatus === 429 ? "rate-limit"
        : `HTTP ${tavResult.lastStatus}`;
      return json({
        error: `All ${tavilyKeys.length} Tavily key(s) exhausted (${reason}). Try again later or add more keys to TAVILY_API_KEYS.`,
      }, 429);
    }
    const { response: tav, keyIndex } = tavResult;
    if (!tav.ok) return json({ error: `Tavily error ${tav.status}` }, 502);
    const tavJson = await tav.json();
    const results: any[] = tavJson.results ?? [];

    // Log which key was used (index only — never log the key value).
    if (tavilyKeys.length > 1) console.log(`Tavily: used key index ${keyIndex} of ${tavilyKeys.length}`);

    const errors: string[] = [];
    let inserted = 0;

    const sysPrompt = `You summarise a single news article into a neutral project update for "${project.title}".
Return ONLY a JSON object (no prose, no markdown, no fence):
{
  "title":   string,  // headline, <=120 chars, no quotes
  "content": string   // 1-2 short paragraphs, plain prose. End with two newlines and a Sources footnote section in this exact format:
                       //
                       //   Sources:
                       //   [1] <url>
}
Use only facts from the article. Do NOT invent.`;

    for (let idx = 0; idx < results.length; idx++) {
      const r = results[idx];
      if (idx > 0) await new Promise(res => setTimeout(res, 2500)); // pace under 30 RPM free tier
      if (!r?.content || r.content.length < 50) continue;
      try {
        const ai = await callChatModel([
          { role: "system", content: sysPrompt },
          { role: "user", content: `Title: ${r.title}\nURL: ${r.url}\n\nArticle:\n${r.content.slice(0, 1500)}` },
        ]);
        if (!ai.ok) {
          errors.push(`AI ${ai.status}: ${ai.error}`);
          if (ai.status === 429 || ai.status === 402) break;
          continue;
        }
        const raw = stripFences(ai.text);
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          errors.push(`JSON parse failed for ${r.url}`);
          continue;
        }
        if (!parsed?.title || !parsed?.content) continue;

        const { error: uErr } = await admin.from("project_updates").insert({
          project_id: project.id,
          author_id: null,
          title: String(parsed.title).slice(0, 200),
          content: String(parsed.content),
          update_type: "news",
          published: false,
          approval_status: "pending",
          submitted_by_ai: true,
        });
        if (uErr) {
          errors.push(`Insert update failed: ${uErr.message}`);
          continue;
        }

        // Skip if this URL is already recorded for this project.
        if (r.url) {
          const { data: existingSource } = await admin
            .from("project_sources")
            .select("id")
            .eq("project_id", project.id)
            .eq("url", r.url)
            .maybeSingle();
          if (existingSource) continue;
        }

        const { error: sErr } = await admin.from("project_sources").insert({
          project_id: project.id,
          added_by: null,
          source_type: "news",
          title: r.title || new URL(r.url).hostname,
          url: r.url,
          verified: false,
          approval_status: "pending",
          submitted_by_ai: true,
        });
        if (sErr) errors.push(`Insert source failed: ${sErr.message}`);

        inserted += 1;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    return json({ inserted, errors });
  } catch (e) {
    console.error("ai-fetch-project-news error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
