// Comprehensive multi-source project analysis. Runs targeted Tavily queries
// across news / Nepal government domains / international orgs / procurement /
// audit, hands the merged corpus to the chat model with a strict JSON
// extraction prompt, and inserts the resulting structured rows into the
// 7 new project_* tables (funding/documents/stakeholders/risks/impact/
// procurement/compliance) as `submitted_by_ai=true, approval_status='pending'`
// for moderator review.

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

// ----- Tavily -----
function parseTavilyKeys(): string[] {
  const multi = (Deno.env.get("TAVILY_API_KEYS") ?? "").split(",").map(k => k.trim()).filter(Boolean);
  if (multi.length > 0) return multi;
  const single = Deno.env.get("TAVILY_API_KEY") ?? "";
  return single ? [single] : [];
}
async function tavily(keys: string[], payload: Record<string, unknown>) {
  for (let i = 0; i < keys.length; i++) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, api_key: keys[i] }),
    });
    if (res.status !== 429) return { res, keyIndex: i };
    await res.text();
  }
  return { exhausted: true } as const;
}

// ----- Chat model (Mistral > Google > Lovable) -----
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
async function callChat(messages: ChatMessage[]):
  Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }>
{
  const mistral = Deno.env.get("MISTRAL_API_KEY");
  const google = Deno.env.get("GOOGLE_AI_API_KEY");
  const lovable = Deno.env.get("LOVABLE_API_KEY");
  let endpoint: string, apiKey: string, model: string;
  if (mistral) {
    endpoint = "https://api.mistral.ai/v1/chat/completions";
    apiKey = mistral; model = "mistral-small-latest";
  } else if (google) {
    endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    apiKey = google; model = "gemini-2.0-flash-lite";
  } else if (lovable) {
    endpoint = "https://ai.gateway.lovable.dev/v1/chat/completions";
    apiKey = lovable; model = "google/gemini-3-flash-preview";
  } else {
    return { ok: false, status: 500, error: "No AI key configured (set MISTRAL_API_KEY, GOOGLE_AI_API_KEY, or LOVABLE_API_KEY)" };
  }
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
    if (!r.ok) {
      const b = await r.text();
      return { ok: false, status: r.status, error: `AI provider error ${r.status}: ${b.slice(0, 300)}` };
    }
    const j = await r.json();
    return { ok: true, text: j.choices?.[0]?.message?.content ?? "" };
  }
  return { ok: false, status: 500, error: "AI call failed" };
}

// ----- Source bundle ranger -----
type Hit = { title: string; url: string; content: string; bucket: string };

async function gatherSources(keys: string[], project: any, maxPerBucket = 3): Promise<{ hits: Hit[]; warnings: string[] }> {
  const warnings: string[] = [];
  const title = (project.title ?? "").replace(/"/g, "");
  const sector = project.sector ?? "";
  const province = project.province ?? "";
  const subject = `"${title}" Nepal ${sector} ${province}`.trim();

  // Bucket-specific Tavily queries with domain biases. Tavily's
  // include_domains / search_depth keep the corpus on-topic.
  const buckets: Array<{ name: string; payload: Record<string, unknown> }> = [
    {
      name: "news",
      payload: { query: subject, topic: "news", days: 365, search_depth: "advanced", max_results: maxPerBucket, include_answer: false },
    },
    {
      name: "government",
      payload: { query: `${subject} ministry OR department OR government`, search_depth: "advanced", max_results: maxPerBucket,
        include_domains: ["gov.np", "mof.gov.np", "moenv.gov.np", "moewri.gov.np", "mopit.gov.np", "moald.gov.np"], include_answer: false },
    },
    {
      name: "procurement",
      payload: { query: `${subject} tender OR contract OR bidding`, search_depth: "advanced", max_results: maxPerBucket,
        include_domains: ["ppmo.gov.np", "bolpatra.gov.np"], include_answer: false },
    },
    {
      name: "audit_compliance",
      payload: { query: `${subject} audit OR EIA OR environmental clearance OR forest clearance OR blacklist`, search_depth: "advanced", max_results: maxPerBucket,
        include_domains: ["oag.gov.np", "ciaa.gov.np", "moenv.gov.np", "doed.gov.np"], include_answer: false },
    },
    {
      name: "international_org",
      payload: { query: `${subject} financing OR loan OR grant OR funding`, search_depth: "advanced", max_results: maxPerBucket,
        include_domains: ["worldbank.org", "adb.org", "undp.org", "ifc.org", "jica.go.jp", "kfw.de"], include_answer: false },
    },
  ];

  const hits: Hit[] = [];
  for (const b of buckets) {
    const r = await tavily(keys, b.payload);
    if ("exhausted" in r) { warnings.push(`Tavily exhausted on bucket ${b.name}`); continue; }
    if (!r.res.ok) { warnings.push(`Tavily ${b.name}: HTTP ${r.res.status}`); continue; }
    const j = await r.res.json();
    for (const item of (j.results ?? []) as any[]) {
      if (!item?.url || !item?.content) continue;
      hits.push({ title: item.title ?? "", url: item.url, content: String(item.content).slice(0, 1500), bucket: b.name });
    }
  }
  return { hits, warnings };
}

// ----- Extraction prompt -----
const EXTRACTION_SYSTEM = `You are an information-extraction system for Nepal infrastructure projects. You will be given:
- a project context block (title, sector, location, current data),
- a corpus of search-result excerpts grouped by source bucket (news, government, procurement, audit_compliance, international_org).

Return ONLY a JSON object with the schema below. Each array may be empty if the corpus has no evidence. Every fact must be grounded in a corpus excerpt — DO NOT invent. Every item MUST include "source_url" pointing to the corpus URL it came from. Skip items you cannot ground.

{
  "funding": [
    { "source_name": str, "source_type": "government|multilateral|bilateral|private|loan|grant|equity|ppp|other",
      "amount_npr": num|null, "amount_usd": num|null, "currency": str|null,
      "committed_at": "YYYY-MM-DD"|null, "disbursed_amount": num|null,
      "lender_terms": str|null, "notes": str|null, "source_url": str }
  ],
  "documents": [
    { "title": str, "doc_type": "eia|iee|contract|tender|audit|progress_report|completion_report|blueprint|financial|press_release|legal|other",
      "url": str, "source_org": str|null, "language": "en|ne"|null,
      "published_at": "YYYY-MM-DD"|null, "notes": str|null, "source_url": str }
  ],
  "stakeholders": [
    { "role": "implementing_agency|executing_ministry|contractor|sub_contractor|consultant|donor|beneficiary|regulator|community|other",
      "org_name": str, "contact_name": str|null, "contact_email": str|null, "contact_phone": str|null,
      "website": str|null, "country": str|null, "notes": str|null, "source_url": str }
  ],
  "risks": [
    { "category": "financial|legal|environmental|social|political|technical|schedule|audit|corruption|other",
      "severity": "low|medium|high|critical", "title": str, "description": str|null,
      "status": "open|mitigated|closed|escalated",
      "reported_at": "YYYY-MM-DD"|null, "resolved_at": "YYYY-MM-DD"|null, "source_url": str }
  ],
  "impact": [
    { "metric_type": "beneficiaries|jobs_temporary|jobs_permanent|displacement|area_served_sq_km|households_served|co2_reduction_t|revenue_generated_npr|energy_capacity_mw|water_capacity_mld|other",
      "metric_value": num|null, "unit": str|null,
      "baseline_value": num|null, "target_value": num|null,
      "measured_at": "YYYY-MM-DD"|null, "methodology": str|null, "notes": str|null, "source_url": str }
  ],
  "procurement": [
    { "tender_id_external": str|null, "tender_title": str, "tender_url": str|null,
      "tender_published_at": "YYYY-MM-DD"|null, "bid_open_at": "YYYY-MM-DD"|null,
      "contract_awarded_at": "YYYY-MM-DD"|null, "awardee_name": str|null, "awardee_id": str|null,
      "contract_value_npr": num|null, "contract_type": "epc|design_build|itb|icb|ncb|limited|direct|framework|ppp|other"|null,
      "procurement_method": str|null,
      "status": "planned|published|bidding|evaluation|awarded|cancelled|disputed",
      "notes": str|null, "source_url": str }
  ],
  "compliance": [
    { "item_type": "eia|iee|land_acquisition|right_of_way|forest_clearance|social_impact|audit_oag|audit_ciaa|blacklist|court_case|other",
      "status": "not_started|in_progress|approved|rejected|conditional|blacklisted|dismissed|pending",
      "authority": str|null, "decided_at": "YYYY-MM-DD"|null, "document_url": str|null,
      "finding": str|null, "notes": str|null, "source_url": str }
  ]
}

Rules:
- Use ISO date "YYYY-MM-DD" or null. NPR amounts in NPR (no commas, raw number).
- Treat the project title as an opaque label — do NOT pull in outside knowledge about real-world projects with similar names.
- Prefer items with clear evidence. Quality over quantity. Cap each array at 6 items.
- Output ONLY the JSON object. No prose, no markdown fences.`;

// ----- Validation helpers -----
const ENUM = {
  fund_source_type: ["government","multilateral","bilateral","private","loan","grant","equity","ppp","other"],
  doc_type: ["eia","iee","contract","tender","audit","progress_report","completion_report","blueprint","financial","press_release","legal","other"],
  stake_role: ["implementing_agency","executing_ministry","contractor","sub_contractor","consultant","donor","beneficiary","regulator","community","other"],
  risk_cat: ["financial","legal","environmental","social","political","technical","schedule","audit","corruption","other"],
  risk_sev: ["low","medium","high","critical"],
  risk_status: ["open","mitigated","closed","escalated"],
  metric_type: ["beneficiaries","jobs_temporary","jobs_permanent","displacement","area_served_sq_km","households_served","co2_reduction_t","revenue_generated_npr","energy_capacity_mw","water_capacity_mld","other"],
  proc_status: ["planned","published","bidding","evaluation","awarded","cancelled","disputed"],
  proc_contract_type: ["epc","design_build","itb","icb","ncb","limited","direct","framework","ppp","other"],
  comp_item: ["eia","iee","land_acquisition","right_of_way","forest_clearance","social_impact","audit_oag","audit_ciaa","blacklist","court_case","other"],
  comp_status: ["not_started","in_progress","approved","rejected","conditional","blacklisted","dismissed","pending"],
};
const inEnum = (v: any, e: string[]) => typeof v === "string" && e.includes(v);
const validDate = (v: any) => v == null || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
const numOrNull = (v: any) => (typeof v === "number" && Number.isFinite(v)) ? v : null;
const strOrNull = (v: any) => (typeof v === "string" && v.trim().length > 0) ? v.trim() : null;

// ----- Insert helpers -----
async function insertAll(admin: any, projectId: number, parsed: any) {
  const stats: Record<string, number> = {};
  const errs: string[] = [];

  const safeInsert = async (table: string, rows: any[]) => {
    if (rows.length === 0) { stats[table] = 0; return; }
    const { error } = await admin.from(table).insert(rows);
    if (error) { errs.push(`${table}: ${error.message}`); stats[table] = 0; }
    else stats[table] = rows.length;
  };

  // funding
  await safeInsert("project_funding", (parsed.funding ?? []).filter((f: any) =>
    f && strOrNull(f.source_name) && inEnum(f.source_type, ENUM.fund_source_type) && strOrNull(f.source_url) && validDate(f.committed_at)
  ).slice(0, 6).map((f: any) => ({
    project_id: projectId, source_name: f.source_name, source_type: f.source_type,
    amount_npr: numOrNull(f.amount_npr), amount_usd: numOrNull(f.amount_usd),
    currency: strOrNull(f.currency) ?? "NPR", committed_at: f.committed_at ?? null,
    disbursed_amount: numOrNull(f.disbursed_amount), lender_terms: strOrNull(f.lender_terms),
    notes: strOrNull(f.notes), source_url: f.source_url,
    submitted_by_ai: true, approval_status: "pending",
  })));

  await safeInsert("project_documents", (parsed.documents ?? []).filter((d: any) =>
    d && strOrNull(d.title) && inEnum(d.doc_type, ENUM.doc_type) && strOrNull(d.url) && strOrNull(d.source_url) && validDate(d.published_at)
  ).slice(0, 6).map((d: any) => ({
    project_id: projectId, title: d.title, doc_type: d.doc_type, url: d.url,
    source_org: strOrNull(d.source_org), language: strOrNull(d.language) ?? "en",
    published_at: d.published_at ?? null, notes: strOrNull(d.notes),
    submitted_by_ai: true, approval_status: "pending",
  })));

  await safeInsert("project_stakeholders", (parsed.stakeholders ?? []).filter((s: any) =>
    s && inEnum(s.role, ENUM.stake_role) && strOrNull(s.org_name) && strOrNull(s.source_url)
  ).slice(0, 6).map((s: any) => ({
    project_id: projectId, role: s.role, org_name: s.org_name,
    contact_name: strOrNull(s.contact_name), contact_email: strOrNull(s.contact_email),
    contact_phone: strOrNull(s.contact_phone), website: strOrNull(s.website),
    country: strOrNull(s.country), notes: strOrNull(s.notes), source_url: s.source_url,
    submitted_by_ai: true, approval_status: "pending",
  })));

  await safeInsert("project_risks", (parsed.risks ?? []).filter((r: any) =>
    r && inEnum(r.category, ENUM.risk_cat) && inEnum(r.severity, ENUM.risk_sev)
      && inEnum(r.status, ENUM.risk_status) && strOrNull(r.title) && strOrNull(r.source_url)
      && validDate(r.reported_at) && validDate(r.resolved_at)
  ).slice(0, 6).map((r: any) => ({
    project_id: projectId, category: r.category, severity: r.severity,
    title: r.title, description: strOrNull(r.description), status: r.status,
    reported_at: r.reported_at ?? null, resolved_at: r.resolved_at ?? null,
    source_url: r.source_url, submitted_by_ai: true, approval_status: "pending",
  })));

  await safeInsert("project_impact", (parsed.impact ?? []).filter((i: any) =>
    i && inEnum(i.metric_type, ENUM.metric_type) && strOrNull(i.source_url) && validDate(i.measured_at)
  ).slice(0, 6).map((i: any) => ({
    project_id: projectId, metric_type: i.metric_type,
    metric_value: numOrNull(i.metric_value), unit: strOrNull(i.unit),
    baseline_value: numOrNull(i.baseline_value), target_value: numOrNull(i.target_value),
    measured_at: i.measured_at ?? null, methodology: strOrNull(i.methodology),
    notes: strOrNull(i.notes), source_url: i.source_url,
    submitted_by_ai: true, approval_status: "pending",
  })));

  await safeInsert("project_procurement", (parsed.procurement ?? []).filter((p: any) =>
    p && strOrNull(p.tender_title) && inEnum(p.status, ENUM.proc_status) && strOrNull(p.source_url)
      && (p.contract_type == null || inEnum(p.contract_type, ENUM.proc_contract_type))
      && validDate(p.tender_published_at) && validDate(p.bid_open_at) && validDate(p.contract_awarded_at)
  ).slice(0, 6).map((p: any) => ({
    project_id: projectId, tender_id_external: strOrNull(p.tender_id_external),
    tender_title: p.tender_title, tender_url: strOrNull(p.tender_url),
    tender_published_at: p.tender_published_at ?? null, bid_open_at: p.bid_open_at ?? null,
    contract_awarded_at: p.contract_awarded_at ?? null,
    awardee_name: strOrNull(p.awardee_name), awardee_id: strOrNull(p.awardee_id),
    contract_value_npr: numOrNull(p.contract_value_npr), contract_type: p.contract_type ?? null,
    procurement_method: strOrNull(p.procurement_method), status: p.status,
    notes: strOrNull(p.notes), source_url: p.source_url,
    submitted_by_ai: true, approval_status: "pending",
  })));

  await safeInsert("project_compliance", (parsed.compliance ?? []).filter((c: any) =>
    c && inEnum(c.item_type, ENUM.comp_item) && inEnum(c.status, ENUM.comp_status)
      && strOrNull(c.source_url) && validDate(c.decided_at)
  ).slice(0, 6).map((c: any) => ({
    project_id: projectId, item_type: c.item_type, status: c.status,
    authority: strOrNull(c.authority), decided_at: c.decided_at ?? null,
    document_url: strOrNull(c.document_url), finding: strOrNull(c.finding),
    notes: strOrNull(c.notes), source_url: c.source_url,
    submitted_by_ai: true, approval_status: "pending",
  })));

  return { stats, errs };
}

// ----- HTTP entry -----
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

    // Auth gate: reviewer / coadmin / admin only.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const { data: roles } = await userClient
      .from("user_roles").select("role").eq("user_id", userData.user.id);
    const isReviewer = (roles ?? []).some((r: any) =>
      r.role === "reviewer" || r.role === "coadmin" || r.role === "admin"
    );
    if (!isReviewer) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const projectId = Number(body.projectId);
    if (!Number.isFinite(projectId) || projectId <= 0) return json({ error: "projectId required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: project, error: pErr } = await admin
      .from("projects")
      .select("id, title, sector, province, district, description, implementing_agency, contractor, budget_npr")
      .eq("id", projectId).single();
    if (pErr || !project) return json({ error: "Project not found" }, 404);

    // 1. Multi-bucket source gather
    const { hits, warnings } = await gatherSources(tavilyKeys, project, 3);
    if (hits.length === 0) {
      return json({ ok: false, error: "No sources found across any bucket", warnings }, 200);
    }

    // 2. Extract structured data
    const ctx =
      `## Project Context\n` +
      `Title: ${project.title}\nSector: ${project.sector ?? "—"}\n` +
      `Location: ${project.district ?? "—"}, ${project.province ?? "—"}\n` +
      `Implementing agency: ${project.implementing_agency ?? "—"}\n` +
      `Contractor: ${project.contractor ?? "—"}\n` +
      `Budget (NPR): ${project.budget_npr ?? "—"}\n` +
      `Description: ${(project.description ?? "").slice(0, 600)}\n\n` +
      `## Search corpus\n` +
      hits.map((h, i) => `### [${i + 1}] (${h.bucket}) ${h.title}\nURL: ${h.url}\n${h.content}`).join("\n\n");

    const ai = await callChat([
      { role: "system", content: EXTRACTION_SYSTEM },
      { role: "user", content: ctx },
    ]);
    if (!ai.ok) return json({ error: ai.error, warnings }, ai.status);

    let parsed: any;
    try { parsed = JSON.parse(stripFences(ai.text)); }
    catch (e) { return json({ error: "AI returned non-JSON", raw: ai.text.slice(0, 500), warnings }, 502); }

    // 3. Insert
    const { stats, errs } = await insertAll(admin, projectId, parsed);

    // 4. Stamp last_comprehensive_analysis_at
    await admin.from("projects").update({ last_comprehensive_analysis_at: new Date().toISOString() }).eq("id", projectId);

    return json({
      ok: true,
      project_id: projectId,
      hits: hits.length,
      buckets: hits.reduce((acc: any, h) => (acc[h.bucket] = (acc[h.bucket] ?? 0) + 1, acc), {}),
      inserted: stats,
      errors: errs,
      warnings,
    });
  } catch (e) {
    console.error("ai-comprehensive-analysis:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
