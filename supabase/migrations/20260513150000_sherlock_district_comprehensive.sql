-- Sherlock follow-up: per-district fan-out option for sweeps. When
-- include_districts=true the enqueue functions loop over every district in
-- each included province (sourced from public.municipalities) and emit one
-- (province × district × sector) sweep_child per cell. Without this flag
-- the original (province × sector) behaviour is unchanged.
--
-- Cap raised from 50 → 500 so a 2-province district sweep (~20-30 districts
-- × 9 sectors = 180-270 cells) actually completes instead of getting
-- truncated. At the 1-job/min drain rate a 270-cell run takes ~4.5h.

ALTER TABLE public.sherlock_sweeps
  ADD COLUMN IF NOT EXISTS include_districts boolean NOT NULL DEFAULT false;

-- Updated sherlock_enqueue_sweep — cron-driven path. Accepts the new flag
-- via the sweep row; same signature so the trigger-installed cron jobs keep
-- working without re-registration.
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

  v_provs := CASE WHEN array_length(v_sweep.provinces, 1) IS NULL OR array_length(v_sweep.provinces, 1) = 0
                  THEN v_default_provs ELSE v_sweep.provinces END;
  v_secs  := CASE WHEN array_length(v_sweep.sectors,   1) IS NULL OR array_length(v_sweep.sectors,   1) = 0
                  THEN v_default_secs  ELSE v_sweep.sectors  END;

  IF v_sweep.include_districts THEN
    SELECT count(*) INTO v_district_count
    FROM (SELECT DISTINCT district FROM public.municipalities WHERE province = ANY(v_provs)) d;
    v_total := v_district_count * array_length(v_secs, 1);

    FOREACH v_prov IN ARRAY v_provs LOOP
      FOR v_dist IN
        SELECT DISTINCT district FROM public.municipalities WHERE province = v_prov ORDER BY district
      LOOP
        FOREACH v_sec IN ARRAY v_secs LOOP
          EXIT WHEN v_count >= v_cap;
          INSERT INTO public.sherlock_jobs(kind, params, sweep_id, priority)
          VALUES (
            'sweep_child',
            jsonb_build_object(
              'province', v_prov,
              'district', v_dist,
              'sectors', jsonb_build_array(v_sec),
              'maxResults', v_sweep.per_query_max
            ),
            p_sweep_id,
            0
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
          p_sweep_id,
          0
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

-- Updated sherlock_run_sweep_now — manual "Run now" path. Same fan-out logic
-- as above, plus the moderator gate + bypass of the enabled flag (so
-- spot-checking a paused sweep still works).
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

  v_provs := CASE WHEN array_length(v_sweep.provinces, 1) IS NULL OR array_length(v_sweep.provinces, 1) = 0
                  THEN v_default_provs ELSE v_sweep.provinces END;
  v_secs  := CASE WHEN array_length(v_sweep.sectors,   1) IS NULL OR array_length(v_sweep.sectors,   1) = 0
                  THEN v_default_secs  ELSE v_sweep.sectors  END;

  IF v_sweep.include_districts THEN
    SELECT count(*) INTO v_district_count
    FROM (SELECT DISTINCT district FROM public.municipalities WHERE province = ANY(v_provs)) d;
    v_total := v_district_count * array_length(v_secs, 1);

    FOREACH v_prov IN ARRAY v_provs LOOP
      FOR v_dist IN
        SELECT DISTINCT district FROM public.municipalities WHERE province = v_prov ORDER BY district
      LOOP
        FOREACH v_sec IN ARRAY v_secs LOOP
          EXIT WHEN v_count >= v_cap;
          INSERT INTO public.sherlock_jobs(kind, params, sweep_id, priority, enqueued_by)
          VALUES (
            'sweep_child',
            jsonb_build_object(
              'province', v_prov,
              'district', v_dist,
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
