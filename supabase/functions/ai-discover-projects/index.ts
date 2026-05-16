// TODO: extract auth gate + Lovable call to _shared if a third caller appears.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { NATIONAL_PRIDE_PROJECTS, matchNationalPride } from "../_shared/national_pride.ts";
import { sendAlert } from "../_shared/notify.ts";
import { getKeys, markExhausted, markSucceeded } from "../_shared/api_keys.ts";
import { tryParseJsonObject } from "../_shared/json_repair.ts";
import { safeIsoDate } from "../_shared/dates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SECTORS = [
  "Transport", "Energy", "Water & Sanitation", "Agriculture & Irrigation",
  "Health", "Education", "Telecom", "Urban Development", "Tourism",
];
const PROVINCES = ["Koshi", "Madhesh", "Bagmati", "Gandaki", "Lumbini", "Karnali", "Sudurpashchim"];
const PROJECT_TYPES = [
  "Road","Bridge","Tunnel","Cable car","Airport","Railway",
  "Hydropower","Solar","Wind","Transmission line","Substation",
  "Drinking water","Sewerage","Treatment plant","Reservoir","Irrigation canal",
  "Hospital","School","Stadium","Market","Office building","Telecom tower","Other",
];
const STATUS_VALUES = ["proposed","approved","in_progress","delayed","completed","cancelled"];
const ESIA_VALUES = ["not_started","in_progress","iee_approved","eia_approved","rejected","exempt"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80);

// JSON repair (handles prose preamble, fenced code, trailing commas, and
// brace/bracket-unbalanced truncation including mid-string and mid-array)
// is shared with ai-fetch-* and ai-generate-* via _shared/json_repair.ts.

// Curated list of project-news + government + funder domains for future
// targeted-search use (e.g. a two-call mode where Tavily is first queried
// with include_domains for precision, then fallback to open search for
// breadth). NOT used as include_domains today — that would hard-restrict
// the search. Kept here as a maintenance constant: when a sweep clearly
// misses obvious projects from a known source, add it here.
const PROJECT_NEWS_DOMAINS = [
  // Nepali English-language news
  "kathmandupost.com", "ekantipur.com", "nepalitimes.com", "onlinekhabar.com",
  "myrepublica.nagariknetwork.com", "setopati.com", "himalpress.com", "en.himalpress.com",
  "thehimalayantimes.com", "nepalnews.com", "kantipurtv.com", "nagariknews.com",
  "baahrakhari.com", "ratopati.com", "biznews.com.np", "newbusinessage.com",
  "nepalenergyforum.com", "nepaliheadlines.com", "deshsanchar.com", "newspolar.com",
  "indianewsnetwork.com",
  // Nepal government ministries + departments
  "mof.gov.np", "mopit.gov.np", "moewri.gov.np", "mohp.gov.np", "moe.gov.np",
  "moald.gov.np", "mocit.gov.np", "mowsi.gov.np", "mocs.gov.np", "moicrr.gov.np",
  "moccs.gov.np", "moicrr.gov.np", "moftqc.gov.np", "moald.gov.np", "moic.gov.np",
  "moha.gov.np", "moljpa.gov.np", "moud.gov.np", "mofald.gov.np", "moir.gov.np",
  "moest.gov.np", "moccs.gov.np",
  // Nepal departments + agencies
  "npc.gov.np", "dor.gov.np", "dolidar.gov.np", "doed.gov.np", "doi.gov.np",
  "dudbc.gov.np", "dws.gov.np", "dohs.gov.np", "dofe.gov.np", "bfin.gov.np",
  "ppmo.gov.np", "oag.gov.np", "ciaa.gov.np", "frfo.gov.np", "bolpatra.gov.np",
  "doft.gov.np", "ihrcsc.gov.np", "dol.gov.np",
  // State-owned implementing entities
  "nea.org.np", "ntc.com.np", "ncell.com.np", "noc.org.np",
  "nrb.org.np", "necepal.org.np",
  // International funders (project pipelines + monitoring).
  // NOTE: documents1.worldbank.org + thedocs.worldbank.org REMOVED — those are
  // doc archives full of 100-page program PDFs that the AI correctly rejects
  // (no single named project). They were dominating Tavily results and
  // pushing actual project news off the top-5 list. blogs.worldbank.org and
  // the editorial worldbank.org pages stay — they're typically about
  // specific projects.
  "worldbank.org", "blogs.worldbank.org",
  "adb.org", "events.adb.org",
  "jica.go.jp", "jica.org.np",
  "undp.org", "who.int", "unicef.org", "aiib.org", "eib.org", "ifc.org",
  "kfw.de", "usaid.gov", "np.usembassy.gov", "giz.de", "dfid.gov.uk", "dfat.gov.au",
  "fcdo.gov.uk", "norad.no", "sdc.admin.ch",
  // International coverage of Nepal projects
  "reuters.com", "theguardian.com", "aljazeera.com",
  // Independent monitoring + thematic coverage. Added 2026-05-15 after a
  // local-AI Analyze batch on 8 Nepal projects found these as the strongest
  // sources for angles the mainstream + .gov.np channels miss:
  //   mongabay.com / mongabay.org — environmental / land / forest stories.
  //     Carried the Pathibhara Cable Car rhododendron-clearance + Supreme
  //     Court interim-stay coverage when Nepali papers were thinner.
  //   globalvoices.org — Indigenous-rights + protest reporting. Pathibhara
  //     Limbu/Yakthung protest casualties surfaced here first.
  //   rightsindevelopment.org — independent ADB/World Bank monitoring.
  //     Surfaced the FWRUDP TA status when SASEC and ADB's own pages
  //     contradicted each other.
  //   rss.com.np — Nepal's national wire service (Rashtriya Samachar
  //     Samiti). Authoritative breaking-news for events lacking deeper
  //     coverage; complements Kathmandu Post / Republica.
  "mongabay.com", "mongabay.org",
  "globalvoices.org",
  "rightsindevelopment.org",
  "rss.com.np",
] as const;

// (Previous NOISE_DOMAINS const removed — now obsolete because we use
// include_domains as a whitelist; anything not in PROJECT_NEWS_DOMAINS is
// already excluded. Kept commented in git history for reference.)

// Parses TAVILY_API_KEYS (comma-separated) with fallback to TAVILY_API_KEY.
// Tries each key in order; moves to the next on quota/auth failures.
// Returns { response, keyIndex } so callers can log which key was used or
// detect total exhaustion.
//
// Rotation triggers (Tavily-specific status codes):
//   429 — Rate Limit Exceeded (short-window throttle)
//   432 — Plan Limit Exceeded (monthly subscription quota)
//   433 — PayGo Limit Exceeded (dashboard spend cap)
//   401 — Unauthorized (key invalid/revoked) — rotate so a single bad key
//         in the list doesn't poison the whole sweep
// Fetch with an AbortController-backed timeout. Deno's fetch has no built-in
// timeout; without this a hung upstream (Tavily slow-loris response, Mistral
// stuck-stream) blocks the whole function past the 300s reaper threshold,
// leaving zero diagnostics. AbortError is normalised to a regular Response-
// shaped throw so callers can handle it as "this key failed, try next".
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const TAVILY_ROTATE_CODES = new Set([401, 429, 432, 433]);
// Tavily timeout: shortened from 30s → 15s. Tavily typically returns in 2-6s;
// anything past 10s is almost always a hung connection that will time out
// anyway. Bounding it tighter lets a stuck article fail fast and roll over
// to the next key/cell before the edge function's wall-time guard expires.
const TAVILY_TIMEOUT_MS = 15_000;
// AI per-call timeout: shortened from 60s → 22s. Mistral-small returns 800-
// 1500 tokens for the discovery schema in 4-10s typically; 22s is enough
// headroom for the long tail without letting one stuck call eat the whole
// wall-time budget. If the model genuinely can't respond in 22s, rolling to
// the next provider beats waiting another 38s.
const AI_TIMEOUT_MS = 22_000;
// admin client is passed so that exhausted keys can be persisted (moved to
// the bottom of the rotation in the api_keys table). Falls silent if a key
// isn't in the table (env-fallback path).
// deno-lint-ignore no-explicit-any
async function tavilySearch(
  admin: any,
  keys: string[],
  payload: Record<string, unknown>,
): Promise<{ response: Response; keyIndex: number; usedKey: string } | { exhausted: true; lastStatus: number }> {
  let lastStatus = 0;
  for (let i = 0; i < keys.length; i++) {
    let res: Response;
    try {
      res = await fetchWithTimeout("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, api_key: keys[i] }),
      }, TAVILY_TIMEOUT_MS);
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      lastStatus = aborted ? 599 : 598;
      continue;
    }
    if (!TAVILY_ROTATE_CODES.has(res.status)) {
      markSucceeded(admin, 'tavily', keys[i]).catch(() => {});
      return { response: res, keyIndex: i, usedKey: keys[i] };
    }
    // Persist exhaustion — key sinks to bottom for future invocations.
    const reason = res.status === 432 ? '432 plan-limit'
      : res.status === 433 ? '433 paygo-limit'
      : res.status === 401 ? '401 unauthorized'
      : res.status === 429 ? '429 rate-limit'
      : `HTTP ${res.status}`;
    markExhausted(admin, 'tavily', keys[i], reason).catch(() => {});
    lastStatus = res.status;
    await res.text();
  }
  return { exhausted: true, lastStatus };
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// Triple-provider chat with Mistral key rotation, then Google/Lovable fallback.
// Each Mistral key gets one retry on transient 429; quota-exhausted (402 or
// 429 with free_tier/resource_exhausted body) → roll over to next key
// immediately. After all Mistral keys exhaust, fall through to Google then
// Lovable.
// deno-lint-ignore no-explicit-any
async function callChatModel(
  admin: any,
  mistralKeys: string[],
  messages: ChatMessage[],
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const google = Deno.env.get("GOOGLE_AI_API_KEY");
  const lovable = Deno.env.get("LOVABLE_API_KEY");
  if (mistralKeys.length === 0 && !google && !lovable) {
    return { ok: false, status: 500, error: "No AI key configured (add Mistral keys via Admin → API Keys, or set MISTRAL_API_KEY/GOOGLE_AI_API_KEY/LOVABLE_API_KEY env)" };
  }

  const callOnce = async (endpoint: string, apiKey: string, model: string) => {
    // Single-attempt path for timeouts/network errors — let the caller rotate
    // to the next key or provider instead of doubling our worst-case latency.
    // The previous 2-attempt loop could turn one stuck Mistral request into a
    // 122s stall (60s + 1.5s backoff + 60s), which alone exceeded the per-
    // iteration time the wall-time guard could absorb.
    //
    // 429s WITHOUT free-tier markers still get one backoff retry below — a
    // brief rate spike on a single key is recoverable and rolling over loses
    // a slot in the quota window.
    let retried429 = false;
    while (true) {
      let r: Response;
      try {
        r = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          // - response_format=json_object forces the provider to emit valid
          //   JSON. Mistral, OpenAI-compatible Google, and Lovable all accept
          //   the OpenAI-style field; providers that ignore it still return
          //   their normal output, which the json_repair helper salvages.
          // - max_tokens=4000 was previously 8000. The schema asks for 250-
          //   500 words plus 30+ fields — ~1.5k tokens for a four-paragraph
          //   description, plus ~1k for the array fields. 4000 leaves a
          //   2x headroom while halving worst-case generation latency on
          //   slow-streaming providers.
          body: JSON.stringify({
            model,
            messages,
            max_tokens: 4000,
            response_format: { type: "json_object" },
          }),
        }, AI_TIMEOUT_MS);
      } catch (e) {
        const aborted = (e as Error)?.name === "AbortError";
        return { kind: "transient" as const, status: aborted ? 599 : 598, body: aborted ? `AI fetch timeout after ${AI_TIMEOUT_MS / 1000}s` : "AI fetch network error" };
      }
      if (r.status === 402) return { kind: "exhausted" as const, status: 402, body: "credits exhausted" };
      if (r.status === 429) {
        const body429 = await r.text();
        if (body429.includes("free_tier") || body429.includes("RESOURCE_EXHAUSTED")) {
          return { kind: "exhausted" as const, status: 429, body: body429.slice(0, 300) };
        }
        if (!retried429) {
          retried429 = true;
          await new Promise(res => setTimeout(res, 2000));
          continue;
        }
        return { kind: "transient" as const, status: 429, body: body429.slice(0, 400) };
      }
      if (!r.ok) {
        const body = await r.text();
        return { kind: "error" as const, status: r.status, body: body.slice(0, 200) };
      }
      const j = await r.json();
      return { kind: "ok" as const, text: (j.choices?.[0]?.message?.content ?? "") as string };
    }
  };

  // 1. Try each Mistral key in order. Roll over on exhaustion, persist
  // the exhausted state so the next invocation tries fresh keys first.
  for (let i = 0; i < mistralKeys.length; i++) {
    const res = await callOnce("https://api.mistral.ai/v1/chat/completions", mistralKeys[i], "mistral-small-latest");
    if (res.kind === "ok") {
      if (mistralKeys.length > 1) console.log(`Mistral: used key index ${i} of ${mistralKeys.length}`);
      markSucceeded(admin, 'mistral', mistralKeys[i]).catch(() => {});
      return { ok: true, text: res.text };
    }
    if (res.kind === "exhausted") {
      console.log(`Mistral key index ${i} exhausted (${res.status}); rolling to next`);
      markExhausted(admin, 'mistral', mistralKeys[i], `${res.status} ${res.body.slice(0, 100)}`).catch(() => {});
      continue;
    }
    console.log(`Mistral key index ${i} returned ${res.status}: ${res.body}`);
    break;
  }

  // 2. Google AI Studio fallback.
  if (google) {
    const res = await callOnce("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", google, "gemini-2.0-flash-lite");
    if (res.kind === "ok") return { ok: true, text: res.text };
    if (res.kind === "exhausted") console.log("Google AI key exhausted");
    else console.log(`Google AI error ${res.status}: ${res.body}`);
  }

  // 3. Lovable gateway last resort.
  if (lovable) {
    const res = await callOnce("https://ai.gateway.lovable.dev/v1/chat/completions", lovable, "google/gemini-2.0-flash");
    if (res.kind === "ok") return { ok: true, text: res.text };
    if (res.kind === "exhausted") return { ok: false, status: 402, error: "All AI providers exhausted (Mistral keys + Google + Lovable)" };
    return { ok: false, status: res.status, error: `AI provider error ${res.status}: ${res.body}` };
  }

  return { ok: false, status: 429, error: "All Mistral keys exhausted and no fallback provider configured" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Hoisted so the outer catch can write `failed` back to sherlock_jobs even
  // if processing throws after the body parse.
  let jobIdForCatch: string | null = null;
  // Hoisted so the outer catch can include the in-progress phase trail in
  // the failed row's error_text.
  const phases: string[] = [];

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Admin client (service role, bypasses RLS) — needed early so we can
    // pull the rotated key list from the api_keys table before any auth
    // or upstream provider work.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Keys pulled from the api_keys table when populated, else from env.
    // tavilySearch + callChatModel use these and persist exhaustion state
    // back to the table so the next invocation tries the freshest first.
    const tavilyKeys = await getKeys(admin, 'tavily');
    const mistralKeys = await getKeys(admin, 'mistral');
    if (tavilyKeys.length === 0) return json({ error: "No Tavily API keys configured (add via Admin → API Keys or TAVILY_API_KEYS env)" }, 500);
    if (mistralKeys.length === 0 && !Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("GOOGLE_AI_API_KEY")) {
      return json({ error: "No AI key configured (add Mistral via Admin → API Keys or set LOVABLE/GOOGLE env)" }, 500);
    }

    // Auth gate: accept either (a) an admin/coadmin/reviewer user JWT, or
    // (b) a service_role JWT directly. The latter lets pg_cron / GitHub
    // Actions invoke this function for Sherlock-style autonomous discovery.
    // We decode the JWT claim rather than string-comparing because the project
    // has multiple service_role-flavoured keys (legacy JWT + modern sb_secret).
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

    // Modern Supabase secret keys (sb_secret_…) aren't JWTs but still grant
    // service-role access. Accept exact match against the env-provided secret.
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
        (r: any) => r.role === "reviewer" || r.role === "coadmin" || r.role === "admin",
      );
      if (!isReviewer) return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const topic: string | undefined = body.topic?.toString().trim() || undefined;
    const region: string | undefined = body.region?.toString().trim() || undefined;
    const province: string | undefined = body.province?.toString().trim() || undefined;
    const district: string | undefined = body.district?.toString().trim() || undefined;
    const municipality: string | undefined = body.municipality?.toString().trim() || undefined;
    const sectorsParam: string[] | undefined = Array.isArray(body.sectors)
      ? body.sectors.map((s: unknown) => String(s).trim()).filter(Boolean)
      : undefined;
    // `maxResults` is the per-cell TARGET (the # of viable Nepal projects we
    // aim to insert from a single province × sector). It's NOT a ceiling on
    // candidate articles — Tavily returns plenty of articles the AI rejects
    // (non-Nepal-specific, off-topic, content too short, dedupe hit), so we
    // request more candidates than the target to give extraction enough room.
    const maxResults = Math.min(Math.max(Number(body.maxResults) || 5, 1), 10);
    // Tavily candidate budget per call: 3× the target, capped at Tavily's
    // hard ceiling of 20. One Tavily call costs the same credit regardless
    // of max_results up to 20, so this is free quota-wise. The inner
    // extraction loop early-breaks once `localInserted >= maxResults`, so
    // the extra candidates only cost AI calls when the first ones got
    // rejected (asymmetric: pay extra only when needed).
    const tavilyCandidates = Math.min(Math.max(maxResults * 3, 10), 20);
    // When the primary query falls short of the target, we'll run ONE
    // follow-up Tavily call per cell with a varied query (swap "project"
    // for program/scheme/tender/DPR synonyms, broaden time window). That
    // doubles Tavily quota usage on shortfall cells (still 1 call when
    // primary nails the target), so guard the follow-up behind a clear
    // shortfall threshold to avoid burning quota on cells that are already
    // close. `0` disables follow-up entirely.
    const FOLLOWUP_TRIGGER_RATIO = 0.6;
    // Build a varied query for the follow-up pass. Returns null if no
    // meaningful variation is possible (e.g. the original query is too
    // generic to vary).
    const buildFollowupQuery = (original: string): string | null => {
      // Swap "project" (and Nepali equivalents if present) for a wider
      // OR-cluster covering programmes, schemes, tenders, DPRs, and named
      // initiatives. Tavily handles OR within a single query.
      if (/\bproject\b/i.test(original)) {
        return original.replace(/\bproject\b/i, "(program OR scheme OR tender OR DPR OR initiative)");
      }
      // Original didn't have "project" — just append the synonym cluster.
      return `${original} (program OR scheme OR tender OR DPR)`;
    };
    // Optional tag for autonomous tools (e.g. "Sherlock") — surfaces in admin queue.
    const aiTag: string | null = body.aiTag?.toString().trim().slice(0, 40) || null;
    // Optional sherlock_jobs row id; if present, we write status/counts back at the end.
    const jobId: string | null = body.jobId?.toString().trim() || null;
    jobIdForCatch = jobId;
    // National Pride mode: caller asks Sherlock to focus specifically on the
    // 24 officially-designated राष्ट्रिय गौरवका आयोजना. Replaces the generic
    // "Nepal infrastructure" query with a targeted one per project; every
    // resulting row is force-labeled national_pride=true regardless of the
    // fuzzy match (which is a belt-and-braces fallback).
    const nationalPrideMode: boolean = body.nationalPride === true;

    // (admin client already created at the top of the handler — reused here.)

    // Build the list of (query, sector?) tuples to run.
    // - National Pride mode: pick one of the 24 names per "sector" the caller
    //   asked for, OR rotate through up to maxResults of them.
    // - Geo mode: province (or any geo field) provided → fan out one Tavily query per sector.
    // - Topic mode: legacy single query from topic/region.
    type Search = { query: string; sector?: string; npName?: string };
    const searches: Search[] = [];
    const geoMode = !!(province || district || municipality);
    if (nationalPrideMode) {
      // If a specific sector subset was passed, only pull National Pride
      // entries matching those sectors. Otherwise rotate through the whole 24.
      const wantSectors = (sectorsParam && sectorsParam.length > 0) ? new Set(sectorsParam) : null;
      const wantProvince = province || district ? (province ?? "") : null;
      let pool = NATIONAL_PRIDE_PROJECTS.filter(p => {
        if (wantSectors && p.sector && !wantSectors.has(p.sector)) return false;
        if (wantProvince && p.province && p.province !== wantProvince) return false;
        return true;
      });
      // Cap to keep edge function wall-time bounded — one Tavily + one AI call
      // per name, max 8 per invocation.
      pool = pool.slice(0, 8);
      for (const np of pool) {
        const parts = ['"' + np.name + '"', "Nepal", np.sector ?? "", np.province ?? "", "project"].filter(Boolean);
        searches.push({ query: parts.join(" "), sector: np.sector, npName: np.name });
      }
    } else if (geoMode) {
      const targetSectors = (sectorsParam && sectorsParam.length > 0) ? sectorsParam : SECTORS;
      for (const sec of targetSectors) {
        // Simple query — empirically validated to perform best when paired
        // with include_domains. The earlier event-keyword OR cluster + topic
        // news combination pulled in Indian regional press dominantly
        // (propnewstime, swarajyamag, deccanchronicle, 5dariyanews etc.) and
        // burned Tavily quota on articles the AI correctly rejected. With
        // include_domains narrowing to Nepali + funder + gov sources,
        // a short factual query gets the cleanest signal.
        const parts = ["Nepal", sec, "project", municipality, district, province].filter(Boolean);
        searches.push({ query: parts.join(" "), sector: sec });
      }
    } else {
      const parts = ["Nepal", topic ?? "infrastructure project", region].filter(Boolean);
      searches.push({ query: parts.join(" ") });
    }

    const errors: string[] = [];
    let inserted = 0;
    let skipped = 0;

    // Wall-time guard. The Sherlock reaper marks any 'running' row past 300s
    // as failed with "row was running for Xs without writeback (edge-function
    // wall-time exceeded)". We want to finish well under that so writeback
    // beats the reaper. Budget of 200s + worst-case single iteration ≈ 80s
    // (15s Tavily + 22s × ~3 provider attempts) gives a ceiling of ~280s,
    // safely under the reaper's 300s threshold.
    //
    // Why not closer to 300s: the reaper cron tick can fire at any point in
    // the 300-360s window AND the platform itself hard-kills around 400s on
    // pro. The closer to 300s we cut, the more often a slow single iteration
    // can flip us past the reaper before writeback. 200s + ~80s ceiling
    // beats both the reaper AND the hard kill.
    //
    // overBudget() is also checked between iterations only — it can't
    // interrupt an in-flight Tavily/AI call. The tight per-call timeouts
    // (AI_TIMEOUT_MS, TAVILY_TIMEOUT_MS) bound the single-iteration cost so
    // this works.
    const wallStartMs = Date.now();
    const WALL_BUDGET_MS = 200_000;
    const overBudget = () => Date.now() - wallStartMs > WALL_BUDGET_MS;

    // Per-step timing trail. Pushed at each major milestone; the most
    // recent ~20 entries get prepended to error_text whenever we bail
    // (wall-time, AI/Tavily exhaustion, or thrown error). When a queue
    // run hangs and gets reaped or truncated, sherlock_jobs.error_text
    // then literally shows "stuck between phase X and phase Y" — way
    // faster than chasing Supabase function logs. `phases` itself is
    // hoisted to the outer scope so the catch block can include it.
    const mark = (label: string) => {
      const ms = Date.now() - wallStartMs;
      phases.push(`${String(ms).padStart(6, ' ')}ms ${label}`);
      // Keep the trail bounded so a long run doesn't bloat the column.
      if (phases.length > 40) phases.splice(0, phases.length - 40);
    };
    const phaseTrail = (note: string) =>
      `${note}\nphase trail (last ${Math.min(phases.length, 20)}):\n${phases.slice(-20).join('\n')}`;

    // Heartbeat: writes the last_diagnostic column on sherlock_jobs after
    // each major phase. Reaper trigger doesn't touch last_diagnostic, so if
    // the function gets hard-killed the row still shows "last seen at
    // phase X, about to call URL Y, elapsed Zms" — which tells us whether
    // a hang is in Tavily, AI, or somewhere else. Fire-and-forget so a
    // slow Supabase write doesn't add latency to the hot path.
    const heartbeat = (label: string) => {
      if (!jobId) return;
      admin.from("sherlock_jobs").update({
        last_diagnostic: {
          ts: new Date().toISOString(),
          label,
          phases: phases.slice(-15),
          elapsed_ms: Date.now() - wallStartMs,
        },
      }).eq("id", jobId).then(
        () => { /* ok */ },
        () => { /* swallow; this is best-effort */ },
      );
    };
    mark('start');
    heartbeat('start');

    const sysPrompt = `You extract a single Nepal public-sector project record from a news article and write a thorough public-facing entry.

A "project" includes both physical infrastructure (roads, bridges, hydropower, hospitals, schools, irrigation works) AND named public-service programs / campaigns / initiatives with concrete scope and a reportable identity. Examples of qualifying soft-infrastructure entries:
  - "Core Group Partners Project (CGPP)" — public-health program in Madhesh with named implementing partner
  - "Mass Drug Administration (MDA) campaign for lymphatic filariasis" — government-run campaign with target districts and coverage goals
  - "Epidemiological Monitoring Survey (EMS)" — multi-district surveillance program
  - "School Sector Development Plan" — education program with budget and target population
Reject only items that are (a) not about Nepal, (b) generic news/opinion with no named project/program, or (c) one-off events without sustained scope (single workshop, one-day rally, single press release).

Return ONLY a JSON object (no prose, no markdown, no code fence) matching this schema:
{
  "title": string,                                    // <= 200 chars, the project's actual name
  "sector": one of ${JSON.stringify(SECTORS)},        // PRIMARY sector — single value, matches the most dominant theme
  "sectors": [one of ${JSON.stringify(SECTORS)}, ...], // ALL applicable sectors, in priority order. A hydropower project that also irrigates farmland is ["Energy","Agriculture & Irrigation"]. Always include the primary sector as element 0.
  "project_type": one of ${JSON.stringify(PROJECT_TYPES)} or null,
  "province": one of ${JSON.stringify(PROVINCES)} or null,     // primary / administrative-owner province
  "provinces": [one of ${JSON.stringify(PROVINCES)}, ...],     // ALL provinces the project physically traverses, in geographic order. East-West Highway = ["Koshi","Madhesh","Bagmati","Gandaki","Lumbini","Sudurpashchim"]. Always include the primary as element 0. Single-province projects = [primary].
  "district": string or null,                                 // primary district
  "districts": [string, ...],                                 // ALL districts the project traverses, max 10 entries
  "municipality": string or null,                             // primary municipality / metropolitan / RM
  "municipalities": [string, ...],                            // ALL municipalities the project traverses, max 15 entries
  "ward": number or null,                             // 0-99
  "location_text": string or null,                    // free-text description (e.g. "Kalanki–Naubise section, 27 km")
  "description": string,                              // SEE RULES BELOW
  "contractor": string or null,
  "implementing_agency": string or null,
  "budget_npr": number or null,                       // raw number, no commas
  "funding_committed_npr": number or null,
  "estimated_beneficiaries": number or null,
  "procurement_method": string or null,               // e.g. "ICB (international)", "NCB (national)", "Direct"
  "esia_status": one of ${JSON.stringify(ESIA_VALUES)} or null,
  "start_date": "YYYY-MM-DD" or null,
  "expected_completion": "YYYY-MM-DD" or null,
  "status": one of ${JSON.stringify(STATUS_VALUES)},   // SEE STATUS RUBRIC BELOW
  "confidence_score": number 0.00-1.00                 // see CONFIDENCE RUBRIC below
}

CONFIDENCE RUBRIC — required, 0.00-1.00:
- 0.95-1.00: article unambiguously names a specific Nepali infrastructure project with budget/agency/dates/location all stated.
- 0.80-0.94: article names the project clearly and gives 3+ concrete fields (sector, location, agency, or budget).
- 0.60-0.79: article mentions the project by name but key fields (location/budget) are inferred or vague.
- 0.40-0.59: project is mentioned in passing; significant fields guessed.
- Below 0.40: skip — return "null" instead of emitting a low-confidence record.
If the article is NOT about a specific Nepal project/program (per the qualifying-entries rules above), return the literal string "null".

DESCRIPTION RULES — this is an identity field, NOT a status report:
- Write 3-5 paragraphs (~250-500 words total) describing what the project IS, not what's currently happening with it.
- COVER (stable facts that don't change with a news cycle): project scope and scale (length / capacity / capital cost), geography (provinces/districts traversed, source-to-end if linear), sector + project type, intent (problem it solves, beneficiaries served, why this was sanctioned), stakeholder structure (implementing agency, executing ministry, lender types — e.g. "ADB sovereign loan + GoN co-financing"), procurement model (ICB / NCB / PPP / EPC, in the abstract), and political-economic significance.
- DO NOT INCLUDE in the description (these belong in updates / current status / risks):
   * Progress percentages ("67% complete", "halfway done")
   * Current contractor activity ("a Chinese contractor is doing the upgrade", "the contractor walked off site")
   * Schedule slippage / delays / extensions
   * Recent news, ongoing issues, latest tender awards
   * Anything dated "as of [recent year]" / "currently" / "is reported to be"
- Use ONLY facts the article actually contains. If a detail isn't in the article, omit it — DO NOT invent. The reader will see the source URL alongside.
- Plain prose. No markdown. No bullet points. Neutral tone. Treat the project name as an opaque label — do NOT pull in outside knowledge about real-world Nepali projects with similar names.

STATUS RUBRIC — extreme importance. Pick exactly one value using these rules (latest evidence in the article wins; if the article spans multiple time points, the MOST RECENT state takes priority):

- "proposed": the project has been announced, studied, or talked about but has NO formal sanction yet. Indicators: "feasibility study", "DPR (detailed project report) in preparation", "concept stage", "under consideration", "proposed", "planned", "concept", "envisaged". No budget formally allocated and no contract awarded.

- "approved": the project has formal sanction from the relevant authority (cabinet, ministry, parliament, board) AND/OR budget has been allocated in a national/provincial budget — BUT physical work has NOT started. Indicators: "approved by Cabinet", "endorsed", "budget allocated", "sanctioned", "tender issued", "tender awarded", "DPR approved", "groundbreaking ceremony scheduled". No construction/implementation reported yet.

- "in_progress": physical construction or implementation is actively underway as of the article's reporting period. Indicators: "construction began", "X% complete", "ongoing", "underway", "in progress", "active works", "contractor mobilised", a contractor is actually on site doing work. Even partial completion (e.g. "30% done") is in_progress unless explicitly stalled.

- "delayed": the project was supposed to be in_progress or completed by a stated date but has missed that target AND there is explicit reporting of the slippage. Indicators: "delayed", "missed deadline", "behind schedule", "stalled", "halted", "suspended", "extension granted (again)", "yet to start despite approval years ago", "deadline pushed", "blacklisted contractor", "contractor walked off site". This is a state ABOVE in_progress when there's clear schedule failure — do NOT default to delayed for any slow project; require explicit delay language.

- "completed": project has been formally finished AND/OR inaugurated AND/OR is in operation. Indicators: "completed", "inaugurated", "handed over", "operational", "now in service", "ribbon cut", "commercial operation date (COD) reached", "commissioned".

- "cancelled": project has been formally scrapped, terminated, or abandoned. Indicators: "cancelled", "scrapped", "abandoned", "terminated", "contract rescinded", "shelved indefinitely", "withdrawn".

Tie-breakers and defaults:
- If the article gives multiple status-relevant facts at different times, pick the one from the LATEST date in the article.
- If genuinely unclear and the article only mentions the project in passing → "proposed".
- An article reporting on tender stages (issued / awarded / signed) without construction start → "approved".
- An article reporting active construction problems but not explicit delay language → still "in_progress".
- An article reporting a partial inauguration of one section while others are still being built → "in_progress" (not "completed") unless the entire project is described as done.

Other rules:
- Title is the project's actual name, not the article's headline (unless they match).
- Be conservative on dates: only fill if the article gives a specific date.
- Treat 1 lakh = 100,000 NPR and 1 crore = 10,000,000 NPR; convert reported figures to raw NPR.
- If the article mentions multiple projects, pick the most prominent one. The dedupe layer will skip exact title matches.`;

    // Outer loop: one Tavily search per `searches` entry. Geo mode runs once
    // per sector; topic mode runs once total.
    mark(`searches built (${searches.length})`);
    outer: for (let sIdx = 0; sIdx < searches.length; sIdx++) {
      if (overBudget()) {
        errors.push(phaseTrail(`Wall-time budget (${WALL_BUDGET_MS / 1000}s) reached before sector "${searches[sIdx].sector ?? "topic"}" — returning partial results.`));
        break outer;
      }
      const search = searches[sIdx];

      // Pace between Tavily calls in geo mode to be polite to upstream.
      // Cut from 1500ms → 1000ms; 1s is still safely within Tavily rate
      // limits but reclaims meaningful wall-time on multi-search runs.
      if (sIdx > 0) await new Promise(res => setTimeout(res, 1000));

      // ─── Dry-cell guard ───────────────────────────────────────────────
      // Skip Tavily entirely if the last 3 runs on this exact (province,
      // district, sector) cell all returned 0 inserts. Saves API quota on
      // cells where Tavily reliably returns content but the AI rejects all
      // of it (typically remote districts with no English-language news
      // coverage of specific projects). Force a re-test by setting
      // forceDryRecheck=true in the job params (rerun handler in
      // SherlockManager injects this automatically).
      if (search.sector && province && !nationalPrideMode && !body.forceDryRecheck) {
        // Pull a small window of recent same-province geo runs, then filter
        // for exact district+sector match client-side. Client filter is
        // more robust than relying on PostgREST JSONB-contains syntax for
        // the sectors array. Also exclude prior dry-skip rows so the guard
        // can't perpetuate itself — only REAL Tavily runs that returned 0
        // inserts count toward the dry streak.
        const { data: recentRuns } = await admin
          .from("sherlock_jobs")
          .select("inserted, params, error_text, finished_at")
          .eq("kind", "geo")
          .eq("status", "done")
          .filter("params->>province", "eq", province)
          .order("finished_at", { ascending: false })
          .limit(20);
        const cellRuns = (recentRuns ?? []).filter((j: any) => {
          // Don't let a prior dry-skip row count as a "Tavily returned 0"
          // — those rows DIDN'T call Tavily. Without this exclusion the
          // guard self-perpetuates: once dry, always dry, even after code
          // changes (e.g. this include_domains switch) that would fix it.
          if (j.error_text && j.error_text.startsWith("Dry cell skipped")) return false;
          const p = j.params ?? {};
          if (district) { if (p.district !== district) return false; }
          else          { if (p.district)              return false; }
          const sectors = Array.isArray(p.sectors) ? p.sectors : [];
          return sectors.includes(search.sector);
        }).slice(0, 3);
        const allDry = cellRuns.length >= 3 && cellRuns.every((j: any) => (j.inserted ?? 0) === 0);
        if (allDry) {
          const cellLabel = [province, district, search.sector].filter(Boolean).join("/");
          mark(`dry-skip sector=${search.sector}`);
          heartbeat(`dry-skip sector=${search.sector}`);
          errors.push(`Dry cell skipped: ${cellLabel} — last 3 geo runs all returned 0 inserts; Tavily call suppressed to conserve quota. Force a recheck by manually rerunning this job.`);
          continue;
        }
      }

      // Per-cell insertion counter — accumulates across BOTH passes.
      // The outer (`inserted`) counter is cumulative across all cells;
      // this one tracks just the current sector so we can (a) stop
      // AI-extracting candidates once the cell target is met and (b)
      // decide whether to run the follow-up Tavily pass.
      let localInserted = 0;

      // Two-pass discovery per sector. Pass 0 = primary query (original
      // behaviour). Pass 1 = follow-up with a varied query, fired only
      // when pass 0 left a shortfall of at least
      // (maxResults * FOLLOWUP_TRIGGER_RATIO). The follow-up adds 1 more
      // Tavily credit per shortfalling sector but gives us a second
      // chance to hit the target via differently-phrased queries.
      passes: for (let pass = 0; pass < 2; pass++) {
        if (overBudget()) break passes;
        if (localInserted >= maxResults) break passes;

        let passQuery: string;
        let passDays: number;
        if (pass === 0) {
          passQuery = search.query;
          passDays = 730;
        } else {
          // Pass 1 = follow-up. Gated on shortfall + meaningful variation.
          const shortfall = maxResults - localInserted;
          if (shortfall < maxResults * FOLLOWUP_TRIGGER_RATIO) break passes;
          const fq = buildFollowupQuery(search.query);
          if (!fq || fq === search.query) break passes;
          passQuery = fq;
          passDays = 1095;  // 3-year window — looser than the primary
          mark(`followup-start sec=${search.sector ?? 'topic'} shortfall=${shortfall}`);
          heartbeat(`followup-start sec=${search.sector ?? 'topic'} shortfall=${shortfall}`);
        }

        mark(`tavily-start sec=${search.sector ?? 'topic'} pass=${pass}`);
        heartbeat(`tavily-start sec=${search.sector ?? 'topic'} pass=${pass}`);

        const tavResult = await tavilySearch(admin, tavilyKeys, {
        query: passQuery,
        search_depth: "advanced",
        max_results: tavilyCandidates,
        include_answer: false,
        include_images: true,
        // Recency window: 2 years for the primary pass (project events
        // often pre-date a few months), 3 years for the follow-up so the
        // varied query can pick up older program/scheme references.
        days: passDays,
        // include_domains: empirically validated whitelist of Nepali news +
        // gov.np ministries + funders. Side-by-side tests showed open-web
        // search returned predominantly Indian wire copy (propnewstime,
        // swarajyamag, deccanchronicle) for "Nepal <sector> project
        // <district>" queries, because south-Asia search results are
        // dominated by Indian regional press. include_domains restores
        // signal at the cost of locking out non-listed sources — the
        // PROJECT_NEWS_DOMAINS list is curated to be comprehensive across
        // Nepali news, government ministries/departments, state-owned
        // entities, and international funders.
        include_domains: [...PROJECT_NEWS_DOMAINS],
      });

      if ("exhausted" in tavResult) {
        const reason = tavResult.lastStatus === 432 ? "plan-limit"
          : tavResult.lastStatus === 433 ? "paygo-limit"
          : tavResult.lastStatus === 401 ? "unauthorized"
          : tavResult.lastStatus === 429 ? "rate-limit"
          : `HTTP ${tavResult.lastStatus}`;
        errors.push(`All ${tavilyKeys.length} Tavily key(s) exhausted (${reason}) at sector "${search.sector ?? "topic"}"`);
        // Operator alert (non-blocking). Cooldown in notify.ts prevents spam.
        sendAlert(admin, "tavily_exhausted",
          `Tavily API keys exhausted (${reason})`,
          `Reason: ${reason}\nSector: ${search.sector ?? "topic"}\nKeys tried: ${tavilyKeys.length}`,
          { details: { reason, sector: search.sector, keysCount: tavilyKeys.length } }
        ).catch((e) => console.warn("sendAlert tavily_exhausted failed:", e));
        break outer;
      }
      const { response: tav, keyIndex } = tavResult;
      if (!tav.ok) {
        errors.push(`Tavily ${tav.status} for sector "${search.sector ?? "topic"}"`);
        continue;
      }
      if (tavilyKeys.length > 1) console.log(`Tavily: used key index ${keyIndex} of ${tavilyKeys.length} for sector "${search.sector ?? "topic"}"`);

      const tavJson = await tav.json();
      const results: any[] = tavJson.results ?? [];
      mark(`tavily-done sec=${search.sector ?? 'topic'} pass=${pass} results=${results.length}`);
      heartbeat(`tavily-done sec=${search.sector ?? 'topic'} pass=${pass} results=${results.length}`);
      // Deduped image URLs from this Tavily search. Up to 6 per search.
      // Reused for every project we extract from this search's articles —
      // not perfect (one search can yield multiple projects) but cheap.
      const searchImages: string[] = [];
      const imgSeen = new Set<string>();
      for (const img of (tavJson.images ?? []) as any[]) {
        const u = typeof img === "string" ? img : (img && typeof img.url === "string" ? img.url : null);
        if (!u || imgSeen.has(u)) continue;
        try { new URL(u); } catch { continue; }
        imgSeen.add(u); searchImages.push(u);
        if (searchImages.length >= 6) break;
      }

      for (let idx = 0; idx < results.length; idx++) {
        if (overBudget()) {
          errors.push(phaseTrail(`Wall-time budget (${WALL_BUDGET_MS / 1000}s) reached mid-sector "${search.sector ?? "topic"}" after ${inserted} insert(s), ${skipped} skip(s).`));
          break outer;
        }
        // Target met for this cell — stop extracting candidates and move
        // to the next cell. We requested more candidates than the target
        // to give extraction breathing room, but every successful insert
        // means one fewer candidate we need to process.
        if (localInserted >= maxResults) {
          mark(`target-met sec=${search.sector ?? 'topic'} localInserted=${localInserted}`);
          break;
        }
        const r = results[idx];
        // Pace between AI calls. Cut from 2500ms → 1200ms — still under the
        // 30 RPM free-tier ceiling (≈ 2000ms minimum) with key rotation
        // sharing the budget across multiple keys.
        if (idx > 0 || sIdx > 0) await new Promise(res => setTimeout(res, 1200));
        const urlShort = (() => {
          try { return new URL(r?.url ?? '').hostname; } catch { return 'no-url'; }
        })();
        mark(`ai-start sec=${search.sector ?? 'topic'} idx=${idx} ${urlShort}`);
        heartbeat(`ai-start sec=${search.sector ?? 'topic'} idx=${idx} ${urlShort}`);
        if (!r?.content || r.content.length < 50) {
          skipped += 1;
          continue;
        }
        try {
          const ai = await callChatModel(admin, mistralKeys, [
            { role: "system", content: sysPrompt },
            { role: "user", content: `Title: ${r.title}\nURL: ${r.url}\n\nArticle:\n${r.content.slice(0, 4000)}` },
          ]);
          mark(`ai-done sec=${search.sector ?? 'topic'} idx=${idx} ok=${ai.ok}`);
          heartbeat(`ai-done sec=${search.sector ?? 'topic'} idx=${idx} ok=${ai.ok}`);
          if (!ai.ok) {
            errors.push(`AI ${ai.status}: ${ai.error}`);
            if (ai.status === 429 || ai.status === 402) {
              // Mistral / fallback providers all exhausted. Alert + bail.
              errors.push(phaseTrail(`AI exhausted at sector "${search.sector ?? "topic"}" idx ${idx}.`));
              sendAlert(admin, "mistral_exhausted",
                `AI provider keys exhausted (HTTP ${ai.status})`,
                `Status: ${ai.status}\nDetail: ${ai.error}\nSector: ${search.sector ?? "topic"}`,
                { details: { status: ai.status, detail: ai.error, sector: search.sector } }
              ).catch((e) => console.warn("sendAlert mistral_exhausted failed:", e));
              break outer;
            }
            continue;
          }
          // Robust parse: handles preamble/postamble prose, fenced code,
          // trailing-comma typos, and brace-unbalanced truncation. The
          // previous bare JSON.parse silently dropped articles like the
          // indianewsnetwork.com/Baglung community-development case where
          // Mistral wrapped its response in conversational text.
          const parseResult = tryParseJsonObject(ai.text ?? "");
          if (!parseResult.ok) {
            if (parseResult.reason === "ai_skipped" || parseResult.reason === "empty") {
              // The AI explicitly judged this article as not-a-Nepal-project,
              // OR returned nothing (rare but possible). Count as a skip.
              skipped += 1;
            } else {
              // Genuine parse failure — log a snippet of what the AI returned
              // so we can diagnose recurring patterns (truncation? format
              // hallucinations?) without chasing edge-function logs.
              const snippet = (ai.text ?? "").slice(0, 240).replace(/\n+/g, " ⏎ ");
              errors.push(`JSON parse failed for ${r.url} (${parseResult.reason}): ${snippet}…`);
            }
            continue;
          }
          const parsed = parseResult.value;
          if (!parsed || !parsed.title) {
            skipped += 1;
            continue;
          }

          // Dedupe by case-insensitive exact title match. Escape ILIKE wildcards
          // so special chars in titles aren't treated as SQL patterns.
          const safeTitle = parsed.title.trim()
            .replace(/\\/g, "\\\\")
            .replace(/%/g, "\\%")
            .replace(/_/g, "\\_");
          const { data: existingProject, error: dedupeErr } = await admin
            .from("projects")
            .select("id, provinces, districts, municipalities")
            .ilike("title", safeTitle)
            .maybeSingle();
          if (dedupeErr) {
            errors.push(`Dedupe check failed: ${dedupeErr.message}`);
            continue;
          }
          if (existingProject) {
            // A project re-discovered through a *different* location search is
            // evidence the project spans both. Instead of dropping the new
            // hit, fold the new location signals into the existing project's
            // arrays. Sources are also appended so a reviewer can see the
            // additional citation.
            const mergeUnique = (existing: any, cands: (string | null | undefined)[], cap: number, valid?: (s: string) => boolean) => {
              const cur: string[] = Array.isArray(existing) ? existing.filter((x): x is string => typeof x === "string") : [];
              const seen = new Set(cur.map(s => s.toLowerCase()));
              const out = [...cur];
              for (const c of cands) {
                if (typeof c !== "string") continue;
                const s = c.trim();
                if (!s) continue;
                if (valid && !valid(s)) continue;
                if (seen.has(s.toLowerCase())) continue;
                seen.add(s.toLowerCase()); out.push(s);
                if (out.length >= cap) break;
              }
              return out;
            };
            // Candidates: this sweep's geo context + whatever the AI extracted.
            const provCands = [
              province, parsed.province,
              ...(Array.isArray(parsed.provinces) ? parsed.provinces : []),
            ];
            const distCands = [
              district, parsed.district,
              ...(Array.isArray(parsed.districts) ? parsed.districts : []),
            ];
            const munCands = [
              municipality, parsed.municipality,
              ...(Array.isArray(parsed.municipalities) ? parsed.municipalities : []),
            ];
            const mergedProvinces      = mergeUnique(existingProject.provinces, provCands, 7, p => PROVINCES.includes(p));
            const mergedDistricts      = mergeUnique(existingProject.districts, distCands, 10);
            const mergedMunicipalities = mergeUnique(existingProject.municipalities, munCands, 15);

            // Only update if at least one array genuinely grew.
            const grew = (a: any, b: string[]) => (Array.isArray(a) ? a.length : 0) < b.length;
            if (grew(existingProject.provinces, mergedProvinces)
              || grew(existingProject.districts, mergedDistricts)
              || grew(existingProject.municipalities, mergedMunicipalities)) {
              const { error: mergeErr } = await admin.from("projects").update({
                provinces: mergedProvinces,
                districts: mergedDistricts,
                municipalities: mergedMunicipalities,
              }).eq("id", existingProject.id);
              if (mergeErr) errors.push(`Location merge failed: ${mergeErr.message}`);
            }

            // Best-effort: append this article to project_sources if it's not
            // already a citation on the project. Same dedupe shape that
            // analysis-drain uses for additional_sources.
            try {
              const nUrl = r.url.replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
              const { data: existingSources } = await admin
                .from("project_sources").select("url").eq("project_id", existingProject.id);
              const already = (existingSources ?? []).some((s: any) =>
                typeof s.url === "string"
                && s.url.replace(/^https?:\/\/(www\.)?/i, "").toLowerCase() === nUrl);
              if (!already) {
                await admin.from("project_sources").insert({
                  project_id: existingProject.id,
                  added_by: null,
                  source_type: "article",
                  title: r.title || new URL(r.url).hostname,
                  url: r.url,
                  verified: false,
                  approval_status: "pending",
                  submitted_by_ai: true,
                });
              }
            } catch { /* sources extension is best-effort */ }

            skipped += 1;
            continue;
          }

          const slug = slugify(parsed.title) + "-" + crypto.randomUUID().slice(0, 4);
          const ward = (typeof parsed.ward === "number" && parsed.ward >= 0 && parsed.ward <= 99) ? parsed.ward : null;
          const status = STATUS_VALUES.includes(parsed.status) ? parsed.status : "proposed";
          const esia = ESIA_VALUES.includes(parsed.esia_status) ? parsed.esia_status : null;
          // Sector default: in geo mode, use the sector we searched for; else "Transport" as before.
          const fallbackSector = search.sector && SECTORS.includes(search.sector) ? search.sector : "Transport";
          // Multi-sector array. Filter to valid SECTORS, dedupe, ensure primary
          // sits at index 0. Falls back to [primary] when AI didn't emit the array.
          const primarySector = SECTORS.includes(parsed.sector) ? parsed.sector : fallbackSector;
          const rawSectors: any[] = Array.isArray(parsed.sectors) ? parsed.sectors : [];
          const sectorsSeen = new Set<string>([primarySector]);
          const sectorsArr: string[] = [primarySector];
          for (const s of rawSectors) {
            if (typeof s !== "string" || !SECTORS.includes(s)) continue;
            if (sectorsSeen.has(s)) continue;
            sectorsSeen.add(s); sectorsArr.push(s);
            if (sectorsArr.length >= 4) break;
          }
          const { data: proj, error: pErr } = await admin
            .from("projects")
            .insert({
              title: String(parsed.title).slice(0, 200),
              slug,
              description: parsed.description ?? null,
              sector: primarySector,
              sectors: sectorsArr,
              project_type: PROJECT_TYPES.includes(parsed.project_type) ? parsed.project_type : null,
              province: PROVINCES.includes(parsed.province) ? parsed.province : null,
              district: parsed.district ?? null,
              municipality: parsed.municipality ?? null,
              // Multi-geo arrays — for projects that span multiple
              // provinces / districts / municipalities. Dedupes, filters
              // provinces against the canonical list, caps at sensible
              // sizes. Always includes the primary as element 0.
              provinces: (() => {
                const primary = PROVINCES.includes(parsed.province) ? parsed.province : null;
                const seen = new Set<string>();
                const out: string[] = [];
                if (primary) { seen.add(primary); out.push(primary); }
                for (const p of (Array.isArray(parsed.provinces) ? parsed.provinces : [])) {
                  if (typeof p !== "string" || !PROVINCES.includes(p) || seen.has(p)) continue;
                  seen.add(p); out.push(p);
                  if (out.length >= 7) break;
                }
                return out;
              })(),
              districts: (() => {
                const primary = parsed.district ?? null;
                const seen = new Set<string>();
                const out: string[] = [];
                if (primary) { seen.add(primary); out.push(primary); }
                for (const d of (Array.isArray(parsed.districts) ? parsed.districts : [])) {
                  if (typeof d !== "string" || !d.trim() || seen.has(d)) continue;
                  seen.add(d); out.push(d);
                  if (out.length >= 10) break;
                }
                return out;
              })(),
              municipalities: (() => {
                const primary = parsed.municipality ?? null;
                const seen = new Set<string>();
                const out: string[] = [];
                if (primary) { seen.add(primary); out.push(primary); }
                for (const m of (Array.isArray(parsed.municipalities) ? parsed.municipalities : [])) {
                  if (typeof m !== "string" || !m.trim() || seen.has(m)) continue;
                  seen.add(m); out.push(m);
                  if (out.length >= 15) break;
                }
                return out;
              })(),
              ward,
              location_text: parsed.location_text ?? null,
              contractor: parsed.contractor ?? null,
              implementing_agency: parsed.implementing_agency ?? null,
              budget_npr: typeof parsed.budget_npr === "number" ? parsed.budget_npr : null,
              funding_committed_npr: typeof parsed.funding_committed_npr === "number" ? parsed.funding_committed_npr : null,
              estimated_beneficiaries: typeof parsed.estimated_beneficiaries === "number" ? parsed.estimated_beneficiaries : null,
              procurement_method: parsed.procurement_method ?? null,
              esia_status: esia,
              // safeIsoDate rejects "2026-03-00" / "2026-02-30" / "2026-13-05"
              // and similar AI hallucinations that pass the regex shape check
              // but fail Postgres's actual calendar validation.
              start_date: safeIsoDate(parsed.start_date),
              expected_completion: safeIsoDate(parsed.expected_completion),
              status,
              approval_status: "pending",
              submitted_by: null,
              submitted_by_ai: true,
              ai_tag: aiTag,
              // Force-label when this came from a National Pride sweep; else
              // fall back to a fuzzy match against the 24-name list so even
              // organic discoveries get the badge when the title is recognisable.
              national_pride: nationalPrideMode || !!matchNationalPride(parsed.title ?? ""),
              // Image gallery from this Tavily search. cover_image_url
              // doubles as the first carousel item + the legacy single-image
              // field used by cards/lists.
              image_urls: searchImages,
              cover_image_url: searchImages[0] ?? null,
              // AI-rated confidence (clamped 0..1). The auto-approve trigger
              // promotes high-confidence rows when the site_settings toggle
              // is on; otherwise they sit pending like before.
              confidence_score: (() => {
                const v = typeof parsed.confidence_score === "number" ? parsed.confidence_score : null;
                if (v == null || !Number.isFinite(v)) return null;
                return Math.max(0, Math.min(1, Math.round(v * 100) / 100));
              })(),
            })
            .select("id")
            .single();
          if (pErr) {
            errors.push(`Insert project failed: ${pErr.message}`);
            continue;
          }

          // Reuse the project-level confidence as the source-row confidence —
          // they share evidence (the AI extracted the project from this very
          // article), so the trust signal carries over. Auto-approve trigger
          // promotes the source row alongside the project when ≥ threshold.
          const projConfidence = (() => {
            const v = typeof parsed.confidence_score === "number" ? parsed.confidence_score : null;
            if (v == null || !Number.isFinite(v)) return null;
            return Math.max(0, Math.min(1, Math.round(v * 100) / 100));
          })();
          const { error: sErr } = await admin.from("project_sources").insert({
            project_id: proj.id,
            added_by: null,
            source_type: "article",
            title: r.title || new URL(r.url).hostname,
            url: r.url,
            verified: false,
            approval_status: "pending",
            submitted_by_ai: true,
            confidence_score: projConfidence,
          });
          if (sErr) {
            errors.push(`Insert source failed: ${sErr.message}`);
            // Roll back the orphaned project so the DB stays clean.
            await admin.from("projects").delete().eq("id", proj.id);
          } else {
            inserted += 1;
            localInserted += 1;
          }
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      } // close passes loop
    }

    mark(`loop-done inserted=${inserted} skipped=${skipped} errors=${errors.length}`);
    // If invoked from sherlock_drain_queue_once(), close out the job row so
    // the admin UI sees it transition queued → running → done. If we
    // accumulated any errors OR the loop bailed early, prepend a phase
    // trail so reaped/truncated rows show where time went.
    if (jobId) {
      let errorText: string | null = null;
      if (errors.length > 0) {
        errorText = errors.slice(0, 10).join("\n").slice(0, 2000);
      } else if (Date.now() - wallStartMs > WALL_BUDGET_MS - 5000) {
        // Edge case: under-budget but very close. Include trail anyway.
        errorText = phaseTrail(`Completed near wall-time budget.`).slice(0, 2000);
      }
      const { error: jobUpdateErr } = await admin.from("sherlock_jobs").update({
        status: "done",
        inserted,
        skipped,
        error_text: errorText,
        finished_at: new Date().toISOString(),
      }).eq("id", jobId);
      if (jobUpdateErr) console.error("Failed to update sherlock_jobs:", jobUpdateErr);
    }

    return json({ inserted, skipped, errors, phases });
  } catch (e) {
    console.error("ai-discover-projects error:", e);
    // Best-effort: if this run came from the queue drain, mark the job failed.
    // Include the phase trail if we have it — tells us where the throw fired.
    if (jobIdForCatch) {
      try {
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const baseMsg = e instanceof Error ? e.message : String(e);
        const withTrail = phases.length > 0
          ? `${baseMsg}\nphase trail (last ${Math.min(phases.length, 20)}):\n${phases.slice(-20).join('\n')}`
          : baseMsg;
        await adminClient.from("sherlock_jobs").update({
          status: "failed",
          error_text: withTrail.slice(0, 2000),
          finished_at: new Date().toISOString(),
        }).eq("id", jobIdForCatch);
      } catch { /* nothing further we can do */ }
    }
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
