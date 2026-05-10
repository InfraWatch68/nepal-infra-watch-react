
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'reviewer', 'contributor');
CREATE TYPE public.project_status AS ENUM ('proposed','approved','in_progress','delayed','completed','cancelled');
CREATE TYPE public.approval_status AS ENUM ('pending','approved','rejected','changes_requested');
CREATE TYPE public.milestone_status AS ENUM ('pending','in_progress','completed','delayed');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  organization TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role function
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Projects
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  sector TEXT NOT NULL,
  province TEXT,
  district TEXT,
  location_text TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  budget_npr NUMERIC(18,2),
  contractor TEXT,
  implementing_agency TEXT,
  start_date DATE,
  expected_completion DATE,
  actual_completion DATE,
  progress_percent INTEGER DEFAULT 0,
  status public.project_status NOT NULL DEFAULT 'proposed',
  approval_status public.approval_status NOT NULL DEFAULT 'pending',
  submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes TEXT,
  cover_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_projects_approval ON public.projects(approval_status);
CREATE INDEX idx_projects_sector ON public.projects(sector);
CREATE INDEX idx_projects_province ON public.projects(province);

-- Milestones
CREATE TABLE public.project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  completed_date DATE,
  status public.milestone_status NOT NULL DEFAULT 'pending',
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;

-- Updates
CREATE TABLE public.project_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT,
  update_type TEXT DEFAULT 'progress',
  published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.project_updates ENABLE ROW LEVEL SECURITY;

-- Sources
CREATE TABLE public.project_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL DEFAULT 'article',
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.project_sources ENABLE ROW LEVEL SECURITY;

-- Ad slots
CREATE TABLE public.ad_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_key TEXT NOT NULL,
  title TEXT NOT NULL,
  image_url TEXT,
  target_url TEXT,
  advertiser TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_slots ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ad_slots_key ON public.ad_slots(slot_key);

-- Trigger: auto-create profile + assign default contributor role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'contributor');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER set_updated_at_profiles BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER set_updated_at_projects BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ RLS POLICIES ============

-- profiles
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- user_roles
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- projects
CREATE POLICY "Anyone can view approved projects" ON public.projects FOR SELECT
USING (approval_status = 'approved' OR auth.uid() = submitted_by OR public.has_role(auth.uid(),'reviewer') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Authenticated users submit projects" ON public.projects FOR INSERT
WITH CHECK (auth.uid() = submitted_by);

CREATE POLICY "Submitter can update own pending project" ON public.projects FOR UPDATE
USING (auth.uid() = submitted_by AND approval_status IN ('pending','changes_requested'));

CREATE POLICY "Reviewers/admins can update any project" ON public.projects FOR UPDATE
USING (public.has_role(auth.uid(),'reviewer') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Admins delete projects" ON public.projects FOR DELETE
USING (public.has_role(auth.uid(),'admin'));

-- milestones
CREATE POLICY "View milestones of viewable projects" ON public.project_milestones FOR SELECT
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.approval_status = 'approved' OR auth.uid() = p.submitted_by OR public.has_role(auth.uid(),'reviewer') OR public.has_role(auth.uid(),'admin'))));

CREATE POLICY "Submitter/reviewer/admin manage milestones" ON public.project_milestones FOR ALL
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (auth.uid() = p.submitted_by OR public.has_role(auth.uid(),'reviewer') OR public.has_role(auth.uid(),'admin'))))
WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (auth.uid() = p.submitted_by OR public.has_role(auth.uid(),'reviewer') OR public.has_role(auth.uid(),'admin'))));

-- updates
CREATE POLICY "View published updates" ON public.project_updates FOR SELECT
USING (published = true OR auth.uid() = author_id OR public.has_role(auth.uid(),'reviewer') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Authenticated post updates" ON public.project_updates FOR INSERT
WITH CHECK (auth.uid() = author_id);

CREATE POLICY "Author/reviewer/admin manage updates" ON public.project_updates FOR UPDATE
USING (auth.uid() = author_id OR public.has_role(auth.uid(),'reviewer') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Author/admin delete updates" ON public.project_updates FOR DELETE
USING (auth.uid() = author_id OR public.has_role(auth.uid(),'admin'));

-- sources
CREATE POLICY "Anyone view sources of viewable projects" ON public.project_sources FOR SELECT
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.approval_status='approved' OR auth.uid()=p.submitted_by OR public.has_role(auth.uid(),'reviewer') OR public.has_role(auth.uid(),'admin'))));

CREATE POLICY "Authenticated add sources" ON public.project_sources FOR INSERT
WITH CHECK (auth.uid() = added_by);

CREATE POLICY "Reviewer/admin verify sources" ON public.project_sources FOR UPDATE
USING (public.has_role(auth.uid(),'reviewer') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Adder/admin delete sources" ON public.project_sources FOR DELETE
USING (auth.uid() = added_by OR public.has_role(auth.uid(),'admin'));

-- ad_slots
CREATE POLICY "Anyone view active ads" ON public.ad_slots FOR SELECT
USING (active = true OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Admins manage ads" ON public.ad_slots FOR ALL
USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
