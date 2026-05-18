CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_projects_title_trgm
  ON public.projects USING gin ((lower(title)) gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.find_duplicate_projects(p_min_similarity float DEFAULT 0.55)
RETURNS TABLE (
  project_a_id bigint,
  project_b_id bigint,
  title_a text,
  title_b text,
  similarity_score float,
  district text,
  province text,
  sector text,
  status_a text,
  status_b text,
  created_a timestamptz,
  created_b timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    a.id::bigint AS project_a_id,
    b.id::bigint AS project_b_id,
    a.title AS title_a,
    b.title AS title_b,
    similarity(lower(a.title), lower(b.title))::float AS similarity_score,
    a.district,
    COALESCE(a.province, b.province) AS province,
    COALESCE(a.sector, b.sector) AS sector,
    a.approval_status::text AS status_a,
    b.approval_status::text AS status_b,
    a.created_at AS created_a,
    b.created_at AS created_b
  FROM public.projects a
  JOIN public.projects b
    ON a.id < b.id
   AND a.district = b.district
   AND a.district IS NOT NULL
   AND a.approval_status IN ('approved', 'pending')
   AND b.approval_status IN ('approved', 'pending')
   AND similarity(lower(a.title), lower(b.title)) >= p_min_similarity
  ORDER BY similarity_score DESC, a.created_at DESC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_projects(p_canonical_id bigint, p_duplicate_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_table text;
  v_count int;
  v_moved jsonb := '{}'::jsonb;
  v_copied text[] := ARRAY[]::text[];
  v_col text;
  v_updated int;
  v_duplicate_exists boolean;
  v_canonical_exists boolean;
  v_detail_tables text[] := ARRAY[
    'project_funding',
    'project_documents',
    'project_stakeholders',
    'project_risks',
    'project_impact',
    'project_procurement',
    'project_compliance',
    'project_updates',
    'project_sources',
    'project_milestones',
    'analysis_jobs',
    'project_analysis_runs'
  ];
  v_backfill_columns text[] := ARRAY[
    'description',
    'coordinates',
    'fiscal_year',
    'start_date',
    'end_date',
    'expected_completion',
    'budget_npr',
    'cover_image_url',
    'province',
    'district',
    'sector',
    'status',
    'progress_percent',
    'progress_stage'
  ];
BEGIN
  IF NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_canonical_id IS NULL OR p_duplicate_id IS NULL OR p_canonical_id = p_duplicate_id THEN
    RAISE EXCEPTION 'canonical and duplicate project ids must be different';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.projects WHERE id = p_canonical_id) INTO v_canonical_exists;
  SELECT EXISTS (SELECT 1 FROM public.projects WHERE id = p_duplicate_id) INTO v_duplicate_exists;

  IF NOT v_canonical_exists THEN
    RAISE EXCEPTION 'canonical project % not found', p_canonical_id;
  END IF;
  IF NOT v_duplicate_exists THEN
    RAISE EXCEPTION 'duplicate project % not found', p_duplicate_id;
  END IF;

  FOREACH v_col IN ARRAY v_backfill_columns LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'projects'
        AND column_name = v_col
    ) THEN
      EXECUTE format(
        'UPDATE public.projects c
            SET %1$I = d.%1$I
           FROM public.projects d
          WHERE c.id = $1
            AND d.id = $2
            AND c.%1$I IS NULL
            AND d.%1$I IS NOT NULL',
        v_col
      )
      USING p_canonical_id, p_duplicate_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated > 0 THEN
        v_copied := array_append(v_copied, v_col);
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'reported_progress_percent'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'reported_progress_as_of'
  ) THEN
    UPDATE public.projects c
       SET reported_progress_percent = d.reported_progress_percent,
           reported_progress_as_of = d.reported_progress_as_of
      FROM public.projects d
     WHERE c.id = p_canonical_id
       AND d.id = p_duplicate_id
       AND d.reported_progress_percent IS NOT NULL
       AND (
         c.reported_progress_percent IS NULL
         OR c.reported_progress_as_of IS NULL
         OR (d.reported_progress_as_of IS NOT NULL AND d.reported_progress_as_of > c.reported_progress_as_of)
       );
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      v_copied := array_append(v_copied, 'reported_progress_percent');
      v_copied := array_append(v_copied, 'reported_progress_as_of');
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'reported_progress_percent'
  ) THEN
    UPDATE public.projects c
       SET reported_progress_percent = d.reported_progress_percent
      FROM public.projects d
     WHERE c.id = p_canonical_id
       AND d.id = p_duplicate_id
       AND c.reported_progress_percent IS NULL
       AND d.reported_progress_percent IS NOT NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN v_copied := array_append(v_copied, 'reported_progress_percent'); END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'last_comprehensive_analysis_at'
  ) THEN
    UPDATE public.projects c
       SET last_comprehensive_analysis_at = GREATEST(c.last_comprehensive_analysis_at, d.last_comprehensive_analysis_at)
      FROM public.projects d
     WHERE c.id = p_canonical_id
       AND d.id = p_duplicate_id
       AND d.last_comprehensive_analysis_at IS NOT NULL
       AND (
         c.last_comprehensive_analysis_at IS NULL
         OR d.last_comprehensive_analysis_at > c.last_comprehensive_analysis_at
       );
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN v_copied := array_append(v_copied, 'last_comprehensive_analysis_at'); END IF;
  END IF;

  FOREACH v_table IN ARRAY v_detail_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'project_id'
    ) THEN
      EXECUTE format('UPDATE public.%I SET project_id = $1 WHERE project_id = $2', v_table)
        USING p_canonical_id, p_duplicate_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_moved := v_moved || jsonb_build_object(v_table, v_count);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'project_reviews'
  ) THEN
    UPDATE public.project_reviews
       SET target_id = p_canonical_id::text
     WHERE target_table = 'projects'
       AND target_id = p_duplicate_id::text;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_moved := v_moved || jsonb_build_object('project_reviews', v_count);
  END IF;

  DELETE FROM public.projects WHERE id = p_duplicate_id;

  RETURN jsonb_build_object(
    'moved_rows_per_table', v_moved,
    'copied_columns', COALESCE(to_jsonb(v_copied), '[]'::jsonb),
    'deleted_duplicate_id', p_duplicate_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_duplicate_project(p_duplicate_id bigint, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_reason_col text;
  v_reviewed_col_exists boolean;
  v_updated int;
BEGIN
  IF NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_duplicate_id IS NULL THEN
    RAISE EXCEPTION 'duplicate project id is required';
  END IF;

  SELECT column_name
    INTO v_reason_col
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'projects'
    AND column_name IN ('review_reason', 'review_notes')
  ORDER BY CASE column_name WHEN 'review_reason' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'reviewed_at'
  ) INTO v_reviewed_col_exists;

  IF v_reason_col IS NOT NULL AND v_reviewed_col_exists THEN
    EXECUTE format(
      'UPDATE public.projects
          SET approval_status = ''rejected'',
              %1$I = COALESCE($2, ''duplicate''),
              reviewed_at = now()
        WHERE id = $1',
      v_reason_col
    )
    USING p_duplicate_id, p_reason;
  ELSIF v_reason_col IS NOT NULL THEN
    EXECUTE format(
      'UPDATE public.projects
          SET approval_status = ''rejected'',
              %1$I = COALESCE($2, ''duplicate'')
        WHERE id = $1',
      v_reason_col
    )
    USING p_duplicate_id, p_reason;
  ELSIF v_reviewed_col_exists THEN
    UPDATE public.projects
       SET approval_status = 'rejected',
           reviewed_at = now()
     WHERE id = p_duplicate_id;
  ELSE
    UPDATE public.projects
       SET approval_status = 'rejected'
     WHERE id = p_duplicate_id;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'project % not found', p_duplicate_id;
  END IF;

  RETURN jsonb_build_object(
    'deleted_duplicate_id', p_duplicate_id,
    'soft_deleted', true,
    'reason', COALESCE(p_reason, 'duplicate')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.find_duplicate_projects(float) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_projects(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_duplicate_project(bigint, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.find_duplicate_projects(float) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_projects(bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_duplicate_project(bigint, text) TO authenticated;
