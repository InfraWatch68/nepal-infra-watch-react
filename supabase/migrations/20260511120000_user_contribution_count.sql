-- Helper function used by the frontend <UserBadge> component to compute a
-- contribution-tier badge from a user's approved-submission count across the
-- three submitter columns.
--
-- SECURITY DEFINER lets anonymous viewers see contribution counts (the badge
-- is public information) without granting blanket read on the underlying
-- approval_status='pending' rows.
--
-- Already applied to live DB on 2026-05-11 via Management API.

CREATE OR REPLACE FUNCTION public.user_contribution_count(_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT COUNT(*) FROM public.projects
    WHERE submitted_by = _user_id AND approval_status = 'approved'
  ), 0) + COALESCE((
    SELECT COUNT(*) FROM public.project_updates
    WHERE author_id = _user_id AND approval_status = 'approved'
  ), 0) + COALESCE((
    SELECT COUNT(*) FROM public.project_sources
    WHERE added_by = _user_id AND approval_status = 'approved'
  ), 0);
$$;

GRANT EXECUTE ON FUNCTION public.user_contribution_count(uuid) TO anon, authenticated;
