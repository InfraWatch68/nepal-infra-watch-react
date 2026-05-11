-- F1 follow-up: schedule Sherlock autonomous discovery via pg_cron.
--
-- Wires up:
--   1. pg_cron     — required for cron.schedule()
--   2. pg_net      — required for net.http_post()
--   3. public.sherlock_run_all_active() — server-side helper that posts to the
--      ai-discover-projects edge function for every active sherlock_filters row.
--   4. A scheduled cron job that calls the helper every 6 hours.
--
-- The function reads the Supabase URL and service role key from database-level
-- settings. After applying this migration, set them once via:
--
--     ALTER DATABASE postgres SET app.sherlock_url = 'https://<ref>.supabase.co';
--     ALTER DATABASE postgres SET app.sherlock_key = '<service_role_key>';
--
-- (These persist across reboots. The key is sensitive — only the postgres
-- superuser can read it via current_setting; pg_cron runs as superuser.)
--
-- If either setting is unset the function no-ops with a NOTICE so the schedule
-- can sit dormant until the operator wires the secrets in.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.sherlock_run_all_active()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url   text := current_setting('app.sherlock_url', true);
  v_key   text := current_setting('app.sherlock_key', true);
  v_filter record;
  v_request_id bigint;
  v_count int := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'sherlock_run_all_active: app.sherlock_url / app.sherlock_key not set — skipping';
    RETURN jsonb_build_object('skipped', true, 'reason', 'settings not configured');
  END IF;

  FOR v_filter IN
    SELECT id, label, topic, region, max_results
    FROM public.sherlock_filters
    WHERE active = true
    ORDER BY created_at ASC
  LOOP
    -- pg_net's http_post is fire-and-forget: it returns a request_id and the
    -- response lands in net._http_response asynchronously. We don't block on
    -- it — the edge function performs its own logging into the projects table
    -- and the SherlockManager UI surfaces last_run_at / last_inserted on the
    -- next page load.
    SELECT net.http_post(
      url := v_url || '/functions/v1/ai-discover-projects',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_strip_nulls(jsonb_build_object(
        'topic',      v_filter.topic,
        'region',     v_filter.region,
        'maxResults', v_filter.max_results,
        'aiTag',      'Sherlock'
      )),
      timeout_milliseconds := 60000
    ) INTO v_request_id;

    -- Stamp last_run_at immediately so the admin UI shows the cron heartbeat
    -- even though the actual inserted count is computed asynchronously.
    UPDATE public.sherlock_filters
    SET last_run_at = now()
    WHERE id = v_filter.id;

    v_count := v_count + 1;
    v_results := v_results || jsonb_build_object(
      'filter_id', v_filter.id,
      'label', v_filter.label,
      'request_id', v_request_id
    );
  END LOOP;

  RETURN jsonb_build_object('dispatched', v_count, 'requests', v_results);
END $$;

-- Only the postgres superuser (and Supabase's service role under the hood)
-- should be able to invoke this — it can fan out external HTTP calls.
REVOKE ALL ON FUNCTION public.sherlock_run_all_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sherlock_run_all_active() TO postgres;
GRANT EXECUTE ON FUNCTION public.sherlock_run_all_active() TO service_role;

-- Cron job: every 6 hours at minute 17 (offset away from typical :00 spikes).
-- Re-scheduling is idempotent — drop any prior schedule with the same name.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'sherlock-discover-every-6h';
EXCEPTION WHEN OTHERS THEN
  -- cron.unschedule raises if the job doesn't exist; swallow on first install.
  NULL;
END $$;

SELECT cron.schedule(
  'sherlock-discover-every-6h',
  '17 */6 * * *',
  $cron$ SELECT public.sherlock_run_all_active(); $cron$
);
