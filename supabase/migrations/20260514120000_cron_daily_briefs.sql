-- Daily AI brief generation cron job. Fires at 23:15 UTC (= 05:00 NPT)
-- every day, POSTs to /functions/v1/generate-daily-briefs which fans out
-- to 8 ai-generate-global-brief calls (1 national + 7 provincial),
-- then emails a consolidated digest to ALERT_EMAIL via Resend.
--
-- Reuses the same app.sherlock_url / app.sherlock_key settings that the
-- existing Sherlock cron uses — operator only needs to set these once.
-- (See 20260511160000_sherlock_pg_cron.sql for the original setup.)
--
-- NPT is UTC+05:45, so 05:00 NPT = 23:15 UTC the previous calendar day.
-- pg_cron uses UTC throughout; the cron expression "15 23 * * *" fires at
-- 23:15 UTC daily.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.run_daily_briefs_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := current_setting('app.sherlock_url', true);
  v_key text := current_setting('app.sherlock_key', true);
  v_request_id bigint;
BEGIN
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'run_daily_briefs_now: app.sherlock_url / app.sherlock_key not set — skipping';
    RETURN jsonb_build_object('skipped', true, 'reason', 'settings not configured');
  END IF;

  -- Fire-and-forget POST. The edge function takes 30-90s to fan out across
  -- 8 scopes; pg_net is async so we don't block the cron worker.
  SELECT net.http_post(
    url := v_url || '/functions/v1/generate-daily-briefs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN jsonb_build_object('dispatched', true, 'request_id', v_request_id, 'at', now());
END $$;

REVOKE ALL ON FUNCTION public.run_daily_briefs_now() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_daily_briefs_now() TO postgres;
GRANT EXECUTE ON FUNCTION public.run_daily_briefs_now() TO service_role;

-- Idempotent reschedule: drop any prior schedule with the same name.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'daily-briefs-5am-nepal';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'daily-briefs-5am-nepal',
  '15 23 * * *',  -- 23:15 UTC = 05:00 NPT
  $cron$ SELECT public.run_daily_briefs_now(); $cron$
);
