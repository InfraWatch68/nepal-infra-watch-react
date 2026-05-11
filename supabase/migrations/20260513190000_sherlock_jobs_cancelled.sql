-- Add 'cancelled' as a permitted status on sherlock_jobs so operators can
-- cancel a queued/running job mid-flight from the admin UI. analysis_jobs
-- already permits this status (see 20260513120000_analysis_jobs.sql).
--
-- Cancelling a `queued` row simply takes it off the drainer's pickup list.
-- Cancelling a `running` row marks operator intent; the in-flight edge fn
-- may still complete and burn its tokens, but the UI reflects "cancelled".

ALTER TABLE public.sherlock_jobs DROP CONSTRAINT IF EXISTS sherlock_jobs_status_check;
ALTER TABLE public.sherlock_jobs ADD CONSTRAINT sherlock_jobs_status_check
  CHECK (status IN ('queued','running','done','failed','cancelled'));
