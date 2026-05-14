-- Add an AI-scored importance column to global_briefs.
--
-- The new daily-briefs cron (5 AM Nepal time) generates 1 national + 7
-- provincial briefs per run and the AI now self-rates each on a 0.00-1.00
-- importance scale based on data salience (flagship slips, audit findings,
-- budget jumps, critical-risk openings, etc.). The home page
-- HomeBriefCarousel uses this score to pick the top 5 across all scopes —
-- so a quiet Karnali day with importance 0.32 doesn't crowd out a
-- noisier Bagmati brief at 0.91.
--
-- Idempotent; safe to re-run.

ALTER TABLE public.global_briefs
  ADD COLUMN IF NOT EXISTS importance REAL;

-- Index supports the home-carousel query:
--   ORDER BY importance DESC NULLS LAST, created_at DESC LIMIT 5
-- across all rows regardless of scope.
CREATE INDEX IF NOT EXISTS idx_global_briefs_importance
  ON public.global_briefs (importance DESC NULLS LAST, created_at DESC);
