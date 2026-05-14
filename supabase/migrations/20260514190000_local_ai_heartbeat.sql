-- Heartbeat timestamps for the two long-running local-AI workflows. The
-- claim columns (golive_session_id / livecheck_session_id) get set on Step
-- 0 and cleared on the prompt's release step. But if the admin kills the
-- AI process externally (terminal SIGINT, browser tab close, host crash),
-- the release step never runs and the columns stay forever — the panel's
-- "Stop" buttons stick around showing a session that nothing is actually
-- driving.
--
-- The fix: each prompt now PATCHes its heartbeat column on every cell
-- (Go Live) / cycle (Live Check), and the panel treats a stale heartbeat
-- (>5min old) as evidence the AI is gone and auto-clears the claim.
--
-- Idempotent.

ALTER TABLE public.sherlock_live_state
  ADD COLUMN IF NOT EXISTS golive_heartbeat_at    timestamptz,
  ADD COLUMN IF NOT EXISTS livecheck_heartbeat_at timestamptz;
