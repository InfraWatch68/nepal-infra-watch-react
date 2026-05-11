-- Sherlock v2 follow-up: drain the queue every minute instead of every 2 min.
--
-- The original */2 cadence (20260512130000_sherlock_queue_and_sweeps.sql) was
-- chosen defensively. After the geo-seed work that splits user-initiated jobs
-- into one row per sector (SherlockManager.tsx GeoDiscoverTab.enqueue), a
-- single "all sectors of Madhesh" seed becomes 9 queued rows. At */2 that
-- would take 18 min wall-clock to drain — a poor UX given each job actually
-- runs in ~30-60s at the edge.
--
-- Rate-limit headroom check: a single drained job kicks off at most 1 sector
-- × maxResults (default 3, max 10) AI calls plus 1 Tavily call. At
-- maxResults=3 that's 3 AI calls per drained job. Even draining every minute
-- yields ~3 RPM against Mistral's 30 RPM free-tier ceiling — 10x headroom.
-- The internal 2.5s pacing inside ai-discover-projects keeps within-job
-- burst RPS bounded regardless.

DO $do$
BEGIN
  PERFORM cron.unschedule('sherlock-drain-queue');
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;

SELECT cron.schedule(
  'sherlock-drain-queue',
  '* * * * *',
  $cron$ SELECT public.sherlock_drain_queue_once(); $cron$
);
