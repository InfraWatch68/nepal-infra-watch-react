-- Multi-geography projects. Real-world examples: East-West Highway crosses
-- 7 provinces; Madan Bhandari Highway crosses 4; Sikta Irrigation spans
-- 2 districts. The existing single-value columns (province, district,
-- municipality) stay as the primary / administrative-owner location for
-- back-compat — ProjectCard, the hero header, and the Sherlock fan-out
-- all still key off them. The new array columns hold the full span.
--
-- Filter rule (same as sectors): a project surfaces under any geo whose
-- value sits in EITHER the primary column or the array. So filtering by
-- "Koshi" picks up both projects whose admin home is Koshi and projects
-- whose primary is elsewhere but cross through Koshi.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS provinces text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS districts text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS municipalities text[] NOT NULL DEFAULT '{}'::text[];

-- Backfill each from its single-value counterpart so the array view is
-- consistent from day one. Skips rows that already have something there.
UPDATE public.projects SET provinces = ARRAY[province]
  WHERE array_length(provinces, 1) IS NULL AND province IS NOT NULL;
UPDATE public.projects SET districts = ARRAY[district]
  WHERE array_length(districts, 1) IS NULL AND district IS NOT NULL;
UPDATE public.projects SET municipalities = ARRAY[municipality]
  WHERE array_length(municipalities, 1) IS NULL AND municipality IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_provinces_gin     ON public.projects USING gin (provinces);
CREATE INDEX IF NOT EXISTS idx_projects_districts_gin     ON public.projects USING gin (districts);
CREATE INDEX IF NOT EXISTS idx_projects_municipalities_gin ON public.projects USING gin (municipalities);
