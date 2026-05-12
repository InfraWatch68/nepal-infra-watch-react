-- Retroactive sweep + on-update auto-approve.
--
-- Problem: auto_approve_high_confidence_project() and auto_approve_high_
-- confidence_child_row() only fire BEFORE INSERT. So when a moderator flips
-- the toggle ON (or lowers the threshold), every pending row that *would*
-- have qualified at insert-time stays stuck in 'pending'. Same story for
-- rows whose confidence_score is filled in by a later UPDATE (Sherlock /
-- ai-comprehensive-analysis can land a row at conf=null and patch it later).
--
-- Fixes:
--   1. Add a public.sweep_auto_approve_now() RPC the admin UI can call when
--      it flips the toggle ON or changes threshold. Re-evaluates every
--      pending AI row (project + 7 detail tables + sources/updates/milestones)
--      against current site_settings and flips eligible ones to approved.
--   2. Extend the BEFORE INSERT triggers to also fire BEFORE UPDATE — covers
--      the case where confidence_score is set or raised after the row is
--      already in pending. Idempotent (function short-circuits on non-pending).
--   3. Run sweep_auto_approve_now() once so the current backlog flushes
--      against the existing setting (which is already enabled=true,
--      threshold=0.85).

-- ── 1. RPC: retroactive sweep against current site_settings.
CREATE OR REPLACE FUNCTION public.sweep_auto_approve_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_enabled    boolean;
  v_threshold  numeric;
  v_counts     jsonb := '{}'::jsonb;
  v_table      text;
  v_n          bigint;
  v_id_array   text[];  -- text covers both bigint (projects/sources/updates/milestones) and uuid (7 detail tables)
  v_audit_note text;
BEGIN
  -- Allow service_role calls (no auth.uid()) for backend automation, but
  -- otherwise gate on moderator role like bulk_approve_pending does.
  IF v_user_id IS NOT NULL AND NOT public.is_moderator(v_user_id) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  SELECT auto_approve_enabled, auto_approve_threshold
    INTO v_enabled, v_threshold
    FROM public.site_settings WHERE id = 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN jsonb_build_object('enabled', false, 'approved', 0);
  END IF;

  v_threshold  := COALESCE(v_threshold, 0.85);
  v_audit_note := format('Retroactive auto-approve sweep (≥ %s%%)', round(v_threshold * 100));

  -- 1a. Promote eligible pending PROJECTS first. Their AFTER UPDATE cascade
  -- (trg_approve_child_rows) will then sweep their pending children too, so
  -- those children don't need to satisfy the threshold individually — the
  -- parent-trust model already covers them.
  WITH upd AS (
    UPDATE public.projects
    SET approval_status = 'approved', reviewed_by = v_user_id
    WHERE approval_status = 'pending'
      AND submitted_by_ai = true
      AND confidence_score IS NOT NULL
      AND confidence_score >= v_threshold
    RETURNING id
  )
  SELECT array_agg(id::text) FROM upd INTO v_id_array;

  v_n := COALESCE(array_length(v_id_array, 1), 0);
  IF v_n > 0 THEN
    INSERT INTO public.project_reviews(target_table, target_id, reviewer_id, reviewer_role, action, notes, was_admin)
    SELECT 'projects', id, v_user_id, 'admin', 'approved', v_audit_note, true
    FROM unnest(v_id_array) AS t(id);
  END IF;
  v_counts := v_counts || jsonb_build_object('projects', v_n);

  -- 1b. Detail tables: promote pending high-confidence rows whose own
  -- confidence clears the bar, regardless of parent project state. This
  -- handles ai-comprehensive-analysis output landed against still-pending
  -- projects (which the parent cascade would otherwise miss).
  FOREACH v_table IN ARRAY ARRAY[
    'project_funding','project_documents','project_stakeholders','project_risks',
    'project_impact','project_procurement','project_compliance'
  ]
  LOOP
    EXECUTE format(
      'WITH upd AS (UPDATE public.%I SET approval_status = ''approved'', reviewed_by = %L WHERE approval_status = ''pending'' AND submitted_by_ai = true AND confidence_score IS NOT NULL AND confidence_score >= %s RETURNING id) SELECT array_agg(id::text) FROM upd',
      v_table, v_user_id, v_threshold
    ) INTO v_id_array;
    v_n := COALESCE(array_length(v_id_array, 1), 0);
    IF v_n > 0 THEN
      INSERT INTO public.project_reviews(target_table, target_id, reviewer_id, reviewer_role, action, notes, was_admin)
      SELECT v_table, id, v_user_id, 'admin', 'approved', v_audit_note, true
      FROM unnest(v_id_array) AS t(id);
    END IF;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  END LOOP;

  -- 1c. Sources/updates/milestones: only those with a real confidence score
  -- (older rows without one stay cascade-trusted via the parent flip above).
  FOREACH v_table IN ARRAY ARRAY['project_sources','project_updates','project_milestones']
  LOOP
    EXECUTE format(
      'WITH upd AS (UPDATE public.%I SET approval_status = ''approved'', reviewed_by = %L WHERE approval_status = ''pending'' AND submitted_by_ai = true AND confidence_score IS NOT NULL AND confidence_score >= %s RETURNING id) SELECT array_agg(id::text) FROM upd',
      v_table, v_user_id, v_threshold
    ) INTO v_id_array;
    v_n := COALESCE(array_length(v_id_array, 1), 0);
    IF v_n > 0 THEN
      INSERT INTO public.project_reviews(target_table, target_id, reviewer_id, reviewer_role, action, notes, was_admin)
      SELECT v_table, id, v_user_id, 'admin', 'approved', v_audit_note, true
      FROM unnest(v_id_array) AS t(id);
    END IF;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  END LOOP;

  RETURN jsonb_build_object(
    'enabled',   true,
    'threshold', v_threshold,
    'counts',    v_counts
  );
END $$;

REVOKE ALL ON FUNCTION public.sweep_auto_approve_now() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_auto_approve_now() TO authenticated, service_role;


-- ── 2. Extend the BEFORE INSERT triggers to also fire BEFORE UPDATE, so a
-- pending row whose confidence_score later gets filled / raised auto-approves
-- on that UPDATE. Functions short-circuit when approval_status isn't pending,
-- so re-firing on every UPDATE is cheap and safe.

DROP TRIGGER IF EXISTS trg_auto_approve_high_confidence ON public.projects;
CREATE TRIGGER trg_auto_approve_high_confidence
BEFORE INSERT OR UPDATE OF confidence_score, approval_status, submitted_by_ai
ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_project();

DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_sources ON public.project_sources;
CREATE TRIGGER trg_auto_approve_high_conf_sources
BEFORE INSERT OR UPDATE OF confidence_score, approval_status, submitted_by_ai
ON public.project_sources
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();

DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_updates ON public.project_updates;
CREATE TRIGGER trg_auto_approve_high_conf_updates
BEFORE INSERT OR UPDATE OF confidence_score, approval_status, submitted_by_ai
ON public.project_updates
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();

DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_milestones ON public.project_milestones;
CREATE TRIGGER trg_auto_approve_high_conf_milestones
BEFORE INSERT OR UPDATE OF confidence_score, approval_status, submitted_by_ai
ON public.project_milestones
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();

-- ── 3. Mirror the change on the 7 detail tables. They use the same
-- generic auto_approve_high_confidence_child_row() function, but currently
-- only attach a parent-state cascade trigger (trg_auto_approve_<bucket>).
-- Add a dedicated high-conf trigger so detail rows can self-approve when
-- their parent is still pending but their own confidence is high.
DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_funding ON public.project_funding;
CREATE TRIGGER trg_auto_approve_high_conf_funding
BEFORE INSERT OR UPDATE OF confidence_score, approval_status, submitted_by_ai
ON public.project_funding
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();

DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_documents ON public.project_documents;
CREATE TRIGGER trg_auto_approve_high_conf_documents
BEFORE INSERT OR UPDATE OF confidence_score, approval_status, submitted_by_ai
ON public.project_documents
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();

DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_stakeholders ON public.project_stakeholders;
CREATE TRIGGER trg_auto_approve_high_conf_stakeholders
BEFORE INSERT OR UPDATE OF confidence_score, approval_status, submitted_by_ai
ON public.project_stakeholders
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();

DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_risks ON public.project_risks;
CREATE TRIGGER trg_auto_approve_high_conf_risks
BEFORE INSERT OR UPDATE OF confidence_score, approval_status, submitted_by_ai
ON public.project_risks
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();

DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_impact ON public.project_impact;
CREATE TRIGGER trg_auto_approve_high_conf_impact
BEFORE INSERT OR UPDATE OF confidence_score, approval_status, submitted_by_ai
ON public.project_impact
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();

DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_procurement ON public.project_procurement;
CREATE TRIGGER trg_auto_approve_high_conf_procurement
BEFORE INSERT OR UPDATE OF confidence_score, approval_status, submitted_by_ai
ON public.project_procurement
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();

DROP TRIGGER IF EXISTS trg_auto_approve_high_conf_compliance ON public.project_compliance;
CREATE TRIGGER trg_auto_approve_high_conf_compliance
BEFORE INSERT OR UPDATE OF confidence_score, approval_status, submitted_by_ai
ON public.project_compliance
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_child_row();
