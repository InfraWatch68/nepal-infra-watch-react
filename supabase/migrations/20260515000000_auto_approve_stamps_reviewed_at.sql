-- Stamp `projects.reviewed_at = now()` on every approval transition, so
-- the Local-AI Live Check loop (and any other "newly reviewed" query)
-- can rely on this column.
--
-- Until now nothing was setting `reviewed_at` — neither the auto-approve
-- BEFORE INSERT trigger nor the admin UI's manual review action. The
-- column stayed NULL on every row, which made Live Check's filter
-- `reviewed_at > livecheck_started_at` return zero candidates regardless
-- of how many projects got approved during a session.
--
-- This migration fixes both paths with one DB trigger that runs in both
-- INSERT and UPDATE contexts, plus a backfill so the existing approved
-- backlog gets a value (without flooding the next Live Check session).
--
-- Semantics:
--   - When the BEFORE INSERT auto-approve trigger flips a row to
--     'approved', this trigger (also BEFORE) stamps reviewed_at.
--   - When a moderator updates a row to 'approved' via the admin UI,
--     this trigger stamps reviewed_at on the same transaction. The UI
--     also sets reviewed_by to the moderator's auth.uid, which we keep.
--   - reviewed_by stays NULL on the auto-approve path because the
--     SECURITY DEFINER function has no auth context. Consumers that
--     need to distinguish auto vs. human reviewers can check
--     `submitted_by_ai = true AND reviewed_by IS NULL`.

-- Step 1: update the auto-approve trigger to also stamp reviewed_at.
CREATE OR REPLACE FUNCTION public.auto_approve_high_confidence_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled    boolean;
  v_threshold  numeric;
BEGIN
  IF NEW.submitted_by_ai IS NOT TRUE THEN RETURN NEW; END IF;
  IF NEW.approval_status IS DISTINCT FROM 'pending' THEN RETURN NEW; END IF;
  IF NEW.confidence_score IS NULL THEN RETURN NEW; END IF;

  SELECT auto_approve_enabled, auto_approve_threshold
    INTO v_enabled, v_threshold
    FROM public.site_settings WHERE id = 1;

  IF v_enabled AND NEW.confidence_score >= COALESCE(v_threshold, 0.85) THEN
    NEW.approval_status := 'approved';
    NEW.reviewed_at     := COALESCE(NEW.reviewed_at, now());
    -- reviewed_by stays null — no human reviewer in this path.
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.auto_approve_high_confidence_project() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_approve_high_confidence_project() TO postgres, service_role;

-- Step 2: catch the manual moderator path too. Whenever approval_status
-- transitions to 'approved' on UPDATE (or the row is inserted already
-- approved by means other than the auto-approve trigger), make sure
-- reviewed_at is stamped. Defaults to now() but respects an explicit
-- caller-provided value (e.g. an admin tool importing reviews with
-- historical timestamps).
CREATE OR REPLACE FUNCTION public.stamp_reviewed_at_on_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.approval_status = 'approved' THEN
    IF TG_OP = 'INSERT' THEN
      -- Only stamp on INSERT if the row arrived already approved AND
      -- reviewed_at wasn't pre-set (the auto-approve trigger already
      -- handles its own path).
      IF NEW.reviewed_at IS NULL THEN
        NEW.reviewed_at := now();
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      -- Stamp on the transition into approved, OR if reviewed_at is
      -- still null on an approved row (UPDATE that re-saves the row
      -- without changing approval_status).
      IF (OLD.approval_status IS DISTINCT FROM 'approved')
         OR (NEW.reviewed_at IS NULL) THEN
        NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_reviewed_at_on_approval ON public.projects;
CREATE TRIGGER trg_stamp_reviewed_at_on_approval
BEFORE INSERT OR UPDATE OF approval_status, reviewed_at ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.stamp_reviewed_at_on_approval();

-- Step 3: backfill reviewed_at for the existing approved backlog using
-- each row's own creation time so they don't all look freshly reviewed.
-- Live Check sessions started AFTER this migration runs use
-- `reviewed_at > livecheck_started_at` as their filter, so backdating
-- to created_at means the backlog stays invisible to Live Check (which
-- is the right behaviour — the backlog should be processed by the
-- "Refresh stale" workflow, not Live Check).
UPDATE public.projects
SET reviewed_at = COALESCE(created_at, now())
WHERE approval_status = 'approved'
  AND reviewed_at IS NULL;
