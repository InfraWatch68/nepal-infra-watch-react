-- Live discovery: don't retry reaper-killed cells.
--
-- The retry-on-error logic in 20260514050000_sherlock_live_retry_errors.sql
-- re-enqueues an errored cell up to 3 times per session, on the assumption
-- that errors are transient (Tavily 429, Mistral 429, JSON parse hiccup).
-- That assumption breaks for "Reaped by sherlock_reap_stuck_jobs: row was
-- running for 300s+" errors — those mean the edge function hit its hard
-- wall-time, and retrying the SAME cell with the SAME params will hit the
-- same wall-time on the same article corpus. Three retries = ~15 minutes
-- burned doing nothing.
--
-- Symptom: Madhesh / Saptari / Energy was reaped at 360s, then auto-retried,
-- then reaped again at 300s, then retried again — every cycle wastes a
-- live-tick slot and a Mistral key budget. Burns the queue without progress.
--
-- Fix: treat error_text starting with "Reaped by" as terminal — fall through
-- to the normal cursor advance instead of re-enqueueing. The cell becomes
-- a permanent gap (operator can manually re-queue from the UI with smaller
-- maxResults if they want that specific cell covered).

CREATE OR REPLACE FUNCTION public.sherlock_live_feed_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state          record;
  v_pending        int;
  v_recent_total   int;
  v_recent_err     int;
  v_provs          text[];
  v_secs           text[];
  v_prov_idx       int;
  v_sec_idx        int;
  v_next_prov      text;
  v_next_sec       text;
  v_next_dist      text;
  v_districts      text[];
  v_dist_idx       int;
  v_last_err       text;
  v_last_prov      text;
  v_last_dist      text;
  v_last_sec_jsonb jsonb;
  v_retry_attempts int;
  v_default_provs  text[] := ARRAY['Koshi','Madhesh','Bagmati','Gandaki','Lumbini','Karnali','Sudurpashchim'];
  v_default_secs   text[] := ARRAY['Transport','Energy','Water & Sanitation','Agriculture & Irrigation','Health','Education','Telecom','Urban Development','Tourism'];
  v_fail_window    int := 5;
  v_retry_cap      int := 3;
BEGIN
  SELECT * INTO v_state FROM public.sherlock_live_state WHERE id = 1;
  IF NOT FOUND OR NOT v_state.is_live THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not live');
  END IF;

  -- Only feed when queue empty so the drainer can finish in-flight work first.
  SELECT count(*) INTO v_pending FROM public.sherlock_jobs WHERE status IN ('queued','running');
  IF v_pending > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', format('queue not empty (%s pending)', v_pending));
  END IF;

  -- Auto-stop guard: 5 consecutive failed jobs in this session → give up.
  IF v_state.started_at IS NOT NULL THEN
    WITH recent AS (
      SELECT error_text
      FROM public.sherlock_jobs
      WHERE finished_at IS NOT NULL
        AND finished_at >= v_state.started_at
        AND status IN ('done','failed')
      ORDER BY finished_at DESC
      LIMIT v_fail_window
    )
    SELECT count(*), count(*) FILTER (WHERE error_text IS NOT NULL AND length(error_text) > 0)
    INTO v_recent_total, v_recent_err
    FROM recent;

    IF v_recent_total >= v_fail_window AND v_recent_err = v_recent_total THEN
      UPDATE public.sherlock_live_state SET
        is_live             = false,
        stopped_at          = now(),
        last_stopped_reason = format('Auto-stopped after %s consecutive failed runs (last error: %s)',
                                     v_fail_window,
                                     (SELECT left(error_text, 200)
                                      FROM public.sherlock_jobs
                                      WHERE finished_at IS NOT NULL
                                        AND finished_at >= v_state.started_at
                                        AND error_text IS NOT NULL
                                      ORDER BY finished_at DESC LIMIT 1)),
        updated_at          = now()
      WHERE id = 1;
      RETURN jsonb_build_object('skipped', true, 'reason', 'auto-stopped (consecutive failures)');
    END IF;
  END IF;

  -- Retry-the-errored-cell check. Skips reaper kills (wall-time exhaustion
  -- won't get fixed by re-running the same params on the same corpus).
  IF v_state.started_at IS NOT NULL AND v_state.last_sector IS NOT NULL THEN
    SELECT error_text
    INTO v_last_err
    FROM public.sherlock_jobs
    WHERE finished_at IS NOT NULL
      AND finished_at >= v_state.started_at
    ORDER BY finished_at DESC
    LIMIT 1;

    IF v_last_err IS NOT NULL
       AND length(v_last_err) > 0
       AND v_last_err NOT LIKE 'Reaped by%' THEN
      v_last_prov      := v_state.last_province;
      v_last_dist      := v_state.last_district;
      v_last_sec_jsonb := jsonb_build_array(v_state.last_sector);

      SELECT count(*) INTO v_retry_attempts
      FROM public.sherlock_jobs
      WHERE finished_at IS NOT NULL
        AND finished_at >= v_state.started_at
        AND kind = 'sweep_child'
        AND error_text IS NOT NULL AND length(error_text) > 0
        AND (params->>'province') IS NOT DISTINCT FROM v_last_prov
        AND (params->>'district') IS NOT DISTINCT FROM v_last_dist
        AND (params->'sectors')   = v_last_sec_jsonb;

      IF v_retry_attempts < v_retry_cap THEN
        INSERT INTO public.sherlock_jobs(kind, params, priority, enqueued_by)
        VALUES (
          'sweep_child',
          jsonb_build_object(
            'province',   v_last_prov,
            'district',   v_last_dist,
            'sectors',    v_last_sec_jsonb,
            'maxResults', v_state.per_query_max,
            'liveMode',   true,
            'retry',      v_retry_attempts
          ),
          1,
          v_state.started_by
        );
        UPDATE public.sherlock_live_state SET
          enqueued_count = enqueued_count + 1,
          updated_at     = now()
        WHERE id = 1;
        RETURN jsonb_build_object(
          'enqueued',  1,
          'retry',     v_retry_attempts + 1,
          'cap',       v_retry_cap,
          'province',  v_last_prov,
          'district',  v_last_dist,
          'sector',    v_state.last_sector,
          'reason',    left(v_last_err, 200)
        );
      END IF;
      -- Hit the cap on this cell — fall through to advance.
    END IF;
    -- "Reaped by" errors also fall through to advance.
  END IF;

  v_provs := CASE WHEN array_length(v_state.provinces, 1) IS NULL OR array_length(v_state.provinces, 1) = 0
                  THEN v_default_provs ELSE v_state.provinces END;
  v_secs  := CASE WHEN array_length(v_state.sectors, 1) IS NULL OR array_length(v_state.sectors, 1) = 0
                  THEN v_default_secs ELSE v_state.sectors END;

  v_prov_idx := COALESCE(array_position(v_provs, v_state.last_province), 0);
  v_sec_idx  := COALESCE(array_position(v_secs,  v_state.last_sector), 0);

  IF v_state.include_districts THEN
    IF v_prov_idx <= 0 THEN v_prov_idx := 1; END IF;
    v_next_prov := v_provs[v_prov_idx];
    SELECT array_agg(DISTINCT district ORDER BY district) INTO v_districts
    FROM public.municipalities WHERE province = v_next_prov;
    IF v_districts IS NULL OR array_length(v_districts, 1) = 0 THEN
      v_districts := ARRAY[NULL]::text[];
    END IF;
    v_dist_idx := COALESCE(array_position(v_districts, v_state.last_district), 0);

    v_sec_idx := v_sec_idx + 1;
    IF v_sec_idx > array_length(v_secs, 1) THEN
      v_sec_idx := 1;
      v_dist_idx := v_dist_idx + 1;
      IF v_dist_idx > array_length(v_districts, 1) THEN
        v_dist_idx := 1;
        v_prov_idx := v_prov_idx + 1;
        IF v_prov_idx > array_length(v_provs, 1) THEN v_prov_idx := 1; END IF;
        v_next_prov := v_provs[v_prov_idx];
        SELECT array_agg(DISTINCT district ORDER BY district) INTO v_districts
        FROM public.municipalities WHERE province = v_next_prov;
        IF v_districts IS NULL OR array_length(v_districts, 1) = 0 THEN
          v_districts := ARRAY[NULL]::text[];
        END IF;
      END IF;
    END IF;
    v_next_prov := v_provs[v_prov_idx];
    v_next_dist := v_districts[v_dist_idx];
    v_next_sec  := v_secs[v_sec_idx];

    INSERT INTO public.sherlock_jobs(kind, params, priority, enqueued_by)
    VALUES (
      'sweep_child',
      jsonb_build_object(
        'province', v_next_prov,
        'district', v_next_dist,
        'sectors', jsonb_build_array(v_next_sec),
        'maxResults', v_state.per_query_max,
        'liveMode', true
      ),
      0,
      v_state.started_by
    );
  ELSE
    v_sec_idx := v_sec_idx + 1;
    IF v_sec_idx > array_length(v_secs, 1) THEN
      v_sec_idx := 1;
      v_prov_idx := v_prov_idx + 1;
      IF v_prov_idx > array_length(v_provs, 1) THEN v_prov_idx := 1; END IF;
    ELSIF v_prov_idx <= 0 THEN
      v_prov_idx := 1;
    END IF;
    v_next_prov := v_provs[v_prov_idx];
    v_next_sec  := v_secs[v_sec_idx];

    INSERT INTO public.sherlock_jobs(kind, params, priority, enqueued_by)
    VALUES (
      'sweep_child',
      jsonb_build_object(
        'province', v_next_prov,
        'sectors', jsonb_build_array(v_next_sec),
        'maxResults', v_state.per_query_max,
        'liveMode', true
      ),
      0,
      v_state.started_by
    );
  END IF;

  UPDATE public.sherlock_live_state SET
    last_province  = v_next_prov,
    last_district  = v_next_dist,
    last_sector    = v_next_sec,
    enqueued_count = enqueued_count + 1,
    updated_at     = now()
  WHERE id = 1;

  RETURN jsonb_build_object('enqueued', 1, 'province', v_next_prov, 'district', v_next_dist, 'sector', v_next_sec);
END $$;
