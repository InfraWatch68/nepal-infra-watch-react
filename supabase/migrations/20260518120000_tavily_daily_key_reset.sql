-- Tavily quotas reset daily. Clear persisted exhaustion state once per day so
-- a transient or previous-day quota mark does not require manual SQL.

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('tavily-daily-key-reset')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'tavily-daily-key-reset'
);

SELECT cron.schedule(
  'tavily-daily-key-reset',
  '10 0 * * *',
  $cron$
    UPDATE public.api_keys
    SET
      is_exhausted = false,
      exhausted_reason = NULL,
      last_exhausted_at = NULL
    WHERE provider = 'tavily';
  $cron$
);
