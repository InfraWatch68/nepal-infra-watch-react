-- Auto-approve project_sources whose parent project is already approved.
--
-- Sherlock inserts every source as approval_status='pending' so a human can
-- vouch for each URL. In practice nothing in the codebase moderates this
-- queue (the Sources tab on ProjectDetail only shows approved rows, and
-- there's no admin workflow specifically for sources). Result: 54 sources
-- exist, 2 ever approved, and every Sherlock-discovered project shows
-- Sources (0) on its detail page.
--
-- Trust model: if the project itself has cleared moderation, its citation
-- URLs are part of that approval — they were the evidence the AI used to
-- build the project record. So when a project is approved, every pending
-- source attached to it gets auto-approved. New sources inserted against
-- an already-approved project skip the pending state entirely.
--
-- Same model applies for project_updates: AI-suggested updates on an
-- approved project go straight to approved.

-- ── 1. Promote pending sources when their project transitions to approved.
CREATE OR REPLACE FUNCTION public.approve_child_rows_on_project_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approval_status <> 'approved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN RETURN NEW; END IF;

  UPDATE public.project_sources
  SET approval_status = 'approved', reviewed_by = NEW.reviewed_by
  WHERE project_id = NEW.id AND approval_status = 'pending';

  UPDATE public.project_updates
  SET approval_status = 'approved', reviewed_by = NEW.reviewed_by
  WHERE project_id = NEW.id AND approval_status = 'pending';

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.approve_child_rows_on_project_approval() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_child_rows_on_project_approval() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_approve_child_rows ON public.projects;
CREATE TRIGGER trg_approve_child_rows
AFTER INSERT OR UPDATE OF approval_status ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.approve_child_rows_on_project_approval();

-- ── 2. New sources / updates against an already-approved project skip the
--      pending state entirely (BEFORE INSERT so we mutate NEW before write).
CREATE OR REPLACE FUNCTION public.auto_approve_child_row_for_approved_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_status text;
BEGIN
  IF NEW.approval_status IS DISTINCT FROM 'pending' THEN RETURN NEW; END IF;
  SELECT approval_status INTO v_project_status FROM public.projects WHERE id = NEW.project_id;
  IF v_project_status = 'approved' THEN
    NEW.approval_status := 'approved';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.auto_approve_child_row_for_approved_project() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_approve_child_row_for_approved_project() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_auto_approve_sources ON public.project_sources;
CREATE TRIGGER trg_auto_approve_sources
BEFORE INSERT ON public.project_sources
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_child_row_for_approved_project();

DROP TRIGGER IF EXISTS trg_auto_approve_updates ON public.project_updates;
CREATE TRIGGER trg_auto_approve_updates
BEFORE INSERT ON public.project_updates
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_child_row_for_approved_project();

-- ── 3. Backfill: approve every existing pending child row whose project is
--      already approved. Skips orphans (project_id pointing nowhere).
UPDATE public.project_sources s
SET approval_status = 'approved'
FROM public.projects p
WHERE s.project_id = p.id
  AND p.approval_status = 'approved'
  AND s.approval_status = 'pending';

UPDATE public.project_updates u
SET approval_status = 'approved'
FROM public.projects p
WHERE u.project_id = p.id
  AND p.approval_status = 'approved'
  AND u.approval_status = 'pending';
