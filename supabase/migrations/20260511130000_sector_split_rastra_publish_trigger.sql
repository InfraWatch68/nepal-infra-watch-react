-- Group B/C/G changes — already applied to live DB on 2026-05-11.
--
-- 1. Sector taxonomy split (B3): SECTORS becomes thematic-only (Transport,
--    Energy, …) and project_type carries the physical-artifact list. Existing
--    rows are remapped from the legacy mixed list.
--
-- 2. Rastra Gaurav classification (C5): boolean flag for national-pride
--    projects, shown as a star badge on cards and as a filter chip on Browse.
--
-- 3. Server-side publish-delay enforcement (G2): a BEFORE trigger forces
--    `published_at = now() + 24h` for any reviewer-level approval, regardless
--    of what the client sent. Admin/coadmin and service-role calls keep
--    whatever published_at they set so AI batch flows and admin overrides
--    work normally.

-- 1. Sector remap
UPDATE public.projects SET sector = CASE sector
  WHEN 'Roads & Highways'    THEN 'Transport'
  WHEN 'Bridges'             THEN 'Transport'
  WHEN 'Bridge'              THEN 'Transport'
  WHEN 'Airports'            THEN 'Transport'
  WHEN 'Railways'            THEN 'Transport'
  WHEN 'Roads'               THEN 'Transport'
  WHEN 'Hydropower'          THEN 'Energy'
  WHEN 'Energy Transmission' THEN 'Energy'
  WHEN 'Water Supply'        THEN 'Water & Sanitation'
  WHEN 'Irrigation'          THEN 'Agriculture & Irrigation'
  WHEN 'Healthcare'          THEN 'Health'
  WHEN 'Hospitals'           THEN 'Health'
  WHEN 'Schools'             THEN 'Education'
  ELSE sector
END
WHERE sector IN ('Roads & Highways','Bridges','Bridge','Airports','Railways','Roads',
                 'Hydropower','Energy Transmission','Water Supply','Irrigation',
                 'Healthcare','Hospitals','Schools');

-- 2. Rastra Gaurav flag
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS is_rastra_gaurav boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_projects_rastra_gaurav ON public.projects(is_rastra_gaurav)
  WHERE is_rastra_gaurav = true;

-- 3. Publish-delay trigger
CREATE OR REPLACE FUNCTION public.tg_enforce_publish_delay()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; is_admin_or_co boolean;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN NEW; END IF;
  IF NEW.approval_status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.approval_status IS DISTINCT FROM 'approved') THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = uid AND role IN ('admin','coadmin')
    ) INTO is_admin_or_co;
    IF NOT is_admin_or_co THEN
      NEW.published_at := now() + interval '24 hours';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text; tables text[] := ARRAY[
  'projects','project_updates','project_sources','project_funding','project_documents',
  'project_stakeholders','project_risks','project_impact','project_procurement','project_compliance'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_enforce_publish_delay ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_enforce_publish_delay BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_publish_delay()', t);
  END LOOP;
END $$;
