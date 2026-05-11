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
    // Pull every data source the unified brief should reason over:
    //   - Project Record tabs: milestones, updates, sources
    //   - Comprehensive Details: funding/documents/stakeholders/risks/impact/procurement/compliance
    //   - Latest analysis run: narrative_summary + gaps_and_contradictions
    // Only approved rows where applicable (avoid showing the brief to mods'
    // pending work). Caps per-table at 6 to keep token spend bounded.
    const cap = (rows: any[] | null | undefined) => (rows ?? []).slice(0, 6);
    const eqOrApproved = "approval_status";
    const [
      { data: ms },
      { data: ups },
      { data: srcs },
      { data: fund },
      { data: docs },
      { data: stake },
      { data: risk },
      { data: impact },
      { data: proc },
      { data: comp },
      { data: runs },
    ] = await Promise.all([
      supabase.from("project_milestones").select("project_id, title, description, milestone_date, due_date, completed_date, stage, status").in("project_id", ids).order("milestone_date", { ascending: true }),
      supabase.from("project_updates").select("project_id, title, content, update_type, update_date, created_at, approval_status").in("project_id", ids).eq(eqOrApproved, "approved").order("created_at", { ascending: false }).limit(40),
      supabase.from("project_sources").select("project_id, title, url, source_type, approval_status").in("project_id", ids).eq(eqOrApproved, "approved").limit(40),
      supabase.from("project_funding").select("project_id, source_name, source_type, amount_npr, amount_usd, committed_at, disbursed_amount, lender_terms, notes, approval_status").in("project_id", ids).eq(eqOrApproved, "approved"),
      supabase.from("project_documents").select("project_id, title, doc_type, url, published_at, source_org, approval_status").in("project_id", ids).eq(eqOrApproved, "approved"),
      supabase.from("project_stakeholders").select("project_id, org_name, role, country, website, notes, approval_status").in("project_id", ids).eq(eqOrApproved, "approved"),
      supabase.from("project_risks").select("project_id, title, description, category, severity, status, reported_at, resolved_at, approval_status").in("project_id", ids).eq(eqOrApproved, "approved"),
      supabase.from("project_impact").select("project_id, metric_type, metric_value, unit, baseline_value, target_value, measured_at, notes, approval_status").in("project_id", ids).eq(eqOrApproved, "approved"),
      supabase.from("project_procurement").select("project_id, tender_title, tender_id_external, awardee_name, contract_value_npr, contract_type, contract_awarded_at, status, approval_status").in("project_id", ids).eq(eqOrApproved, "approved"),
      supabase.from("project_compliance").select("project_id, item_type, status, authority, decided_at, finding, approval_status").in("project_id", ids).eq(eqOrApproved, "approved"),
      supabase.from("project_analysis_runs").select("project_id, narrative_summary, gaps_and_contradictions, finished_at, status").in("project_id", ids).eq("status", "succeeded").order("started_at", { ascending: false }).limit(ids.length * 2),
    ]);

    const latestRunFor = (pid: number) => (runs ?? []).find((r: any) => r.project_id === pid);

    const projectBlocks = projects.map((p: any) => {
      const pms = cap((ms ?? []).filter((m: any) => m.project_id === p.id));
      const pus = cap((ups ?? []).filter((u: any) => u.project_id === p.id));
      const ps  = cap((srcs ?? []).filter((s: any) => s.project_id === p.id));
      const pf  = cap((fund ?? []).filter((f: any) => f.project_id === p.id));
      const pd  = cap((docs ?? []).filter((d: any) => d.project_id === p.id));
      const pst = cap((stake ?? []).filter((s: any) => s.project_id === p.id));
      const pr  = cap((risk ?? []).filter((r: any) => r.project_id === p.id));
      const pi  = cap((impact ?? []).filter((i: any) => i.project_id === p.id));
      const ppr = cap((proc ?? []).filter((q: any) => q.project_id === p.id));
      const pc  = cap((comp ?? []).filter((c: any) => c.project_id === p.id));
      const run = latestRunFor(p.id);
      return `## ${p.title}

### Identity
- Sector: ${p.sector} · Type: ${p.project_type ?? "—"} · National Pride: ${p.national_pride ? "yes" : "no"}
- Location: ${p.district ?? "—"}, ${p.province ?? "—"}${p.municipality ? ` (${p.municipality})` : ""}
- Implementing agency: ${p.implementing_agency ?? "—"} · Contractor: ${p.contractor ?? "—"}
- Status: ${p.status} (${p.progress_percent ?? 0}% complete)
- Budget (NPR): ${p.budget_npr ?? "—"} · Funding committed (NPR): ${p.funding_committed_npr ?? "—"}
- Procurement method: ${p.procurement_method ?? "—"} · ESIA: ${p.esia_status ?? "—"}
- Timeline: ${p.start_date ?? "—"} → ${p.expected_completion ?? "—"}
- Description (identity-only, may exclude recent activity): ${p.description ?? "—"}

### Latest analysis synthesis
${run?.narrative_summary ? run.narrative_summary : "(no analysis run completed yet)"}

### Gaps & contradictions flagged by analysis
${(run?.gaps_and_contradictions && run.gaps_and_contradictions.length > 0) ? run.gaps_and_contradictions.map((g: string) => `- ${g}`).join("\n") : "- (none flagged)"}

### Project Record (timeline)
Milestones (${pms.length}):
${pms.map((m: any) => `- ${m.title}${m.milestone_date ? ` (${m.milestone_date})` : ""} — ${m.status ?? "—"}${m.description ? `: ${m.description.slice(0, 180)}` : ""}`).join("\n") || "- none"}

Recent updates (${pus.length}):
${pus.map((u: any) => `- [${u.update_date ?? new Date(u.created_at).toISOString().slice(0, 10)}] ${u.title}${u.content ? ` — ${u.content.slice(0, 200)}` : ""}`).join("\n") || "- none"}

Citations (${ps.length}):
${ps.map((s: any) => `- ${s.source_type}: ${s.title} <${s.url}>`).join("\n") || "- none"}

### Comprehensive details
Funding (${pf.length}):
${pf.map((f: any) => `- ${f.source_name} (${f.source_type})${f.amount_npr ? ` NPR ${f.amount_npr}` : ""}${f.amount_usd ? ` / USD ${f.amount_usd}` : ""}${f.notes ? ` — ${f.notes.slice(0, 160)}` : ""}`).join("\n") || "- none"}

Stakeholders (${pst.length}):
${pst.map((s: any) => `- ${s.org_name} (${s.role})${s.country ? ` · ${s.country}` : ""}`).join("\n") || "- none"}

Risks (${pr.length}):
${pr.map((r: any) => `- [${r.severity}] ${r.title} (${r.status})${r.description ? ` — ${r.description.slice(0, 180)}` : ""}`).join("\n") || "- none"}

Impact metrics (${pi.length}):
${pi.map((i: any) => `- ${i.metric_type}: ${i.metric_value ?? "—"} ${i.unit ?? ""}${i.measured_at ? ` (measured ${i.measured_at})` : ""}`).join("\n") || "- none"}

Procurement (${ppr.length}):
${ppr.map((q: any) => `- ${q.tender_title}${q.awardee_name ? ` → ${q.awardee_name}` : ""}${q.contract_value_npr ? ` (NPR ${q.contract_value_npr})` : ""} [${q.status}]`).join("\n") || "- none"}

Compliance (${pc.length}):
${pc.map((c: any) => `- ${c.item_type}: ${c.status}${c.authority ? ` (${c.authority})` : ""}${c.finding ? ` — ${c.finding.slice(0, 180)}` : ""}`).join("\n") || "- none"}

Documents (${pd.length}):
${pd.map((d: any) => `- ${d.doc_type}: ${d.title} <${d.url}>`).join("\n") || "- none"}`;
    }).join("\n\n---\n\n");

    const systemPrompt = mode === "summary"
      ? `You are an analyst writing a comprehensive AI Project Brief for a Nepal infrastructure project. You are given an assembled context covering the project's identity, latest analysis synthesis, gaps, timeline (milestones / updates / citations), and comprehensive details (funding / stakeholders / risks / impact / procurement / compliance / documents).

WRITE THE BRIEF:
- 4-7 paragraphs (~400-700 words). Plain prose, neutral tone, no markdown, no bullet points, no headings.
- Lead with the most informative angle (status + scale, or controversy + funding, or audit findings — whichever the data emphasises).
- WEAVE the four data sources together — don't just summarise each in turn. e.g. "The project's NPR 31B Government of Nepal allocation [funding] funds the Kakarbhitta-Laukahi section that ADB tendered without finalising land acquisition [risks], a gap also flagged in the latest analysis run [gaps]."
- Cite specific values where useful (amounts, percentages, agency names, dates).
- Acknowledge gaps and contradictions explicitly — they are part of the public-record picture.
- DO NOT invent, infer, or pull in outside knowledge about real-world Nepali projects, locations, contractors, costs, or history — even if the title resembles a known project. Treat the title as an opaque label.
- If a category has no data, you may either omit it or note its absence as a gap. Don't pad.

STRICT: Use ONLY the structured data provided below.`
      : `You are an analyst comparing Nepal infrastructure projects across all available data (identity, latest analysis synthesis, timeline, and comprehensive details). STRICT RULES: Use ONLY the structured data provided. Do NOT invent or import outside knowledge about any project, even if titles resemble known ones. If fields are missing, say so. Cover: scope & scale, budget, schedule, geography, stakeholders, risks, and a one-line note on which warrants closer scrutiny. Plain prose with short headings.`;

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
