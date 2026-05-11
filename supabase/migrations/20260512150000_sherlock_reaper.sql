-- Sherlock v2 follow-up: reap stuck `running` jobs.
--
-- Symptom that prompted this: a user-initiated geo job bundling 9 sectors ran
-- past the edge-function wall-time limit (~150s free / ~400s pro). The
-- function was killed mid-execution, so neither the success branch nor the
-- catch branch in ai-discover-projects ever wrote `done`/`failed` back. The
-- row sat at `status='running'` indefinitely, blocking the admin queue UI's
-- "running" indicator from clearing.
--
-- Fix: a small reaper that scans every minute and flips any `running` row
-- older than 5 minutes (started_at < now() - 5 min) to `failed` with an
-- explanatory note. Five minutes comfortably exceeds any realistic happy-path
-- runtime — even a fully-loaded sweep_child (1 sector × 10 results) finishes
-- well under 3 minutes — so this only catches genuinely abandoned rows.

CREATE OR REPLACE FUNCTION public.sherlock_reap_stuck_jobs(p_max_minutes int DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  WITH reaped AS (
    UPDATE public.sherlock_jobs
    SET status = 'failed',
        finished_at = now(),
        error_text = COALESCE(error_text, '')
          || CASE WHEN COALESCE(error_text, '') = '' THEN '' ELSE E'\n' END
          || format(
               'Reaped by sherlock_reap_stuck_jobs: row was running for %ss without writeback (edge-function wall-time exceeded).',
               EXTRACT(EPOCH FROM (now() - started_at))::int
             )
    WHERE status = 'running'
      AND started_at IS NOT NULL
      AND started_at < now() - make_interval(mins => p_max_minutes)
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM reaped;

  RETURN jsonb_build_object('reaped', v_count, 'max_minutes', p_max_minutes);
END $$;

REVOKE ALL ON FUNCTION public.sherlock_reap_stuck_jobs(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sherlock_reap_stuck_jobs(int) TO postgres, service_role;

-- Schedule: every minute. Cheap (single indexed UPDATE on rows where status='running').
DO $$
BEGIN
  PERFORM cron.unschedule('sherlock-reap-stuck-jobs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sherlock-reap-stuck-jobs',
  '* * * * *',
  $cron$ SELECT public.sherlock_reap_stuck_jobs(5); $cron$
);
