-- Multi-brief redesign: one "Generate AI briefs" admin click now produces a
-- BATCH of briefs per scope (national + 7 provinces), with the AI deciding
-- how many distinct angles the underlying data supports. Only briefs scored
-- above the importance threshold are marked display_eligible and shown on
-- the homepage carousel. The prior batch's display rows for the same scope
-- get demoted to display_eligible=false by the edge function on insert, so
-- the carousel always reflects the latest run.
--
-- Idempotent; safe to re-run.

ALTER TABLE public.global_briefs
  ADD COLUMN IF NOT EXISTS batch_id          UUID,
  ADD COLUMN IF NOT EXISTS display_eligible  BOOLEAN NOT NULL DEFAULT false;

-- Carousel query lives at:
--   SELECT … FROM global_briefs
--   WHERE display_eligible = true
--   ORDER BY importance DESC NULLS LAST, created_at DESC
--   LIMIT N
-- Existing idx_global_briefs_importance handles the ordering; we add a
-- partial index for the WHERE filter so the carousel never scans demoted rows.
CREATE INDEX IF NOT EXISTS idx_global_briefs_display
  ON public.global_briefs (importance DESC NULLS LAST, created_at DESC)
  WHERE display_eligible = true;

-- Track batches so an admin can see "what did the last run produce" without
-- having to grep by timestamp.
CREATE INDEX IF NOT EXISTS idx_global_briefs_batch
  ON public.global_briefs (batch_id, scope) WHERE batch_id IS NOT NULL;
