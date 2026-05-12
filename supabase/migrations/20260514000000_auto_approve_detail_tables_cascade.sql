-- Extend the parent→child approval cascade (already wired for project_sources
-- and project_updates by 20260513210000_auto_approve_sources.sql) to all 7
-- comprehensive detail tables:
--   project_funding, project_documents, project_stakeholders, project_risks,
--   project_impact, project_procurement, project_compliance
--
-- Why: when an AI-discovered project clears moderation (manually or via the
-- site-wide high-confidence auto-approve toggle), the detail rows the same AI
-- run produced are part of that approval — they were extracted from the same
-- citations and rated against the same rubric. Forcing moderators to bulk-
-- approve them again in a second step is busywork. The old "Approve N high-
-- conf" button in ComprehensiveSections.tsx is replaced by this cascade.
--
-- Two trigger paths, mirroring the sources/updates pattern:
--   1. AFTER INSERT/UPDATE on projects → flip pending children to approved.
--   2. BEFORE INSERT on each detail table → if parent is already approved,
--      skip the pending state entirely (so Sherlock-driven analysis runs that
--      land detail rows AFTER project approval still flow through).

-- ── 1. Extend the existing AFTER trigger function to cover detail tables.
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

  UPDATE public.project_funding
  SET approval_status = 'approved', reviewed_by = NEW.reviewed_by
  WHERE project_id = NEW.id AND approval_status = 'pending';

  UPDATE public.project_documents
  SET approval_status = 'approved', reviewed_by = NEW.reviewed_by
  WHERE project_id = NEW.id AND approval_status = 'pending';

  UPDATE public.project_stakeholders
  SET approval_status = 'approved', reviewed_by = NEW.reviewed_by
  WHERE project_id = NEW.id AND approval_status = 'pending';

  UPDATE public.project_risks
  SET approval_status = 'approved', reviewed_by = NEW.reviewed_by
  WHERE project_id = NEW.id AND approval_status = 'pending';

  UPDATE public.project_impact
  SET approval_status = 'approved', reviewed_by = NEW.reviewed_by
  WHERE project_id = NEW.id AND approval_status = 'pending';

  UPDATE public.project_procurement
  SET approval_status = 'approved', reviewed_by = NEW.reviewed_by
  WHERE project_id = NEW.id AND approval_status = 'pending';

  UPDATE public.project_compliance
  SET approval_status = 'approved', reviewed_by = NEW.reviewed_by
  WHERE project_id = NEW.id AND approval_status = 'pending';

  RETURN NEW;
END $$;

-- ── 2. BEFORE INSERT triggers on each detail table reuse the existing generic
-- `auto_approve_child_row_for_approved_project` function — it's already shape-
-- agnostic (only touches NEW.project_id and NEW.approval_status).
DROP TRIGGER IF EXISTS trg_auto_approve_funding ON public.project_funding;
CREATE TRIGGER trg_auto_approve_funding
BEFORE INSERT ON public.project_funding
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_child_row_for_approved_project();

DROP TRIGGER IF EXISTS trg_auto_approve_documents ON public.project_documents;
CREATE TRIGGER trg_auto_approve_documents
BEFORE INSERT ON public.project_documents
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_child_row_for_approved_project();

DROP TRIGGER IF EXISTS trg_auto_approve_stakeholders ON public.project_stakeholders;
CREATE TRIGGER trg_auto_approve_stakeholders
BEFORE INSERT ON public.project_stakeholders
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_child_row_for_approved_project();

DROP TRIGGER IF EXISTS trg_auto_approve_risks ON public.project_risks;
CREATE TRIGGER trg_auto_approve_risks
BEFORE INSERT ON public.project_risks
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_child_row_for_approved_project();

DROP TRIGGER IF EXISTS trg_auto_approve_impact ON public.project_impact;
CREATE TRIGGER trg_auto_approve_impact
BEFORE INSERT ON public.project_impact
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_child_row_for_approved_project();

DROP TRIGGER IF EXISTS trg_auto_approve_procurement ON public.project_procurement;
CREATE TRIGGER trg_auto_approve_procurement
BEFORE INSERT ON public.project_procurement
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_child_row_for_approved_project();

DROP TRIGGER IF EXISTS trg_auto_approve_compliance ON public.project_compliance;
CREATE TRIGGER trg_auto_approve_compliance
BEFORE INSERT ON public.project_compliance
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_child_row_for_approved_project();

-- ── 3. Backfill: approve every existing pending detail row whose parent
-- project is already approved. Mirrors the backfill in the sources/updates
-- migration so post-deploy state matches the new steady state.
UPDATE public.project_funding c       SET approval_status = 'approved' FROM public.projects p WHERE c.project_id = p.id AND p.approval_status = 'approved' AND c.approval_status = 'pending';
UPDATE public.project_documents c     SET approval_status = 'approved' FROM public.projects p WHERE c.project_id = p.id AND p.approval_status = 'approved' AND c.approval_status = 'pending';
UPDATE public.project_stakeholders c  SET approval_status = 'approved' FROM public.projects p WHERE c.project_id = p.id AND p.approval_status = 'approved' AND c.approval_status = 'pending';
UPDATE public.project_risks c         SET approval_status = 'approved' FROM public.projects p WHERE c.project_id = p.id AND p.approval_status = 'approved' AND c.approval_status = 'pending';
UPDATE public.project_impact c        SET approval_status = 'approved' FROM public.projects p WHERE c.project_id = p.id AND p.approval_status = 'approved' AND c.approval_status = 'pending';
UPDATE public.project_procurement c   SET approval_status = 'approved' FROM public.projects p WHERE c.project_id = p.id AND p.approval_status = 'approved' AND c.approval_status = 'pending';
UPDATE public.project_compliance c    SET approval_status = 'approved' FROM public.projects p WHERE c.project_id = p.id AND p.approval_status = 'approved' AND c.approval_status = 'pending';
