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

type FieldName = "coordinates" | "fiscal_year";
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type ProjectResult = {
  project_id: number;
  title: string | null;
  processed: boolean;
  enriched_coords: boolean;
  enriched_fy: boolean;
  skipped_reason?: "low_confidence" | "no_data" | "update_failed";
};

// Tavily rotate codes — keep 401 separate so an invalid key rotates without
// burning the rotation. 402/429/432/433 are real quota signals.
const TAVILY_ROTATE_CODES = new Set([401, 402, 429, 432, 433]);
const TAVILY_EXHAUST_CODES = new Set([402, 429, 432, 433]);
// Exhaustion codes for chat providers (Mistral, Google, Lovable)
const CHAT_EXHAUST_CODES = new Set([402, 429]);

async function tavily(admin: any, keys: string[], query: string) {
  let lastStatus = 0;
  for (let i = 0; i < keys.length; i++) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${keys[i]}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "advanced",
        max_results: 5,
        include_answer: false,
      }),
    });
    if (!TAVILY_ROTATE_CODES.has(res.status)) {
      markSucceeded(admin, "tavily", keys[i]).catch(() => {});
      return { res, keyIndex: i };
    }
    lastStatus = res.status;
    const body = await res.text().catch(() => "");
    if (TAVILY_EXHAUST_CODES.has(res.status)) {
      markExhausted(admin, "tavily", keys[i], `${res.status} ${body.slice(0, 100)}`).catch(() => {});
    }
    // 401 falls through: rotate without persisting exhaustion.
  }
  return { exhausted: true, lastStatus } as const;
}

async function callOpenAiCompatible(endpoint: string, key: string, model: string, messages: ChatMessage[]) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, response_format: { type: "json_object" } }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    return { kind: CHAT_EXHAUST_CODES.has(r.status) ? "exhausted" as const : "error" as const, status: r.status, body: body.slice(0, 500) };
  }
  const j = await r.json();
  return { kind: "ok" as const, text: (j.choices?.[0]?.message?.content ?? "") as string };
}

async function callChat(admin: any, messages: ChatMessage[]) {
  const providers = [
    {
      provider: "mistral" as const,
      endpoint: "https://api.mistral.ai/v1/chat/completions",
      model: "mistral-small-latest",
      keys: await getKeys(admin, "mistral"),
    },
    {
      provider: "google" as const,
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      model: "gemini-2.0-flash-lite",
      keys: await getKeys(admin, "google"),
    },
    {
      provider: "lovable" as const,
      endpoint: "https://ai.gateway.lovable.dev/v1/chat/completions",
      model: "google/gemini-2.0-flash",
      keys: await getKeys(admin, "lovable"),
    },
  ];

  for (const p of providers) {
    for (const key of p.keys) {
      const res = await callOpenAiCompatible(p.endpoint, key, p.model, messages);
      if (res.kind === "ok") {
        markSucceeded(admin, p.provider, key).catch(() => {});
        return { ok: true as const, text: res.text };
      }
      if (res.kind === "exhausted") {
        markExhausted(admin, p.provider, key, `${res.status} ${res.body.slice(0, 100)}`).catch(() => {});
        continue;
      }
      break;
    }
  }
  return { ok: false as const, error: "All AI providers exhausted or unavailable" };
}

function cleanFields(input: any): FieldName[] {
  const raw = Array.isArray(input?.fields) ? input.fields : [];
  const out: FieldName[] = [];
  if (raw.includes("coordinates")) out.push("coordinates");
  if (raw.includes("fiscal_year")) out.push("fiscal_year");
  return out;
}

function validCoords(value: any): { coordinates: string; latitude: number; longitude: number } | null {
  let lat: number | null = null;
  let lng: number | null = null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    const simple = trimmed.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    const hem = trimmed.match(/(-?\d+(?:\.\d+)?)\s*(?:deg|degrees|°)?\s*([NS])\s*[,;\s]+(-?\d+(?:\.\d+)?)\s*(?:deg|degrees|°)?\s*([EW])/i);
    const m = simple ?? hem;
    if (!m) return null;
    lat = Number(m[1]);
    lng = Number(m[3] ?? m[2]);
    if (hem) {
      if (String(m[2]).toUpperCase() === "S") lat = -lat;
      if (String(m[4]).toUpperCase() === "W") lng = -lng;
    }
  } else if (value && typeof value === "object") {
    lat = Number(value.lat ?? value.latitude);
    lng = Number(value.lng ?? value.lon ?? value.longitude);
  }

  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 26.3 || lat > 30.5 || lng < 80.0 || lng > 88.2) return null;
  return {
    coordinates: `${lat.toFixed(6).replace(/\.?0+$/, "")}, ${lng.toFixed(6).replace(/\.?0+$/, "")}`,
    latitude: Number(lat.toFixed(6)),
    longitude: Number(lng.toFixed(6)),
  };
}

function validFy(value: any): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^20\d{2}\/\d{2}$/.test(trimmed) ? trimmed : null;
}

const SYSTEM_PROMPT = `You are an information extraction system for Nepal infrastructure projects.
Return ONLY strict JSON:
{
  "coordinates": "lat, lng" | null,
  "fiscal_year": "YYYY/YY" | null,
  "confidence": 0.00-1.00,
  "sources": [{"url": string}]
}

Rules:
- Extract only facts supported by the supplied search excerpts.
- coordinates must be decimal degrees inside Nepal: lat 26.3-30.5, lng 80.0-88.2. Omit if not explicit.
- fiscal_year must be Nepali FY format such as "2081/82". Prefer explicit Nepali FY. Convert AD years to nearest Nepali FY only if unambiguous.
- confidence is overall confidence that the extracted values are correct.
- sources must contain URLs from the excerpts that support the value.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    // Prefer the explicit secret (works on new-key-format projects where
    // SUPABASE_SERVICE_ROLE_KEY auto-injection may be empty).
    const SERVICE_KEY =
      Deno.env.get("INFRA_SERVICE_ROLE_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    // Verify caller JWT using anon client + user JWT in headers (mirrors ai-verify-project).
    const userClient = createClient(SUPABASE_URL, ANON_KEY || jwt, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    // Service-role admin client for all RLS-bypass operations.
    if (!SERVICE_KEY) return json({ error: "Service key not configured" }, 500);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const isReviewer = (roles ?? []).some((r: any) =>
      r.role === "reviewer" || r.role === "coadmin" || r.role === "admin"
    );
    if (!isReviewer) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const fields = cleanFields(body);
    if (fields.length === 0) return json({ error: "fields must include coordinates or fiscal_year" }, 400);
    const limit = typeof body?.limit === "number" && body.limit > 0 ? Math.min(body.limit, 50) : 10;
    const projectId = typeof body?.projectId === "number" || typeof body?.project_id === "number"
      ? Number(body.projectId ?? body.project_id)
      : null;

    const { data: settings } = await admin
      .from("site_settings")
      .select("auto_approve_threshold")
      .eq("id", 1)
      .maybeSingle();
    const threshold = typeof (settings as any)?.auto_approve_threshold === "number"
      ? Number((settings as any).auto_approve_threshold)
      : 0.75;

    const tavilyKeys = await getKeys(admin, "tavily");
    if (tavilyKeys.length === 0) return json({ error: "No Tavily API keys configured" }, 500);

    const missingFilters: string[] = [];
    if (fields.includes("coordinates")) missingFilters.push("coordinates.is.null");
    if (fields.includes("fiscal_year")) missingFilters.push("fiscal_year.is.null");

    let rowQuery = admin
      .from("projects")
      .select("id, title, sector, province, district, coordinates, fiscal_year")
      .eq("approval_status", "approved")
      .or(missingFilters.join(","));
    if (projectId != null) rowQuery = rowQuery.eq("id", projectId);
    else rowQuery = rowQuery.order("id", { ascending: true }).limit(limit);

    const { data: rows, error: rowErr } = await rowQuery;
    if (rowErr) return json({ error: rowErr.message }, 500);

    let processed = 0;
    let enriched_projects = 0;
    let enriched_coords = 0;
    let enriched_fy = 0;
    let skipped_low_conf = 0;
    let skipped_no_data = 0;
    const project_results: ProjectResult[] = [];

    for (const project of (rows ?? []) as any[]) {
      const wantsCoords = fields.includes("coordinates") && project.coordinates == null;
      const wantsFy = fields.includes("fiscal_year") && project.fiscal_year == null;
      if (!wantsCoords && !wantsFy) continue;
      processed += 1;
      const result: ProjectResult = {
        project_id: Number(project.id),
        title: project.title ?? null,
        processed: true,
        enriched_coords: false,
        enriched_fy: false,
      };

      const query = `${project.title ?? ""} ${project.sector ?? ""} "${project.district ?? ""}" Nepal site:gov.np OR site:bolpatra.gov.np OR site:ppmo.gov.np`;
      const search = await tavily(admin, tavilyKeys, query);
      if ("exhausted" in search) return json({ error: `Tavily keys exhausted (${search.lastStatus})` }, 429);
      if (!search.res.ok) {
        skipped_no_data += 1;
        result.skipped_reason = "no_data";
        project_results.push(result);
        continue;
      }
      const searchJson = await search.res.json();
      const hits = ((searchJson.results ?? []) as any[])
        .filter(h => h?.url)
        .slice(0, 5)
        .map((h, i) => `### [${i + 1}] ${h.title ?? ""}\nURL: ${h.url}\n${String(h.content ?? "").slice(0, 1500)}`)
        .join("\n\n");
      if (!hits) {
        skipped_no_data += 1;
        result.skipped_reason = "no_data";
        project_results.push(result);
        continue;
      }

      const requested = [
        wantsCoords ? "coordinates" : null,
        wantsFy ? "fiscal_year" : null,
      ].filter(Boolean).join(", ");
      const userPrompt =
        `Project:\n` +
        `id: ${project.id}\n` +
        `title: ${project.title ?? ""}\n` +
        `sector: ${project.sector ?? ""}\n` +
        `province: ${project.province ?? ""}\n` +
        `district: ${project.district ?? ""}\n` +
        `requested_missing_fields: ${requested}\n\n` +
        `Search excerpts:\n${hits}`;

      const ai = await callChat(admin, [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ]);
      if (!ai.ok) return json({ error: ai.error }, 500);

      const parsed = tryParseJsonObject<any>(ai.text ?? "");
      if (!parsed.ok) {
        skipped_no_data += 1;
        result.skipped_reason = "no_data";
        project_results.push(result);
        continue;
      }
      const confidence = typeof parsed.value.confidence === "number" ? parsed.value.confidence : 0;
      const coords = wantsCoords ? validCoords(parsed.value.coordinates) : null;
      const fy = wantsFy ? validFy(parsed.value.fiscal_year) : null;
      if (confidence < threshold) {
        if (coords || fy) skipped_low_conf += 1;
        else skipped_no_data += 1;
        result.skipped_reason = coords || fy ? "low_confidence" : "no_data";
        project_results.push(result);
        continue;
      }
      const patch: Record<string, string | number> = {};
      if (coords) {
        patch.coordinates = coords.coordinates;
        patch.latitude = coords.latitude;
        patch.longitude = coords.longitude;
      }
      if (fy) patch.fiscal_year = fy;
      if (Object.keys(patch).length === 0) {
        skipped_no_data += 1;
        result.skipped_reason = "no_data";
        project_results.push(result);
        continue;
      }

      const { error: updateErr } = await admin.from("projects").update(patch).eq("id", project.id);
      if (updateErr) {
        skipped_no_data += 1;
        result.skipped_reason = "update_failed";
        project_results.push(result);
        continue;
      }
      enriched_projects += 1;
      if (patch.coordinates) {
        enriched_coords += 1;
        result.enriched_coords = true;
      }
      if (patch.fiscal_year) {
        enriched_fy += 1;
        result.enriched_fy = true;
      }
      project_results.push(result);
    }

    return json({ ok: true, processed, enriched_projects, enriched_coords, enriched_fy, skipped_low_conf, skipped_no_data, project_results });
  } catch (e) {
    console.error("ai-enrich-coords-fy error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
