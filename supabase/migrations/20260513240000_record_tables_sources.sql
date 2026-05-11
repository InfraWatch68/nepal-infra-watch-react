-- Add `sources` jsonb to project_milestones and project_updates so the
-- Trace History pipeline can attach citation URLs (matching the shape used
-- by the 7 comprehensive detail tables). The UI's existing SourceLink
-- component handles both legacy string[] and the new [{url, published_at}]
-- shape automatically.

ALTER TABLE public.project_milestones
  ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.project_updates
  ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;
