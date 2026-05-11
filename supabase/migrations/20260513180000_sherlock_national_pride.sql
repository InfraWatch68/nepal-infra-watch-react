-- Sherlock "National Pride" mode. When a sweep / live config has
-- national_pride=true, instead of fanning out per (province × sector), one
-- single sweep_child is enqueued with `nationalPride: true` in its params.
-- The ai-discover-projects edge function reads that flag and rotates through
-- the 24-name list from supabase/functions/_shared/national_pride.ts —
-- targeted Tavily queries, force-labels every resulting project with
-- projects.national_pride = true.
--
-- This is more efficient than the per-cell fan-out: 1 job covers up to 8
-- NP projects per invocation instead of 63 (province × sector) cells each
-- searching for 1-2 matches.

ALTER TABLE public.sherlock_sweeps
  ADD COLUMN IF NOT EXISTS national_pride boolean NOT NULL DEFAULT false;

ALTER TABLE public.sherlock_live_state
  ADD COLUMN IF NOT EXISTS national_pride boolean NOT NULL DEFAULT false;

-- sherlock_enqueue_sweep — cron-driven. NP path short-circuits the
-- province × sector loop.
CREATE OR REPLACE FUNCTION public.sherlock_enqueue_sweep(p_sweep_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sweep         record;
  v_prov          text;
  v_sec           text;
  v_dist          text;
  v_count         int := 0;
  v_cap           int := 500;
  v_provs         text[];
  v_secs          text[];
  v_total         int;
  v_default_provs text[] := ARRAY['Koshi','Madhesh','Bagmati','Gandaki','Lumbini','Karnali','Sudurpashchim'];
  v_default_secs  text[] := ARRAY['Transport','Energy','Water & Sanitation','Agriculture & Irrigation','Health','Education','Telecom','Urban Development','Tourism'];
  v_district_count int;
BEGIN
  SELECT * INTO v_sweep FROM public.sherlock_sweeps WHERE id = p_sweep_id;
  IF NOT FOUND OR NOT v_sweep.enabled THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not found or disabled');
  END IF;

  -- ── National Pride mode: one job, function iterates the 24-name list. ──
  IF v_sweep.national_pride THEN
    INSERT INTO public.sherlock_jobs(kind, params, sweep_id, priority)
    VALUES (
      'sweep_child',
      jsonb_build_object(
        'nationalPride', true,
        'maxResults', v_sweep.per_query_max,
        -- Pass any filters too, so e.g. an "NP + Energy" sweep narrows the 24.
        'sectors', CASE WHEN array_length(v_sweep.sectors, 1) > 0 THEN to_jsonb(v_sweep.sectors) ELSE NULL END,
        'province', CASE WHEN array_length(v_sweep.provinces, 1) = 1 THEN v_sweep.provinces[1] ELSE NULL END
      ),
      p_sweep_id,
      0
    );
    UPDATE public.sherlock_sweeps SET
      last_run_at = now(),
      last_run_note = 'enqueued 1 National Pride scan job'
    WHERE id = p_sweep_id;
    RETURN jsonb_build_object('enqueued', 1, 'mode', 'national_pride');
  END IF;

  v_provs := CASE WHEN array_length(v_sweep.provinces, 1) IS NULL OR array_length(v_sweep.provinces, 1) = 0
                  THEN v_default_provs ELSE v_sweep.provinces END;
  v_secs  := CASE WHEN array_length(v_sweep.sectors,   1) IS NULL OR array_length(v_sweep.sectors,   1) = 0
                  THEN v_default_secs  ELSE v_sweep.sectors  END;

  IF v_sweep.include_districts THEN
    SELECT count(*) INTO v_district_count
    FROM (SELECT DISTINCT district FROM public.municipalities WHERE province = ANY(v_provs)) d;
    v_total := v_district_count * array_length(v_secs, 1);

    FOREACH v_prov IN ARRAY v_provs LOOP
      FOR v_dist IN SELECT DISTINCT district FROM public.municipalities WHERE province = v_prov ORDER BY district LOOP
        FOREACH v_sec IN ARRAY v_secs LOOP
          EXIT WHEN v_count >= v_cap;
          INSERT INTO public.sherlock_jobs(kind, params, sweep_id, priority)
          VALUES (
            'sweep_child',
            jsonb_build_object(
              'province', v_prov, 'district', v_dist,
              'sectors', jsonb_build_array(v_sec),
              'maxResults', v_sweep.per_query_max
            ),
            p_sweep_id, 0
          );
          v_count := v_count + 1;
        END LOOP;
        EXIT WHEN v_count >= v_cap;
      END LOOP;
      EXIT WHEN v_count >= v_cap;
    END LOOP;
  ELSE
    v_total := array_length(v_provs, 1) * array_length(v_secs, 1);
    FOREACH v_prov IN ARRAY v_provs LOOP
      FOREACH v_sec IN ARRAY v_secs LOOP
        EXIT WHEN v_count >= v_cap;
        INSERT INTO public.sherlock_jobs(kind, params, sweep_id, priority)
        VALUES (
          'sweep_child',
          jsonb_build_object(
            'province', v_prov,
            'sectors', jsonb_build_array(v_sec),
            'maxResults', v_sweep.per_query_max
          ),
          p_sweep_id, 0
        );
        v_count := v_count + 1;
      END LOOP;
      EXIT WHEN v_count >= v_cap;
    END LOOP;
  END IF;

  UPDATE public.sherlock_sweeps SET
    last_run_at = now(),
    last_run_note = CASE
      WHEN v_count = v_total THEN format('enqueued %s combos', v_count)
      ELSE format('enqueued %s of %s combos (capped at %s)', v_count, v_total, v_cap)
    END
  WHERE id = p_sweep_id;

  RETURN jsonb_build_object('enqueued', v_count, 'total_combos', v_total, 'cap', v_cap, 'district_mode', v_sweep.include_districts);
END $$;

REVOKE ALL ON FUNCTION public.sherlock_enqueue_sweep(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sherlock_enqueue_sweep(uuid) TO postgres, service_role;

-- sherlock_run_sweep_now — manual "Run now". Same NP short-circuit.
CREATE OR REPLACE FUNCTION public.sherlock_run_sweep_now(p_sweep_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sweep         record;
  v_prov          text;
  v_sec           text;
  v_dist          text;
  v_count         int := 0;
  v_cap           int := 500;
  v_provs         text[];
  v_secs          text[];
  v_total         int;
  v_default_provs text[] := ARRAY['Koshi','Madhesh','Bagmati','Gandaki','Lumbini','Karnali','Sudurpashchim'];
  v_default_secs  text[] := ARRAY['Transport','Energy','Water & Sanitation','Agriculture & Irrigation','Health','Education','Telecom','Urban Development','Tourism'];
  v_district_count int;
BEGIN
  IF NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised: moderator role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sweep FROM public.sherlock_sweeps WHERE id = p_sweep_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sweep not found');
  END IF;

  IF v_sweep.national_pride THEN
    INSERT INTO public.sherlock_jobs(kind, params, sweep_id, priority, enqueued_by)
    VALUES (
      'sweep_child',
      jsonb_build_object(
        'nationalPride', true,
        'maxResults', v_sweep.per_query_max,
        'sectors', CASE WHEN array_length(v_sweep.sectors, 1) > 0 THEN to_jsonb(v_sweep.sectors) ELSE NULL END,
        'province', CASE WHEN array_length(v_sweep.provinces, 1) = 1 THEN v_sweep.provinces[1] ELSE NULL END
      ),
      p_sweep_id, 5, auth.uid()
    );
    UPDATE public.sherlock_sweeps SET
      last_run_at = now(),
      last_run_note = 'manual: enqueued 1 National Pride scan job'
    WHERE id = p_sweep_id;
    RETURN jsonb_build_object('enqueued', 1, 'mode', 'national_pride', 'enabled', v_sweep.enabled);
  END IF;

  v_provs := CASE WHEN array_length(v_sweep.provinces, 1) IS NULL OR array_length(v_sweep.provinces, 1) = 0
                  THEN v_default_provs ELSE v_sweep.provinces END;
  v_secs  := CASE WHEN array_length(v_sweep.sectors,   1) IS NULL OR array_length(v_sweep.sectors,   1) = 0
                  THEN v_default_secs  ELSE v_sweep.sectors  END;

  IF v_sweep.include_districts THEN
    SELECT count(*) INTO v_district_count
    FROM (SELECT DISTINCT district FROM public.municipalities WHERE province = ANY(v_provs)) d;
    v_total := v_district_count * array_length(v_secs, 1);

    FOREACH v_prov IN ARRAY v_provs LOOP
      FOR v_dist IN SELECT DISTINCT district FROM public.municipalities WHERE province = v_prov ORDER BY district LOOP
        FOREACH v_sec IN ARRAY v_secs LOOP
          EXIT WHEN v_count >= v_cap;
          INSERT INTO public.sherlock_jobs(kind, params, sweep_id, priority, enqueued_by)
          VALUES (
            'sweep_child',
            jsonb_build_object(
              'province', v_prov, 'district', v_dist,
              'sectors', jsonb_build_array(v_sec),
              'maxResults', v_sweep.per_query_max
            ),
            p_sweep_id, 5, auth.uid()
          );
          v_count := v_count + 1;
        END LOOP;
        EXIT WHEN v_count >= v_cap;
      END LOOP;
      EXIT WHEN v_count >= v_cap;
    END LOOP;
  ELSE
    v_total := array_length(v_provs, 1) * array_length(v_secs, 1);
    FOREACH v_prov IN ARRAY v_provs LOOP
      FOREACH v_sec IN ARRAY v_secs LOOP
        EXIT WHEN v_count >= v_cap;
        INSERT INTO public.sherlock_jobs(kind, params, sweep_id, priority, enqueued_by)
        VALUES (
          'sweep_child',
          jsonb_build_object(
            'province', v_prov,
            'sectors', jsonb_build_array(v_sec),
            'maxResults', v_sweep.per_query_max
          ),
          p_sweep_id, 5, auth.uid()
        );
        v_count := v_count + 1;
      END LOOP;
      EXIT WHEN v_count >= v_cap;
    END LOOP;
  END IF;

  UPDATE public.sherlock_sweeps SET
    last_run_at = now(),
    last_run_note = CASE
      WHEN v_count = v_total THEN format('manual: enqueued %s combos', v_count)
      ELSE format('manual: enqueued %s of %s combos (capped at %s)', v_count, v_total, v_cap)
    END
  WHERE id = p_sweep_id;

  RETURN jsonb_build_object('enqueued', v_count, 'total_combos', v_total, 'cap', v_cap, 'enabled', v_sweep.enabled, 'district_mode', v_sweep.include_districts);
END $$;

REVOKE ALL ON FUNCTION public.sherlock_run_sweep_now(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sherlock_run_sweep_now(uuid) TO authenticated, service_role;

-- sherlock_live_feed_tick — Live mode. In NP mode, each tick enqueues an NP
-- scan job (which itself rotates 8 names internally). Cursor advances by
-- count only — no province/sector indices needed.
CREATE OR REPLACE FUNCTION public.sherlock_live_feed_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state         record;
  v_pending       int;
  v_provs         text[];
  v_secs          text[];
  v_prov_idx      int;
  v_sec_idx       int;
  v_next_prov     text;
  v_next_sec      text;
  v_next_dist     text;
  v_districts     text[];
  v_dist_idx      int;
  v_default_provs text[] := ARRAY['Koshi','Madhesh','Bagmati','Gandaki','Lumbini','Karnali','Sudurpashchim'];
  v_default_secs  text[] := ARRAY['Transport','Energy','Water & Sanitation','Agriculture & Irrigation','Health','Education','Telecom','Urban Development','Tourism'];
BEGIN
  SELECT * INTO v_state FROM public.sherlock_live_state WHERE id = 1;
  IF NOT FOUND OR NOT v_state.is_live THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not live');
  END IF;

  SELECT count(*) INTO v_pending FROM public.sherlock_jobs WHERE status IN ('queued','running');
  IF v_pending > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', format('queue not empty (%s pending)', v_pending));
  END IF;

  -- ── NP mode: each tick fires one National Pride scan job. ──
  IF v_state.national_pride THEN
    INSERT INTO public.sherlock_jobs(kind, params, priority, enqueued_by)
    VALUES (
      'sweep_child',
      jsonb_build_object('nationalPride', true, 'maxResults', v_state.per_query_max, 'liveMode', true),
      0, v_state.started_by
    );
    UPDATE public.sherlock_live_state SET
      enqueued_count = enqueued_count + 1, updated_at = now()
    WHERE id = 1;
    RETURN jsonb_build_object('enqueued', 1, 'mode', 'national_pride');
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
    SELECT array_agg(DISTINCT district ORDER BY district) INTO v_districts FROM public.municipalities WHERE province = v_next_prov;
    IF v_districts IS NULL OR array_length(v_districts, 1) = 0 THEN v_districts := ARRAY[NULL]::text[]; END IF;
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
        SELECT array_agg(DISTINCT district ORDER BY district) INTO v_districts FROM public.municipalities WHERE province = v_next_prov;
        IF v_districts IS NULL OR array_length(v_districts, 1) = 0 THEN v_districts := ARRAY[NULL]::text[]; END IF;
      END IF;
    END IF;
    v_next_prov := v_provs[v_prov_idx];
    v_next_dist := v_districts[v_dist_idx];
    v_next_sec  := v_secs[v_sec_idx];

    INSERT INTO public.sherlock_jobs(kind, params, priority, enqueued_by)
    VALUES ('sweep_child', jsonb_build_object('province', v_next_prov, 'district', v_next_dist, 'sectors', jsonb_build_array(v_next_sec), 'maxResults', v_state.per_query_max, 'liveMode', true), 0, v_state.started_by);
  ELSE
    v_sec_idx := v_sec_idx + 1;
    IF v_sec_idx > array_length(v_secs, 1) THEN
      v_sec_idx := 1;
      v_prov_idx := v_prov_idx + 1;
      IF v_prov_idx > array_length(v_provs, 1) THEN v_prov_idx := 1; END IF;
    ELSIF v_prov_idx <= 0 THEN v_prov_idx := 1;
    END IF;
    v_next_prov := v_provs[v_prov_idx];
    v_next_sec  := v_secs[v_sec_idx];

    INSERT INTO public.sherlock_jobs(kind, params, priority, enqueued_by)
    VALUES ('sweep_child', jsonb_build_object('province', v_next_prov, 'sectors', jsonb_build_array(v_next_sec), 'maxResults', v_state.per_query_max, 'liveMode', true), 0, v_state.started_by);
  END IF;

  UPDATE public.sherlock_live_state SET
    last_province = v_next_prov, last_district = v_next_dist, last_sector = v_next_sec,
    enqueued_count = enqueued_count + 1, updated_at = now()
  WHERE id = 1;

  RETURN jsonb_build_object('enqueued', 1, 'province', v_next_prov, 'district', v_next_dist, 'sector', v_next_sec);
END $$;

REVOKE ALL ON FUNCTION public.sherlock_live_feed_tick() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sherlock_live_feed_tick() TO postgres, service_role;
