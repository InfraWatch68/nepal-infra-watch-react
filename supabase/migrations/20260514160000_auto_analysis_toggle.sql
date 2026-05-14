-- Auto-analysis-on-approval toggle.
--
-- Currently `queue_analysis_on_approval()` (migration 20260513200000) fires
-- unconditionally whenever a project transitions to approval_status='approved'
-- and enqueues a comprehensive analysis row that runs through analysis-drain
-- (which burns Tavily + Mistral free-tier credits). The operator wants to
-- opt out of that and instead use a Local-AI "Live Check" workflow that
-- pays for the analysis on their own Claude.ai / ChatGPT subscription.
--
-- This migration:
--   1. Adds `site_settings.auto_analysis_on_approval_enabled` (default TRUE
--      so behaviour is unchanged until the admin flips the toggle).
--   2. Patches the trigger function to short-circuit when the toggle is OFF.

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS auto_analysis_on_approval_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.queue_analysis_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id  uuid;
  v_enabled boolean;
BEGIN
  -- Only fire on the transition into 'approved'. Inserts that start as
  -- approved AND updates that flip pending → approved both qualify.
  IF NEW.approval_status <> 'approved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN RETURN NEW; END IF;

  -- New: respect the site-wide toggle. COALESCE so a missing row defaults
  -- to ON (preserves the original always-fire behaviour out of the box).
  SELECT auto_analysis_on_approval_enabled INTO v_enabled
    FROM public.site_settings WHERE id = 1;
  IF NOT COALESCE(v_enabled, TRUE) THEN
    RETURN NEW;
  END IF;

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

-- Trigger definition itself is unchanged; just the function body.
