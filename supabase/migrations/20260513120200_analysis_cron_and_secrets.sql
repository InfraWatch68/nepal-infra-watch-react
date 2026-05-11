-- Wire up the cron drainer + stuck-job reaper for analysis_jobs. Mirrors the
-- pattern in 20260512130000_sherlock_queue_and_sweeps.sql + 20260512150000_sherlock_reaper.sql.
--
-- Secrets are reused from `public.sherlock_secrets` (singleton id=1 row with
-- url + key) — same Supabase project URL + service-role key both queues need.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ────────────────────────────────────────────────────────────────────────────
-- Drainer: picks one queued analysis_jobs row, flips to running, fires
-- analysis-drain via pg_net. The edge function writes status + counts back.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.analysis_drain_once()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    text;
  v_key    text;
  v_job    record;
  v_body   jsonb;
  v_req_id bigint;
BEGIN
  SELECT url, key INTO v_url, v_key FROM public.sherlock_secrets WHERE id = 1;
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'analysis_drain_once: sherlock_secrets not configured — skipping';
    RETURN jsonb_build_object('skipped', true, 'reason', 'secrets not configured');
  END IF;

  SELECT * INTO v_job
  FROM public.analysis_jobs
  WHERE status = 'queued'
  ORDER BY enqueued_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('drained', 0);
  END IF;

  UPDATE public.analysis_jobs
  SET status = 'running', started_at = now(), attempts = attempts + 1
  WHERE id = v_job.id;

  UPDATE public.project_analysis_runs
  SET status = 'running'
  WHERE id = v_job.run_id;

  v_body := jsonb_build_object(
    'jobId', v_job.id::text,
    'runId', v_job.run_id::text,
    'projectId', v_job.project_id
  );

  SELECT net.http_post(
    url := v_url || '/functions/v1/analysis-drain',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := v_body,
    timeout_milliseconds := 120000
  ) INTO v_req_id;

  RETURN jsonb_build_object('drained', 1, 'job_id', v_job.id, 'request_id', v_req_id);
END $$;

REVOKE ALL ON FUNCTION public.analysis_drain_once() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analysis_drain_once() TO postgres, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- Reaper: any analysis_jobs row stuck in `running` past 10 min is failed.
-- Same shape as sherlock_reap_stuck_jobs but a longer grace (10 min vs 5)
-- because analysis work fans 5 Tavily buckets + 1 AI extraction sequentially
-- and reasonably uses more wall time than Sherlock's 1-sector jobs.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.analysis_reap_stuck_jobs(p_max_minutes int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_reaped uuid[];
BEGIN
  WITH reaped AS (
    UPDATE public.analysis_jobs
    SET status = 'failed',
        finished_at = now(),
        last_error = COALESCE(last_error, '')
          || CASE WHEN COALESCE(last_error, '') = '' THEN '' ELSE E'\n' END
          || format(
               'Reaped by analysis_reap_stuck_jobs: row was running for %ss without writeback (edge-function wall-time exceeded).',
               EXTRACT(EPOCH FROM (now() - started_at))::int
             )
    WHERE status = 'running'
      AND started_at IS NOT NULL
      AND started_at < now() - make_interval(mins => p_max_minutes)
    RETURNING id, run_id
  ),
  reaped_runs AS (
    UPDATE public.project_analysis_runs r
    SET status = 'failed',
        finished_at = now(),
        errors = array_append(r.errors, 'reaped: edge-function wall-time exceeded')
    FROM reaped
    WHERE r.id = reaped.run_id
    RETURNING r.id
  )
  SELECT count(*), array_agg(id) INTO v_count, v_reaped FROM reaped;

  RETURN jsonb_build_object('reaped', v_count, 'max_minutes', p_max_minutes, 'ids', COALESCE(to_jsonb(v_reaped), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.analysis_reap_stuck_jobs(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analysis_reap_stuck_jobs(int) TO postgres, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- Crons: drainer every 1 min, reaper every 1 min.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('analysis-drain-queue');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'analysis-drain-queue',
  '* * * * *',
  $cron$ SELECT public.analysis_drain_once(); $cron$
);

DO $$
BEGIN
  PERFORM cron.unschedule('analysis-reap-stuck-jobs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'analysis-reap-stuck-jobs',
  '* * * * *',
  $cron$ SELECT public.analysis_reap_stuck_jobs(10); $cron$
);
