-- Fix missing INSERT policies on project_updates and project_sources.
-- The earlier coadmin_powers migration created `FOR ALL` policies but the
-- INSERT clause didn't register on the live DB (verified via pg_policy: only
-- SELECT / UPDATE / DELETE policies exist). Authenticated users can't post
-- updates or add sources. This migration adds explicit INSERT policies that
-- match the prior FOR-ALL intent: author can insert their own row, moderators
-- can insert any row.

-- project_updates: INSERT must have author_id = auth.uid() (or moderator).
DROP POLICY IF EXISTS "Submit project_updates" ON public.project_updates;
CREATE POLICY "Submit project_updates" ON public.project_updates FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (auth.uid() = author_id OR public.is_moderator(auth.uid()))
);

-- project_sources: INSERT must have added_by = auth.uid() (or moderator).
-- The legacy column on this table is `added_by` (not `submitted_by`).
DROP POLICY IF EXISTS "Submit project_sources" ON public.project_sources;
CREATE POLICY "Submit project_sources" ON public.project_sources FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (auth.uid() = added_by OR public.is_moderator(auth.uid()))
);
