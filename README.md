# Nepal Infra Watch

Modern React + Supabase infrastructure project tracking platform for Nepal.

## Main stack

- React + Vite + TypeScript
- Supabase Auth + Postgres + RLS
- Leaflet / React Leaflet map
- Recharts analytics
- Shadcn-style UI components
- Ad slot system
- Future AI-ready Supabase Edge Function

## Local setup

1. Create `.env` in the project root:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key_here
```

If you already use the older key name, this also works:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your_publishable_key_here
```

2. Install dependencies:

```bash
npm install --legacy-peer-deps --no-audit --no-fund
```

3. Start local dev server:

```bash
npm run dev
```

The app usually runs at:

```txt
http://localhost:8080
```

## Supabase upgrade

For an existing older Nepal Infra Watch database, run this file in Supabase SQL Editor:

```txt
supabase/upgrade_existing.sql
```

This adds/aligns:

- profiles
- user_roles
- project approval workflow
- project slugs
- ad_slots
- project_updates compatibility
- project_milestones
- project_sources
- RLS policies

## User roles

To make a user reviewer/admin after they sign up:

```sql
insert into public.user_roles (user_id, role)
select id, 'reviewer'::public.app_role
from auth.users
where email = 'their_email@example.com'
on conflict (user_id, role) do nothing;
```

or:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin'::public.app_role
from auth.users
where email = 'their_email@example.com'
on conflict (user_id, role) do nothing;
```

## Notes

- `.env` is intentionally not included in this zip.
- Coordinates can stay as pasted text like `27.7, 85.3`; the frontend parses them for the map.
- Ads are handled through the `ad_slots` table.
- AI features should use Supabase Edge Functions, not frontend API keys.
