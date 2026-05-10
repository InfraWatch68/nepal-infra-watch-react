-- Comprehensive project-detail expansion: financing, procurement, documents,
-- stakeholders, risks, compliance, impact. Mirrors the approval-workflow pattern
-- used by project_updates / project_sources so AI-submitted rows land as 'pending'
-- and moderators (admin / coadmin / reviewer) approve them.
--
-- All new tables: project_id FK with ON DELETE CASCADE, RLS on, public read of
-- approved rows, moderator full access. A trigger keeps updated_at fresh where
-- present.

-- (Reuses public.tg_set_updated_at() defined in the initial schema migration.)

-- --------------------------------------------------------------------------
-- Extra columns on projects: finer geography, project_type, rolled-up totals
-- and a marker for the comprehensive-analysis run timestamp.
-- --------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS municipality              text,
  ADD COLUMN IF NOT EXISTS ward                      smallint,
  ADD COLUMN IF NOT EXISTS project_type              text,
  ADD COLUMN IF NOT EXISTS procurement_method        text,
  ADD COLUMN IF NOT EXISTS funding_committed_npr     numeric,
  ADD COLUMN IF NOT EXISTS funding_disbursed_npr     numeric,
  ADD COLUMN IF NOT EXISTS estimated_beneficiaries   integer,
  ADD COLUMN IF NOT EXISTS esia_status               text,
  ADD COLUMN IF NOT EXISTS last_audit_at             timestamptz,
  ADD COLUMN IF NOT EXISTS last_audit_finding        text,
  ADD COLUMN IF NOT EXISTS last_comprehensive_analysis_at timestamptz;

-- ==========================================================================
-- 1. project_funding — financing sources & disbursements
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.project_funding (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_name       text NOT NULL,
  source_type       text NOT NULL CHECK (source_type IN
                      ('government','multilateral','bilateral','private','loan','grant','equity','ppp','other')),
  amount_npr        numeric,
  amount_usd        numeric,
  currency          text DEFAULT 'NPR',
  committed_at      date,
  disbursed_amount  numeric,
  lender_terms      text,
  notes             text,
  source_url        text,
  approval_status   text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  submitted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by_ai   boolean NOT NULL DEFAULT false,
  reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_funding_project    ON public.project_funding(project_id);
CREATE INDEX IF NOT EXISTS idx_project_funding_approval   ON public.project_funding(approval_status);
DROP TRIGGER IF EXISTS trg_project_funding_updated_at     ON public.project_funding;
CREATE TRIGGER trg_project_funding_updated_at BEFORE UPDATE ON public.project_funding
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ==========================================================================
-- 2. project_documents — EIA, contracts, audits, completion reports, etc.
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.project_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title             text NOT NULL,
  doc_type          text NOT NULL CHECK (doc_type IN
                      ('eia','iee','contract','tender','audit','progress_report',
                       'completion_report','blueprint','financial','press_release','legal','other')),
  url               text NOT NULL,
  source_org        text,
  language          text DEFAULT 'en',
  published_at      date,
  file_size_bytes   bigint,
  notes             text,
  approval_status   text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  submitted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by_ai   boolean NOT NULL DEFAULT false,
  reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_documents_project  ON public.project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_project_documents_approval ON public.project_documents(approval_status);
CREATE INDEX IF NOT EXISTS idx_project_documents_type     ON public.project_documents(doc_type);
DROP TRIGGER IF EXISTS trg_project_documents_updated_at   ON public.project_documents;
CREATE TRIGGER trg_project_documents_updated_at BEFORE UPDATE ON public.project_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ==========================================================================
-- 3. project_stakeholders — ministries, donors, consultants, sub-contractors
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.project_stakeholders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN
                      ('implementing_agency','executing_ministry','contractor','sub_contractor',
                       'consultant','donor','beneficiary','regulator','community','other')),
  org_name          text NOT NULL,
  contact_name      text,
  contact_email     text,
  contact_phone     text,
  website           text,
  country           text,
  notes             text,
  source_url        text,
  approval_status   text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  submitted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by_ai   boolean NOT NULL DEFAULT false,
  reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_stakeholders_project  ON public.project_stakeholders(project_id);
CREATE INDEX IF NOT EXISTS idx_project_stakeholders_approval ON public.project_stakeholders(approval_status);
DROP TRIGGER IF EXISTS trg_project_stakeholders_updated_at   ON public.project_stakeholders;
CREATE TRIGGER trg_project_stakeholders_updated_at BEFORE UPDATE ON public.project_stakeholders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ==========================================================================
-- 4. project_risks — formal risk / issue register
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.project_risks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category          text NOT NULL CHECK (category IN
                      ('financial','legal','environmental','social','political','technical','schedule','audit','corruption','other')),
  severity          text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  title             text NOT NULL,
  description       text,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','mitigated','closed','escalated')),
  reported_at       date,
  resolved_at       date,
  source_url        text,
  approval_status   text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  submitted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by_ai   boolean NOT NULL DEFAULT false,
  reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_risks_project   ON public.project_risks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_risks_approval  ON public.project_risks(approval_status);
CREATE INDEX IF NOT EXISTS idx_project_risks_severity  ON public.project_risks(severity);
DROP TRIGGER IF EXISTS trg_project_risks_updated_at    ON public.project_risks;
CREATE TRIGGER trg_project_risks_updated_at BEFORE UPDATE ON public.project_risks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ==========================================================================
-- 5. project_impact — beneficiaries, jobs, environmental impact metrics
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.project_impact (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  metric_type       text NOT NULL CHECK (metric_type IN
                      ('beneficiaries','jobs_temporary','jobs_permanent','displacement',
                       'area_served_sq_km','households_served','co2_reduction_t',
                       'revenue_generated_npr','energy_capacity_mw','water_capacity_mld','other')),
  metric_value      numeric,
  unit              text,
  baseline_value    numeric,
  target_value      numeric,
  measured_at       date,
  methodology       text,
  notes             text,
  source_url        text,
  approval_status   text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  submitted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by_ai   boolean NOT NULL DEFAULT false,
  reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_impact_project  ON public.project_impact(project_id);
CREATE INDEX IF NOT EXISTS idx_project_impact_approval ON public.project_impact(approval_status);
DROP TRIGGER IF EXISTS trg_project_impact_updated_at   ON public.project_impact;
CREATE TRIGGER trg_project_impact_updated_at BEFORE UPDATE ON public.project_impact
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ==========================================================================
-- 6. project_procurement — tenders, bids, contract awards
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.project_procurement (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tender_id_external    text,
  tender_title          text NOT NULL,
  tender_url            text,
  tender_published_at   date,
  bid_open_at           date,
  contract_awarded_at   date,
  awardee_name          text,
  awardee_id            text,
  contract_value_npr    numeric,
  contract_type         text CHECK (contract_type IN
                          ('epc','design_build','itb','icb','ncb','limited','direct','framework','ppp','other')
                          OR contract_type IS NULL),
  procurement_method    text,
  status                text NOT NULL DEFAULT 'planned' CHECK (status IN
                          ('planned','published','bidding','evaluation','awarded','cancelled','disputed')),
  source_url            text,
  notes                 text,
  approval_status       text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  submitted_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by_ai       boolean NOT NULL DEFAULT false,
  reviewed_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes          text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_procurement_project  ON public.project_procurement(project_id);
CREATE INDEX IF NOT EXISTS idx_project_procurement_approval ON public.project_procurement(approval_status);
CREATE INDEX IF NOT EXISTS idx_project_procurement_status   ON public.project_procurement(status);
DROP TRIGGER IF EXISTS trg_project_procurement_updated_at   ON public.project_procurement;
CREATE TRIGGER trg_project_procurement_updated_at BEFORE UPDATE ON public.project_procurement
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ==========================================================================
-- 7. project_compliance — EIA/IEE, land, audits (OAG/CIAA), blacklist
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.project_compliance (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  item_type         text NOT NULL CHECK (item_type IN
                      ('eia','iee','land_acquisition','right_of_way','forest_clearance',
                       'social_impact','audit_oag','audit_ciaa','blacklist','court_case','other')),
  status            text NOT NULL DEFAULT 'not_started' CHECK (status IN
                      ('not_started','in_progress','approved','rejected','conditional','blacklisted','dismissed','pending')),
  authority         text,
  decided_at        date,
  document_url      text,
  finding           text,
  notes             text,
  source_url        text,
  approval_status   text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  submitted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by_ai   boolean NOT NULL DEFAULT false,
  reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_compliance_project  ON public.project_compliance(project_id);
CREATE INDEX IF NOT EXISTS idx_project_compliance_approval ON public.project_compliance(approval_status);
CREATE INDEX IF NOT EXISTS idx_project_compliance_type     ON public.project_compliance(item_type);
DROP TRIGGER IF EXISTS trg_project_compliance_updated_at   ON public.project_compliance;
CREATE TRIGGER trg_project_compliance_updated_at BEFORE UPDATE ON public.project_compliance
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ==========================================================================
-- RLS — same pattern as project_updates / project_sources:
--   * SELECT approved rows: anyone (anonymous read OK).
--   * SELECT own pending rows OR any pending if moderator.
--   * INSERT: any authenticated user (lands as 'pending'); AI inserts via service_role bypass RLS.
--   * UPDATE / DELETE: moderators only.
-- ==========================================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'project_funding','project_documents','project_stakeholders',
    'project_risks','project_impact','project_procurement','project_compliance'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS "View approved %1$s" ON public.%1$I', t);
    EXECUTE format($p$
      CREATE POLICY "View approved %1$s" ON public.%1$I FOR SELECT
      USING (
        approval_status = 'approved'
        OR submitted_by = auth.uid()
        OR public.is_moderator(auth.uid())
      )
    $p$, t);

    EXECUTE format('DROP POLICY IF EXISTS "Submit %1$s" ON public.%1$I', t);
    EXECUTE format($p$
      CREATE POLICY "Submit %1$s" ON public.%1$I FOR INSERT
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND (submitted_by = auth.uid() OR public.is_moderator(auth.uid()))
      )
    $p$, t);

    EXECUTE format('DROP POLICY IF EXISTS "Moderators manage %1$s" ON public.%1$I', t);
    EXECUTE format($p$
      CREATE POLICY "Moderators manage %1$s" ON public.%1$I FOR ALL
      USING (public.is_moderator(auth.uid()))
      WITH CHECK (public.is_moderator(auth.uid()))
    $p$, t);
  END LOOP;
END $$;
