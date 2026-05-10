-- Aggregate AI briefs for the homepage hero card and per-region/sector summaries.
-- A "scope" string lets us key briefs as 'global', 'province:Bagmati', 'sector:Hydropower'
-- so the homepage can pull whichever is freshest without a schema dance.

CREATE TABLE IF NOT EXISTS public.global_briefs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL DEFAULT 'global',
  headline    text NOT NULL,
  body        text NOT NULL,
  sources     jsonb,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_global_briefs_scope_created
  ON public.global_briefs(scope, created_at DESC);

ALTER TABLE public.global_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read global briefs" ON public.global_briefs;
CREATE POLICY "Public read global briefs" ON public.global_briefs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Moderators manage global briefs" ON public.global_briefs;
CREATE POLICY "Moderators manage global briefs" ON public.global_briefs FOR ALL
  USING (public.is_moderator(auth.uid()))
  WITH CHECK (public.is_moderator(auth.uid()));
