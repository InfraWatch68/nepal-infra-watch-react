-- Phase 1 of the "Project Data Hub" revamp of Run AI Analysis.
--
-- analysis_jobs is the queue equivalent of sherlock_jobs. One row per
-- enqueued analysis. The partial unique index `analysis_jobs_one_active_per_project`
-- prevents double-enqueue while a run is queued or running; the
-- analysis-enqueue edge function maps the resulting 23505 unique-violation
-- to a clean 409 Conflict so the UI can show "an analysis is already in flight".

CREATE TABLE IF NOT EXISTS public.analysis_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id        uuid NOT NULL,
  status        text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  enqueued_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enqueued_at   timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  attempts      int NOT NULL DEFAULT 0,
  last_error    text
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_drain
  ON public.analysis_jobs(status, enqueued_at ASC)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_project
  ON public.analysis_jobs(project_id, enqueued_at DESC);

-- One active job per project. This is the dedupe key the enqueue function relies on.
CREATE UNIQUE INDEX IF NOT EXISTS analysis_jobs_one_active_per_project
  ON public.analysis_jobs(project_id)
  WHERE status IN ('queued','running');

ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Moderators manage analysis_jobs" ON public.analysis_jobs;
CREATE POLICY "Moderators manage analysis_jobs" ON public.analysis_jobs FOR ALL
  USING (public.is_moderator(auth.uid()))
  WITH CHECK (public.is_moderator(auth.uid()));
