// TODO: extract auth gate + Lovable call to _shared if a third caller appears.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

const stripFences = (s: string) =>
  s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

// Parses TAVILY_API_KEYS (comma-separated) with fallback to TAVILY_API_KEY.
// Tries each key in order; moves to the next on 429. Returns { response, keyIndex }
// so callers can log which key was used or detect total exhaustion.
async function tavilySearch(
  keys: string[],
  payload: Record<string, unknown>,
): Promise<{ response: Response; keyIndex: number } | { exhausted: true }> {
  for (let i = 0; i < keys.length; i++) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, api_key: keys[i] }),
    });
    if (res.status !== 429) return { response: res, keyIndex: i };
    // 429 → try next key; consume body so the connection is released
    await res.text();
  }
  return { exhausted: true };
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
    model = "google/gemini-2.0-flash";
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
      // Quota-exhausted errors (daily/monthly limit) won't recover — return immediately.
      if (body429.includes("free_tier") || body429.includes("RESOURCE_EXHAUSTED")) {
        return { ok: false, status: 429, error: `AI quota exhausted (free tier limit hit). Use a Google AI Studio key for higher quota. Details: ${body429.slice(0, 200)}` };
      }
      // Transient per-second rate limit: one fast retry after 3 s (safe within edge fn timeout).
      console.log(`AI 429 attempt ${attempt} body: ${body429}`);
      if (attempt === 0) { await new Promise(res => setTimeout(res, 3000)); continue; }
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

    // Auth gate: require admin or reviewer role.
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
    const topic: string | undefined = body.topic?.toString().trim() || undefined;
    const region: string | undefined = body.region?.toString().trim() || undefined;
    const maxResults = Math.min(Math.max(Number(body.maxResults) || 5, 1), 10);
    // Optional tag for autonomous tools (e.g. "Sherlock") — surfaces in admin queue.
    const aiTag: string | null = body.aiTag?.toString().trim().slice(0, 40) || null;

    const query = ["Nepal infrastructure project", topic ?? "", region ?? ""].filter(Boolean).join(" ");

    const tavResult = await tavilySearch(tavilyKeys, {
      query,
      search_depth: "advanced",
      max_results: maxResults,
      include_answer: false,
    });

    if ("exhausted" in tavResult) {
      return json({
        error: `All ${tavilyKeys.length} Tavily key(s) are rate-limited. Try again later.`,
      }, 429);
    }
    const { response: tav, keyIndex } = tavResult;
    if (!tav.ok) return json({ error: `Tavily error ${tav.status}` }, 502);
    const tavJson = await tav.json();
    const results: any[] = tavJson.results ?? [];

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const errors: string[] = [];
    let inserted = 0;
    let skipped = 0;

    // Log which key was used (index only — never log the key value).
    if (tavilyKeys.length > 1) console.log(`Tavily: used key index ${keyIndex} of ${tavilyKeys.length}`);

    const sysPrompt = `You extract a single Nepal infrastructure project record from a news article and write a thorough public-facing entry.
Return ONLY a JSON object (no prose, no markdown, no code fence) matching this schema:
{
  "title": string,                                    // <= 200 chars, the project's actual name
  "sector": one of ${JSON.stringify(SECTORS)},
  "project_type": one of ${JSON.stringify(PROJECT_TYPES)} or null,
  "province": one of ${JSON.stringify(PROVINCES)} or null,
  "district": string or null,
  "municipality": string or null,                     // municipality / metropolitan / RM
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
  "status": one of ${JSON.stringify(STATUS_VALUES)}   // best inference from article (proposed if unclear)
}
If the article is NOT about a specific infrastructure project in Nepal, return the literal string "null".

DESCRIPTION RULES — this is the most important field:
- Write 3-6 substantive paragraphs (~250-600 words total).
- Cover: scope/scale, geography, stakeholders, timeline, financing, current status, and any reported issues, delays, beneficiaries, environmental/social context, and political or economic significance.
- Use ONLY facts the article actually contains. If a detail isn't in the article, omit it — DO NOT invent. The reader will see the source URL alongside.
- Plain prose. No markdown. No bullet points. Neutral tone. Treat the project name as an opaque label — do NOT pull in outside knowledge about real-world Nepali projects with similar names.

Other rules:
- Title is the project's actual name, not the article's headline (unless they match).
- Be conservative on dates: only fill if the article gives a specific date.
- Treat 1 lakh = 100,000 NPR and 1 crore = 10,000,000 NPR; convert reported figures to raw NPR.
- If the article mentions multiple projects, pick the most prominent one. The dedupe layer will skip exact title matches.`;

    for (let idx = 0; idx < results.length; idx++) {
      const r = results[idx];
      if (idx > 0) await new Promise(res => setTimeout(res, 2500)); // pace under 30 RPM free tier
      if (!r?.content || r.content.length < 50) {
        skipped += 1;
        continue;
      }
      try {
        const ai = await callChatModel([
          { role: "system", content: sysPrompt },
          { role: "user", content: `Title: ${r.title}\nURL: ${r.url}\n\nArticle:\n${r.content.slice(0, 4000)}` },
        ]);
        if (!ai.ok) {
          errors.push(`AI ${ai.status}: ${ai.error}`);
          if (ai.status === 429 || ai.status === 402) break;
          continue;
        }
        const raw = stripFences(ai.text);
        if (!raw || raw === "null" || raw === '"null"') {
          skipped += 1;
          continue;
        }
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          errors.push(`JSON parse failed for ${r.url}`);
          continue;
        }
        if (!parsed || !parsed.title) {
          skipped += 1;
          continue;
        }

        // Skip if a project with this title already exists (case-insensitive exact match).
        // Escape ILIKE wildcards so special chars in titles aren't treated as SQL patterns.
        const safeTitle = parsed.title.trim()
          .replace(/\\/g, "\\\\")
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_");
        const { data: existingProject, error: dedupeErr } = await admin
          .from("projects")
          .select("id")
          .ilike("title", safeTitle)
          .maybeSingle();
        if (dedupeErr) {
          errors.push(`Dedupe check failed: ${dedupeErr.message}`);
          continue;
        }
        if (existingProject) {
          skipped += 1;
          continue;
        }

        const slug = slugify(parsed.title) + "-" + crypto.randomUUID().slice(0, 4);
        const ward = (typeof parsed.ward === "number" && parsed.ward >= 0 && parsed.ward <= 99) ? parsed.ward : null;
        const status = STATUS_VALUES.includes(parsed.status) ? parsed.status : "proposed";
        const esia = ESIA_VALUES.includes(parsed.esia_status) ? parsed.esia_status : null;
        const { data: proj, error: pErr } = await admin
          .from("projects")
          .insert({
            title: String(parsed.title).slice(0, 200),
            slug,
            description: parsed.description ?? null,
            sector: SECTORS.includes(parsed.sector) ? parsed.sector : "Transport",
            project_type: PROJECT_TYPES.includes(parsed.project_type) ? parsed.project_type : null,
            province: PROVINCES.includes(parsed.province) ? parsed.province : null,
            district: parsed.district ?? null,
            municipality: parsed.municipality ?? null,
            ward,
            location_text: parsed.location_text ?? null,
            contractor: parsed.contractor ?? null,
            implementing_agency: parsed.implementing_agency ?? null,
            budget_npr: typeof parsed.budget_npr === "number" ? parsed.budget_npr : null,
            funding_committed_npr: typeof parsed.funding_committed_npr === "number" ? parsed.funding_committed_npr : null,
            estimated_beneficiaries: typeof parsed.estimated_beneficiaries === "number" ? parsed.estimated_beneficiaries : null,
            procurement_method: parsed.procurement_method ?? null,
            esia_status: esia,
            start_date: parsed.start_date ?? null,
            expected_completion: parsed.expected_completion ?? null,
            status,
            approval_status: "pending",
            submitted_by: null,
            submitted_by_ai: true,
            ai_tag: aiTag,
          })
          .select("id")
          .single();
        if (pErr) {
          errors.push(`Insert project failed: ${pErr.message}`);
          continue;
        }

        const { error: sErr } = await admin.from("project_sources").insert({
          project_id: proj.id,
          added_by: null,
          source_type: "article",
          title: r.title || new URL(r.url).hostname,
          url: r.url,
          verified: false,
          approval_status: "pending",
          submitted_by_ai: true,
        });
        if (sErr) {
          errors.push(`Insert source failed: ${sErr.message}`);
          // Roll back the orphaned project so the DB stays clean.
          await admin.from("projects").delete().eq("id", proj.id);
        } else {
          inserted += 1;
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    return json({ inserted, skipped, errors });
  } catch (e) {
    console.error("ai-discover-projects error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
