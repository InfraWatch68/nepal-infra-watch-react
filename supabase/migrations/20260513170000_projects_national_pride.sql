-- "Rastra Gaurab Aviyaan" (राष्ट्रिय गौरवका आयोजना) tag for projects. Boolean
-- so it surfaces cleanly in filters and badges. Sherlock + analysis-drain
-- auto-set this when a discovered/analysed project matches the 24-name
-- constants list in src/lib/nationalPride.ts; operators can also flip it
-- manually from the project edit form.
--
-- Partial index keeps lookups for "all National Pride projects" cheap
-- without bloating the column-wide btree.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS national_pride boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_projects_national_pride
  ON public.projects(national_pride) WHERE national_pride = true;
