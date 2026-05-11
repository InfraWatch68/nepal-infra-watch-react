-- Sherlock v2 follow-up: store the queue-drain callback URL and service-role
-- key in a row instead of `app.*` GUCs. Supabase's hosted Postgres denies
-- ALTER DATABASE/ROLE for custom GUCs to non-superusers, so the previous
-- current_setting('app.sherlock_url', true) pattern can't be wired up.
--
-- Storage: a public.sherlock_secrets table with RLS enabled and NO policies.
-- This makes it invisible to anon / authenticated / admin moderators (nobody
-- has a matching policy → nothing visible). The drain function is
-- SECURITY DEFINER owned by `postgres`, which has BYPASSRLS, so it can read.

CREATE TABLE IF NOT EXISTS public.sherlock_secrets (
  id     int PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton row
  url    text NOT NULL,
  key    text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sherlock_secrets ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies. Only BYPASSRLS roles (postgres, service_role on
-- direct DB connections — not via PostgREST) can read.

-- Replace the drain function to read from sherlock_secrets.
CREATE OR REPLACE FUNCTION public.sherlock_drain_queue_once()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url      text;
  v_key      text;
  v_job      record;
  v_body     jsonb;
  v_req_id   bigint;
BEGIN
  SELECT url, key INTO v_url, v_key FROM public.sherlock_secrets WHERE id = 1;

  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'sherlock_drain_queue_once: sherlock_secrets not configured — skipping';
    RETURN jsonb_build_object('skipped', true, 'reason', 'secrets not configured');
  END IF;

  SELECT * INTO v_job
  FROM public.sherlock_jobs
  WHERE status = 'queued'
  ORDER BY priority DESC, enqueued_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('drained', 0);
  END IF;

  UPDATE public.sherlock_jobs
  SET status = 'running', started_at = now()
  WHERE id = v_job.id;

  v_body := v_job.params || jsonb_build_object(
    'aiTag', 'Sherlock',
    'jobId', v_job.id::text
  );

  SELECT net.http_post(
    url := v_url || '/functions/v1/ai-discover-projects',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := v_body,
    timeout_milliseconds := 120000
  ) INTO v_req_id;

  RETURN jsonb_build_object('drained', 1, 'job_id', v_job.id, 'request_id', v_req_id);
END $$;

REVOKE ALL ON FUNCTION public.sherlock_drain_queue_once() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sherlock_drain_queue_once() TO postgres, service_role;
