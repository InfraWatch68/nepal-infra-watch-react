-- Add ai_tag to every table the local-AI workflows write to.
-- Was on `projects` only; the rollback-by-batch UX needed it on the
-- detail/timeline tables too so a single Rollback click can find and
-- bulk-reject every row a batch produced.
--
-- Idempotent.

ALTER TABLE public.project_funding       ADD COLUMN IF NOT EXISTS ai_tag text;
ALTER TABLE public.project_documents     ADD COLUMN IF NOT EXISTS ai_tag text;
ALTER TABLE public.project_stakeholders  ADD COLUMN IF NOT EXISTS ai_tag text;
ALTER TABLE public.project_risks         ADD COLUMN IF NOT EXISTS ai_tag text;
ALTER TABLE public.project_impact        ADD COLUMN IF NOT EXISTS ai_tag text;
ALTER TABLE public.project_procurement   ADD COLUMN IF NOT EXISTS ai_tag text;
ALTER TABLE public.project_compliance    ADD COLUMN IF NOT EXISTS ai_tag text;
ALTER TABLE public.project_milestones    ADD COLUMN IF NOT EXISTS ai_tag text;
ALTER TABLE public.project_updates       ADD COLUMN IF NOT EXISTS ai_tag text;
ALTER TABLE public.project_sources       ADD COLUMN IF NOT EXISTS ai_tag text;
ALTER TABLE public.project_analysis_runs ADD COLUMN IF NOT EXISTS ai_tag text;
ALTER TABLE public.global_briefs         ADD COLUMN IF NOT EXISTS ai_tag text;
