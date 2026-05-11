-- "Go Live" mode for Sherlock: when is_live=true, a separate cron feeds the
-- sweep_child queue with the next (province × [district] × sector) cell
-- every time the queue empties. Operator hits Stop Live to turn it off.
--
-- Singleton row (id=1) so cron logic doesn't need to pick "which live config".
-- The cursor fields (last_*) advance per tick so rotation is deterministic
-- and resumes correctly after a stop/start.

CREATE TABLE IF NOT EXISTS public.sherlock_live_state (
  id                 int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_live            boolean NOT NULL DEFAULT false,
  started_at         timestamptz,
  stopped_at         timestamptz,
  started_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  include_districts  boolean NOT NULL DEFAULT false,
  per_query_max      int NOT NULL DEFAULT 3 CHECK (per_query_max BETWEEN 1 AND 10),
  provinces          text[] NOT NULL DEFAULT '{}'::text[],  -- empty = all 7
  sectors            text[] NOT NULL DEFAULT '{}'::text[],  -- empty = all 9
  enqueued_count     int NOT NULL DEFAULT 0,
  last_province      text,
  last_district      text,
  last_sector        text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Seed singleton row.
INSERT INTO public.sherlock_live_state(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.sherlock_live_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read sherlock_live_state" ON public.sherlock_live_state;
CREATE POLICY "Public read sherlock_live_state" ON public.sherlock_live_state FOR SELECT USING (true);

DROP POLICY IF EXISTS "Moderators update sherlock_live_state" ON public.sherlock_live_state;
CREATE POLICY "Moderators update sherlock_live_state" ON public.sherlock_live_state FOR UPDATE
  USING (public.is_moderator(auth.uid())) WITH CHECK (public.is_moderator(auth.uid()));

-- ────────────────────────────────────────────────────────────────────────────
-- Live feed: each cron tick, if is_live=true AND the queue is empty, pick
-- the next combo (cursor-advanced) and enqueue a single sweep_child. Keeps
-- enqueue rate ≈ drain rate so we don't pile up work or starve the queue.
-- ────────────────────────────────────────────────────────────────────────────

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

  -- Only feed when queue empty so the drainer can finish in-flight work first.
  SELECT count(*) INTO v_pending FROM public.sherlock_jobs WHERE status IN ('queued','running');
  IF v_pending > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', format('queue not empty (%s pending)', v_pending));
  END IF;

  v_provs := CASE WHEN array_length(v_state.provinces, 1) IS NULL OR array_length(v_state.provinces, 1) = 0
                  THEN v_default_provs ELSE v_state.provinces END;
  v_secs  := CASE WHEN array_length(v_state.sectors, 1) IS NULL OR array_length(v_state.sectors, 1) = 0
                  THEN v_default_secs ELSE v_state.sectors END;

  -- Find where the cursor sits; default to first cell when not set or no
  -- longer in the configured lists.
  v_prov_idx := COALESCE(array_position(v_provs, v_state.last_province), 0);
  v_sec_idx  := COALESCE(array_position(v_secs,  v_state.last_sector), 0);

  IF v_state.include_districts THEN
    -- Build district list for the current cursor's province (or first if blank).
    IF v_prov_idx <= 0 THEN v_prov_idx := 1; END IF;
    v_next_prov := v_provs[v_prov_idx];
    SELECT array_agg(DISTINCT district ORDER BY district) INTO v_districts
    FROM public.municipalities WHERE province = v_next_prov;
    IF v_districts IS NULL OR array_length(v_districts, 1) = 0 THEN
      v_districts := ARRAY[NULL]::text[];  -- single null entry so we still emit one cell
    END IF;
    v_dist_idx := COALESCE(array_position(v_districts, v_state.last_district), 0);

    -- Advance (sector → district → province) so we cycle through sectors fastest.
    v_sec_idx := v_sec_idx + 1;
    IF v_sec_idx > array_length(v_secs, 1) THEN
      v_sec_idx := 1;
      v_dist_idx := v_dist_idx + 1;
      IF v_dist_idx > array_length(v_districts, 1) THEN
        v_dist_idx := 1;
        v_prov_idx := v_prov_idx + 1;
        IF v_prov_idx > array_length(v_provs, 1) THEN v_prov_idx := 1; END IF;
        -- Re-fetch districts for the new province.
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
    -- Province × sector rotation (sector advances first).
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

REVOKE ALL ON FUNCTION public.sherlock_live_feed_tick() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sherlock_live_feed_tick() TO postgres, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- Schedule: every minute. Same cadence as the drainer so live mode tightly
-- couples to drain throughput.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('sherlock-live-feed');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sherlock-live-feed',
  '* * * * *',
  $cron$ SELECT public.sherlock_live_feed_tick(); $cron$
);
