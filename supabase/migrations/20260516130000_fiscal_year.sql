-- Track which Nepal fiscal year a project's budget was allocated in.
--
-- Nepal's fiscal year runs from Shrawan 1 (≈ mid-July) to Ashad end
-- (≈ mid-July the following year). The conventional label is "2081/82"
-- (Bikram Sambat start year / last two digits of end year).
--
-- projects.fiscal_year          — primary allocation year of the project
-- project_funding.fiscal_year   — per-tranche fiscal year for multi-year funding

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS fiscal_year text;

ALTER TABLE public.project_funding
  ADD COLUMN IF NOT EXISTS fiscal_year text;

CREATE INDEX IF NOT EXISTS idx_projects_fiscal_year
  ON public.projects(fiscal_year)
  WHERE fiscal_year IS NOT NULL;
