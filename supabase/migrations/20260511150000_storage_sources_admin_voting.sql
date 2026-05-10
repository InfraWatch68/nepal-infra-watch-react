-- Group B/E/G additions — already applied to live DB on 2026-05-11.
-- 1. project-covers storage bucket + policies (B4)
-- 2. sources jsonb column on the 7 detail tables (E2)
-- 3. admin_removal_proposals + admin_removal_votes + threshold trigger (G1)
-- 4. user_roles RLS hardened so only the voting flow can revoke an admin

-- 1. project-covers bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('project-covers','project-covers', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read project covers" ON storage.objects;
CREATE POLICY "Public read project covers" ON storage.objects FOR SELECT
  USING (bucket_id = 'project-covers');
DROP POLICY IF EXISTS "Authed upload project covers" ON storage.objects;
CREATE POLICY "Authed upload project covers" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'project-covers' AND auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Owner manage project covers" ON storage.objects;
CREATE POLICY "Owner manage project covers" ON storage.objects FOR ALL
  USING (bucket_id = 'project-covers' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_moderator(auth.uid())))
  WITH CHECK (bucket_id = 'project-covers' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_moderator(auth.uid())));

-- 2. sources jsonb on the 7 detail tables
DO $$
DECLARE t text; tables text[] := ARRAY[
  'project_funding','project_documents','project_stakeholders',
  'project_risks','project_impact','project_procurement','project_compliance'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT ''[]''::jsonb', t);
  END LOOP;
END $$;

-- 3. admin removal proposals + votes
CREATE TABLE IF NOT EXISTS public.admin_removal_proposals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proposed_by     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  executed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_removal_proposals_target ON public.admin_removal_proposals(target_user_id, status);

CREATE TABLE IF NOT EXISTS public.admin_removal_votes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  uuid NOT NULL REFERENCES public.admin_removal_proposals(id) ON DELETE CASCADE,
  voter_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote         text NOT NULL CHECK (vote IN ('yes','no')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, voter_id)
);

CREATE OR REPLACE FUNCTION public.admin_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(DISTINCT user_id)::int FROM public.user_roles WHERE role = 'admin';
$$;

-- Threshold: ≥2 yes votes from non-target admins, AND ≥2/3 of non-target admins.
CREATE OR REPLACE FUNCTION public.tg_check_admin_removal_threshold()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prop public.admin_removal_proposals%ROWTYPE;
  total_eligible int; yes_votes int; threshold int;
BEGIN
  SELECT * INTO prop FROM public.admin_removal_proposals WHERE id = NEW.proposal_id;
  IF prop IS NULL OR prop.status <> 'pending' THEN RETURN NEW; END IF;
  SELECT COUNT(DISTINCT user_id)::int INTO total_eligible
    FROM public.user_roles WHERE role = 'admin' AND user_id <> prop.target_user_id;
  SELECT COUNT(*)::int INTO yes_votes
    FROM public.admin_removal_votes v
    JOIN public.user_roles ur ON ur.user_id = v.voter_id AND ur.role = 'admin'
   WHERE v.proposal_id = prop.id AND v.vote = 'yes' AND v.voter_id <> prop.target_user_id;
  threshold := GREATEST(2, CEIL(total_eligible::numeric * 2 / 3));
  IF yes_votes >= threshold THEN
    DELETE FROM public.user_roles WHERE user_id = prop.target_user_id AND role = 'admin';
    UPDATE public.admin_removal_proposals SET status = 'approved', executed_at = now() WHERE id = prop.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_admin_removal_threshold ON public.admin_removal_votes;
CREATE TRIGGER trg_check_admin_removal_threshold AFTER INSERT ON public.admin_removal_votes
  FOR EACH ROW EXECUTE FUNCTION public.tg_check_admin_removal_threshold();

ALTER TABLE public.admin_removal_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_removal_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read proposals" ON public.admin_removal_proposals;
CREATE POLICY "Admins read proposals" ON public.admin_removal_proposals FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins propose" ON public.admin_removal_proposals;
CREATE POLICY "Admins propose" ON public.admin_removal_proposals FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND proposed_by = auth.uid()
    AND target_user_id <> auth.uid()
    AND public.has_role(target_user_id, 'admin'::app_role)
  );
DROP POLICY IF EXISTS "Proposer cancels" ON public.admin_removal_proposals;
CREATE POLICY "Proposer cancels" ON public.admin_removal_proposals FOR UPDATE
  USING (proposed_by = auth.uid() AND status = 'pending')
  WITH CHECK (proposed_by = auth.uid() AND status IN ('pending','cancelled'));
DROP POLICY IF EXISTS "Admins read votes" ON public.admin_removal_votes;
CREATE POLICY "Admins read votes" ON public.admin_removal_votes FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins vote" ON public.admin_removal_votes;
CREATE POLICY "Admins vote" ON public.admin_removal_votes FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND voter_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.admin_removal_proposals p
      WHERE p.id = proposal_id AND p.status = 'pending' AND p.target_user_id <> auth.uid()
    )
  );

-- 4. Hardened user_roles policy: admin role can only be revoked via voting flow
-- (the trigger uses SECURITY DEFINER so it bypasses this policy).
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage non-admin roles" ON public.user_roles;
CREATE POLICY "Admins manage non-admin roles" ON public.user_roles FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND (role <> 'admin' OR user_id = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND (role <> 'admin' OR user_id = auth.uid())
  );
