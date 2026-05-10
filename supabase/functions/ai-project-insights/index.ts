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
    const { mode, projectIds } = await req.json();
    if (!Array.isArray(projectIds) || projectIds.length === 0) {
      return json({ error: "projectIds required" }, 400);
    }
    if (!["summary", "compare"].includes(mode)) {
      return json({ error: "mode must be summary or compare" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: projects, error } = await supabase
      .from("projects").select("*")
      .in("id", projectIds.slice(0, 4));
    if (error) throw error;
    if (!projects || projects.length === 0) {
      return json({ error: "No approved projects found" }, 404);
    }

    const ids = projects.map((p: any) => p.id);
    const [{ data: ms }, { data: ups }] = await Promise.all([
      supabase.from("project_milestones").select("*").in("project_id", ids),
      supabase.from("project_updates").select("*").in("project_id", ids)
        .eq("approval_status", "approved").order("created_at", { ascending: false }).limit(20),
    ]);

    const projectBlocks = projects.map((p: any) => {
      const pms = (ms ?? []).filter((m: any) => m.project_id === p.id);
      const pus = (ups ?? []).filter((u: any) => u.project_id === p.id);
      return `## ${p.title}
- Sector: ${p.sector}
- Location: ${p.district ?? "—"}, ${p.province ?? "—"}
- Status: ${p.status} (${p.progress_percent ?? 0}% complete)
- Budget (NPR): ${p.budget_npr ?? "—"}
- Agency: ${p.implementing_agency ?? "—"} | Contractor: ${p.contractor ?? "—"}
- Timeline: ${p.start_date ?? "—"} → ${p.expected_completion ?? "—"}
- Description: ${p.description ?? ""}
- Milestones (${pms.length}): ${pms.map((m: any) => `${m.title} [${m.status}]`).join("; ") || "none"}
- Recent updates: ${pus.slice(0, 3).map((u: any) => u.title).join("; ") || "none"}`;
    }).join("\n\n");

    const systemPrompt = mode === "summary"
      ? "You are an analyst writing concise, neutral briefs about Nepal infrastructure projects. STRICT RULES: Use ONLY the structured data provided below. Do NOT invent, infer, or pull in any outside knowledge about real-world Nepali projects, locations, contractors, costs, or history — even if the title resembles a known project. Treat the title as an opaque label. If a field is missing or empty (—), explicitly say it is not provided. If the data is too sparse for a meaningful brief, say so in 1-2 sentences and stop. Write 1-4 short paragraphs based strictly on the given fields. Plain prose only."
      : "You are an analyst comparing Nepal infrastructure projects. STRICT RULES: Use ONLY the structured data provided. Do NOT invent or import outside knowledge about any project, even if titles resemble known ones. If fields are missing, say so. Cover: scope & scale, budget, schedule, geography, and a one-line note on which warrants closer scrutiny. Plain prose with short headings.";

    const ai = await callChatModel([
      { role: "system", content: systemPrompt },
      { role: "user", content: projectBlocks },
    ]);
    if (!ai.ok) return json({ error: ai.error }, ai.status);
    return json({ text: ai.text });
  } catch (e) {
    console.error("ai-project-insights error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
