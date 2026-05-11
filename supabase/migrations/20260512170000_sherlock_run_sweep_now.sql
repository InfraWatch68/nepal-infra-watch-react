-- Sherlock v2 UX: "Run now" button for scheduled sweeps.
--
-- Before this, the only way to fire a sweep ahead of its cadence was running
-- `SELECT public.sherlock_enqueue_sweep(<id>);` in the SQL editor, or flipping
-- a separate SMOKE-TEST row. Both are clunky.
--
-- This adds `public.sherlock_run_sweep_now(uuid)` — a moderator-gated RPC
-- that fans the same (province × sector) combos into `sherlock_jobs` as the
-- cron-triggered path. It deliberately ignores the `enabled` flag so an
-- operator can spot-check a paused config without registering a real
-- pg_cron job for it.
--
-- The cron-called `sherlock_enqueue_sweep(uuid)` is untouched so its
-- behaviour (skip when disabled, write last_run_note) stays exactly as
-- scheduled sweeps expect.

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
  v_count         int := 0;
  v_cap           int := 50;
  v_provs         text[];
  v_secs          text[];
  v_total         int;
  v_default_provs text[] := ARRAY['Koshi','Madhesh','Bagmati','Gandaki','Lumbini','Karnali','Sudurpashchim'];
  v_default_secs  text[] := ARRAY['Transport','Energy','Water & Sanitation','Agriculture & Irrigation','Health','Education','Telecom','Urban Development','Tourism'];
BEGIN
  IF NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised: moderator role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sweep FROM public.sherlock_sweeps WHERE id = p_sweep_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sweep not found');
  END IF;

  v_provs := CASE WHEN array_length(v_sweep.provinces, 1) IS NULL OR array_length(v_sweep.provinces, 1) = 0
                  THEN v_default_provs ELSE v_sweep.provinces END;
  v_secs  := CASE WHEN array_length(v_sweep.sectors,   1) IS NULL OR array_length(v_sweep.sectors,   1) = 0
                  THEN v_default_secs  ELSE v_sweep.sectors  END;
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
        p_sweep_id,
        5, -- between sweep_child(0) and user-geo(10): manual sweep should beat scheduled but defer to direct geo seeds
        auth.uid()
      );
      v_count := v_count + 1;
    END LOOP;
    EXIT WHEN v_count >= v_cap;
  END LOOP;

  -- Note this on the sweep itself so the operator sees when it last ran (manual or scheduled).
  UPDATE public.sherlock_sweeps SET
    last_run_at = now(),
    last_run_note = CASE
      WHEN v_count = v_total THEN format('manual: enqueued %s combos', v_count)
      ELSE format('manual: enqueued %s of %s combos (capped at %s)', v_count, v_total, v_cap)
    END
  WHERE id = p_sweep_id;

  RETURN jsonb_build_object(
    'enqueued', v_count,
    'total_combos', v_total,
    'cap', v_cap,
    'enabled', v_sweep.enabled
  );
END $$;

REVOKE ALL ON FUNCTION public.sherlock_run_sweep_now(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sherlock_run_sweep_now(uuid) TO authenticated, service_role;
