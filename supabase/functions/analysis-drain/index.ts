// Phase 1 of the Project Data Hub revamp. The heavy lifter that pg_cron's
// analysis_drain_once() fires via pg_net once a queued analysis_jobs row exists.
//
// What this does, in order:
//   1. Service-role gate (only the cron drainer should call this).
//   2. Loads project basics + initialises bucket_status with all bucket names
//      in `queued` state — gives the UI something to show immediately.
//   3. Runs 5 Tavily buckets in PARALLEL via Promise.allSettled (vs the old
//      sequential pattern that wasted 20-40s of wall time). After each bucket
//      finishes, writes `bucket_status[name] = {state, hits, started_at, finished_at, error}`
//      back to project_analysis_runs so Realtime subscribers see live progress.
//   4. Builds a single context blob from all hits, calls the chat model with
//      the EXTRACTION_SYSTEM prompt. The prompt now also asks for
//      narrative_summary (synthesis) + gaps_and_contradictions (explicit
//      missing/conflict bullets) + confidence_score per row. Authority and
//      recency rules tilt the AI toward .gov.np + recent facts.
//   5. dedupeCandidate(): for each candidate detail row, looks up existing
//      approved+pending rows with table-specific match keys. Match → skip
//      and bump deduped_per_table[table]. No match → insert with
//      submitted_by_ai=true, approval_status='pending', confidence_score.
//   6. Optionally NULL-fills basic project columns from `basic_updates`
//      (same guard as the old function — never overwrite manual edits).
//   7. Final writeback: project_analysis_runs gets status='succeeded',
//      narrative_summary, gaps_and_contradictions, counts. analysis_jobs gets
//      status='succeeded', finished_at. Any thrown error writes failed instead.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const stripFences = (s: string) =>
  s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

// ─── Tavily ──────────────────────────────────────────────────────────────────
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

// ─── Chat (Mistral > Google > Lovable) ───────────────────────────────────────
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
    apiKey = lovable; model = "google/gemini-2.0-flash";
  } else {
    return { ok: false, status: 500, error: "No AI key configured" };
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

// ─── Bucket definitions — read from public.analysis_buckets ──────────────────
// Phase 2 promoted the hardcoded list into a DB table. The drainer now reads
// enabled rows, substitutes {title}/{sector}/{province}/{district} into the
// query_template, and filters by sector_filter when set.
type Hit = { title: string; url: string; content: string; bucket: string; published_date: string | null };
type BucketDef = { name: string; payload: Record<string, unknown> };
type BucketRow = {
  name: string;
  query_template: string;
  include_domains: string[];
  max_results: number;
  search_depth: string;
  topic: string | null;
  days: number | null;
  sector_filter: string[];
  enabled: boolean;
  sort_order: number;
};

function substituteTemplate(tpl: string, project: any): string {
  const subs: Record<string, string> = {
    title: (project.title ?? "").replace(/"/g, ""),
    sector: project.sector ?? "",
    province: project.province ?? "",
    district: project.district ?? "",
  };
  // Replace tokens, then collapse the resulting double-spaces from empty subs.
  return tpl.replace(/\{(title|sector|province|district)\}/g, (_m, k) => subs[k]).replace(/\s+/g, " ").trim();
}

async function loadBuckets(admin: any, project: any): Promise<BucketDef[]> {
  const { data, error } = await admin
    .from("analysis_buckets")
    .select("name, query_template, include_domains, max_results, search_depth, topic, days, sector_filter, enabled, sort_order")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Could not load analysis_buckets: ${error.message}`);
  const rows = ((data ?? []) as BucketRow[]).filter(b => {
    // Empty sector_filter = applies to all projects; otherwise the project's sector must match.
    if (!b.sector_filter || b.sector_filter.length === 0) return true;
    return project.sector && b.sector_filter.includes(project.sector);
  });
  return rows.map(b => {
    const payload: Record<string, unknown> = {
      query: substituteTemplate(b.query_template, project),
      search_depth: b.search_depth,
      max_results: b.max_results,
      include_answer: false,
    };
    if (b.topic) payload.topic = b.topic;
    if (b.days) payload.days = b.days;
    if (b.include_domains && b.include_domains.length > 0) payload.include_domains = b.include_domains;
    return { name: b.name, payload };
  });
}

// Patch a single bucket's entry inside project_analysis_runs.bucket_status.
// Goes through public.analysis_patch_bucket_status() (SQL function that does
// the merge in one atomic statement) so 10 parallel bucket workers don't
// clobber each other's updates the way a JS-side read-modify-write would.
async function patchBucketStatus(admin: any, runId: string, name: string, patch: Record<string, unknown>) {
  await admin.rpc("analysis_patch_bucket_status", { p_run_id: runId, p_bucket: name, p_patch: patch });
}

// Run one bucket: write running → run Tavily → write succeeded/failed with hits.
async function runBucket(admin: any, runId: string, keys: string[], b: BucketDef): Promise<Hit[]> {
  await patchBucketStatus(admin, runId, b.name, { state: "running", started_at: new Date().toISOString() });
  const r = await tavily(keys, b.payload);
  if ("exhausted" in r) {
    await patchBucketStatus(admin, runId, b.name, { state: "failed", finished_at: new Date().toISOString(), error: "Tavily keys exhausted" });
    return [];
  }
  if (!r.res.ok) {
    await patchBucketStatus(admin, runId, b.name, { state: "failed", finished_at: new Date().toISOString(), error: `HTTP ${r.res.status}` });
    return [];
  }
  const j = await r.res.json();
  const hits: Hit[] = [];
  for (const item of (j.results ?? []) as any[]) {
    if (!item?.url || !item?.content) continue;
    // Tavily returns `published_date` mostly on news/article hits. Format varies
    // (ISO, RFC2822, "Aug 15, 2024", etc.) so we run it through Date.parse() and
    // normalise to YYYY-MM-DD. Falls back to null when missing/unparseable.
    let published_date: string | null = null;
    if (typeof item.published_date === "string" && item.published_date.trim()) {
      const parsed = new Date(item.published_date);
      if (!isNaN(parsed.getTime())) {
        published_date = parsed.toISOString().slice(0, 10);
      }
    }
    hits.push({ title: item.title ?? "", url: item.url, content: String(item.content).slice(0, 1500), bucket: b.name, published_date });
  }
  await patchBucketStatus(admin, runId, b.name, { state: "succeeded", finished_at: new Date().toISOString(), hits: hits.length });
  return hits;
}

// ─── Extraction prompt — hub-grade output ────────────────────────────────────
const EXTRACTION_SYSTEM = `You are an information-extraction system for Nepal infrastructure projects. You will be given:
- a project context block (title, sector, location, current data),
- a corpus of search-result excerpts grouped by source bucket (news, government, procurement, audit_compliance, international_org).

Return ONLY a JSON object matching the schema below. Every fact must be grounded in a corpus excerpt — DO NOT invent. Every item must include a non-empty "sources" array of corpus URLs that support it.

## Authority hierarchy for sources
Rank sources in "sources" with the highest-authority URL first:
1. Nepali government (.gov.np) — strongest for regulatory/procurement/audit facts.
2. International development orgs (worldbank.org, adb.org, undp.org, ifc.org, jica.go.jp, kfw.de) — strongest for funding.
3. Local news outlets — supplementary; weak alone for financial/legal facts.
4. Anything else — weakest; only use if no other source covers the fact.

## Recency rule
When facts conflict, prefer the most recent. A 2026 audit overrides a 2022 news article. If a tender was awarded then later cancelled, emit BOTH as separate procurement rows (status=awarded with the awarded date, status=cancelled with the cancellation date) — do NOT collapse into one.

## Confidence rubric — REQUIRED per item
"confidence_score" (number 0.00-1.00):
- 1.00 → multiple high-authority sources agree AND the fact is recent (last 24 months).
- 0.80 → one high-authority source OR multiple medium-authority sources agree.
- 0.60 → one medium-authority source, no contradiction.
- 0.40 → only a low-authority source, or some ambiguity.
- 0.25 → implied / inferred from context (rare; prefer skipping).
- Never emit below 0.10. If you can't justify >= 0.40, skip the item.

## Synthesis fields (top-level, both REQUIRED)
- "narrative_summary": 200-400 words, plain prose, 2-3 paragraphs. Lead with the project's current status (latest known facts), then key context (scale, location, stakeholders), then open questions or controversies. Neutral tone. No markdown. No bullets. Treat the project title as an opaque label — do NOT pull in outside knowledge about real-world projects with similar names.
- "gaps_and_contradictions": array of short strings (max 10). Flag EXPLICITLY: missing categories ("no procurement record despite project status=in_progress"), direct conflicts between sources ("MoF reports NPR 8B disbursed; OAG audit reports NPR 6B as of same date"), or stale information ("most recent news is 18 months old"). Empty array if genuinely none.

## Schema
{
  "narrative_summary": str,
  "gaps_and_contradictions": [str, ...],
  "funding": [
    { "source_name": str, "source_type": "government|multilateral|bilateral|private|loan|grant|equity|ppp|other",
      "amount_npr": num|null, "amount_usd": num|null, "currency": str|null,
      "committed_at": "YYYY-MM-DD"|null, "disbursed_amount": num|null,
      "lender_terms": str|null, "notes": str|null,
      "sources": [str, ...], "confidence_score": num }
  ],
  "documents": [
    { "title": str, "doc_type": "eia|iee|contract|tender|audit|progress_report|completion_report|blueprint|financial|press_release|legal|other",
      "url": str, "source_org": str|null, "language": "en|ne"|null,
      "published_at": "YYYY-MM-DD"|null, "notes": str|null,
      "sources": [str, ...], "confidence_score": num }
  ],
  "stakeholders": [
    { "role": "implementing_agency|executing_ministry|contractor|sub_contractor|consultant|donor|beneficiary|regulator|community|other",
      "org_name": str, "contact_name": str|null, "contact_email": str|null, "contact_phone": str|null,
      "website": str|null, "country": str|null, "notes": str|null,
      "sources": [str, ...], "confidence_score": num }
  ],
  "risks": [
    { "category": "financial|legal|environmental|social|political|technical|schedule|audit|corruption|other",
      "severity": "low|medium|high|critical", "title": str, "description": str|null,
      "status": "open|mitigated|closed|escalated",
      "reported_at": "YYYY-MM-DD"|null, "resolved_at": "YYYY-MM-DD"|null,
      "sources": [str, ...], "confidence_score": num }
  ],
  "impact": [
    { "metric_type": "beneficiaries|jobs_temporary|jobs_permanent|displacement|area_served_sq_km|households_served|co2_reduction_t|revenue_generated_npr|energy_capacity_mw|water_capacity_mld|other",
      "metric_value": num|null, "unit": str|null, "baseline_value": num|null, "target_value": num|null,
      "measured_at": "YYYY-MM-DD"|null, "methodology": str|null, "notes": str|null,
      "sources": [str, ...], "confidence_score": num }
  ],
  "procurement": [
    { "tender_id_external": str|null, "tender_title": str, "tender_url": str|null,
      "tender_published_at": "YYYY-MM-DD"|null, "bid_open_at": "YYYY-MM-DD"|null,
      "contract_awarded_at": "YYYY-MM-DD"|null, "awardee_name": str|null,
      "contract_value_npr": num|null, "contract_type": "epc|design_build|itb|icb|ncb|limited|direct|framework|ppp|other"|null,
      "procurement_method": str|null,
      "status": "planned|published|bidding|evaluation|awarded|cancelled|disputed",
      "notes": str|null,
      "sources": [str, ...], "confidence_score": num }
  ],
  "compliance": [
    { "item_type": "eia|iee|land_acquisition|right_of_way|forest_clearance|social_impact|audit_oag|audit_ciaa|blacklist|court_case|other",
      "status": "not_started|in_progress|approved|rejected|conditional|blacklisted|dismissed|pending",
      "authority": str|null, "decided_at": "YYYY-MM-DD"|null, "document_url": str|null,
      "finding": str|null, "notes": str|null,
      "sources": [str, ...], "confidence_score": num }
  ],
  "basic_updates": {
    "procurement_method": str|null,
    "esia_status": "not_started|in_progress|iee_approved|eia_approved|rejected|exempt"|null,
    "funding_committed_npr": num|null,
    "estimated_beneficiaries": num|null,
    "project_type": str|null
  }
}

Rules:
- Use ISO date "YYYY-MM-DD" or null. NPR amounts as raw number (no commas).
- Treat 1 lakh = 100,000 and 1 crore = 10,000,000.
- Prefer items with clear evidence. Cap each array at 6 items. Quality over quantity.
- Output ONLY the JSON object. No prose, no markdown fences.`;

// ─── Validation ──────────────────────────────────────────────────────────────
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
const clampConfidence = (v: any) => {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
};
const normSources = (item: any): { primary: string | null; all: string[] } => {
  const raw: any[] = Array.isArray(item?.sources) ? item.sources : (item?.source_url ? [item.source_url] : []);
  const seen = new Set<string>();
  const all: string[] = [];
  for (const u of raw) {
    if (typeof u !== "string") continue;
    const t = u.trim();
    if (!t || seen.has(t)) continue;
    try { new URL(t); } catch { continue; }
    seen.add(t); all.push(t);
    if (all.length >= 6) break;
  }
  return { primary: all[0] ?? null, all };
};

// Normalise a URL for dedupe — lowercase host, strip query + fragment + trailing slash.
const normUrl = (u: any): string | null => {
  if (typeof u !== "string") return null;
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, "")}`;
  } catch { return null; }
};

// Nepal-infra-specific acronym expansion. Common shapes the AI uses
// interchangeably across runs ("ADB" vs "Asian Development Bank") would
// otherwise slip past dedupe. We expand acronyms to their full form, then
// normalise (lowercase, strip diacritics + punctuation, collapse whitespace).
// Comparing normalised strings catches the rephrasings the strict-match
// dedupe missed in Phase 1's smoke test.
const ACRONYM_EXPANSIONS: Array<[RegExp, string]> = [
  // International orgs / donors
  [/\bADB\b/gi, "Asian Development Bank"],
  [/\bWB\b/gi, "World Bank"],
  [/\bJICA\b/gi, "Japan International Cooperation Agency"],
  [/\bKfW\b/gi, "Kreditanstalt fur Wiederaufbau"],
  [/\bIFC\b/gi, "International Finance Corporation"],
  [/\bUNDP\b/gi, "United Nations Development Programme"],
  [/\bUSAID\b/gi, "United States Agency for International Development"],
  // Nepal ministries / departments / agencies
  [/\bMoF\b/gi, "Ministry of Finance"],
  [/\bMoEnv\b/gi, "Ministry of Environment"],
  [/\bMoFE\b/gi, "Ministry of Forests and Environment"],
  [/\bMoEWRI\b/gi, "Ministry of Energy Water Resources and Irrigation"],
  [/\bMoPIT\b/gi, "Ministry of Physical Infrastructure and Transport"],
  [/\bMoALD\b/gi, "Ministry of Agriculture and Livestock Development"],
  [/\bMoUD\b/gi, "Ministry of Urban Development"],
  [/\bMoHP\b/gi, "Ministry of Health and Population"],
  [/\bMoCIT\b/gi, "Ministry of Communications and Information Technology"],
  [/\bOAG\b/gi, "Office of the Auditor General"],
  [/\bCIAA\b/gi, "Commission for the Investigation of Abuse of Authority"],
  [/\bDoED\b/gi, "Department of Electricity Development"],
  [/\bDoR\b/gi, "Department of Roads"],
  [/\bDWSS\b/gi, "Department of Water Supply and Sewerage"],
  [/\bPPMO\b/gi, "Public Procurement Monitoring Office"],
  [/\bNEA\b/gi, "Nepal Electricity Authority"],
  [/\bNTC\b/gi, "Nepal Telecom"],
  [/\bMWSDB\b/gi, "Melamchi Water Supply Development Board"],
];

const normText = (raw: any): string => {
  if (typeof raw !== "string") return "";
  let s = raw;
  for (const [re, full] of ACRONYM_EXPANSIONS) s = s.replace(re, full);
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")            // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")               // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
};

// Fuzzy match: are two strings the same after normalisation, or does one
// fully contain the other (with word boundaries)? Cheap, no embeddings.
const fuzzyEqual = (a: string, b: string): boolean => {
  const an = normText(a);
  const bn = normText(b);
  if (!an || !bn) return false;
  if (an === bn) return true;
  // Containment with word boundaries — catches "ADB Manila branch" vs "ADB".
  // Require the shorter to be at least 60% of the longer to avoid spurious
  // matches like "Nepal" matching every project.
  const [short, long] = an.length <= bn.length ? [an, bn] : [bn, an];
  if (short.length / long.length < 0.6) return false;
  return long.includes(short);
};

// ─── Dedupe rules per detail table ───────────────────────────────────────────
// Match against approved+pending rows (NOT rejected — operator decided those
// shouldn't exist; re-suggesting them is fine and gives them another shot).
async function dedupeCandidate(admin: any, table: string, projectId: number, row: any): Promise<"insert" | "skip"> {
  const baseFilter = (q: any) => q.eq("project_id", projectId).in("approval_status", ["approved", "pending"]);
  try {
    if (table === "project_documents") {
      const url = normUrl(row.url);
      if (!url) return "insert";
      const { data } = await baseFilter(admin.from(table).select("id, url")).limit(50);
      for (const r of (data ?? [])) if (normUrl(r.url) === url) return "skip";
      return "insert";
    }
    if (table === "project_funding") {
      // Fetch all funding rows of the same source_type, then fuzzy-match
      // source_name (acronym-aware) and amount within ±5%. The old ILIKE
      // approach missed "ADB" ↔ "Asian Development Bank" rephrasings.
      const name = (row.source_name ?? "").toString();
      const stype = row.source_type;
      const amt = numOrNull(row.amount_npr);
      if (!name) return "insert";
      const { data } = await baseFilter(admin.from(table).select("id, source_name, source_type, amount_npr")).eq("source_type", stype).limit(50);
      for (const r of (data ?? [])) {
        if (!fuzzyEqual(name, r.source_name)) continue;
        const rAmt = numOrNull(r.amount_npr);
        const amtMatch = (amt == null && rAmt == null) || (amt != null && rAmt != null && Math.abs(rAmt - amt) <= 0.05 * Math.max(rAmt, amt, 1));
        if (amtMatch) return "skip";
      }
      return "insert";
    }
    if (table === "project_stakeholders") {
      const org = (row.org_name ?? "").toString();
      if (!org) return "insert";
      // Fetch by role then fuzzy-match org_name (acronym expansion catches
      // "NEA" ↔ "Nepal Electricity Authority").
      const { data } = await baseFilter(admin.from(table).select("id, org_name, role")).eq("role", row.role).limit(30);
      for (const r of (data ?? [])) if (fuzzyEqual(org, r.org_name)) return "skip";
      return "insert";
    }
    if (table === "project_risks") {
      const title = (row.title ?? "").toString();
      if (!title) return "insert";
      // Risk titles vary wildly across runs — pull a recent pool and fuzzy-match.
      const { data } = await baseFilter(admin.from(table).select("id, title")).limit(50);
      for (const r of (data ?? [])) if (fuzzyEqual(title, r.title)) return "skip";
      return "insert";
    }
    if (table === "project_impact") {
      const mt = row.metric_type;
      const md = row.measured_at;
      if (!mt) return "insert";
      let q = baseFilter(admin.from(table).select("id, metric_type, measured_at")).eq("metric_type", mt);
      q = md ? q.eq("measured_at", md) : q.is("measured_at", null);
      const { data } = await q.limit(10);
      if ((data ?? []).length > 0) return "skip";
      return "insert";
    }
    if (table === "project_procurement") {
      // Prefer external id if present; else (tender_title + awardee_name).
      if (row.tender_id_external) {
        const { data } = await baseFilter(admin.from(table).select("id, tender_id_external")).eq("tender_id_external", row.tender_id_external).limit(5);
        if ((data ?? []).length > 0) return "skip";
        return "insert";
      }
      const title = (row.tender_title ?? "").toString().trim().toLowerCase();
      const awardee = (row.awardee_name ?? "").toString().trim().toLowerCase();
      if (!title) return "insert";
      let q = baseFilter(admin.from(table).select("id, tender_title, awardee_name")).ilike("tender_title", title);
      if (awardee) q = q.ilike("awardee_name", awardee);
      const { data } = await q.limit(10);
      if ((data ?? []).length > 0) return "skip";
      return "insert";
    }
    if (table === "project_compliance") {
      const it = row.item_type;
      const auth = (row.authority ?? "").toString();
      if (!it) return "insert";
      // Fetch by item_type, then fuzzy-match authority (acronym expansion
      // catches "OAG" ↔ "Office of the Auditor General"). If authority is
      // null/empty on the candidate, treat item_type alone as the dedupe key.
      const { data } = await baseFilter(admin.from(table).select("id, item_type, authority")).eq("item_type", it).limit(30);
      for (const r of (data ?? [])) {
        if (!auth && !r.authority) return "skip";
        if (auth && r.authority && fuzzyEqual(auth, r.authority)) return "skip";
      }
      return "insert";
    }
  } catch {
    // Dedupe is best-effort — if the lookup fails, default to insert. The
    // moderator can still merge duplicates manually via the row controls.
    return "insert";
  }
  return "insert";
}

// ─── Insert helpers ──────────────────────────────────────────────────────────
type InsertStats = { inserted: Record<string, number>; deduped: Record<string, number>; errors: string[] };

async function insertAll(admin: any, projectId: number, parsed: any, hitDateMap: Map<string, string | null>): Promise<InsertStats> {
  const inserted: Record<string, number> = {};
  const deduped: Record<string, number> = {};
  const errs: string[] = [];

  const tryInsert = async (table: string, rows: any[]) => {
    inserted[table] = 0; deduped[table] = 0;
    for (const r of rows) {
      const verdict = await dedupeCandidate(admin, table, projectId, r);
      if (verdict === "skip") { deduped[table] += 1; continue; }
      const { error } = await admin.from(table).insert(r);
      if (error) { errs.push(`${table}: ${error.message}`); continue; }
      inserted[table] += 1;
    }
  };

  const common = (item: any) => {
    const { primary, all } = normSources(item);
    // Enrich each source URL with the publication date Tavily returned for that
    // hit. Missing entries (AI hallucinated a URL not in the corpus, or Tavily
    // didn't supply a date) end up with published_at=null. UI shows the date
    // when present; older string-array rows still render fine because
    // SourceLink tolerates both shapes.
    const sources = all.map(u => ({ url: u, published_at: hitDateMap.get(u) ?? null }));
    return {
      project_id: projectId,
      source_url: primary,
      sources,
      submitted_by_ai: true,
      approval_status: "pending",
      submitted_by: null,
      confidence_score: clampConfidence(item.confidence_score),
    };
  };

  // project_funding
  {
    const rows = (Array.isArray(parsed.funding) ? parsed.funding : []).slice(0, 6).map((f: any) => ({
      ...common(f),
      source_name: strOrNull(f.source_name) ?? "(unknown source)",
      source_type: inEnum(f.source_type, ENUM.fund_source_type) ? f.source_type : "other",
      amount_npr: numOrNull(f.amount_npr),
      amount_usd: numOrNull(f.amount_usd),
      currency: strOrNull(f.currency),
      committed_at: validDate(f.committed_at) ? f.committed_at : null,
      disbursed_amount: numOrNull(f.disbursed_amount),
      lender_terms: strOrNull(f.lender_terms),
      notes: strOrNull(f.notes),
    })).filter((r: any) => r.sources.length > 0);
    await tryInsert("project_funding", rows);
  }

  // project_documents
  {
    const rows = (Array.isArray(parsed.documents) ? parsed.documents : []).slice(0, 6).map((d: any) => {
      const url = strOrNull(d.url);
      if (!url) return null;
      try { new URL(url); } catch { return null; }
      const row = {
        ...common(d),
        title: strOrNull(d.title) ?? "(untitled)",
        doc_type: inEnum(d.doc_type, ENUM.doc_type) ? d.doc_type : "other",
        url,
        source_org: strOrNull(d.source_org),
        language: d.language === "ne" || d.language === "en" ? d.language : null,
        published_at: validDate(d.published_at) ? d.published_at : null,
        notes: strOrNull(d.notes),
      } as any;
      // project_documents has its own `url` (the document itself) and `sources` array. No source_url.
      delete row.source_url;
      return row;
    }).filter(Boolean);
    await tryInsert("project_documents", rows as any[]);
  }

  // project_stakeholders
  {
    const rows = (Array.isArray(parsed.stakeholders) ? parsed.stakeholders : []).slice(0, 6).map((s: any) => ({
      ...common(s),
      org_name: strOrNull(s.org_name) ?? "(unknown org)",
      role: inEnum(s.role, ENUM.stake_role) ? s.role : "other",
      contact_name: strOrNull(s.contact_name),
      contact_email: strOrNull(s.contact_email),
      contact_phone: strOrNull(s.contact_phone),
      website: strOrNull(s.website),
      country: strOrNull(s.country),
      notes: strOrNull(s.notes),
    })).filter((r: any) => r.sources.length > 0);
    await tryInsert("project_stakeholders", rows);
  }

  // project_risks
  {
    const rows = (Array.isArray(parsed.risks) ? parsed.risks : []).slice(0, 6).map((r: any) => ({
      ...common(r),
      title: strOrNull(r.title) ?? "(untitled risk)",
      description: strOrNull(r.description),
      category: inEnum(r.category, ENUM.risk_cat) ? r.category : "other",
      severity: inEnum(r.severity, ENUM.risk_sev) ? r.severity : "low",
      status: inEnum(r.status, ENUM.risk_status) ? r.status : "open",
      reported_at: validDate(r.reported_at) ? r.reported_at : null,
      resolved_at: validDate(r.resolved_at) ? r.resolved_at : null,
    })).filter((r: any) => r.sources.length > 0);
    await tryInsert("project_risks", rows);
  }

  // project_impact
  {
    const rows = (Array.isArray(parsed.impact) ? parsed.impact : []).slice(0, 6).map((i: any) => ({
      ...common(i),
      metric_type: inEnum(i.metric_type, ENUM.metric_type) ? i.metric_type : "other",
      metric_value: numOrNull(i.metric_value),
      unit: strOrNull(i.unit),
      baseline_value: numOrNull(i.baseline_value),
      target_value: numOrNull(i.target_value),
      measured_at: validDate(i.measured_at) ? i.measured_at : null,
      methodology: strOrNull(i.methodology),
      notes: strOrNull(i.notes),
    })).filter((r: any) => r.sources.length > 0);
    await tryInsert("project_impact", rows);
  }

  // project_procurement
  {
    const rows = (Array.isArray(parsed.procurement) ? parsed.procurement : []).slice(0, 6).map((p: any) => ({
      ...common(p),
      tender_id_external: strOrNull(p.tender_id_external),
      tender_title: strOrNull(p.tender_title) ?? "(untitled tender)",
      tender_url: strOrNull(p.tender_url),
      tender_published_at: validDate(p.tender_published_at) ? p.tender_published_at : null,
      bid_open_at: validDate(p.bid_open_at) ? p.bid_open_at : null,
      contract_awarded_at: validDate(p.contract_awarded_at) ? p.contract_awarded_at : null,
      awardee_name: strOrNull(p.awardee_name),
      contract_value_npr: numOrNull(p.contract_value_npr),
      contract_type: inEnum(p.contract_type, ENUM.proc_contract_type) ? p.contract_type : null,
      procurement_method: strOrNull(p.procurement_method),
      status: inEnum(p.status, ENUM.proc_status) ? p.status : "published",
      notes: strOrNull(p.notes),
    })).filter((r: any) => r.sources.length > 0);
    await tryInsert("project_procurement", rows);
  }

  // project_compliance
  {
    const rows = (Array.isArray(parsed.compliance) ? parsed.compliance : []).slice(0, 6).map((c: any) => ({
      ...common(c),
      item_type: inEnum(c.item_type, ENUM.comp_item) ? c.item_type : "other",
      status: inEnum(c.status, ENUM.comp_status) ? c.status : "pending",
      authority: strOrNull(c.authority),
      decided_at: validDate(c.decided_at) ? c.decided_at : null,
      document_url: strOrNull(c.document_url),
      finding: strOrNull(c.finding),
      notes: strOrNull(c.notes),
    })).filter((r: any) => r.sources.length > 0);
    await tryInsert("project_compliance", rows);
  }

  return { inserted, deduped, errors: errs };
}

// ─── Main serve ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // ANALYSIS_DRAIN_KEY is the shared secret the cron drainer (via pg_net)
  // uses to authenticate. Custom env name because Supabase reserves the
  // SUPABASE_ prefix for its own auto-injection. Mirror it into the DB row
  // public.sherlock_secrets so the SQL drainer can read it.
  const ANALYSIS_DRAIN_KEY = Deno.env.get("ANALYSIS_DRAIN_KEY") ?? "";

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
  } catch { /* not a JWT; fall through */ }
  if (!isServiceRole && jwt === SUPABASE_SERVICE_ROLE_KEY) isServiceRole = true;
  if (!isServiceRole && ANALYSIS_DRAIN_KEY && jwt === ANALYSIS_DRAIN_KEY) isServiceRole = true;
  if (!isServiceRole) return json({ error: "Forbidden" }, 403);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let jobId: string | null = null;
  let runId: string | null = null;
  let projectId: number | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    jobId = strOrNull(body.jobId);
    runId = strOrNull(body.runId);
    projectId = Number.isFinite(Number(body.projectId)) ? Number(body.projectId) : null;
    if (!jobId || !runId || !projectId) return json({ error: "jobId, runId, projectId required" }, 400);

    const tavilyKeys = parseTavilyKeys();
    if (tavilyKeys.length === 0) throw new Error("No Tavily API keys configured");
    if (!Deno.env.get("MISTRAL_API_KEY") && !Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("GOOGLE_AI_API_KEY")) {
      throw new Error("No AI key configured");
    }

    const { data: project, error: pErr } = await admin
      .from("projects")
      .select("id, title, sector, province, district, description, implementing_agency, contractor, budget_npr")
      .eq("id", projectId).single();
    if (pErr || !project) throw new Error(`Project ${projectId} not found`);

    const buckets = await loadBuckets(admin, project);
    if (buckets.length === 0) throw new Error("No enabled buckets in analysis_buckets table");
    const initial: Record<string, any> = {};
    for (const b of buckets) initial[b.name] = { state: "queued" };
    await admin.from("project_analysis_runs").update({ bucket_status: initial }).eq("id", runId);

    // Parallel bucket fan-out via Promise.allSettled (vs old sequential loop).
    // Each bucket independently writes its own state to bucket_status.
    const settled = await Promise.allSettled(buckets.map(b => runBucket(admin, runId!, tavilyKeys, b)));
    const hits: Hit[] = [];
    for (const s of settled) if (s.status === "fulfilled") hits.push(...s.value);

    if (hits.length === 0) {
      await admin.from("project_analysis_runs").update({
        status: "succeeded", finished_at: new Date().toISOString(),
        narrative_summary: "No external sources were found for this project across any bucket. Re-running once new news/government filings exist may yield results.",
        gaps_and_contradictions: ["Zero hits across all 5 source buckets — project may be too new, too local, or the title may not match published references."],
      }).eq("id", runId);
      await admin.from("analysis_jobs").update({ status: "succeeded", finished_at: new Date().toISOString() }).eq("id", jobId);
      return json({ ok: true, hits: 0 });
    }

    // ── Single extraction over the merged corpus ──
    // Each hit's header now exposes its publication date — material for the
    // AI's recency rule (prefer the most recent fact when sources conflict).
    const ctx =
      `## Project Context\n` +
      `Title: ${project.title}\nSector: ${project.sector ?? "—"}\n` +
      `Location: ${project.district ?? "—"}, ${project.province ?? "—"}\n` +
      `Implementing agency: ${project.implementing_agency ?? "—"}\n` +
      `Contractor: ${project.contractor ?? "—"}\n` +
      `Budget (NPR): ${project.budget_npr ?? "—"}\n` +
      `Description: ${(project.description ?? "").slice(0, 600)}\n\n` +
      `## Search corpus (${hits.length} hits across ${new Set(hits.map(h => h.bucket)).size} buckets)\n` +
      hits.map((h, i) => {
        const datePart = h.published_date ? ` · published ${h.published_date}` : "";
        return `### [${i + 1}] (${h.bucket}${datePart}) ${h.title}\nURL: ${h.url}\n${h.content}`;
      }).join("\n\n");

    const ai = await callChat([
      { role: "system", content: EXTRACTION_SYSTEM },
      { role: "user", content: ctx },
    ]);
    if (!ai.ok) throw new Error(`AI ${ai.status}: ${ai.error}`);

    let parsed: any;
    try { parsed = JSON.parse(stripFences(ai.text)); }
    catch { throw new Error(`AI returned non-JSON: ${ai.text.slice(0, 300)}`); }

    const narrative_summary = strOrNull(parsed.narrative_summary);
    const gaps_and_contradictions = Array.isArray(parsed.gaps_and_contradictions)
      ? parsed.gaps_and_contradictions.map((s: any) => strOrNull(s)).filter((s: string | null): s is string => !!s).slice(0, 10)
      : [];

    // Map URL → published_date from Tavily so insertAll can attach the
    // source publication date to each row's sources jsonb. The AI emits URL
    // strings only; we re-attach the date from the corpus we collected.
    const hitDateMap = new Map<string, string | null>();
    for (const h of hits) hitDateMap.set(h.url, h.published_date);

    const { inserted, deduped, errors: insertErrors } = await insertAll(admin, projectId, parsed, hitDateMap);

    // ── NULL-only enrichment of basic project columns (same posture as the old function) ──
    const ESIA_VALUES = ["not_started","in_progress","iee_approved","eia_approved","rejected","exempt"];
    const PROJECT_TYPES = ["Road","Bridge","Tunnel","Cable car","Airport","Railway","Hydropower","Solar","Wind","Transmission line","Substation","Drinking water","Sewerage","Treatment plant","Reservoir","Irrigation canal","Hospital","School","Stadium","Market","Office building","Telecom tower","Other"];
    const eRaw = parsed.basic_updates ?? {};
    const enrich: Record<string, any> = {};
    if (typeof eRaw.procurement_method === "string" && eRaw.procurement_method.trim()) enrich.procurement_method = eRaw.procurement_method.trim().slice(0, 60);
    if (typeof eRaw.esia_status === "string" && ESIA_VALUES.includes(eRaw.esia_status)) enrich.esia_status = eRaw.esia_status;
    if (typeof eRaw.funding_committed_npr === "number" && Number.isFinite(eRaw.funding_committed_npr) && eRaw.funding_committed_npr >= 0) enrich.funding_committed_npr = eRaw.funding_committed_npr;
    if (typeof eRaw.estimated_beneficiaries === "number" && Number.isFinite(eRaw.estimated_beneficiaries) && eRaw.estimated_beneficiaries >= 0) enrich.estimated_beneficiaries = Math.round(eRaw.estimated_beneficiaries);
    if (typeof eRaw.project_type === "string" && PROJECT_TYPES.includes(eRaw.project_type)) enrich.project_type = eRaw.project_type;
    if (Object.keys(enrich).length > 0) {
      const cols = Object.keys(enrich);
      const { data: cur } = await admin.from("projects").select(["id", ...cols].join(",")).eq("id", projectId).single();
      const patch: Record<string, any> = {};
      for (const k of cols) if (cur && (cur as any)[k] == null) patch[k] = enrich[k];
      if (Object.keys(patch).length > 0) await admin.from("projects").update(patch).eq("id", projectId);
    }

    await admin.from("projects").update({ last_comprehensive_analysis_at: new Date().toISOString() }).eq("id", projectId);

    // ── Final writeback ──
    await admin.from("project_analysis_runs").update({
      status: "succeeded",
      finished_at: new Date().toISOString(),
      narrative_summary,
      gaps_and_contradictions,
      inserted_per_table: inserted,
      deduped_per_table: deduped,
      errors: insertErrors,
    }).eq("id", runId);

    await admin.from("analysis_jobs").update({
      status: "succeeded",
      finished_at: new Date().toISOString(),
    }).eq("id", jobId);

    return json({ ok: true, hits: hits.length, inserted, deduped, errors: insertErrors });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("analysis-drain:", msg);
    // Best-effort: mark job + run as failed so the UI doesn't see "running" forever.
    if (jobId) {
      try {
        await admin.from("analysis_jobs").update({
          status: "failed", finished_at: new Date().toISOString(), last_error: msg.slice(0, 2000),
        }).eq("id", jobId);
      } catch { /* nothing we can do */ }
    }
    if (runId) {
      try {
        await admin.from("project_analysis_runs").update({
          status: "failed", finished_at: new Date().toISOString(),
          errors: [msg.slice(0, 500)],
        }).eq("id", runId);
      } catch { /* nothing we can do */ }
    }
    return json({ error: msg }, 500);
  }
});
