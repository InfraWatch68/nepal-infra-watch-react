-- Phase 2: add 5 new source buckets beyond the original 5. Operator can
-- disable any of these from the admin UI if a particular source proves noisy.
--
-- The query templates use {title}/{sector}/{province}/{district} placeholders;
-- the analysis-drain edge function substitutes them per project before
-- firing Tavily.

INSERT INTO public.analysis_buckets(name, query_template, include_domains, max_results, search_depth, topic, days, sort_order, notes)
VALUES
  ('parliament',
   '"{title}" Nepal {sector} parliament OR committee OR budget',
   ARRAY['parliament.gov.np','hr.parliament.gov.np'],
   2, 'advanced', null, null, 60,
   'Federal parliament records — debates, committee reports, budget allocations referencing the project.'),

  ('donor_projects',
   '"{title}" Nepal {sector} project page',
   ARRAY['projects.worldbank.org','adb.org','jica.go.jp','undp.org','ifc.org'],
   2, 'advanced', null, null, 70,
   'Structured per-project pages on donor sites — usually richer for disbursement timelines than the international_org bucket.'),

  ('local_news',
   '"{title}" {district} {sector}',
   ARRAY['onlinekhabar.com','setopati.com','ekantipur.com','nepalitimes.com','annapurnapost.com','myrepublica.nagariknetwork.com','ratopati.com','thehimalayantimes.com'],
   3, 'advanced', null, null, 80,
   'Major Nepali news outlets (English + transliterated). District + sector context yields more local-impact coverage than the generic news bucket.'),

  ('academic',
   '"{title}" Nepal {sector} study OR research OR analysis',
   ARRAY['nepjol.info','researchgate.net','academia.edu','scholar.google.com'],
   2, 'advanced', null, null, 90,
   'Academic and research repositories — useful for impact metrics, methodology, and historical context.'),

  ('district_admin',
   '"{title}" {district} office OR notification',
   ARRAY['gov.np'],
   2, 'advanced', null, null, 100,
   'District administrative office sites. Tavily filters by gov.np; titles often include district name. Best for land acquisition / right-of-way / local notifications.')
ON CONFLICT (name) DO NOTHING;
