-- Add `confidence_score` to all 7 project detail tables so the AI can rate
-- each extracted row 0.00-1.00. Reviewers see a High/Med/Low badge per row;
-- a future bulk-approve flow can fast-track confidence >= 0.8.
--
-- Existing rows stay NULL ("unknown / legacy"). Manual moderator additions
-- also leave it NULL — the UI treats NULL as "no AI scoring".

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'project_funding','project_documents','project_stakeholders','project_risks',
    'project_impact','project_procurement','project_compliance'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS confidence_score numeric(3,2) '
      'CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1))',
      t
    );
  END LOOP;
END $$;
