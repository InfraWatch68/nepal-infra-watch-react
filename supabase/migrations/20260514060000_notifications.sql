-- Email notifications: log table + 500-projects milestone trigger.
--
-- Operator-facing alerts are sent from the `send-alert` edge function via
-- Resend. This migration provides:
--   1) `notification_log` — append-only audit of which alerts fired when,
--      used by _shared/notify.ts for cooldown ("don't email twice in 30 min").
--   2) `internal_notifier_config` — singleton row holding the send-alert URL
--      and a shared secret that the projects-milestone trigger passes to
--      authenticate as a "server-side caller" (no user session).
--   3) `notify_projects_milestone()` trigger on `projects` AFTER INSERT —
--      fires an alert each time the total project count crosses a 500
--      boundary. Catches every insert source (AI, manual, analysis-drain).
--
-- The internal_token / send_alert_url values are seeded here; the matching
-- INTERNAL_NOTIFIER_TOKEN goes into Supabase secrets so the edge function
-- can verify the header. Both are bootstrapped by the deploy script.

create extension if not exists pg_net;

create table if not exists public.notification_log (
  id      bigserial primary key,
  kind    text not null,
  details jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now()
);
create index if not exists idx_notification_log_kind_sent_at
  on public.notification_log (kind, sent_at desc);
alter table public.notification_log enable row level security;
-- No SELECT policy by default — service role bypasses RLS for the edge fn.

create table if not exists public.internal_notifier_config (
  id              int primary key default 1 check (id = 1),
  send_alert_url  text,
  internal_token  text
);
insert into public.internal_notifier_config (id) values (1) on conflict do nothing;
alter table public.internal_notifier_config enable row level security;

-- ────────────────────────────────────────────────────────────────────────────
-- 500-projects milestone trigger.
--
-- After each INSERT on projects, count total non-rejected rows. If we crossed
-- a new 500-multiple since the last `projects_milestone_500` log entry, fire
-- an email via pg_net to the send-alert edge function. The log row is written
-- BEFORE the http_post so concurrent inserts can't double-fire (the next
-- trigger run will see the milestone already recorded and skip).
--
-- Counts exclude `rejected` — those rows aren't "added to the site" in any
-- meaningful sense. Approved + pending + changes_requested all count.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_projects_milestone()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count          int;
  v_milestone      int;
  v_last_milestone int;
  v_config         record;
  v_request_id     bigint;
begin
  if coalesce(new.approval_status, '') = 'rejected' then
    return new;
  end if;

  select count(*) into v_count
  from public.projects
  where coalesce(approval_status, '') <> 'rejected';

  v_milestone := (v_count / 500) * 500;
  if v_milestone = 0 then
    return new;
  end if;

  select coalesce(max((details->>'milestone')::int), 0) into v_last_milestone
  from public.notification_log
  where kind = 'projects_milestone_500';

  if v_milestone <= v_last_milestone then
    return new;
  end if;

  -- Record first to lock out concurrent triggers.
  insert into public.notification_log (kind, details)
  values ('projects_milestone_500', jsonb_build_object(
    'milestone', v_milestone,
    'total',     v_count,
    'triggered_at', now()
  ));

  -- Fire-and-forget HTTP call to send-alert. Failures are swallowed in
  -- pg_net (returns a request id; non-fatal if the function is down).
  select * into v_config from public.internal_notifier_config where id = 1;
  if v_config.send_alert_url is not null and v_config.internal_token is not null then
    select net.http_post(
      url     := v_config.send_alert_url,
      headers := jsonb_build_object(
        'Content-Type',     'application/json',
        'X-Internal-Token', v_config.internal_token
      ),
      body    := jsonb_build_object(
        'kind',      'projects_milestone_500',
        'milestone', v_milestone,
        'total',     v_count,
        'internal',  true
      )
    ) into v_request_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_notify_projects_milestone on public.projects;
create trigger trg_notify_projects_milestone
  after insert on public.projects
  for each row execute function public.notify_projects_milestone();
