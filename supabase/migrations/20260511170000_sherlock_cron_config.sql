-- F1 follow-up: read Sherlock cron secrets from Supabase Vault.
--
-- Why this instead of GUCs: Supabase's Management API SQL role cannot run
-- ALTER DATABASE, so `current_setting('app.sherlock_url')` is impractical to
-- populate without direct psql access. Vault is the recommended encrypted
-- secrets store, the service_role JWT can read decrypted values, and writes
-- go through `vault.create_secret(...)` (callable via the Management API).
--
-- Secret names used:
--   * sherlock_supabase_url
--   * sherlock_service_key
-- These are populated by a one-time INSERT against vault.secrets / vault.create_secret.

CREATE OR REPLACE FUNCTION public.sherlock_run_all_active()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_url   text;
  v_key   text;
  v_filter record;
  v_request_id bigint;
  v_count int := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'sherlock_supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'sherlock_service_key' LIMIT 1;

  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'sherlock_run_all_active: vault secrets sherlock_supabase_url / sherlock_service_key not set — skipping';
    RETURN jsonb_build_object('skipped', true, 'reason', 'vault secrets missing');
  END IF;

  FOR v_filter IN
    SELECT id, label, topic, region, max_results
    FROM public.sherlock_filters
    WHERE active = true
    ORDER BY created_at ASC
  LOOP
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

    UPDATE public.sherlock_filters SET last_run_at = now() WHERE id = v_filter.id;
    v_count := v_count + 1;
    v_results := v_results || jsonb_build_object(
      'filter_id', v_filter.id,
      'label', v_filter.label,
      'request_id', v_request_id
    );
  END LOOP;

  RETURN jsonb_build_object('dispatched', v_count, 'requests', v_results);
END $$;

REVOKE ALL ON FUNCTION public.sherlock_run_all_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sherlock_run_all_active() TO postgres;
GRANT EXECUTE ON FUNCTION public.sherlock_run_all_active() TO service_role;
