-- Run history for the "Run AI Analysis" feature. One row per click.
-- Drained by the analysis-drain edge function which incrementally writes
-- bucket_status (per-bucket {state, hits, started_at, finished_at, error})
-- so the UI can show per-bucket progress pills live via Realtime.
--
-- narrative_summary + gaps_and_contradictions are the "hub-grade" output
-- additions: a readable synthesis and an explicit list of missing/conflicting
-- facts, both written by the AI in the same extraction pass. These are
-- rendered at the top of ComprehensiveSections as the new entry point —
-- the existing 7 tabs become evidence below the synthesis, not the front page.

CREATE TABLE IF NOT EXISTS public.project_analysis_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  started_at               timestamptz NOT NULL DEFAULT now(),
  finished_at              timestamptz,
  status                   text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  bucket_status            jsonb NOT NULL DEFAULT '{}'::jsonb,
  inserted_per_table       jsonb NOT NULL DEFAULT '{}'::jsonb,
  deduped_per_table        jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors                   text[] NOT NULL DEFAULT '{}'::text[],
  invoked_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  narrative_summary        text,
  gaps_and_contradictions  text[] NOT NULL DEFAULT '{}'::text[]
);

CREATE INDEX IF NOT EXISTS idx_project_analysis_runs_project_recent
  ON public.project_analysis_runs(project_id, started_at DESC);

ALTER TABLE public.project_analysis_runs ENABLE ROW LEVEL SECURITY;

-- Public can read run metadata (counts, narrative, gaps) — same trust posture
-- as approved detail rows. Writes go through the edge function with service role.
DROP POLICY IF EXISTS "Public read project_analysis_runs" ON public.project_analysis_runs;
CREATE POLICY "Public read project_analysis_runs" ON public.project_analysis_runs FOR SELECT
  USING (true);

-- Moderators can insert directly (the enqueue function uses user JWT, not service role,
-- so RLS applies). Service role bypasses RLS for the drain's writeback.
DROP POLICY IF EXISTS "Moderators insert project_analysis_runs" ON public.project_analysis_runs;
CREATE POLICY "Moderators insert project_analysis_runs" ON public.project_analysis_runs FOR INSERT
  WITH CHECK (public.is_moderator(auth.uid()));

DROP POLICY IF EXISTS "Moderators update project_analysis_runs" ON public.project_analysis_runs;
CREATE POLICY "Moderators update project_analysis_runs" ON public.project_analysis_runs FOR UPDATE
  USING (public.is_moderator(auth.uid()))
  WITH CHECK (public.is_moderator(auth.uid()));
