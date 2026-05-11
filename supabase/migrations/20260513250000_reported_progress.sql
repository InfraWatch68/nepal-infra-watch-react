-- Honest progress reporting. Stores the latest progress percentage the AI
-- found stated explicitly in the corpus (e.g. "67% complete as of March 2026"),
-- plus the date that claim is anchored to + the source URL. The UI surfaces
-- "X% as of YYYY-MM-DD · source" instead of derived heuristics.
--
-- Auto-replace policy: analysis-drain overwrites these values whenever it
-- finds a more recent reported_progress_as_of than what's currently stored,
-- so over time the column always reflects the freshest publicly-reported
-- progress figure. Manual edits to projects.progress_percent stay
-- authoritative (separate column).

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS reported_progress_percent numeric(5,2)
    CHECK (reported_progress_percent IS NULL OR (reported_progress_percent >= 0 AND reported_progress_percent <= 100));

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS reported_progress_as_of date;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS reported_progress_source_url text;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS reported_progress_quote text;
