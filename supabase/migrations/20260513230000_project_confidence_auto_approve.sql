-- Project-level confidence score + opt-in auto-approval for high-confidence
-- AI submissions. Manual submissions stay confidence=null and follow the
-- normal moderation flow.
--
-- When auto-approval fires it cascades through existing triggers:
--   trg_queue_analysis_on_approval  → enqueues a comprehensive analysis run
--   trg_approve_child_rows          → flips pending sources/updates to approved

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS confidence_score numeric(3,2)
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1));

-- Singleton site settings row. Future site-wide toggles can pile onto this.
CREATE TABLE IF NOT EXISTS public.site_settings (
  id                       int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  auto_approve_enabled     boolean NOT NULL DEFAULT false,
  auto_approve_threshold   numeric(3,2) NOT NULL DEFAULT 0.85
    CHECK (auto_approve_threshold >= 0 AND auto_approve_threshold <= 1),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.site_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read site_settings" ON public.site_settings;
CREATE POLICY "Public read site_settings" ON public.site_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Moderators update site_settings" ON public.site_settings;
CREATE POLICY "Moderators update site_settings" ON public.site_settings FOR UPDATE
  USING (public.is_moderator(auth.uid())) WITH CHECK (public.is_moderator(auth.uid()));

-- Auto-approve trigger. Runs BEFORE INSERT so we can mutate NEW.approval_status
-- in place (cleaner than a chained AFTER trigger that would re-fire other
-- approval-cascade triggers twice).
CREATE OR REPLACE FUNCTION public.auto_approve_high_confidence_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled    boolean;
  v_threshold  numeric;
BEGIN
  -- Only consider AI-submitted, currently-pending rows with a real score.
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

REVOKE ALL ON FUNCTION public.auto_approve_high_confidence_project() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_approve_high_confidence_project() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_auto_approve_high_confidence ON public.projects;
CREATE TRIGGER trg_auto_approve_high_confidence
BEFORE INSERT ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_high_confidence_project();
