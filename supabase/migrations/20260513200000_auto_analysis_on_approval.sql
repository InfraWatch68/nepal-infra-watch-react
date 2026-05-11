-- Auto-fire a comprehensive AI analysis when a project is approved.
--
-- Trigger fires AFTER UPDATE on projects when approval_status transitions
-- to 'approved'. Inserts a project_analysis_runs row + matching analysis_jobs
-- row, just like the analysis-enqueue edge function does — but as a DB
-- trigger so it works regardless of who/how the approval happens (admin
-- panel, REST API call, future automation).
--
-- Idempotent via the partial unique index
-- `analysis_jobs_one_active_per_project`: if an analysis is already queued
-- or running for the project, the INSERT raises 23505 which we swallow.

CREATE OR REPLACE FUNCTION public.queue_analysis_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  -- Only fire on the transition into 'approved'. Inserts (new rows starting
  -- as approved) and same-value updates both qualify.
  IF NEW.approval_status <> 'approved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN RETURN NEW; END IF;

  BEGIN
    INSERT INTO public.project_analysis_runs (project_id, status, invoked_by)
    VALUES (NEW.id, 'queued', NEW.reviewed_by)
    RETURNING id INTO v_run_id;

    INSERT INTO public.analysis_jobs (project_id, run_id, status, enqueued_by)
    VALUES (NEW.id, v_run_id, 'queued', NEW.reviewed_by);
  EXCEPTION
    WHEN unique_violation THEN
      -- An analysis is already queued/running for this project; clean up the
      -- orphan run row we just made and skip silently.
      IF v_run_id IS NOT NULL THEN
        DELETE FROM public.project_analysis_runs WHERE id = v_run_id;
      END IF;
    WHEN OTHERS THEN
      -- Never block the approval because the auto-analysis enqueue failed.
      RAISE NOTICE 'queue_analysis_on_approval: insert failed for project %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.queue_analysis_on_approval() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_analysis_on_approval() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_queue_analysis_on_approval ON public.projects;
CREATE TRIGGER trg_queue_analysis_on_approval
AFTER INSERT OR UPDATE OF approval_status ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.queue_analysis_on_approval();
