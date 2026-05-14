-- Split sherlock_live_state.local_session_id into per-workflow columns so
-- a local Go Live sweep and a Local Live-Check loop can run concurrently
-- without overwriting each other's session claim.
--
-- Each long-running local workflow now writes to its own column on the
-- singleton row id=1:
--   golive_session_id     - batch id of the currently-running local Go Live
--   golive_started_at     - when that session began
--   livecheck_session_id  - batch id of the currently-running Live Check
--   livecheck_started_at  - when that session began
--
-- The kill-switch logic each prompt runs checks ITS OWN column. The panel's
-- Stop button targets a specific workflow.
--
-- Idempotent.

ALTER TABLE public.sherlock_live_state
  ADD COLUMN IF NOT EXISTS golive_session_id    text,
  ADD COLUMN IF NOT EXISTS golive_started_at    timestamptz,
  ADD COLUMN IF NOT EXISTS livecheck_session_id text,
  ADD COLUMN IF NOT EXISTS livecheck_started_at timestamptz;
