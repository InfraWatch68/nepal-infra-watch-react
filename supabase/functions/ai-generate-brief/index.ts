// TODO: extract auth gate + brief prompt to _shared if a third caller appears.
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
    if (!projectId) return json({ error: "projectId required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: project, error: pErr } = await admin
      .from("projects").select("*").eq("id", projectId).single();
    if (pErr || !project) return json({ error: "Project not found" }, 404);

    const [{ data: ms }, { data: ups }] = await Promise.all([
      admin.from("project_milestones").select("*").eq("project_id", projectId),
      admin.from("project_updates").select("*").eq("project_id", projectId)
        .eq("approval_status", "approved").order("created_at", { ascending: false }).limit(20),
    ]);

    const projectBlock = `## ${project.title}
- Sector: ${project.sector}
- Location: ${project.district ?? "—"}, ${project.province ?? "—"}
- Status: ${project.status} (${project.progress_percent ?? 0}% complete)
- Budget (NPR): ${project.budget_npr ?? "—"}
- Agency: ${project.implementing_agency ?? "—"} | Contractor: ${project.contractor ?? "—"}
- Timeline: ${project.start_date ?? "—"} → ${project.expected_completion ?? "—"}
- Description: ${project.description ?? ""}
- Milestones (${(ms ?? []).length}): ${(ms ?? []).map((m: any) => `${m.title} [${m.status}]`).join("; ") || "none"}
- Recent updates: ${(ups ?? []).slice(0, 3).map((u: any) => u.title).join("; ") || "none"}`;

    const systemPrompt = `You are an analyst writing concise, neutral briefs about Nepal infrastructure projects.
STRICT RULES: Use ONLY the structured data provided below. Do NOT invent, infer, or import outside knowledge about real-world Nepali projects, locations, contractors, costs, or history — even if the title resembles a known project. Treat the title as an opaque label. If a field is missing or empty (—), explicitly say it is not provided. If the data is too sparse for a meaningful brief, say so in 1-2 sentences in the body.

Return ONLY a JSON object (no prose, no markdown, no code fence):
{
  "headline": string,  // <=120 chars, factual, no surrounding quotes
  "body": string       // 1-3 short paragraphs, plain prose, no markdown
}`;

    const ai = await callChatModel([
      { role: "system", content: systemPrompt },
      { role: "user", content: projectBlock },
    ]);
    if (!ai.ok) return json({ error: ai.error }, ai.status);
    const raw = ai.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    if (!raw) return json({ error: "Empty AI response" }, 500);
    let parsed: { headline?: string; body?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: "AI returned non-JSON output" }, 500);
    }
    const headline = (parsed.headline ?? "").toString().trim().slice(0, 200);
    const bodyText = (parsed.body ?? "").toString().trim();
    if (!headline || !bodyText) return json({ error: "AI response missing headline or body" }, 500);

    const { data: ins, error: iErr } = await admin.from("project_updates").insert({
      project_id: projectId,
      author_id: null,
      title: headline,
      content: bodyText,
      update_type: "brief",
      published: false,
      approval_status: "pending",
      submitted_by_ai: true,
    }).select("id").single();
    if (iErr) return json({ error: iErr.message }, 500);

    return json({ updateId: ins.id });
  } catch (e) {
    console.error("ai-generate-brief error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
