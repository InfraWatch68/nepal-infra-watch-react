-- RPCs powering the new "Project moderation" admin view.
--
-- 1) project_moderation_summary(p_threshold numeric)
--    Returns one row per APPROVED project with per-bucket approved / pending /
--    pending-at-or-above-threshold counts as a jsonb blob. Cheap enough to
--    keep in-line (one CTE per child table) so we avoid 10× per-project
--    roundtrips from the client.
--
-- 2) bulk_approve_pending(p_project_id bigint, p_threshold numeric)
--    Promotes pending child rows whose confidence_score is >= p_threshold to
--    approved. Sources/updates/milestones lack confidence_score, so they are
--    promoted unconditionally for projects whose parent is approved (matches
--    the cascade trigger trust model). p_project_id = NULL → all approved
--    projects (global mode). Writes one project_reviews row per promotion.
--    Returns counts per table so the UI can toast the result.

CREATE OR REPLACE FUNCTION public.project_moderation_summary(p_threshold numeric DEFAULT 0.85)
RETURNS TABLE (
  project_id           bigint,
  title                text,
  slug                 text,
  confidence_score     numeric,
  total_approved       bigint,
  total_pending        bigint,
  total_pending_eligible bigint,
  buckets              jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  -- One row per (project, bucket). Each bucket has scoped pending eligibility:
  -- detail tables use confidence_score >= threshold, sources/updates have no
  -- score so "eligible" == "pending" (cascade-trusted).
  bucket_counts AS (
    SELECT project_id, 'funding' AS bucket,
      count(*) FILTER (WHERE approval_status = 'approved') AS approved,
      count(*) FILTER (WHERE approval_status = 'pending')  AS pending,
      count(*) FILTER (WHERE approval_status = 'pending' AND confidence_score IS NOT NULL AND confidence_score >= p_threshold) AS pending_eligible
    FROM public.project_funding GROUP BY project_id
    UNION ALL
    SELECT project_id, 'documents',
      count(*) FILTER (WHERE approval_status = 'approved'),
      count(*) FILTER (WHERE approval_status = 'pending'),
      count(*) FILTER (WHERE approval_status = 'pending' AND confidence_score IS NOT NULL AND confidence_score >= p_threshold)
    FROM public.project_documents GROUP BY project_id
    UNION ALL
    SELECT project_id, 'stakeholders',
      count(*) FILTER (WHERE approval_status = 'approved'),
      count(*) FILTER (WHERE approval_status = 'pending'),
      count(*) FILTER (WHERE approval_status = 'pending' AND confidence_score IS NOT NULL AND confidence_score >= p_threshold)
    FROM public.project_stakeholders GROUP BY project_id
    UNION ALL
    SELECT project_id, 'risks',
      count(*) FILTER (WHERE approval_status = 'approved'),
      count(*) FILTER (WHERE approval_status = 'pending'),
      count(*) FILTER (WHERE approval_status = 'pending' AND confidence_score IS NOT NULL AND confidence_score >= p_threshold)
    FROM public.project_risks GROUP BY project_id
    UNION ALL
    SELECT project_id, 'impact',
      count(*) FILTER (WHERE approval_status = 'approved'),
      count(*) FILTER (WHERE approval_status = 'pending'),
      count(*) FILTER (WHERE approval_status = 'pending' AND confidence_score IS NOT NULL AND confidence_score >= p_threshold)
    FROM public.project_impact GROUP BY project_id
    UNION ALL
    SELECT project_id, 'procurement',
      count(*) FILTER (WHERE approval_status = 'approved'),
      count(*) FILTER (WHERE approval_status = 'pending'),
      count(*) FILTER (WHERE approval_status = 'pending' AND confidence_score IS NOT NULL AND confidence_score >= p_threshold)
    FROM public.project_procurement GROUP BY project_id
    UNION ALL
    SELECT project_id, 'compliance',
      count(*) FILTER (WHERE approval_status = 'approved'),
      count(*) FILTER (WHERE approval_status = 'pending'),
      count(*) FILTER (WHERE approval_status = 'pending' AND confidence_score IS NOT NULL AND confidence_score >= p_threshold)
    FROM public.project_compliance GROUP BY project_id
    UNION ALL
    -- sources/updates: cascade-trusted (no confidence column). Eligible == pending.
    SELECT project_id, 'sources',
      count(*) FILTER (WHERE approval_status = 'approved'),
      count(*) FILTER (WHERE approval_status = 'pending'),
      count(*) FILTER (WHERE approval_status = 'pending')
    FROM public.project_sources GROUP BY project_id
    UNION ALL
    SELECT project_id, 'updates',
      count(*) FILTER (WHERE approval_status = 'approved'),
      count(*) FILTER (WHERE approval_status = 'pending'),
      count(*) FILTER (WHERE approval_status = 'pending')
    FROM public.project_updates GROUP BY project_id
  ),
  -- Always emit every bucket name for every approved project, even when zero
  -- rows exist — keeps the client-side expand UI uniform without conditionals.
  all_bucket_names AS (
    SELECT unnest(ARRAY[
      'funding','documents','stakeholders','risks','impact','procurement','compliance','sources','updates'
    ]) AS bucket
  ),
  approved_projects AS (
    SELECT id, title, slug, confidence_score
    FROM public.projects
    WHERE approval_status = 'approved'
  ),
  grid AS (
    SELECT ap.id AS project_id, ap.title, ap.slug, ap.confidence_score, b.bucket
    FROM approved_projects ap CROSS JOIN all_bucket_names b
  ),
  filled AS (
    SELECT g.project_id, g.title, g.slug, g.confidence_score, g.bucket,
      COALESCE(bc.approved, 0)        AS approved,
      COALESCE(bc.pending, 0)         AS pending,
      COALESCE(bc.pending_eligible,0) AS pending_eligible
    FROM grid g
    LEFT JOIN bucket_counts bc
      ON bc.project_id = g.project_id AND bc.bucket = g.bucket
  )
  SELECT
    f.project_id,
    max(f.title)            AS title,
    max(f.slug)             AS slug,
    max(f.confidence_score) AS confidence_score,
    sum(f.approved)::bigint         AS total_approved,
    sum(f.pending)::bigint          AS total_pending,
    sum(f.pending_eligible)::bigint AS total_pending_eligible,
    jsonb_object_agg(f.bucket, jsonb_build_object(
      'approved',         f.approved,
      'pending',          f.pending,
      'pending_eligible', f.pending_eligible
    )) AS buckets
  FROM filled f
  GROUP BY f.project_id
  ORDER BY sum(f.pending) DESC, max(f.title);
$$;

REVOKE ALL ON FUNCTION public.project_moderation_summary(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_moderation_summary(numeric) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.bulk_approve_pending(
  p_project_id bigint  DEFAULT NULL,  -- NULL = all approved projects (global)
  p_threshold  numeric DEFAULT 0.85
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role    text;
  v_counts  jsonb := '{}'::jsonb;
  v_table   text;
  v_n       bigint;
  v_eligible_filter text;
  v_project_filter  text;
  v_audit_note      text;
  v_id_array        bigint[];
BEGIN
  -- Only moderators may bulk-approve.
  IF NOT public.is_moderator(v_user_id) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  -- Caller-visible audit note; mirrors what the old client-side bulk button wrote.
  v_audit_note := format('Bulk-approved (auto-cascade ≥ %s%%)', round(p_threshold * 100));

  v_project_filter := CASE
    WHEN p_project_id IS NULL THEN
      'project_id IN (SELECT id FROM public.projects WHERE approval_status = ''approved'')'
    ELSE
      format('project_id = %L', p_project_id)
  END;

  -- 7 detail tables: gate on confidence_score >= threshold.
  FOREACH v_table IN ARRAY ARRAY[
    'project_funding','project_documents','project_stakeholders','project_risks',
    'project_impact','project_procurement','project_compliance'
  ]
  LOOP
    v_eligible_filter := format(
      'approval_status = ''pending'' AND confidence_score IS NOT NULL AND confidence_score >= %s AND %s',
      p_threshold, v_project_filter
    );

    EXECUTE format(
      'WITH upd AS (UPDATE public.%I SET approval_status = ''approved'', reviewed_by = %L WHERE %s RETURNING id) SELECT array_agg(id) FROM upd',
      v_table, v_user_id, v_eligible_filter
    ) INTO v_id_array;

    v_n := COALESCE(array_length(v_id_array, 1), 0);
    IF v_n > 0 THEN
      INSERT INTO public.project_reviews(target_table, target_id, reviewer_id, reviewer_role, action, notes, was_admin)
      SELECT v_table, id::text, v_user_id, 'admin', 'approved', v_audit_note, true
      FROM unnest(v_id_array) AS t(id);
    END IF;

    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  END LOOP;

  -- Sources / updates: cascade-trusted, no confidence check.
  FOREACH v_table IN ARRAY ARRAY['project_sources','project_updates']
  LOOP
    v_eligible_filter := format(
      'approval_status = ''pending'' AND %s',
      v_project_filter
    );

    EXECUTE format(
      'WITH upd AS (UPDATE public.%I SET approval_status = ''approved'', reviewed_by = %L WHERE %s RETURNING id) SELECT array_agg(id) FROM upd',
      v_table, v_user_id, v_eligible_filter
    ) INTO v_id_array;

    v_n := COALESCE(array_length(v_id_array, 1), 0);
    IF v_n > 0 THEN
      INSERT INTO public.project_reviews(target_table, target_id, reviewer_id, reviewer_role, action, notes, was_admin)
      SELECT v_table, id::text, v_user_id, 'admin', 'approved', v_audit_note, true
      FROM unnest(v_id_array) AS t(id);
    END IF;

    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  END LOOP;

  RETURN v_counts;
END $$;

REVOKE ALL ON FUNCTION public.bulk_approve_pending(bigint, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_approve_pending(bigint, numeric) TO authenticated;
