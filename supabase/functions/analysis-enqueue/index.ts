// Phase 1 of the Project Data Hub revamp. This is the thin enqueue endpoint
// for "Run AI Analysis". Validates that the caller is a reviewer-or-above,
// inserts a project_analysis_runs row + analysis_jobs row in one short
// request, and returns the ids. No Tavily, no AI, no waiting — the heavy
// lifting happens in analysis-drain (called from pg_cron).
//
// Duplicate-prevention is delegated to the partial unique index
// `analysis_jobs_one_active_per_project` (status IN ('queued','running')).
// A 23505 unique-violation maps to a clean 409 so the UI can say
// "an analysis is already in flight for this project".

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    // Auth via user JWT (so RLS applies for the runs/jobs inserts below).
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const { data: roles } = await userClient.from("user_roles").select("role").eq("user_id", userId);
    const isReviewer = (roles ?? []).some((r: any) =>
      r.role === "reviewer" || r.role === "coadmin" || r.role === "admin"
    );
    if (!isReviewer) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const projectId = Number(body.projectId);
    if (!Number.isFinite(projectId) || projectId <= 0) return json({ error: "projectId required" }, 400);

    // Confirm project exists (service role to avoid RLS noise) — saves a
    // confusing FK error downstream when callers mistype the id.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: project, error: pErr } = await admin.from("projects").select("id, title").eq("id", projectId).maybeSingle();
    if (pErr) return json({ error: pErr.message }, 500);
    if (!project) return json({ error: "Project not found" }, 404);

    // Insert run first — its id is referenced by the job. Both go through the
    // user JWT client so RLS gates the writes (the moderator-insert policy
    // on both tables consumes is_moderator(auth.uid())).
    const { data: runRow, error: runErr } = await userClient
      .from("project_analysis_runs")
      .insert({ project_id: projectId, status: "queued", invoked_by: userId })
      .select("id")
      .single();
    if (runErr) return json({ error: `Could not create run: ${runErr.message}` }, 500);

    const { data: jobRow, error: jobErr } = await userClient
      .from("analysis_jobs")
      .insert({ project_id: projectId, run_id: runRow.id, status: "queued", enqueued_by: userId })
      .select("id")
      .single();

    if (jobErr) {
      // Unique-violation on the partial index → an active job already exists.
      // Clean up the orphan run row we just created and return 409.
      const isDup = jobErr.code === "23505" || /one_active_per_project/.test(jobErr.message || "");
      if (isDup) {
        await admin.from("project_analysis_runs").delete().eq("id", runRow.id);
        return json({ error: "An analysis is already in flight for this project", code: "ALREADY_RUNNING" }, 409);
      }
      // Other error: clean up the orphan run too.
      await admin.from("project_analysis_runs").delete().eq("id", runRow.id);
      return json({ error: `Could not enqueue: ${jobErr.message}` }, 500);
    }

    return json({ ok: true, jobId: jobRow.id, runId: runRow.id, projectId, projectTitle: project.title });
  } catch (e) {
    console.error("analysis-enqueue error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
