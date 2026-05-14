-- Shared Go Live state between server-side Sherlock Live (the every-minute
-- cron) and the new Local AI Go Live workflow.
--
-- Both modes will now read and write the same cursor row so progress hands
-- off cleanly when admins switch between server and local sweeps mid-run.
--
-- New columns (all nullable so the existing singleton row stays valid):
--   last_advanced_by   text  - server or local: which side last bumped
--                              last_province/sector
--   last_advanced_at   timestamptz - when the last bump happened
--   local_session_id   text  - batch id of the currently-active local
--                              Go Live session; null when no local session
--                              is in flight
--   local_started_at   timestamptz - when the local session began
--
-- Idempotent.

ALTER TABLE public.sherlock_live_state
  ADD COLUMN IF NOT EXISTS last_advanced_by  text,
  ADD COLUMN IF NOT EXISTS last_advanced_at  timestamptz,
  ADD COLUMN IF NOT EXISTS local_session_id  text,
  ADD COLUMN IF NOT EXISTS local_started_at  timestamptz;
