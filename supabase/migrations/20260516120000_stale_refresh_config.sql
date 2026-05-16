-- Configurable auto-refresh settings for stale project analysis.
--
-- Singleton settings table (id = 1) that the hourly cron reads to decide
-- which projects to auto-enqueue.  The admin UI writes to this table;
-- auto_enqueue_stale_projects() (SECURITY DEFINER) reads it without RLS.
--
-- Separate stale windows for incomplete vs complete/cancelled projects:
--   incomplete = proposed / approved / in_progress / delayed
--   complete   = completed / cancelled (change rarely; longer window is fine)
--
-- The enqueued analysis_jobs rows carry a since_date so analysis-drain
-- scopes each Tavily search to the window since the last run, avoiding
-- re-fetching sources that are already in the DB.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. since_date column on analysis_jobs
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.analysis_jobs
  ADD COLUMN IF NOT EXISTS since_date timestamptz;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Settings table
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.stale_refresh_config (
  id                        int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  incomplete_stale_days     int  NOT NULL DEFAULT 30,
  complete_stale_days       int  NOT NULL DEFAULT 90,
  incomplete_auto_enabled   bool NOT NULL DEFAULT false,
  complete_auto_enabled     bool NOT NULL DEFAULT false,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.stale_refresh_config (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE public.stale_refresh_config ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read (admin panel already gates the UI).
DROP POLICY IF EXISTS "Authenticated read stale_refresh_config" ON public.stale_refresh_config;
CREATE POLICY "Authenticated read stale_refresh_config" ON public.stale_refresh_config
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admin / coadmin can modify.
DROP POLICY IF EXISTS "Admins write stale_refresh_config" ON public.stale_refresh_config;
CREATE POLICY "Admins write stale_refresh_config" ON public.stale_refresh_config
  FOR ALL
  USING (public.is_admin_or_coadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_coadmin(auth.uid()));

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Auto-enqueue function
-- ────────────────────────────────────────────────────────────────────────────
-- Runs hourly via pg_cron.  Reads the config, finds stale approved projects,
-- and inserts up to 5 analysis jobs per run (incomplete bucket first, then
-- complete with the remaining budget).
--
-- Uses the same insert pattern as queue_analysis_on_approval() in
-- 20260513200000_auto_analysis_on_approval.sql.  The partial unique index
-- analysis_jobs_one_active_per_project prevents double-enqueue; we check
-- NOT EXISTS first so we don't create an orphan project_analysis_runs row.

CREATE OR REPLACE FUNCTION public.auto_enqueue_stale_projects()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg       record;
  proj      record;
  v_run_id  uuid;
  processed int := 0;
  budget    int := 5;
BEGIN
  SELECT * INTO cfg FROM public.stale_refresh_config WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no config row');
  END IF;

  -- ── Incomplete projects ───────────────────────────────────────────────────
  IF cfg.incomplete_auto_enabled AND processed < budget THEN
    FOR proj IN
      SELECT id, title, last_comprehensive_analysis_at
      FROM public.projects
      WHERE approval_status = 'approved'
        AND status NOT IN ('completed', 'cancelled')
        AND (
          last_comprehensive_analysis_at IS NULL
          OR last_comprehensive_analysis_at < now() - (cfg.incomplete_stale_days || ' days')::interval
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.analysis_jobs
          WHERE project_id = projects.id AND status IN ('queued','running')
        )
      ORDER BY last_comprehensive_analysis_at ASC NULLS FIRST
      LIMIT budget - processed
    LOOP
      BEGIN
        INSERT INTO public.project_analysis_runs (project_id, status, invoked_by)
        VALUES (proj.id, 'queued', NULL)
        RETURNING id INTO v_run_id;

        INSERT INTO public.analysis_jobs (project_id, run_id, status, since_date)
        VALUES (proj.id, v_run_id, 'queued', proj.last_comprehensive_analysis_at);

        processed := processed + 1;
      EXCEPTION
        WHEN unique_violation THEN
          IF v_run_id IS NOT NULL THEN
            DELETE FROM public.project_analysis_runs WHERE id = v_run_id;
          END IF;
        WHEN OTHERS THEN
          RAISE NOTICE 'auto_enqueue_stale_projects: failed for project %: %', proj.id, SQLERRM;
      END;
    END LOOP;
  END IF;

  -- ── Complete / cancelled projects ────────────────────────────────────────
  IF cfg.complete_auto_enabled AND processed < budget THEN
    FOR proj IN
      SELECT id, title, last_comprehensive_analysis_at
      FROM public.projects
      WHERE approval_status = 'approved'
        AND status IN ('completed', 'cancelled')
        AND (
          last_comprehensive_analysis_at IS NULL
          OR last_comprehensive_analysis_at < now() - (cfg.complete_stale_days || ' days')::interval
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.analysis_jobs
          WHERE project_id = projects.id AND status IN ('queued','running')
        )
      ORDER BY last_comprehensive_analysis_at ASC NULLS FIRST
      LIMIT budget - processed
    LOOP
      BEGIN
        INSERT INTO public.project_analysis_runs (project_id, status, invoked_by)
        VALUES (proj.id, 'queued', NULL)
        RETURNING id INTO v_run_id;

        INSERT INTO public.analysis_jobs (project_id, run_id, status, since_date)
        VALUES (proj.id, v_run_id, 'queued', proj.last_comprehensive_analysis_at);

        processed := processed + 1;
      EXCEPTION
        WHEN unique_violation THEN
          IF v_run_id IS NOT NULL THEN
            DELETE FROM public.project_analysis_runs WHERE id = v_run_id;
          END IF;
        WHEN OTHERS THEN
          RAISE NOTICE 'auto_enqueue_stale_projects: failed for project %: %', proj.id, SQLERRM;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('enqueued', processed);
END $$;

REVOKE ALL ON FUNCTION public.auto_enqueue_stale_projects() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_enqueue_stale_projects() TO postgres, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Hourly pg_cron job
-- ────────────────────────────────────────────────────────────────────────────

SELECT cron.unschedule('auto-stale-refresh') FROM cron.job WHERE jobname = 'auto-stale-refresh';

SELECT cron.schedule(
  'auto-stale-refresh',
  '0 * * * *',
  $$SELECT public.auto_enqueue_stale_projects()$$
);
