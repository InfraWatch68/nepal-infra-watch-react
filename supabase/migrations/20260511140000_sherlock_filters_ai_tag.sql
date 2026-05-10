-- F1: Sherlock — autonomous discovery with stored filters.
-- Already applied to live DB on 2026-05-11 via Management API.
--
-- Adds an `ai_tag` column on projects so AI tools can label their
-- contributions ("Sherlock", "Discover", etc.) and the admin queue can render
-- a tool-specific badge instead of the generic "AI" pill. Plus a
-- `sherlock_filters` table that persists topic/region presets the admin can
-- run on demand or eventually via cron.

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS ai_tag text;
CREATE INDEX IF NOT EXISTS idx_projects_ai_tag ON public.projects(ai_tag) WHERE ai_tag IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sherlock_filters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL,
  topic         text,
  region        text,
  max_results   integer NOT NULL DEFAULT 3 CHECK (max_results BETWEEN 1 AND 10),
  active        boolean NOT NULL DEFAULT true,
  last_run_at   timestamptz,
  last_inserted integer,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sherlock_active ON public.sherlock_filters(active) WHERE active = true;

ALTER TABLE public.sherlock_filters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Moderators manage sherlock_filters" ON public.sherlock_filters;
CREATE POLICY "Moderators manage sherlock_filters" ON public.sherlock_filters FOR ALL
  USING (public.is_moderator(auth.uid()))
  WITH CHECK (public.is_moderator(auth.uid()));
