-- Phase 2: bucket definitions live in a table instead of being hardcoded in
-- supabase/functions/analysis-drain/index.ts. Operator can add, retune, or
-- disable a bucket from the admin UI without redeploying the function.
--
-- query_template supports lightweight substitution: {title}, {sector},
-- {province}, {district}. Empty values are stripped before the search fires.
-- include_domains is a Tavily allowlist; null/empty = "all domains".
-- sector_filter (optional) restricts the bucket to projects whose sector
-- matches one of the listed values — lets us add hydropower-specific or
-- hospital-specific buckets without polluting unrelated projects.

CREATE TABLE IF NOT EXISTS public.analysis_buckets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  query_template  text NOT NULL,
  include_domains text[] NOT NULL DEFAULT '{}'::text[],
  max_results     int NOT NULL DEFAULT 3 CHECK (max_results BETWEEN 1 AND 10),
  search_depth    text NOT NULL DEFAULT 'advanced' CHECK (search_depth IN ('basic','advanced')),
  topic           text,  -- 'news' to use Tavily's news topic; null otherwise
  days            int,   -- only meaningful when topic='news'
  sector_filter   text[] NOT NULL DEFAULT '{}'::text[],  -- empty = applies to all projects
  enabled         boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 100,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_buckets_enabled
  ON public.analysis_buckets(enabled, sort_order);

ALTER TABLE public.analysis_buckets ENABLE ROW LEVEL SECURITY;

-- Public read so the admin UI can render the bucket list. Writes restricted
-- to moderators. The drain edge function uses service-role anyway.
DROP POLICY IF EXISTS "Public read analysis_buckets" ON public.analysis_buckets;
CREATE POLICY "Public read analysis_buckets" ON public.analysis_buckets FOR SELECT USING (true);

DROP POLICY IF EXISTS "Moderators manage analysis_buckets" ON public.analysis_buckets;
CREATE POLICY "Moderators manage analysis_buckets" ON public.analysis_buckets FOR ALL
  USING (public.is_moderator(auth.uid()))
  WITH CHECK (public.is_moderator(auth.uid()));

-- Seed: the 5 buckets that used to be hardcoded in analysis-drain.
-- Phase 2 follow-up migration adds the 5 new ones.
INSERT INTO public.analysis_buckets(name, query_template, include_domains, max_results, search_depth, topic, days, sort_order, notes)
VALUES
  ('news',
   '"{title}" Nepal {sector} {province}',
   '{}'::text[], 3, 'advanced', 'news', 365, 10,
   'General news coverage (last 365 days). Strongest for status updates and controversies.'),
  ('government',
   '"{title}" Nepal {sector} {province} ministry OR department OR government',
   ARRAY['gov.np','mof.gov.np','moenv.gov.np','moewri.gov.np','mopit.gov.np','moald.gov.np'],
   3, 'advanced', null, null, 20,
   'Nepali government ministries + departments. Highest authority for regulatory facts.'),
  ('procurement',
   '"{title}" Nepal {sector} {province} tender OR contract OR bidding',
   ARRAY['ppmo.gov.np','bolpatra.gov.np'],
   3, 'advanced', null, null, 30,
   'Public Procurement Monitoring Office + Bolpatra tender portal.'),
  ('audit_compliance',
   '"{title}" Nepal {sector} {province} audit OR EIA OR environmental clearance OR forest clearance OR blacklist',
   ARRAY['oag.gov.np','ciaa.gov.np','moenv.gov.np','doed.gov.np'],
   3, 'advanced', null, null, 40,
   'Office of the Auditor General, CIAA, MoEnv, Department of Electricity Development.'),
  ('international_org',
   '"{title}" Nepal {sector} {province} financing OR loan OR grant OR funding',
   ARRAY['worldbank.org','adb.org','undp.org','ifc.org','jica.go.jp','kfw.de'],
   3, 'advanced', null, null, 50,
   'Multilateral + bilateral development banks. Strongest for funding amounts and disbursement schedules.')
ON CONFLICT (name) DO NOTHING;
