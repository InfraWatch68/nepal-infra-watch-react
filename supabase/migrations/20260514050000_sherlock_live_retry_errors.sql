-- Live discovery: retry errored cells before advancing the cursor.
--
-- Symptom: a sweep_child run for Madhesh / Rautahat / Energy returned
-- `AI 429: All Mistral keys exhausted and no fallback provider configured`.
-- The live tick then advanced to Water & Sanitation, Agriculture & Irrigation,
-- etc., and the errored Energy cell was never retried — its data gap stayed
-- in the queue indefinitely until the operator noticed.
--
-- Existing logic: auto-stop in 20260514020000_sherlock_live_auto_stop.sql only
-- fires after 5 consecutive errors. A single transient AI/Tavily 429 burns one
-- cell silently.
--
-- Fix: before computing the next cell, check the last completed sweep_child
-- in this live session. If it errored AND we haven't already retried this
-- exact (province, district, sector) cell 3 times this session, re-enqueue
-- the same cell with `retry = N` in params, and DON'T advance the cursor.
-- After 3 attempts on the same cell, fall through to the normal advance —
-- the auto-stop guard still catches a sustained outage.
--
-- "Same cell" matches on params->>'province', params->>'district' (treating
-- NULL as ''), and params->'sectors' (a 1-element jsonb array). Counted from
-- v_state.started_at so a prior bad run doesn't poison a fresh Go Live.

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

  -- Auto-stop guard: if the last v_fail_window completed jobs in THIS live
  -- session all returned an error_text, give up. Bounded to jobs finished
  -- after state.started_at so a previous bad run doesn't poison a fresh start.
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

  -- Retry-the-errored-cell check. The last enqueued cell maps 1:1 with
  -- v_state.last_*, so we know which cell to re-attempt without re-deriving
  -- it from the job row. We do still inspect the job's error_text and count
  -- prior attempts on the same cell.
  IF v_state.started_at IS NOT NULL AND v_state.last_sector IS NOT NULL THEN
    SELECT error_text
    INTO v_last_err
    FROM public.sherlock_jobs
    WHERE finished_at IS NOT NULL
      AND finished_at >= v_state.started_at
    ORDER BY finished_at DESC
    LIMIT 1;

    IF v_last_err IS NOT NULL AND length(v_last_err) > 0 THEN
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
        -- Re-enqueue the same cell. Don't touch last_* — we're still on it.
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
          1,  -- higher priority than fresh cells so retries drain first
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
      -- Hit the cap on this cell — fall through to the normal advance below,
      -- abandoning the cell. The auto-stop guard still catches a sustained
      -- multi-cell outage.
    END IF;
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
