-- Multi-image support on projects. Existing cover_image_url stays as the
-- canonical first/hero image (so existing pages and exports work unchanged);
-- image_urls is a curated array used by the new ProjectDetail carousel.
--
-- The AI pipelines (ai-discover-projects, analysis-drain) populate this via
-- Tavily's include_images=true response. No AI judgement involved — we just
-- take the first N unique URLs and store them ordered.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}'::text[];

-- Convenience index — small array, but worth a GIN for "any project with N
-- or more images" filters later.
CREATE INDEX IF NOT EXISTS idx_projects_image_urls_gin
  ON public.projects USING gin (image_urls);
