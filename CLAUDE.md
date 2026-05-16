# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Nepal Infra Watch** — React + Vite + TypeScript SPA backed by Supabase (Auth + Postgres + RLS + Edge Functions) for tracking Nepal infrastructure projects. UI uses Tailwind + shadcn/ui (Radix primitives in `src/components/ui`). Map is React Leaflet, charts are Recharts, exports use jsPDF, forms are react-hook-form + zod.

## Commands

Install (the `--legacy-peer-deps` flag is required by README; don't drop it):

```bash
npm install --legacy-peer-deps --no-audit --no-fund
```

- `npm run dev` — Vite dev server on **port 8080** (set in `vite.config.ts`, host `::`)
- `npm run build` / `npm run build:dev` — production / dev-mode build
- `npm run lint` — ESLint (flat config, `eslint.config.js`)
- `npm run test` — Vitest single run (jsdom env, setup at `src/test/setup.ts`)
- `npm run test:watch` — Vitest watch mode
- Run a single test file: `npx vitest run src/path/to/file.test.ts`
- Filter by name: `npx vitest run -t "partial test name"`

Vitest globs `src/**/*.{test,spec}.{ts,tsx}`. Path alias `@/*` → `src/*` is configured in both `vite.config.ts` and `vitest.config.ts`.

## Environment

`.env` at project root must define:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (the older `VITE_SUPABASE_ANON_KEY` is also accepted as a fallback in `src/integrations/supabase/client.ts`)

The Supabase client throws at import time if either is missing — there is no offline/mocked mode for local dev.

## Architecture

### App shell (`src/App.tsx`)
Provider chain (outer → inner): `QueryClientProvider` → `TooltipProvider` → toasters (`Toaster`, `Sonner`) → `BrowserRouter` → `AuthProvider` → `Routes`. **`AuthProvider` lives inside `BrowserRouter`** — keep it that way if you add navigation hooks to it.

Routes wired in `App.tsx`: `/`, `/auth`, `/projects`, `/projects/:slug`, `/map`, `/compare`, `/analytics`, `/analytics/ratings`, `/dashboard`, `/dashboard/submit`, `/admin`, `/admin/guide`, and `*` → `NotFound`. `src/pages/Index.tsx` exists but is not currently routed.

### Auth & roles (`src/hooks/useAuth.tsx`)
Four roles: `admin`, `coadmin`, `reviewer`, `contributor`. Roles are loaded from the `user_roles` table on every auth state change. `isReviewer` is true for reviewer/coadmin/admin (escalating). Any role-gated UI should consume `useAuth()` rather than re-querying.

The role lookup inside `onAuthStateChange` is wrapped in `setTimeout(..., 0)` — this is a known Supabase pattern to avoid deadlocking the auth callback. Don't inline the await.

### Supabase layer
- Client: `src/integrations/supabase/client.ts` — singleton, persists session in `localStorage`.
- Generated DB types: `src/integrations/supabase/types.ts` — typed via `createClient<Database>`.
- Migrations: `supabase/migrations/*.sql` (timestamp-prefixed).
- Edge functions in `supabase/functions/*/index.ts` (Deno runtime):
  - AI extraction: `ai-comprehensive-analysis`, `ai-discover-projects`, `ai-project-insights`, `ai-verify-project`, `ai-fetch-project-news`, `ai-fetch-news-all`
  - Briefs: `ai-generate-brief`, `ai-generate-global-brief`, `generate-daily-briefs`
  - Analysis queue: `analysis-enqueue`, `analysis-drain`
  - Ops: `check-api-key`, `send-alert`
  - Shared helpers in `_shared/` (including `api_keys.ts` for provider key rotation).
- AI provider keys are sourced from the `api_keys` table (provider/key_value/position/is_exhausted) with env fallback (`MISTRAL_API_KEY` / `MISTRAL_API_KEYS`, `TAVILY_API_KEY` / `TAVILY_API_KEYS`, `GOOGLE_AI_API_KEY`, `LOVABLE_API_KEY`). Edge functions chain Mistral → Google → Lovable. **Never call AI providers from frontend code** (per README and the existing pattern).
- `ai-comprehensive-analysis` runs targeted Tavily searches across 5 buckets (news, government `.gov.np`, procurement `ppmo.gov.np` / `bolpatra.gov.np`, audit `oag.gov.np` / `ciaa.gov.np`, international orgs `worldbank.org` / `adb.org` / `jica.go.jp` etc.), feeds results to Mistral with a strict JSON-extraction prompt, and writes structured rows into the 7 detail tables as `submitted_by_ai=true, approval_status='pending'` for moderator approval. Bucket definitions live in the `analysis_buckets` table — operators can disable/retune without redeploying.
- Detail-tracking tables: `project_funding`, `project_documents`, `project_stakeholders`, `project_risks`, `project_impact`, `project_procurement`, `project_compliance`. All FK on `bigint project_id`, all carry the same `approval_status` workflow as `project_updates` (RLS mirrors). Surface in the UI via `src/components/ComprehensiveSections.tsx` (rendered inside `ProjectDetail.tsx` below the existing Tabs).
- Schema bootstrap for older databases: `supabase/upgrade_existing.sql` (run manually in Supabase SQL Editor).
- Project id is in `supabase/config.toml` (`vlioybqqswbohdhpnjym`).

### Domain constants (`src/lib/constants.ts`)
`SECTORS`, `PROVINCES`, `DISTRICTS_BY_PROVINCE` (Nepal's 7 provinces / 77 districts), and the project `STATUS_LABELS` / `STATUS_COLORS` maps. Use `districtsFor(province)` rather than re-deriving the district list. Status keys: `proposed`, `approved`, `in_progress`, `delayed`, `completed`, `cancelled`.

### Coordinates
Coordinates are stored as free text (e.g. `"27.7, 85.3"`). `src/lib/parseCoords.ts` parses them for the map — do not refactor coordinates into structured columns without coordinating with the existing data shape.

### UI components
50 shadcn-style primitives live in `src/components/ui/`. **Reuse them rather than introducing a new component library.** App-level components (`AdSlot`, `NavLink`, `ProjectCard`, `ProjectMap`, `layout/SiteHeader`, `layout/SiteFooter`) sit at `src/components/`.

## Conventions

- **Don't off-load work to the user.** Never end a response with instructions for the user to do something themselves — no "run `npm run dev`", "open the SQL Editor", "click here and try it", "go check the dashboard". Find a way to do it yourself through the terminal: dev server in background, headless tests, curl, Management API, build/lint/typecheck commands, log scraping. When something appears to need manual intervention (a browser, a dashboard click, a UI interaction), look for terminal-accessible alternatives or workarounds first. Only escalate to the user when something is **genuinely impossible** through any tool you have. Asking "want me to do X next?" to clarify *scope* is fine — that's about what to work on next, not about who does the work.
- TypeScript is **deliberately loose**: `strictNullChecks`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters` are all off in `tsconfig.json`. Don't introduce strictness flags or refactor `any` usage as cleanup — match the surrounding style.
- Vite alias `@` → `src` is the canonical import prefix; prefer it over relative paths that cross directories.
- Ad placements go through the `ad_slots` table, surfaced via `src/components/AdSlot.tsx`.
- Backend changes go through Supabase migrations + RLS, not ad-hoc SQL.

## Supabase control

You **can** control this Supabase project from the shell — don't refuse with "I can't open Supabase." When the user asks for a Supabase action (set a secret, run SQL, deploy a function, view logs, manage users, etc.), do it via:

- **Supabase CLI** (`supabase` command) for project-scoped operations: `supabase secrets set`, `supabase functions deploy`, `supabase db push`, `supabase db execute`. Requires `SUPABASE_ACCESS_TOKEN` (personal access token) and the project ref from `supabase/config.toml`.
- **Management API** (`https://api.supabase.com/v1/...`) via curl/Invoke-RestMethod for org/project-level ops. Auth: `Authorization: Bearer <PERSONAL_ACCESS_TOKEN>`.
- **Project REST/SQL API** (`<VITE_SUPABASE_URL>/rest/v1/...` or `/pg/...`) with the **service role key** for data ops that bypass RLS. Anon key only for end-user-equivalent calls.
- **Direct Postgres** via `psql` using the connection string from the dashboard (Settings → Database).

If you don't already have the credential needed for the action, **ask the user for the specific one** ("I need your Supabase personal access token" / "paste the service role key" / "give me the DB connection string") rather than declining. Treat secrets as one-shot inputs: never echo them back, never write them into committed files (`.env` is gitignored — secrets go there or into `supabase/.env` for the CLI), and warn the user to rotate any key they've already pasted into the chat in plain text.
