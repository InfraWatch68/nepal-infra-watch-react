-- Multi-sector projects. Existing `sector` column (single value, NOT NULL)
-- stays as the primary/canonical sector for back-compat — ProjectCard,
-- analytics buckets, and the Sherlock fan-out all still key off it. The
-- new `sectors text[]` column carries the full list of relevant sectors
-- (e.g. Hydropower projects often touch Energy + Water & Sanitation +
-- Agriculture & Irrigation). Filtering matches a project whenever the
-- selected sector is in EITHER column.
--
-- Backfill: every existing row gets sectors = [sector] so the array view
-- is consistent from day one.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS sectors text[] NOT NULL DEFAULT '{}'::text[];

-- One-time backfill. Safe to re-run; the WHERE clause skips already-populated rows.
UPDATE public.projects
SET sectors = ARRAY[sector]
WHERE array_length(sectors, 1) IS NULL AND sector IS NOT NULL;

-- GIN index lets Browse / Analytics filter by sectors @> ARRAY[?] cheaply.
CREATE INDEX IF NOT EXISTS idx_projects_sectors_gin
  ON public.projects USING gin (sectors);
