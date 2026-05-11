// DEPRECATED — kept as a thin forwarding alias so any external/scripted
// callers using the old endpoint name still work. The current UI calls
// `analysis-enqueue` directly (see ComprehensiveSections.tsx).
//
// The original synchronous Tavily + AI pipeline was moved to
// supabase/functions/analysis-drain (called by pg_cron through
// analysis_drain_once()), with `analysis-enqueue` as the user-facing
// thin endpoint. Remove this alias once we're confident no external
// callers reference it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.text();
  const upstream = await fetch(`${SUPABASE_URL}/functions/v1/analysis-enqueue`, {
    method: "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json" },
    body,
  });

  const text = await upstream.text();
  // Preserve status + body so callers see exactly what analysis-enqueue returned.
  return new Response(text, {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      "X-Deprecation-Notice": "ai-comprehensive-analysis is deprecated; call analysis-enqueue directly",
    },
  });
});
