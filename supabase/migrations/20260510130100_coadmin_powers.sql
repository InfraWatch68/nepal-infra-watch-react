-- Wire 'coadmin' into RLS so it actually grants reviewer-level powers
-- (plus ad management). The two helpers below replace inline OR-chains
-- of has_role() calls and become the canonical moderator check.

CREATE OR REPLACE FUNCTION public.is_moderator(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('reviewer'::public.app_role, 'coadmin'::public.app_role, 'admin'::public.app_role)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_coadmin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('coadmin'::public.app_role, 'admin'::public.app_role)
  );
$$;

-- ============================================================
-- projects
-- ============================================================
DROP POLICY IF EXISTS "Anyone can view approved projects" ON public.projects;
CREATE POLICY "Anyone can view approved projects" ON public.projects FOR SELECT
USING (
  approval_status = 'approved'
  OR auth.uid() = submitted_by
  OR public.is_moderator(auth.uid())
);

DROP POLICY IF EXISTS "Reviewers/admins can update any project" ON public.projects;
DROP POLICY IF EXISTS "Reviewers can update any project" ON public.projects;
CREATE POLICY "Moderators can update any project" ON public.projects FOR UPDATE
USING (public.is_moderator(auth.uid()));

-- ============================================================
-- project_milestones
-- ============================================================
DROP POLICY IF EXISTS "View milestones of viewable projects" ON public.project_milestones;
DROP POLICY IF EXISTS "Anyone view milestones of viewable projects" ON public.project_milestones;
CREATE POLICY "View milestones" ON public.project_milestones FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = project_id
       AND (p.approval_status = 'approved' OR auth.uid() = p.submitted_by OR public.is_moderator(auth.uid()))
  )
);

DROP POLICY IF EXISTS "Submitter/reviewer/admin manage milestones" ON public.project_milestones;
CREATE POLICY "Moderators manage milestones" ON public.project_milestones FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = project_id
       AND (auth.uid() = p.submitted_by OR public.is_moderator(auth.uid()))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = project_id
       AND (auth.uid() = p.submitted_by OR public.is_moderator(auth.uid()))
  )
);

-- ============================================================
-- project_updates
-- ============================================================
DROP POLICY IF EXISTS "View approved updates" ON public.project_updates;
CREATE POLICY "View approved updates" ON public.project_updates FOR SELECT
USING (
  approval_status = 'approved'
  OR auth.uid() = author_id
  OR public.is_moderator(auth.uid())
);

DROP POLICY IF EXISTS "Author/reviewer/admin manage updates" ON public.project_updates;
CREATE POLICY "Moderators manage updates" ON public.project_updates FOR UPDATE
USING (auth.uid() = author_id OR public.is_moderator(auth.uid()))
WITH CHECK (auth.uid() = author_id OR public.is_moderator(auth.uid()));

DROP POLICY IF EXISTS "Author/admin delete updates" ON public.project_updates;
CREATE POLICY "Author/admin delete updates" ON public.project_updates FOR DELETE
USING (auth.uid() = author_id OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- project_sources
-- ============================================================
DROP POLICY IF EXISTS "View approved sources" ON public.project_sources;
CREATE POLICY "View approved sources" ON public.project_sources FOR SELECT
USING (
  approval_status = 'approved'
  OR auth.uid() = added_by
  OR public.is_moderator(auth.uid())
);

DROP POLICY IF EXISTS "Reviewer/admin verify sources" ON public.project_sources;
CREATE POLICY "Moderators verify sources" ON public.project_sources FOR UPDATE
USING (public.is_moderator(auth.uid()))
WITH CHECK (public.is_moderator(auth.uid()));

-- ============================================================
-- ad_slots: extend management to coadmin
-- ============================================================
DROP POLICY IF EXISTS "Admins manage ads" ON public.ad_slots;
CREATE POLICY "Admins/coadmins manage ads" ON public.ad_slots FOR ALL
USING (public.is_admin_or_coadmin(auth.uid()))
WITH CHECK (public.is_admin_or_coadmin(auth.uid()));

-- ============================================================
-- user_roles: keep tight — only true admins can grant/revoke roles
-- ============================================================
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- profiles: admins need to read all rows for the Users tab.
-- The existing "Profiles are viewable by everyone" policy already
-- permits this — no change required.
-- ============================================================
