-- Progress & daily-update tracking (Layer 1, free tier — no LLM tokens).
--
-- Two surfaces:
--   1. `daily_project_metrics` — one row per UTC day with counters mined
--      from rows Sherlock/analysis/moderation already wrote. Drives the
--      Admin Activity dashboard chart + table.
--   2. `projects.last_activity_at` — denormalised max(created_at) across
--      the 10 child tables, maintained by triggers. Drives the public
--      "updated N days ago" freshness badge and a "stalest first" admin sort.
--
-- The trigger approach is preferred over a cron rebuild: writes are O(1)
-- per child-row insert (negligible vs Sherlock's 1/min drain) and the
-- value is current to the same transaction instead of lagging up to a day.
-- `greatest()` guards every UPDATE so out-of-order writes never regress.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. daily_project_metrics — one row per UTC day, recomputed by cron + RPC.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.daily_project_metrics (
  day                date PRIMARY KEY,
  new_projects       int NOT NULL DEFAULT 0,
  new_updates        int NOT NULL DEFAULT 0,
  new_detail_rows    int NOT NULL DEFAULT 0,
  sherlock_jobs_run  int NOT NULL DEFAULT 0,
  sherlock_inserted  int NOT NULL DEFAULT 0,
  sherlock_errors    int NOT NULL DEFAULT 0,
  analysis_runs      int NOT NULL DEFAULT 0,
  approvals          int NOT NULL DEFAULT 0,
  rejections         int NOT NULL DEFAULT 0,
  computed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_project_metrics_day
  ON public.daily_project_metrics(day DESC);

ALTER TABLE public.daily_project_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read daily_project_metrics" ON public.daily_project_metrics;
CREATE POLICY "Public read daily_project_metrics" ON public.daily_project_metrics
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Moderators write daily_project_metrics" ON public.daily_project_metrics;
CREATE POLICY "Moderators write daily_project_metrics" ON public.daily_project_metrics
  FOR ALL USING (public.is_moderator(auth.uid())) WITH CHECK (public.is_moderator(auth.uid()));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. projects.last_activity_at — denormalised freshness column + index.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_projects_last_activity
  ON public.projects(last_activity_at DESC NULLS LAST);

-- Backfill from existing rows: take max across project itself + 10 child tables.
-- One-shot, safe to re-run; the WHERE clause skips already-populated rows.
DO $$
BEGIN
  WITH agg AS (
    SELECT p.id,
           greatest(
             p.updated_at,
             coalesce((SELECT max(created_at) FROM public.project_updates       WHERE project_id = p.id), '-infinity'::timestamptz),
             coalesce((SELECT max(created_at) FROM public.project_milestones    WHERE project_id = p.id), '-infinity'::timestamptz),
             coalesce((SELECT max(created_at) FROM public.project_sources       WHERE project_id = p.id), '-infinity'::timestamptz),
             coalesce((SELECT max(greatest(created_at, updated_at)) FROM public.project_funding       WHERE project_id = p.id), '-infinity'::timestamptz),
             coalesce((SELECT max(greatest(created_at, updated_at)) FROM public.project_documents     WHERE project_id = p.id), '-infinity'::timestamptz),
             coalesce((SELECT max(greatest(created_at, updated_at)) FROM public.project_stakeholders  WHERE project_id = p.id), '-infinity'::timestamptz),
             coalesce((SELECT max(greatest(created_at, updated_at)) FROM public.project_risks         WHERE project_id = p.id), '-infinity'::timestamptz),
             coalesce((SELECT max(greatest(created_at, updated_at)) FROM public.project_impact        WHERE project_id = p.id), '-infinity'::timestamptz),
             coalesce((SELECT max(greatest(created_at, updated_at)) FROM public.project_procurement   WHERE project_id = p.id), '-infinity'::timestamptz),
             coalesce((SELECT max(greatest(created_at, updated_at)) FROM public.project_compliance    WHERE project_id = p.id), '-infinity'::timestamptz)
           ) AS la
    FROM public.projects p
  )
  UPDATE public.projects p
     SET last_activity_at = agg.la
    FROM agg
   WHERE p.id = agg.id
     AND p.last_activity_at IS DISTINCT FROM agg.la;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Triggers — bump last_activity_at on writes to any child table.
-- ────────────────────────────────────────────────────────────────────────────

-- Generic bump: works for any child table that has a `project_id bigint` column.
CREATE OR REPLACE FUNCTION public.tg_bump_project_last_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.projects
     SET last_activity_at = greatest(coalesce(last_activity_at, '-infinity'::timestamptz), now())
   WHERE id = NEW.project_id;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_bump_project_last_activity() FROM PUBLIC, anon, authenticated;

-- project_reviews uses (target_table, target_id text) instead of project_id —
-- needs its own trigger that filters by target_table and parses the id.
CREATE OR REPLACE FUNCTION public.tg_bump_project_last_activity_from_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id bigint;
BEGIN
  -- Reviews on the projects row itself: target_id IS the project id.
  IF NEW.target_table = 'projects' THEN
    BEGIN
      v_project_id := NEW.target_id::bigint;
    EXCEPTION WHEN OTHERS THEN
      RETURN NEW;
    END;
    UPDATE public.projects
       SET last_activity_at = greatest(coalesce(last_activity_at, '-infinity'::timestamptz), now())
     WHERE id = v_project_id;
    RETURN NEW;
  END IF;

  -- Reviews on child rows: look up the child's project_id by target_id (uuid in text).
  -- Each detail table's PK is uuid; project_updates/sources also keyed by id.
  IF NEW.target_table IN ('project_updates','project_sources','project_funding','project_documents',
                          'project_stakeholders','project_risks','project_impact','project_procurement',
                          'project_compliance') THEN
    EXECUTE format('SELECT project_id FROM public.%I WHERE id::text = $1', NEW.target_table)
       INTO v_project_id USING NEW.target_id;
    IF v_project_id IS NOT NULL THEN
      UPDATE public.projects
         SET last_activity_at = greatest(coalesce(last_activity_at, '-infinity'::timestamptz), now())
       WHERE id = v_project_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_bump_project_last_activity_from_review() FROM PUBLIC, anon, authenticated;

-- Self-bump: any direct UPDATE on projects (e.g. status change, moderator
-- edit) advances last_activity_at in the same statement. BEFORE UPDATE so
-- the new value lands without a second write.
CREATE OR REPLACE FUNCTION public.tg_bump_project_self_last_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.last_activity_at := greatest(coalesce(OLD.last_activity_at, '-infinity'::timestamptz), now());
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_bump_project_self_last_activity() FROM PUBLIC, anon, authenticated;

-- Attach to all 10 child tables (project_id bigint) + project_reviews + projects itself.
DO $$
DECLARE
  t text;
  child_tables text[] := ARRAY[
    'project_updates','project_milestones','project_sources',
    'project_funding','project_documents','project_stakeholders',
    'project_risks','project_impact','project_procurement','project_compliance'
  ];
BEGIN
  FOREACH t IN ARRAY child_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_bump_last_activity ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_bump_last_activity AFTER INSERT OR UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.tg_bump_project_last_activity()',
      t
    );
  END LOOP;

  DROP TRIGGER IF EXISTS trg_bump_last_activity_from_review ON public.project_reviews;
  CREATE TRIGGER trg_bump_last_activity_from_review
    AFTER INSERT ON public.project_reviews
    FOR EACH ROW EXECUTE FUNCTION public.tg_bump_project_last_activity_from_review();

  DROP TRIGGER IF EXISTS trg_bump_self_last_activity ON public.projects;
  CREATE TRIGGER trg_bump_self_last_activity
    BEFORE UPDATE ON public.projects
    FOR EACH ROW
    WHEN (NEW.updated_at IS DISTINCT FROM OLD.updated_at)
    EXECUTE FUNCTION public.tg_bump_project_self_last_activity();
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. compute_daily_project_metrics(p_day) — aggregator + UPSERT.
--    Cron calls it nightly with default = yesterday; RPC re-uses it.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.compute_daily_project_metrics(p_day date DEFAULT (current_date - 1))
RETURNS public.daily_project_metrics
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.daily_project_metrics;
BEGIN
  INSERT INTO public.daily_project_metrics AS m (
    day, new_projects, new_updates, new_detail_rows,
    sherlock_jobs_run, sherlock_inserted, sherlock_errors,
    analysis_runs, approvals, rejections, computed_at
  )
  SELECT
    p_day,
    (SELECT count(*) FROM public.projects        WHERE created_at::date = p_day),
    (SELECT count(*) FROM public.project_updates WHERE created_at::date = p_day),
    (SELECT
       coalesce((SELECT count(*) FROM public.project_funding       WHERE created_at::date = p_day), 0) +
       coalesce((SELECT count(*) FROM public.project_documents     WHERE created_at::date = p_day), 0) +
       coalesce((SELECT count(*) FROM public.project_stakeholders  WHERE created_at::date = p_day), 0) +
       coalesce((SELECT count(*) FROM public.project_risks         WHERE created_at::date = p_day), 0) +
       coalesce((SELECT count(*) FROM public.project_impact        WHERE created_at::date = p_day), 0) +
       coalesce((SELECT count(*) FROM public.project_procurement   WHERE created_at::date = p_day), 0) +
       coalesce((SELECT count(*) FROM public.project_compliance    WHERE created_at::date = p_day), 0)
    ),
    (SELECT count(*) FROM public.sherlock_jobs
       WHERE finished_at::date = p_day AND status IN ('done','failed','cancelled')),
    (SELECT coalesce(sum(inserted), 0) FROM public.sherlock_jobs
       WHERE finished_at::date = p_day AND status = 'done'),
    (SELECT count(*) FROM public.sherlock_jobs
       WHERE finished_at::date = p_day AND error_text IS NOT NULL AND length(error_text) > 0),
    (SELECT count(*) FROM public.project_analysis_runs
       WHERE finished_at::date = p_day),
    (SELECT count(*) FROM public.project_reviews
       WHERE created_at::date = p_day AND action = 'approved'),
    (SELECT count(*) FROM public.project_reviews
       WHERE created_at::date = p_day AND action = 'rejected'),
    now()
  ON CONFLICT (day) DO UPDATE SET
    new_projects      = EXCLUDED.new_projects,
    new_updates       = EXCLUDED.new_updates,
    new_detail_rows   = EXCLUDED.new_detail_rows,
    sherlock_jobs_run = EXCLUDED.sherlock_jobs_run,
    sherlock_inserted = EXCLUDED.sherlock_inserted,
    sherlock_errors   = EXCLUDED.sherlock_errors,
    analysis_runs     = EXCLUDED.analysis_runs,
    approvals         = EXCLUDED.approvals,
    rejections        = EXCLUDED.rejections,
    computed_at       = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

REVOKE EXECUTE ON FUNCTION public.compute_daily_project_metrics(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_daily_project_metrics(date) TO postgres, service_role;

-- Moderator-callable RPC for the "Rebuild" button + ad-hoc backfills.
CREATE OR REPLACE FUNCTION public.rebuild_daily_project_metrics(p_from date, p_to date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d date := p_from;
  n int := 0;
BEGIN
  IF NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised: moderator role required' USING ERRCODE = '42501';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'p_from must be <= p_to';
  END IF;
  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'range too large (max 366 days)';
  END IF;
  WHILE d <= p_to LOOP
    PERFORM public.compute_daily_project_metrics(d);
    d := d + 1;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION public.rebuild_daily_project_metrics(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_daily_project_metrics(date, date) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. pg_cron — 00:05 UTC nightly, computes yesterday.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('compute-daily-project-metrics');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'compute-daily-project-metrics',
  '5 0 * * *',
  $cron$ SELECT public.compute_daily_project_metrics(); $cron$
);

-- Seed yesterday and today so the dashboard isn't empty on first deploy.
SELECT public.compute_daily_project_metrics(current_date - 1);
SELECT public.compute_daily_project_metrics(current_date);
