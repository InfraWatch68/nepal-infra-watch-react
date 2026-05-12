// send-alert: callable by both the admin UI (Go Live toggle) and the
// projects-milestone DB trigger (via pg_net). Auth supports two modes:
//   1) User JWT — must belong to a moderator (admin/coadmin/reviewer)
//   2) X-Internal-Token header — must match INTERNAL_NOTIFIER_TOKEN env
//
// Body:
//   { kind: AlertKind, ...arbitrary details }
//
// Returns { sent: bool, reason?: string } from sendAlert().

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendAlert, type AlertKind } from "../_shared/notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_TOKEN = Deno.env.get("INTERNAL_NOTIFIER_TOKEN") ?? "";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Internal-trigger path: the DB trigger sends X-Internal-Token. If it
  // matches, skip user auth and trust the body.
  const internalToken = req.headers.get("X-Internal-Token") ?? "";
  const isInternal = INTERNAL_TOKEN.length > 0 && internalToken === INTERNAL_TOKEN;

  let actor = "trigger";
  if (!isInternal) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u.user) return json({ error: "Unauthorized" }, 401);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
    const allowed = (roles ?? []).some((r: { role: string }) =>
      r.role === "admin" || r.role === "coadmin" || r.role === "reviewer"
    );
    if (!allowed) return json({ error: "Forbidden" }, 403);
    actor = u.user.email ?? u.user.id;
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const kind = body.kind as AlertKind;

  let subject: string;
  let text: string;
  let cooldownMinutes = 30;

  if (kind === "go_live_on") {
    subject = "Sherlock Go Live turned ON";
    text = [
      subject,
      "",
      `Operator: ${actor}`,
      `At: ${new Date().toISOString()}`,
      body.note ? `Note: ${body.note}` : "",
    ].filter(Boolean).join("\n");
    cooldownMinutes = 5;
  } else if (kind === "go_live_off") {
    subject = "Sherlock Go Live turned OFF";
    text = [
      subject,
      "",
      `Operator: ${actor}`,
      `At: ${new Date().toISOString()}`,
      body.reason ? `Reason: ${body.reason}` : "",
    ].filter(Boolean).join("\n");
    cooldownMinutes = 5;
  } else if (kind === "projects_milestone_500") {
    const milestone = body.milestone ?? 0;
    const total = body.total ?? 0;
    subject = `Nepal Infra Watch crossed ${milestone} projects`;
    text = [
      subject,
      "",
      `The site now has ${total} non-rejected projects.`,
      `Milestone: ${milestone}`,
      `Triggered: ${new Date().toISOString()}`,
    ].join("\n");
    cooldownMinutes = 0;
  } else if (kind === "tavily_exhausted") {
    subject = "Tavily API keys exhausted";
    text = [
      subject,
      "",
      `Trigger: ${actor}`,
      `Reason: ${body.reason ?? "unknown"}`,
      `Context: ${body.context ?? ""}`,
      `At: ${new Date().toISOString()}`,
    ].join("\n");
  } else if (kind === "mistral_exhausted") {
    subject = "Mistral / AI keys exhausted";
    text = [
      subject,
      "",
      `Trigger: ${actor}`,
      `Status: ${body.status ?? ""}`,
      `Detail: ${body.detail ?? ""}`,
      `At: ${new Date().toISOString()}`,
    ].join("\n");
  } else {
    return json({ error: `unsupported kind: ${kind}` }, 400);
  }

  const result = await sendAlert(admin, kind, subject, text, {
    cooldownMinutes,
    details: { actor, ...body },
  });
  return json(result);
});
