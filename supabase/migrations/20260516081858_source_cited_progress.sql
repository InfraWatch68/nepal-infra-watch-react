ALTER TABLE public.project_sources
  ADD COLUMN IF NOT EXISTS progress_percent smallint CHECK (progress_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS cited_at date,
  ADD COLUMN IF NOT EXISTS progress_note text;

ALTER TABLE public.project_updates
  ADD COLUMN IF NOT EXISTS progress_percent smallint CHECK (progress_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS cited_at date,
  ADD COLUMN IF NOT EXISTS progress_note text;
