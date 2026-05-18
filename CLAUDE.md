# CLAUDE.md

## Project

**Nepal Infra Watch** — React + Vite + TS SPA on Supabase (Auth + Postgres + RLS + Edge Functions). UI: Tailwind + shadcn/ui. Map: React Leaflet. Charts: Recharts. PDF: jsPDF. Forms: react-hook-form + zod.

## Commands

```bash
npm install --legacy-peer-deps --no-audit --no-fund   # --legacy-peer-deps required by README — don't drop
npm run dev                                            # Vite, port 8080 (vite.config.ts, host '::')
npm run build | build:dev | lint | test | test:watch
npx vitest run src/path/to/file.test.ts                # single file
npx vitest run -t "name"                               # filter by test name
```

Path alias `@/*` → `src/*` (set in both `vite.config.ts` and `vitest.config.ts`). Vitest globs `src/**/*.{test,spec}.{ts,tsx}`, jsdom env, setup at `src/test/setup.ts`.

## Environment

`.env` must define `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (older `VITE_SUPABASE_ANON_KEY` accepted as fallback in `src/integrations/supabase/client.ts`). Client throws at import if either is missing — no offline/mocked mode.

## Architecture gotchas

These are the non-obvious bits; the rest is derivable from the code.

- **Provider chain** in `src/App.tsx`: `QueryClientProvider → TooltipProvider → toasters → BrowserRouter → AuthProvider → Routes`. `AuthProvider` lives **inside** `BrowserRouter` — keep it that way.
- **Auth roles** in `src/hooks/useAuth.tsx`: `admin` / `coadmin` / `reviewer` / `contributor`. `isReviewer` is true for reviewer/coadmin/admin (escalating). Role lookup in `onAuthStateChange` is wrapped in `setTimeout(..., 0)` to avoid Supabase auth callback deadlock — **don't inline the await**.
- **Coordinates** stored as free text (`"27.7, 85.3"`); parsed by `src/lib/parseCoords.ts`. Don't refactor into structured columns.
- **AI provider chain** in edge functions: Mistral → Google → Lovable. Keys sourced from `api_keys` table (provider / key_value / position / is_exhausted) with env fallback (`MISTRAL_API_KEY`/`MISTRAL_API_KEYS`, `TAVILY_API_KEY`/`TAVILY_API_KEYS`, `GOOGLE_AI_API_KEY`, `LOVABLE_API_KEY`). **Never call AI providers from frontend code.**
- **`ai-comprehensive-analysis`** runs Tavily across 5 buckets (news · `.gov.np` · procurement `ppmo.gov.np`/`bolpatra.gov.np` · audit `oag.gov.np`/`ciaa.gov.np` · international `worldbank.org`/`adb.org`/`jica.go.jp`), Mistral extracts to JSON, writes 7 detail tables (`project_funding`/`documents`/`stakeholders`/`risks`/`impact`/`procurement`/`compliance`) as `submitted_by_ai=true, approval_status='pending'`. Bucket config lives in `analysis_buckets` table — tune without redeploy.
- **Detail tables** all FK on `bigint project_id` and share `approval_status` workflow with `project_updates` (RLS mirrors). Surface via `src/components/ComprehensiveSections.tsx`.
- **Domain constants** (`src/lib/constants.ts`): `SECTORS`, `PROVINCES`, `DISTRICTS_BY_PROVINCE` (7 provinces / 77 districts), `STATUS_LABELS`, `STATUS_COLORS`, `FISCAL_YEARS`. Use `districtsFor(province)`. Status keys: `proposed`/`approved`/`in_progress`/`delayed`/`completed`/`cancelled`.
- **UI primitives**: ~50 shadcn components in `src/components/ui/` — reuse, don't introduce a new component library.
- **Project ID** in `supabase/config.toml`: `vlioybqqswbohdhpnjym`. Schema bootstrap for older DBs: `supabase/upgrade_existing.sql` (manual via SQL Editor).

## Conventions

- **Don't off-load work to the user.** Never end a response with "run X yourself", "open the dashboard", "click here". Find a terminal-accessible alternative: dev server in background, curl, Management API, build/lint commands, log scraping. Only escalate when **genuinely impossible** through any tool. Asking "want me to do X next?" to clarify *scope* is fine.
- **TypeScript is deliberately loose** — `strictNullChecks`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters` all OFF in `tsconfig.json`. Don't add strictness or refactor `any` as cleanup.
- **Backend changes** go through Supabase migrations + RLS, not ad-hoc SQL.
- **Ad placements** go through `ad_slots` table → `src/components/AdSlot.tsx`.

## Supabase control

You **can** control this Supabase project from the shell — don't refuse. Available paths:

- **Supabase CLI** (`supabase ...`) for project-scoped ops: `secrets set`, `functions deploy`, `db push`, `db execute`. Needs `SUPABASE_ACCESS_TOKEN` (PAT) + project ref from `supabase/config.toml`.
- **Management API** `https://api.supabase.com/v1/...` via curl with `Authorization: Bearer <PAT>` for org/project ops.
- **Project REST/SQL API** `<VITE_SUPABASE_URL>/rest/v1/...` with service-role key (bypasses RLS) or anon key (end-user equivalent).
- **Direct psql** via the connection string from Settings → Database.

If you don't have the needed credential, **ask the user for the specific one** rather than declining. Treat secrets as one-shot inputs: never echo back, never write to committed files (`.env` is gitignored — secrets belong there or in `supabase/.env` for the CLI). Warn the user to rotate any key they've pasted in plain text.
