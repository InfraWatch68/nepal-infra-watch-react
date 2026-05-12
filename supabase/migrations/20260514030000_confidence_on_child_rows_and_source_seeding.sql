-- Three changes in one drop:
--   1) Add confidence_score to project_sources, project_updates, project_milestones
--      so AI-extracted rows carry the same 0..1 trust signal the detail tables
--      and projects already use.
--   2) Bring project_milestones into the moderation flow (approval_status +
--      submitted_by_ai + reviewed_by). Backfill all existing rows to
--      'approved' so the public Project Detail page doesn't suddenly hide
--      legacy milestones. New AI-extracted milestones will land 'pending'
--      and auto-approve via the same cascade + high-confidence triggers used
--      elsewhere.
--   3) Defensive trigger: when a project transitions to approved, seed
--      project_sources from projects.source_url if no source row covers that
--      URL yet. AI discovery already inserts a source row up front, so this
--      is a safety net for manual submissions and any edge case where the
--      source row was deleted.

-- ── 1. confidence_score on the three child tables.
ALTER TABLE public.project_sources
  ADD COLUMN IF NOT EXISTS confidence_score numeric(3,2)
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1));
ALTER TABLE public.project_updates
  ADD COLUMN IF NOT EXISTS confidence_score numeric(3,2)
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1));
ALTER TABLE public.project_milestones
  ADD COLUMN IF NOT EXISTS confidence_score numeric(3,2)
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1));

-- ── 2. project_milestones gets full moderation parity.
ALTER TABLE public.project_milestones
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS submitted_by_ai boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 3. Generic confidence-based auto-approve for child rows.
-- Mirrors public.auto_approve_high_confidence_project() but for child tables.
-- Reads site_settings.auto_approve_enabled / auto_approve_threshold, so the
-- toggle in the admin UI controls these the same way it controls projects.
CREATE OR REPLACE FUNCTION public.auto_approve_high_confidence_child_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled    boolean;
  v_threshold  numeric;
BEGIN
  IF NEW.submitted_by_ai IS NOT TRUE THEN RETURN NEW; END IF;
  IF NEW.approval_status IS DISTINCT FROM 'pending' THEN RETURN NEW; END IF;
  IF NEW.confidence_score IS NULL THEN RETURN NEW; END IF;

  SELECT auto_approve_enabled, auto_approve_threshold
    INTO v_enabled, v_threshold
    FROM public.site_settings WHERE id = 1;

  IF v_enabled AND NEW.confidence_score >= COALESCE(v_threshold, 0.85) THEN
    NEW.approval_status := 'approved';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.auto_approve_high_confidence_child_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_approve_high_confidence_child_row() TO postgres, service_role;

-- Sources / updates / milestones — three identical BEFORE INSERT triggers that
-- share the same function. The existing parent-approval cascade triggers
-- (trg_auto_approve_sources, trg_auto_approve_updates) still fire — they run
-- *also* BEFORE INSERT, just with a different condition; whichever sets
-- approved first wins, which is fine because the outcome is the same.
DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_sources ON public.project_sources;
CREATE TRIGGER trg_auto_approve_high_conf_sources
BEFORE INSERT ON public.project_sources
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();

DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_updates ON public.project_updates;
CREATE TRIGGER trg_auto_approve_high_conf_updates
BEFORE INSERT ON public.project_updates
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();

DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_milestones ON public.project_milestones;
CREATE TRIGGER trg_auto_approve_high_conf_milestones
BEFORE INSERT ON public.project_milestones
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();

-- ── 4. Bring milestones into the parent-approval cascade and into the
-- "parent is already approved → child skips pending" pattern.
CREATE OR REPLACE FUNCTION public.approve_child_rows_on_project_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approval_status <> 'approved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN RETURN NEW; END IF;

  UPDATE public.project_sources       SET approval_status='approved', reviewed_by=NEW.reviewed_by WHERE project_id=NEW.id AND approval_status='pending';
  UPDATE public.project_updates       SET approval_status='approved', reviewed_by=NEW.reviewed_by WHERE project_id=NEW.id AND approval_status='pending';
  UPDATE public.project_milestones    SET approval_status='approved', reviewed_by=NEW.reviewed_by WHERE project_id=NEW.id AND approval_status='pending';
  UPDATE public.project_funding       SET approval_status='approved', reviewed_by=NEW.reviewed_by WHERE project_id=NEW.id AND approval_status='pending';
  UPDATE public.project_documents     SET approval_status='approved', reviewed_by=NEW.reviewed_by WHERE project_id=NEW.id AND approval_status='pending';
  UPDATE public.project_stakeholders  SET approval_status='approved', reviewed_by=NEW.reviewed_by WHERE project_id=NEW.id AND approval_status='pending';
  UPDATE public.project_risks         SET approval_status='approved', reviewed_by=NEW.reviewed_by WHERE project_id=NEW.id AND approval_status='pending';
  UPDATE public.project_impact        SET approval_status='approved', reviewed_by=NEW.reviewed_by WHERE project_id=NEW.id AND approval_status='pending';
  UPDATE public.project_procurement   SET approval_status='approved', reviewed_by=NEW.reviewed_by WHERE project_id=NEW.id AND approval_status='pending';
  UPDATE public.project_compliance    SET approval_status='approved', reviewed_by=NEW.reviewed_by WHERE project_id=NEW.id AND approval_status='pending';

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_approve_milestones ON public.project_milestones;
CREATE TRIGGER trg_auto_approve_milestones
BEFORE INSERT ON public.project_milestones
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_child_row_for_approved_project();

-- ── 5. Seed project_sources from projects.source_url when a project gets
-- approved and no source row already covers that URL. Belt-and-braces for
-- manual submissions and any AI path that forgot to write its source row.
CREATE OR REPLACE FUNCTION public.seed_project_source_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing int;
BEGIN
  IF NEW.approval_status <> 'approved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN RETURN NEW; END IF;
  IF NEW.source_url IS NULL OR length(trim(NEW.source_url)) = 0 THEN RETURN NEW; END IF;

  -- Skip if a source for this project already references this URL.
  SELECT count(*) INTO v_existing
  FROM public.project_sources
  WHERE project_id = NEW.id
    AND url IS NOT NULL
    AND lower(regexp_replace(url, '^https?://(www\.)?', '', 'i')) =
        lower(regexp_replace(NEW.source_url, '^https?://(www\.)?', '', 'i'));
  IF v_existing > 0 THEN RETURN NEW; END IF;

  INSERT INTO public.project_sources(
    project_id, url, title, source_type, verified, submitted_by_ai, approval_status, reviewed_by
  ) VALUES (
    NEW.id, NEW.source_url,
    NULLIF(split_part(regexp_replace(NEW.source_url, '^https?://(www\.)?', '', 'i'), '/', 1), ''),
    COALESCE(NEW.source_type, 'article'),
    false, NEW.submitted_by_ai, 'approved', NEW.reviewed_by
  );
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.seed_project_source_on_approval() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_project_source_on_approval() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_seed_project_source_on_approval ON public.projects;
CREATE TRIGGER trg_seed_project_source_on_approval
AFTER INSERT OR UPDATE OF approval_status ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.seed_project_source_on_approval();

-- ── 6. Update project_moderation_summary to include milestones.
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
    SELECT project_id, 'sources',
      count(*) FILTER (WHERE approval_status = 'approved'),
      count(*) FILTER (WHERE approval_status = 'pending'),
      -- sources/updates/milestones may or may not carry confidence_score
      -- (AI-extracted rows do; legacy/manual ones don't). Treat null as
      -- ineligible-by-threshold so the eligible count is conservative.
      count(*) FILTER (WHERE approval_status = 'pending' AND confidence_score IS NOT NULL AND confidence_score >= p_threshold)
    FROM public.project_sources GROUP BY project_id
    UNION ALL
    SELECT project_id, 'updates',
      count(*) FILTER (WHERE approval_status = 'approved'),
      count(*) FILTER (WHERE approval_status = 'pending'),
      count(*) FILTER (WHERE approval_status = 'pending' AND confidence_score IS NOT NULL AND confidence_score >= p_threshold)
    FROM public.project_updates GROUP BY project_id
    UNION ALL
    SELECT project_id, 'milestones',
      count(*) FILTER (WHERE approval_status = 'approved'),
      count(*) FILTER (WHERE approval_status = 'pending'),
      count(*) FILTER (WHERE approval_status = 'pending' AND confidence_score IS NOT NULL AND confidence_score >= p_threshold)
    FROM public.project_milestones GROUP BY project_id
  ),
  all_bucket_names AS (
    SELECT unnest(ARRAY[
      'funding','documents','stakeholders','risks','impact','procurement','compliance','sources','updates','milestones'
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

-- Re-grant after redefinition.
REVOKE ALL ON FUNCTION public.project_moderation_summary(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_moderation_summary(numeric) TO authenticated, service_role;

-- Also extend bulk_approve_pending to cover milestones (cascade-trusted plus
-- confidence-gated for AI rows on pending projects).
CREATE OR REPLACE FUNCTION public.bulk_approve_pending(
  p_project_id bigint  DEFAULT NULL,
  p_threshold  numeric DEFAULT 0.85
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_counts  jsonb := '{}'::jsonb;
  v_table   text;
  v_n       bigint;
  v_eligible_filter text;
  v_project_filter  text;
  v_audit_note      text;
  v_id_array        bigint[];
BEGIN
  IF NOT public.is_moderator(v_user_id) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

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

  -- Sources / updates / milestones: cascade-trusted, no confidence check
  -- (they're auto-approved when the parent project is approved anyway —
  -- this branch handles the case where a moderator clicks "approve eligible"
  -- on a still-pending project's children).
  FOREACH v_table IN ARRAY ARRAY['project_sources','project_updates','project_milestones']
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
