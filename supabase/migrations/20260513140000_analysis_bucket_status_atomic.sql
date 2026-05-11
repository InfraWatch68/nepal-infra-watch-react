-- Phase 2 polish: atomic jsonb merge for bucket_status updates.
--
-- The drainer fires 10 buckets in parallel via Promise.allSettled. Each
-- bucket reads bucket_status, adds its own key, writes back. With 10
-- concurrent read-modify-writes, occasional updates get clobbered and the
-- corresponding bucket stays at "queued" in the UI even though Tavily
-- actually completed. Routing the merge through this SQL function makes the
-- update atomic at the row level — Postgres serialises the writes.

CREATE OR REPLACE FUNCTION public.analysis_patch_bucket_status(p_run_id uuid, p_bucket text, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.project_analysis_runs
  SET bucket_status = jsonb_set(
        COALESCE(bucket_status, '{}'::jsonb),
        ARRAY[p_bucket],
        COALESCE(bucket_status -> p_bucket, '{}'::jsonb) || p_patch,
        true
      )
  WHERE id = p_run_id;
END $$;

REVOKE ALL ON FUNCTION public.analysis_patch_bucket_status(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analysis_patch_bucket_status(uuid, text, jsonb) TO postgres, service_role;
