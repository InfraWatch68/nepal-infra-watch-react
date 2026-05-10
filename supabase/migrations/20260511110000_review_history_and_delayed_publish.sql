-- Group D: approval-workflow changes
-- 1. published_at on every public-readable table — gates row visibility on a
--    delay timestamp so reviewer-approved rows get a 24h grace before going
--    public. Admin/coadmin override sets published_at = now() to push immediately.
-- 2. project_reviews — append-only history of every review action across every
--    target table. Reviewer/admin/coadmin role and `was_admin` flag captured
--    so the UI can show "approved by reviewer X, pushed live by admin Y".
--
-- Already applied to live DB on 2026-05-11 via Management API.

-- 1. published_at columns + RLS gating on legacy tables
ALTER TABLE public.projects        ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.project_updates ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.project_sources ADD COLUMN IF NOT EXISTS published_at timestamptz;
UPDATE public.projects        SET published_at = COALESCE(published_at, created_at) WHERE approval_status = 'approved';
UPDATE public.project_updates SET published_at = COALESCE(published_at, created_at) WHERE approval_status = 'approved';
UPDATE public.project_sources SET published_at = COALESCE(published_at, created_at) WHERE approval_status = 'approved';

DROP POLICY IF EXISTS "Anyone can view approved projects" ON public.projects;
CREATE POLICY "Anyone can view approved projects" ON public.projects FOR SELECT
USING (
  (approval_status = 'approved' AND (published_at IS NULL OR published_at <= now()))
  OR auth.uid() = submitted_by
  OR public.is_moderator(auth.uid())
);

DROP POLICY IF EXISTS "View approved updates" ON public.project_updates;
CREATE POLICY "View approved updates" ON public.project_updates FOR SELECT
USING (
  (approval_status = 'approved' AND (published_at IS NULL OR published_at <= now()))
  OR auth.uid() = author_id
  OR public.is_moderator(auth.uid())
);

DROP POLICY IF EXISTS "View approved sources" ON public.project_sources;
CREATE POLICY "View approved sources" ON public.project_sources FOR SELECT
USING (
  (approval_status = 'approved' AND (published_at IS NULL OR published_at <= now()))
  OR auth.uid() = added_by
  OR public.is_moderator(auth.uid())
);

-- 2. Same on the 7 detail tables added in 20260510200000.
DO $$
DECLARE t text; tables text[] := ARRAY[
  'project_funding','project_documents','project_stakeholders',
  'project_risks','project_impact','project_procurement','project_compliance'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS published_at timestamptz', t);
    EXECUTE format($u$UPDATE public.%I SET published_at = COALESCE(published_at, created_at) WHERE approval_status = 'approved'$u$, t);
    EXECUTE format('DROP POLICY IF EXISTS "View approved %1$s" ON public.%1$I', t);
    EXECUTE format($p$
      CREATE POLICY "View approved %1$s" ON public.%1$I FOR SELECT
      USING (
        (approval_status = 'approved' AND (published_at IS NULL OR published_at <= now()))
        OR submitted_by = auth.uid()
        OR public.is_moderator(auth.uid())
      )
    $p$, t);
  END LOOP;
END $$;

-- 3. project_reviews — append-only log
CREATE TABLE IF NOT EXISTS public.project_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_table  text NOT NULL CHECK (target_table IN
    ('projects','project_updates','project_sources','project_funding','project_documents',
     'project_stakeholders','project_risks','project_impact','project_procurement','project_compliance')),
  target_id     text NOT NULL,
  reviewer_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_role text,
  action        text NOT NULL CHECK (action IN ('approved','rejected','changes_requested','submitted','edited')),
  notes         text,
  was_admin     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_reviews_target   ON public.project_reviews(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_project_reviews_reviewer ON public.project_reviews(reviewer_id);

ALTER TABLE public.project_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View project_reviews" ON public.project_reviews;
CREATE POLICY "View project_reviews" ON public.project_reviews FOR SELECT
  USING (true);
DROP POLICY IF EXISTS "Moderators write project_reviews" ON public.project_reviews;
CREATE POLICY "Moderators write project_reviews" ON public.project_reviews FOR INSERT
  WITH CHECK (public.is_moderator(auth.uid()) AND reviewer_id = auth.uid());
