-- AI moderation queue: extend project_updates and project_sources with the same
-- approval workflow already present on projects, and mark AI-originated rows.
--
-- The remote schema was bootstrapped via upgrade_existing.sql which uses
-- `approval_status text` rather than the approval_status enum. We match that
-- pattern here (text + CHECK constraint) so this migration applies cleanly
-- against either shape.

ALTER TABLE public.project_updates
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_notes    text,
  ADD COLUMN IF NOT EXISTS submitted_by_ai boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.project_updates
    ADD CONSTRAINT project_updates_approval_status_check
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'changes_requested'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.project_sources
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_notes    text,
  ADD COLUMN IF NOT EXISTS submitted_by_ai boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.project_sources
    ADD CONSTRAINT project_sources_approval_status_check
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'changes_requested'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS submitted_by_ai boolean NOT NULL DEFAULT false;

-- Existing trusted rows are already public; promote them to approved so
-- visibility doesn't regress when the new RLS policies kick in.
UPDATE public.project_updates
   SET approval_status = 'approved'
 WHERE published = true AND approval_status = 'pending';

UPDATE public.project_sources
   SET approval_status = 'approved'
 WHERE verified = true AND approval_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_project_updates_approval ON public.project_updates(approval_status);
CREATE INDEX IF NOT EXISTS idx_project_sources_approval ON public.project_sources(approval_status);

-- Tighten public read RLS: approval_status drives visibility, not the legacy boolean.
DROP POLICY IF EXISTS "View published updates" ON public.project_updates;
DROP POLICY IF EXISTS "View approved updates" ON public.project_updates;
CREATE POLICY "View approved updates" ON public.project_updates FOR SELECT
USING (
  approval_status = 'approved'
  OR auth.uid() = author_id
  OR public.has_role(auth.uid(), 'reviewer'::public.app_role)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "Allow public read project sources" ON public.project_sources;
DROP POLICY IF EXISTS "Anyone view sources of viewable projects" ON public.project_sources;
DROP POLICY IF EXISTS "View approved sources" ON public.project_sources;
CREATE POLICY "View approved sources" ON public.project_sources FOR SELECT
USING (
  approval_status = 'approved'
  OR auth.uid() = added_by
  OR public.has_role(auth.uid(), 'reviewer'::public.app_role)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);
