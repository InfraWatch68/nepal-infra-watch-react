-- ==========================================================
-- NEPAL INFRA WATCH - EXISTING SUPABASE DATABASE UPGRADE SQL
-- Use this when you already have the older React/Supabase database.
-- This keeps coordinates as pasted text like "27.7, 85.3" for frontend parsing.
-- ==========================================================

-- 1. Roles enum
DO $$
BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'reviewer', 'contributor');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Profiles and roles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  organization text,
  bio text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'contributor',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- If an older user_roles.role column exists as text, convert it safely to app_role.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_roles'
      AND column_name = 'role'
      AND udt_name <> 'app_role'
  ) THEN
    ALTER TABLE public.user_roles ALTER COLUMN role DROP DEFAULT;
    ALTER TABLE public.user_roles ALTER COLUMN role TYPE public.app_role USING role::text::public.app_role;
    ALTER TABLE public.user_roles ALTER COLUMN role SET DEFAULT 'contributor';
  END IF;
END $$;

-- Role checker. The explicit text cast avoids text = app_role operator errors.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text = _role::text
  );
$$;

-- 3. Projects table upgrade
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS sector text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS location_text text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS latitude numeric(9,6);
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS longitude numeric(9,6);
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS budget_npr numeric(18,2);
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS contractor text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS implementing_agency text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS expected_completion date;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS actual_completion date;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS progress_percent integer DEFAULT 0;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS review_notes text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS approval_status text DEFAULT 'pending';
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS cover_image_url text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 4. Backfill old project data
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='detailed_description') THEN
    EXECUTE 'UPDATE public.projects SET description = COALESCE(description, detailed_description) WHERE description IS NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='short_description') THEN
    EXECUTE 'UPDATE public.projects SET description = COALESCE(description, short_description) WHERE description IS NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='image_url') THEN
    EXECUTE 'UPDATE public.projects SET cover_image_url = COALESCE(cover_image_url, image_url) WHERE cover_image_url IS NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='budget') THEN
    EXECUTE 'UPDATE public.projects SET budget_npr = COALESCE(budget_npr, budget) WHERE budget_npr IS NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='funding_agency') THEN
    EXECUTE 'UPDATE public.projects SET implementing_agency = COALESCE(implementing_agency, funding_agency) WHERE implementing_agency IS NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='coordinates') THEN
    EXECUTE 'UPDATE public.projects SET location_text = COALESCE(location_text, coordinates) WHERE location_text IS NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='user_id') THEN
    EXECUTE 'UPDATE public.projects SET submitted_by = COALESCE(submitted_by, user_id) WHERE submitted_by IS NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='sector_id')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sectors') THEN
    EXECUTE '
      UPDATE public.projects p
      SET sector = COALESCE(
        p.sector,
        (SELECT s.name FROM public.sectors s WHERE s.id = p.sector_id),
        ''General''
      )
      WHERE p.sector IS NULL
    ';
  ELSE
    EXECUTE 'UPDATE public.projects SET sector = COALESCE(sector, ''General'') WHERE sector IS NULL';
  END IF;
END $$;

-- 5. Approval status backfill
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='review_status') THEN
    EXECUTE '
      UPDATE public.projects
      SET approval_status = CASE
        WHEN review_status::text = ''approved'' THEN ''approved''
        WHEN review_status::text = ''rejected'' THEN ''rejected''
        WHEN review_status::text = ''changes_requested'' THEN ''changes_requested''
        ELSE COALESCE(approval_status, ''pending'')
      END
    ';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='is_approved') THEN
    EXECUTE '
      UPDATE public.projects
      SET approval_status = CASE
        WHEN is_approved = true THEN ''approved''
        WHEN approval_status IS NULL THEN ''pending''
        ELSE approval_status
      END
    ';
  END IF;
END $$;

UPDATE public.projects SET approval_status = COALESCE(approval_status, 'pending');

-- 6. Status compatibility
UPDATE public.projects SET status = 'proposed' WHERE status::text = 'planned';
UPDATE public.projects SET status = 'in_progress' WHERE status::text = 'ongoing';

-- 7. Slug generation
UPDATE public.projects
SET slug = lower(
  regexp_replace(
    regexp_replace(COALESCE(title, 'project-' || id::text), '[^a-zA-Z0-9]+', '-', 'g'),
    '(^-|-$)', '', 'g'
  )
) || '-' || id::text
WHERE slug IS NULL OR slug = '';

CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_unique ON public.projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_approval ON public.projects(approval_status);
CREATE INDEX IF NOT EXISTS idx_projects_sector ON public.projects(sector);
CREATE INDEX IF NOT EXISTS idx_projects_province ON public.projects(province);

-- 8. Keep older is_approved synced, if it exists
CREATE OR REPLACE FUNCTION public.sync_is_approved_from_approval_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'is_approved'
  ) THEN
    IF NEW.approval_status::text = 'approved' THEN
      NEW.is_approved := true;
    ELSE
      NEW.is_approved := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_is_approved_from_approval_status ON public.projects;
CREATE TRIGGER trigger_sync_is_approved_from_approval_status
BEFORE INSERT OR UPDATE OF approval_status ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.sync_is_approved_from_approval_status();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='is_approved') THEN
    EXECUTE '
      UPDATE public.projects
      SET is_approved = CASE WHEN approval_status::text = ''approved'' THEN true ELSE false END
    ';
  END IF;
END $$;

-- 9. Ad slots table
CREATE TABLE IF NOT EXISTS public.ad_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_key text NOT NULL,
  title text NOT NULL,
  image_url text,
  target_url text,
  advertiser text,
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_slots ADD COLUMN IF NOT EXISTS slot_key text;
ALTER TABLE public.ad_slots ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.ad_slots ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.ad_slots ADD COLUMN IF NOT EXISTS target_url text;
ALTER TABLE public.ad_slots ADD COLUMN IF NOT EXISTS advertiser text;
ALTER TABLE public.ad_slots ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.ad_slots ADD COLUMN IF NOT EXISTS starts_at timestamptz;
ALTER TABLE public.ad_slots ADD COLUMN IF NOT EXISTS ends_at timestamptz;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ad_slots' AND column_name='is_active') THEN
    EXECUTE 'UPDATE public.ad_slots SET active = is_active WHERE active IS NULL';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ad_slots_slot_key_unique ON public.ad_slots(slot_key);

INSERT INTO public.ad_slots (title, slot_key, advertiser, active)
VALUES
('Homepage Top Ad', 'home-top', 'Nepal Infra Watch', true),
('Homepage Middle Ad', 'home-middle', 'Nepal Infra Watch', true),
('Projects List Ad', 'projects-list', 'Nepal Infra Watch', true),
('Project Detail Sidebar Ad', 'project-detail-sidebar', 'Nepal Infra Watch', true),
('Dashboard Ad', 'dashboard-side', 'Nepal Infra Watch', true)
ON CONFLICT (slot_key) DO NOTHING;

-- 10. Project updates compatibility
CREATE TABLE IF NOT EXISTS public.project_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  content text,
  update_type text DEFAULT 'progress',
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_updates ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.project_updates ADD COLUMN IF NOT EXISTS update_type text DEFAULT 'progress';
ALTER TABLE public.project_updates ADD COLUMN IF NOT EXISTS published boolean DEFAULT true;
ALTER TABLE public.project_updates ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_updates' AND column_name='update_text') THEN
    EXECUTE 'UPDATE public.project_updates SET content = COALESCE(content, update_text) WHERE content IS NULL';
  END IF;
END $$;

UPDATE public.project_updates SET published = true WHERE published IS NULL;

-- 11. Project milestones
CREATE TABLE IF NOT EXISTS public.project_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid,
  title text NOT NULL,
  description text,
  due_date date,
  completed_date date,
  status text DEFAULT 'pending',
  order_index integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_milestones ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE public.project_milestones ADD COLUMN IF NOT EXISTS completed_date date;
ALTER TABLE public.project_milestones ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE public.project_milestones ADD COLUMN IF NOT EXISTS order_index integer DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_milestones' AND column_name='milestone_date') THEN
    EXECUTE 'UPDATE public.project_milestones SET due_date = milestone_date WHERE due_date IS NULL';
  END IF;
END $$;

-- 12. Project sources
CREATE TABLE IF NOT EXISTS public.project_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'article',
  title text NOT NULL,
  url text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 13. Updated-at helper and signup helper
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_profiles ON public.profiles;
CREATE TRIGGER set_updated_at_profiles
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_projects ON public.projects;
CREATE TRIGGER set_updated_at_projects
BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'contributor')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 14. RLS policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_slots ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- User roles
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Projects
DROP POLICY IF EXISTS "Anyone can view approved projects" ON public.projects;
CREATE POLICY "Anyone can view approved projects" ON public.projects FOR SELECT
USING (
  approval_status::text = 'approved'
  OR auth.uid() = submitted_by
  OR public.has_role(auth.uid(), 'reviewer'::public.app_role)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "Authenticated users submit projects" ON public.projects;
CREATE POLICY "Authenticated users submit projects" ON public.projects FOR INSERT TO authenticated
WITH CHECK (auth.uid() = submitted_by);

DROP POLICY IF EXISTS "Submitter can update own pending project" ON public.projects;
CREATE POLICY "Submitter can update own pending project" ON public.projects FOR UPDATE
USING (auth.uid() = submitted_by AND approval_status::text IN ('pending', 'changes_requested'));

DROP POLICY IF EXISTS "Reviewers/admins can update any project" ON public.projects;
CREATE POLICY "Reviewers/admins can update any project" ON public.projects FOR UPDATE
USING (public.has_role(auth.uid(), 'reviewer'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins delete projects" ON public.projects;
CREATE POLICY "Admins delete projects" ON public.projects FOR DELETE
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Ads
DROP POLICY IF EXISTS "Anyone view active ads" ON public.ad_slots;
CREATE POLICY "Anyone view active ads" ON public.ad_slots FOR SELECT
USING (active = true OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage ads" ON public.ad_slots;
CREATE POLICY "Admins manage ads" ON public.ad_slots FOR ALL
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Updates
DROP POLICY IF EXISTS "View published updates" ON public.project_updates;
CREATE POLICY "View published updates" ON public.project_updates FOR SELECT
USING (published = true OR auth.uid() = author_id OR public.has_role(auth.uid(), 'reviewer'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Authenticated post updates" ON public.project_updates;
CREATE POLICY "Authenticated post updates" ON public.project_updates FOR INSERT TO authenticated
WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "Author/reviewer/admin manage updates" ON public.project_updates;
CREATE POLICY "Author/reviewer/admin manage updates" ON public.project_updates FOR UPDATE
USING (auth.uid() = author_id OR public.has_role(auth.uid(), 'reviewer'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Author/admin delete updates" ON public.project_updates;
CREATE POLICY "Author/admin delete updates" ON public.project_updates FOR DELETE
USING (auth.uid() = author_id OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- Milestones
DROP POLICY IF EXISTS "Allow public read project milestones" ON public.project_milestones;
CREATE POLICY "Allow public read project milestones" ON public.project_milestones FOR SELECT USING (true);

DROP POLICY IF EXISTS "Submitter/reviewer/admin manage milestones" ON public.project_milestones;
CREATE POLICY "Submitter/reviewer/admin manage milestones" ON public.project_milestones FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id::text = project_id::text
      AND (auth.uid() = p.submitted_by OR public.has_role(auth.uid(), 'reviewer'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id::text = project_id::text
      AND (auth.uid() = p.submitted_by OR public.has_role(auth.uid(), 'reviewer'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
  )
);

-- Sources
DROP POLICY IF EXISTS "Allow public read project sources" ON public.project_sources;
CREATE POLICY "Allow public read project sources" ON public.project_sources FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated add sources" ON public.project_sources;
CREATE POLICY "Authenticated add sources" ON public.project_sources FOR INSERT TO authenticated
WITH CHECK (auth.uid() = added_by);

DROP POLICY IF EXISTS "Reviewer/admin verify sources" ON public.project_sources;
CREATE POLICY "Reviewer/admin verify sources" ON public.project_sources FOR UPDATE
USING (public.has_role(auth.uid(), 'reviewer'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- Done.
