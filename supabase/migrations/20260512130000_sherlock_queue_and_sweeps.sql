-- Sherlock v2: async job queue + scheduled sweeps.
--
-- Replaces the single every-6h discovery cron (20260511160000_sherlock_pg_cron.sql)
-- with three primitives:
--
--   1. sherlock_jobs   — persistent queue of discovery jobs (topic / geo / sweep_child).
--                        Every "Run" in the admin UI becomes an enqueue.
--   2. sherlock_sweeps — operator-configured scheduled sweeps. A BEFORE trigger
--                        on the table calls cron.schedule()/cron.unschedule() so
--                        each enabled sweep gets its own pg_cron job. We let
--                        pg_cron parse the cadence expression instead of writing
--                        a cron parser in plpgsql.
--   3. sherlock_drain_queue_once() — picks the oldest queued job and fires
--                        ai-discover-projects via pg_net (every 2 minutes via cron).
--
-- Operator pre-requisites (already set for the prior 6h cron):
--   ALTER DATABASE postgres SET app.sherlock_url = 'https://<ref>.supabase.co';
--   ALTER DATABASE postgres SET app.sherlock_key = '<service_role_key>';

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ────────────────────────────────────────────────────────────────────────────
-- Job queue
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sherlock_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('topic','geo','sweep_child')),
  params       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  inserted     integer,
  skipped      integer,
  error_text   text,
  priority     integer NOT NULL DEFAULT 0,  -- higher drains first; user-initiated geo defaults to 10, sweep_child to 0
  enqueued_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  sweep_id     uuid  -- link back to the sweep that spawned a sweep_child job
);

CREATE INDEX IF NOT EXISTS idx_sherlock_jobs_drain
  ON public.sherlock_jobs(status, priority DESC, enqueued_at ASC)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_sherlock_jobs_sweep
  ON public.sherlock_jobs(sweep_id) WHERE sweep_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sherlock_jobs_recent
  ON public.sherlock_jobs(enqueued_at DESC);

ALTER TABLE public.sherlock_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Moderators manage sherlock_jobs" ON public.sherlock_jobs;
CREATE POLICY "Moderators manage sherlock_jobs" ON public.sherlock_jobs FOR ALL
  USING (public.is_moderator(auth.uid()))
  WITH CHECK (public.is_moderator(auth.uid()));

-- ────────────────────────────────────────────────────────────────────────────
-- Scheduled sweeps
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sherlock_sweeps (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label          text NOT NULL,
  enabled        boolean NOT NULL DEFAULT true,
  cadence        text NOT NULL,  -- raw cron expression, e.g. '17 */6 * * *'
  provinces      text[] NOT NULL DEFAULT '{}'::text[],  -- empty = all 7
  sectors        text[] NOT NULL DEFAULT '{}'::text[],  -- empty = all 9
  per_query_max  integer NOT NULL DEFAULT 3 CHECK (per_query_max BETWEEN 1 AND 10),
  cron_job_id    bigint,  -- pg_cron jobid, set by sherlock_apply_sweep()
  last_run_at    timestamptz,
  last_run_note  text,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sherlock_sweeps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Moderators manage sherlock_sweeps" ON public.sherlock_sweeps;
CREATE POLICY "Moderators manage sherlock_sweeps" ON public.sherlock_sweeps FOR ALL
  USING (public.is_moderator(auth.uid()))
  WITH CHECK (public.is_moderator(auth.uid()));

-- ────────────────────────────────────────────────────────────────────────────
-- Sweep fan-out: enqueue (province × sector) child jobs, capped at 50.
-- Called by the per-sweep pg_cron job that sherlock_apply_sweep() registers.
-- ────────────────────────────────────────────────────────────────────────────

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
  v_count         int := 0;
  v_cap           int := 50;
  v_provs         text[];
  v_secs          text[];
  v_total         int;
  v_default_provs text[] := ARRAY['Koshi','Madhesh','Bagmati','Gandaki','Lumbini','Karnali','Sudurpashchim'];
  v_default_secs  text[] := ARRAY['Transport','Energy','Water & Sanitation','Agriculture & Irrigation','Health','Education','Telecom','Urban Development','Tourism'];
BEGIN
  SELECT * INTO v_sweep FROM public.sherlock_sweeps WHERE id = p_sweep_id;
  IF NOT FOUND OR NOT v_sweep.enabled THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not found or disabled');
  END IF;

  v_provs := CASE WHEN array_length(v_sweep.provinces, 1) IS NULL OR array_length(v_sweep.provinces, 1) = 0
                  THEN v_default_provs ELSE v_sweep.provinces END;
  v_secs  := CASE WHEN array_length(v_sweep.sectors,   1) IS NULL OR array_length(v_sweep.sectors,   1) = 0
                  THEN v_default_secs  ELSE v_sweep.sectors  END;
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

  UPDATE public.sherlock_sweeps SET
    last_run_at = now(),
    last_run_note = CASE
      WHEN v_count = v_total THEN format('enqueued %s combos', v_count)
      ELSE format('enqueued %s of %s combos (capped at %s)', v_count, v_total, v_cap)
    END
  WHERE id = p_sweep_id;

  RETURN jsonb_build_object('enqueued', v_count, 'total_combos', v_total, 'cap', v_cap);
END $$;

REVOKE ALL ON FUNCTION public.sherlock_enqueue_sweep(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sherlock_enqueue_sweep(uuid) TO postgres, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- Queue drain: pull the oldest queued job, flip to running, fire pg_net.
-- The edge function writes inserted/skipped/status back via service-role.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sherlock_drain_queue_once()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url      text := current_setting('app.sherlock_url', true);
  v_key      text := current_setting('app.sherlock_key', true);
  v_job      record;
  v_body     jsonb;
  v_req_id   bigint;
BEGIN
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'sherlock_drain_queue_once: app.sherlock_url / app.sherlock_key not set — skipping';
    RETURN jsonb_build_object('skipped', true, 'reason', 'settings not configured');
  END IF;

  -- Pick one queued job, lock for update, skip if another tick beat us to it.
  SELECT * INTO v_job
  FROM public.sherlock_jobs
  WHERE status = 'queued'
  ORDER BY priority DESC, enqueued_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('drained', 0);
  END IF;

  UPDATE public.sherlock_jobs
  SET status = 'running', started_at = now()
  WHERE id = v_job.id;

  v_body := v_job.params || jsonb_build_object(
    'aiTag', 'Sherlock',
    'jobId', v_job.id::text
  );

  SELECT net.http_post(
    url := v_url || '/functions/v1/ai-discover-projects',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := v_body,
    timeout_milliseconds := 120000
  ) INTO v_req_id;

  RETURN jsonb_build_object('drained', 1, 'job_id', v_job.id, 'request_id', v_req_id);
END $$;

REVOKE ALL ON FUNCTION public.sherlock_drain_queue_once() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sherlock_drain_queue_once() TO postgres, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- Sweep lifecycle trigger: keep one pg_cron job per enabled sweep in sync
-- with the sherlock_sweeps row. Lets pg_cron handle cadence parsing — we just
-- forward the operator's cron string.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sherlock_apply_sweep()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_name      text;
  v_new_jobid bigint;
BEGIN
  -- Tear down the previous schedule (if any) on UPDATE or DELETE.
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.cron_job_id IS NOT NULL THEN
    BEGIN
      PERFORM cron.unschedule(OLD.cron_job_id);
    EXCEPTION WHEN OTHERS THEN
      -- Job may have already been removed; that's fine.
      NULL;
    END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.enabled THEN
    v_name := 'sherlock-sweep-' || NEW.id::text;
    SELECT cron.schedule(
      v_name,
      NEW.cadence,
      format('SELECT public.sherlock_enqueue_sweep(%L::uuid);', NEW.id)
    ) INTO v_new_jobid;
    NEW.cron_job_id := v_new_jobid;
  ELSE
    NEW.cron_job_id := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sherlock_apply_sweep_bi ON public.sherlock_sweeps;
CREATE TRIGGER trg_sherlock_apply_sweep_bi
BEFORE INSERT OR UPDATE OF enabled, cadence ON public.sherlock_sweeps
FOR EACH ROW EXECUTE FUNCTION public.sherlock_apply_sweep();

DROP TRIGGER IF EXISTS trg_sherlock_apply_sweep_bd ON public.sherlock_sweeps;
CREATE TRIGGER trg_sherlock_apply_sweep_bd
BEFORE DELETE ON public.sherlock_sweeps
FOR EACH ROW EXECUTE FUNCTION public.sherlock_apply_sweep();

-- ────────────────────────────────────────────────────────────────────────────
-- Replace the old every-6h job with the new drain tick.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('sherlock-discover-every-6h');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('sherlock-drain-queue');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sherlock-drain-queue',
  '*/2 * * * *',
  $cron$ SELECT public.sherlock_drain_queue_once(); $cron$
);

-- ────────────────────────────────────────────────────────────────────────────
-- Default sweep — mirrors the prior 6h all-Nepal cadence so existing operator
-- behaviour is preserved. Operator can disable or retune via the admin UI.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.sherlock_sweeps(label, enabled, cadence, provinces, sectors, per_query_max)
SELECT 'Default 6h all-Nepal sweep', true, '17 */6 * * *', '{}'::text[], '{}'::text[], 3
WHERE NOT EXISTS (
  SELECT 1 FROM public.sherlock_sweeps WHERE label = 'Default 6h all-Nepal sweep'
);
