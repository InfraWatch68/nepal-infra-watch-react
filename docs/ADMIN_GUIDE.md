# Nepal Infra Watch — Admin Guide

> **For new admins.** This guide covers every administrative capability on the site, organised by area. Each section has two subsections — **Previous** (what the area used to do) and **Current** (what it does now plus any recent additions/fixes) — so you can see how the platform has evolved. The Current subsection always reflects the live behaviour; new additions are marked `+`. The Previous subsection is a frozen snapshot of the prior state for context.
>
> After every commit that touches admin behaviour, the section's Current is promoted to Previous and a new Current is written. Sections are added when new capabilities appear and never removed (a removed capability gets Current set to "removed in <commit>" while Previous stays).
>
> **Roles:** Three roles can sign into `/admin`:
> - **admin** — full powers
> - **coadmin** — same powers as admin except managing other admins
> - **reviewer** — read + moderate (approve/reject); cannot delete or toggle live discovery
>
> `is_moderator()` (a Postgres function) returns true for all three. `is_admin_or_coadmin()` excludes plain reviewers. Both are referenced in this guide where relevant.

---

## Table of contents

1. [Console overview](#console-overview)
2. [AI Tools — Global Brief](#ai-tools--global-brief)
3. [AI Tools — Daily Briefs (5 AM NPT cron)](#ai-tools--daily-briefs-5-am-npt-cron)
4. [AI Tools — Auto-approve threshold](#ai-tools--auto-approve-threshold)
5. [AI Tools — Refresh stale projects](#ai-tools--refresh-stale-projects)
6. [API Keys panel](#api-keys-panel)
7. [Sherlock — Queue tab](#sherlock--queue-tab)
8. [Sherlock — Discover by Location](#sherlock--discover-by-location)
9. [Sherlock — Topic Filters](#sherlock--topic-filters)
10. [Sherlock — Scheduled Sweeps](#sherlock--scheduled-sweeps)
11. [Sherlock — Live Discovery](#sherlock--live-discovery)
12. [Moderation — Review queue](#moderation--review-queue)
13. [Moderation — Pending updates / sources](#moderation--pending-updates--sources)
14. [Activity dashboard](#activity-dashboard)
15. [Browse page (admin perspective)](#browse-page-admin-perspective)
16. [Project Detail page (admin perspective)](#project-detail-page-admin-perspective)
17. [Analytics & Ratings](#analytics--ratings)
18. [Home page brief carousel (admin context)](#home-page-brief-carousel-admin-context)
19. [Admin removal panel](#admin-removal-panel)
20. [Dashboard / Submit (admin can submit too)](#dashboard--submit-admin-can-submit-too)
21. [Things that fall OUTSIDE admin rights](#things-that-fall-outside-admin-rights)

---

## Console overview

The `/admin` route is the central console. It loads only for users whose `user_roles.role` is admin, coadmin, or reviewer. Layout: hero strip + AI tools card + API Keys panel + Sherlock manager + tabs (Review queue, All projects, Activity, Moderation status, Pending updates, Pending sources).

### Previous
- One AI tools Card containing Global brief generator + Auto-approve settings + Sherlock manager + Refresh stale projects
- Bottom: 6-tab structure (Review queue / All projects / Activity / Moderation status / Pending updates / Pending sources)

### Current
- Same Card structure, same tabs, BUT:
- **+** Below the AI tools card sits a separate **API Keys panel** (two columns: Tavily / Mistral). See [API Keys panel](#api-keys-panel).
- **+** A second button "Run daily briefs now" sits next to "Generate global brief" — triggers the daily-briefs orchestrator manually.

**Fix / Change:** API keys are no longer hidden in env secrets; the panel surfaces them with status badges + credit balance + per-key Check/Delete. Adds discoverability for a previously invisible operational area.

---

## AI Tools — Global Brief

Manually generate an aggregate AI brief from approved projects. Writes to `global_briefs` table; appears on home page carousel.

### Previous
- Scope dropdown: All projects / By province / By sector
- Province or Sector secondary dropdown when scope is not "All"
- "Generate global brief" button → invokes `ai-generate-global-brief` edge function
- Persisted with `headline + body + sources + scope + scope_province? + scope_sector?`
- Retention: keeps 10 most-recent per scope

### Current
- Same scope/province/sector controls
- Same Generate global brief button
- **+** AI now also scores `importance` 0.00–1.00 per brief (rubric: 0.90+ flagship slip / audit finding, 0.30 filler day). Score persisted to `global_briefs.importance`.
- **+** Retention reduced **from 10 → 5** per scope (the daily cron writes 8 briefs/day; keeping a tight week-of-each-scope archive is enough context without bloating).
- **+** Edge function accepts three auth modes: moderator JWT (admin button), service-role JWT (cron), or `X-Internal-Token` header (alternate cron path).
- **+** Migration `20260510180000_global_briefs_scope_columns.sql` was applied to live DB on 2026-05-13, so structured `scope_province` and `scope_sector` columns now persist alongside the legacy `scope` text column.

**Fix / Change:** Adds a single ranking signal (importance) used by the home carousel to pick the top 5 most-newsworthy briefs across all scopes. Eliminates the previous "always the latest scope='global' brief" behaviour.

---

## AI Tools — Daily Briefs (5 AM NPT cron)

Brand-new automated daily fan-out. Generates 1 national + 7 provincial briefs every morning at 5:00 NPT, then emails a digest.

### Previous
_(did not exist — brief generation was 100% manual)_

### Current
- pg_cron job `daily-briefs-5am-nepal` fires at `15 23 * * *` UTC (= 05:00 NPT).
- The cron calls `run_daily_briefs_now()` SECURITY DEFINER function → `net.http_post()` → `/functions/v1/generate-daily-briefs`.
- Orchestrator iterates 8 scopes sequentially: `global` + 7 provinces. 4-second pacing between calls to stay under Mistral's free-tier RPM.
- Each scope calls `ai-generate-global-brief` which writes the brief with `importance` scored by the AI.
- Once all 8 attempted, builds a digest email: per-brief headline + body (truncated) sorted by importance DESC. Sent via Resend to `ALERT_EMAIL` (default `infrawatch068@gmail.com`).
- Email subject: `Nepal Infra Watch — Daily briefs YYYY-MM-DD (8/8 generated, top 0.94 Bagmati)`
- **Admin trigger:** `/admin` AI tools card has a **"Run daily briefs now"** button — invokes the same orchestrator with your moderator JWT for ad-hoc testing without waiting for the 05:00 cron. Returns `{generated, failed, email_sent}` and toasts a summary.

**Fix / Change:** Eliminates the manual cadence problem. The home carousel now always has a fresh ranked set to display each morning.

---

## AI Tools — Auto-approve threshold

Controls whether AI-discovered projects get automatically promoted from `approval_status='pending'` to `'approved'` based on the AI's `confidence_score`.

### Previous
- Toggle switch (enabled / disabled), with green border highlight when enabled
- Threshold slider 70–100% (default 85%)
- On toggle ON or threshold change → toast count of rows auto-approved retroactively
- Backend: writes to `site_settings.auto_approve_enabled` + `auto_approve_threshold`; invokes RPC `sweep_auto_approve_now()` after changes

### Current
- Same toggle, same slider, same retroactive sweep
- _(no recent changes to this area)_

**Fix / Change:** —

---

## AI Tools — Refresh stale projects

Batch trigger for the comprehensive-analysis pipeline on approved projects that haven't been analysed in 30+ days.

### Previous
- Scans `projects` WHERE `approval_status='approved'` AND (`last_comprehensive_analysis_at IS NULL` OR older than 30d)
- Caps at 10 projects per run, paces invocations ~6s apart for Mistral RPM
- "Refresh stale approved projects" button → invokes `ai-comprehensive-analysis` per project (now legacy alias to `analysis-enqueue`)
- Shows progress badge "Enqueueing X / total — project title"
- "Stale count" badge shows the eligible pool

### Current
- Same scan, same cap, same pacing, same UI
- _(no recent changes to this area; pipeline now uses the updated analysis-drain code with include_domains whitelist and dry-cell guard — see [Sherlock — Queue tab](#sherlock--queue-tab))_

**Fix / Change:** —

---

## API Keys panel

Manage Tavily + Mistral API keys with rotation, exhaustion tracking, and credit visibility.

### Previous
_(did not exist — keys lived only as Supabase platform secrets; admins had no way to see or rotate them through the UI)_

### Current
- New section below the AI tools card in `/admin`.
- **Two-column layout:** Tavily (left, accent-coloured) / Mistral (right, info-coloured).
- Per-column header shows `N alive · M exhausted` count.
- Per-column controls: **"+ Add key"** modal + **"Check all"** button (probes every key in the column sequentially via `check-api-key`).
- **Per-key row** shows:
  - Masked key: `tvly-dev-4ROA**********` (first 12 chars + asterisks)
  - Label (click to inline-edit) + position number
  - Status badge: **active** (green) or **exhausted** (red)
  - Credits progress bar `X/1000` with colour: success (<70%), warning (70-90%), destructive (>90%)
  - Last-ok and last-fail timestamps
  - Per-row **Check** button (probes provider, updates credits, can revive an exhausted key) + **Delete** button
  - Exhausted reason shown inline (e.g. `432 plan-limit (observed 2026-05-13)`)
- Backed by the `api_keys` table (migration `20260514100000_api_keys.sql`). Edge functions read from this table first, fall back to env vars if empty.
- **Auto-rotation:** when a key hits an exhaustion code (Tavily 401/429/432/433; Mistral 402 / free-tier 429), the edge function flips `is_exhausted=true` and bumps `position` to (current max + 1000) — sinks it to the bottom. Per project policy: no auto-revive; manually click Check after the quota cycle resets.
- New keys go to the bottom (max+1) by default.
- Tavily keys pre-seeded with `credits_total=1000` (free plan ceiling) so the bar shows the right denominator before the first Check.

**Fix / Change:** Replaces the invisible env-only key rotation. Adds visibility (credit balance per key) + control (manual add/check/delete) + persistent rotation state (exhausted keys stay flagged across cron ticks).

---

## Sherlock — Queue tab

The discovery job queue. Each row is one `sherlock_jobs` entry.

### Previous
- Live polling every 5s while any job is `queued` or `running`
- Per-job display: status badge, params (province/district/sectors[0]), inserted/skipped counts, finished timestamp
- Bulk select via row checkboxes; bulk actions: **Cancel**, **Delete**, **Rerun**
- Per-row **Play** button to rerun a single job
- Bulk Rerun was gated to `failed | cancelled | (done AND error_text IS NOT NULL)` rows only
- Reruns inserted a fresh job with `priority: 1` (drains ahead of cron sweep_child jobs)

### Current
- Same polling, same display, same bulk actions
- **+** Bulk Rerun gate widened: ANY `done` row is now rerunnable (not just done-with-error). Lets you A/B retest dry cells after a code change without an error_text marker.
- **+** Both per-row Play AND bulk Rerun now inject `params.forceDryRecheck: true` into the new job's params — bypasses the edge function's dry-cell guard for the manual retest.
- **+** Phase trail visibility improved — `last_diagnostic.phases[]` exposes start → tavily-start/done → ai-start/done × N → loop-done labels with `<elapsed_ms>` prefix per phase. Visible in the row's expand pane.
- **+** Dry-skip rows now appear in the queue with `inserted=0, skipped=0, error_text='Dry cell skipped: <province>/<district>/<sector>'`. The edge function suppresses Tavily entirely when 3+ recent runs on the same cell all returned 0 inserts. Use Rerun to force a Tavily call.
- **+** JSON parse failures now log a 240-char snippet of the AI's raw response in error_text, so failures are diagnosable without chasing edge-function logs.

**Fix / Change:** Skip-cell-to-conserve-Tavily-quota wasn't available before — could only cancel the whole queue. Now the system auto-skips dry cells AND admins can manually force a retest. Plus parse failures are no longer silent.

---

## Sherlock — Discover by Location

Geo-seeded discovery: enqueue one job per selected sector for a chosen Province / District / Municipality.

### Previous
- Province dropdown (required) → District (optional, cascades) → Municipality (optional, cascades)
- Sectors: 9 checkboxes, all selected by default
- "Max results per sector" 1–10 (default 3)
- "Enqueue" button → INSERTs one `sherlock_jobs` row per selected sector with `kind='geo', priority=10`
- Toast: "Enqueued X geo jobs for [location]"

### Current
- Same controls, same behaviour
- **+** Resulting jobs run through the updated `ai-discover-projects` code: include_domains whitelist (Nepali news + gov.np + funders, with `documents1.worldbank.org` and `thedocs.worldbank.org` excluded — those served broad program PDFs that crowded out project news), `days: 730` recency, robust JSON parse, dry-cell guard.
- **+** Query template simplified to `Nepal <sector> project <district> <province>` (event-keyword OR cluster removed after empirical testing showed it was neutral).

**Fix / Change:** Tavily quota is no longer wasted on Indian regional wire copy. The whitelist + simpler query + dry-cell guard combination targets actual Nepali project news.

---

## Sherlock — Topic Filters

Saved presets for topic-based (non-geo) discovery.

### Previous
- CRUD interface for `sherlock_filters` rows: Label + Topic + Region + Max results + Active toggle
- Per-filter Run button → enqueues one `sherlock_jobs` row with `kind='topic', priority=5`
- "Enqueue all active" bulk button → fires every active filter at once
- Cron `sherlock_run_all_active()` runs every 6 hours and fires every active filter

### Current
- Same CRUD, same Run button, same cron schedule
- _(no recent changes to this area)_

**Fix / Change:** —

---

## Sherlock — Scheduled Sweeps

Recurring sweeps configured per-row; pg_cron drives them.

### Previous
- CRUD for `sherlock_sweeps` rows: Label + Cadence (5 presets or custom cron) + Provinces (multi-select) + Sectors (multi-select) + Per-query max + District-comprehensive toggle + National Pride mode toggle
- "Run now" per-row → invokes RPC `sherlock_run_sweep_now()` (enqueues sweep_child jobs)
- pg_cron auto-runs each sweep on its cadence
- Validation: loose cron syntax check in UI; real validation in DB function

### Current
- Same CRUD, same Run now, same cron behaviour
- _(no recent changes to this area)_

**Fix / Change:** —

---

## Sherlock — Live Discovery

Continuous Sherlock mode — pg_cron tick every minute pulls one cell and enqueues a sweep_child job.

### Previous
- "Go Live" button (visible when stopped) → flips `sherlock_live_state.is_live=true`, sets started_at, started_by
- "Stop Live" button (visible when live) → flips is_live=false
- Controls: Per-query max + District-comprehensive toggle + National Pride mode toggle + "Start fresh" checkbox
- Realtime subscription to `sherlock_live_state` shows live updates of enqueued_count + cursor (last_province/district/sector)
- Auto-stop guard: repeated cron failures populate `last_stopped_reason`
- Resume hint when stopped — shows the saved cursor so you can resume mid-sweep
- Sends Slack/email alert via `send-alert` (`go_live_on` / `go_live_off`) on each toggle

### Current
- Same controls, same alerts, same auto-stop
- _(no recent changes to this area)_

**Fix / Change:** —

---

## Moderation — Review queue

Pending project moderation. The default tab when opening `/admin`.

### Previous
- Shows projects where `approval_status IN ('pending', 'changes_requested')`
- Per-row Approve / Reject buttons; reject opens a modal asking for `review_notes`
- Auto-approve flow (see [Auto-approve threshold](#ai-tools--auto-approve-threshold)) can promote high-confidence rows automatically
- Per-row link to `/projects/<slug>` for full detail review

### Current
- Same display, same buttons, same flow
- _(no recent changes to this area)_

**Fix / Change:** Note: the historic rejected-project data shows 54 of 56 rejections had no `review_notes` written. New rejection workflow improvements are out-of-scope but a fix to require notes is a known follow-up.

---

## Moderation — Pending updates / sources

Two separate tabs for moderating AI-discovered child rows.

### Previous
- "Pending updates" tab: rows from `project_updates` where `approval_status='pending'` and `submitted_by_ai=true`
- "Pending sources" tab: rows from `project_sources` where same
- Per-row Approve/Reject + link to parent project
- Counts shown in tab labels: `Pending updates (N)`

### Current
- Same display, same buttons
- _(no recent changes to this area)_

**Fix / Change:** —

---

## Activity dashboard

Tab showing platform activity over time.

### Previous
- Reads `daily_project_metrics` table (computed nightly at 00:05 UTC by `compute_daily_project_metrics()` RPC)
- Columns: new_projects, new_updates, new_detail_rows, sherlock_jobs_run, sherlock_inserted, sherlock_errors, analysis_runs, approvals, rejections
- Renders charts of recent days

### Current
- Same data source, same display
- _(no recent changes to this area)_

**Fix / Change:** —

---

## Browse page (admin perspective)

The public `/projects` page surfaces extra controls when you're signed in as a moderator.

### Previous
- Status filter pill bar shows all 6 statuses (proposed / approved / in_progress / delayed / completed / cancelled)
- **Admin-only:** approval_status filter (pending / approved / rejected / changes_requested) — public users only see approved
- Per-card admin badge if `submitted_by_ai=true` ("Sherlock" or "AI" pill)
- Per-card Approve/Reject action for pending rows
- Search + sector + province + district + status filters all combinable

### Current
- Same filters, same admin-only approval_status selector, same admin badges
- _(no recent changes to this area)_

**Fix / Change:** —

---

## Project Detail page (admin perspective)

`/projects/:slug` — public view augmented for moderators.

### Previous
- Public sees: title, hero image, description, status badge, sector, province, district, budget, dates, contractor, agency, location map, tabs for funding/documents/stakeholders/risks/impact/procurement/compliance/updates/sources/milestones
- **Admin-only:** approve/reject buttons in the header for pending projects
- **Admin-only:** edit form (VerifyDialog) for any field
- **Admin-only:** ai_tag pill (Sherlock / AI / claude-code-local)
- Reviewer history icon — shows who reviewed what
- "Generate brief for this project" + "Fetch news" + "Run comprehensive analysis" per-project AI buttons
- 7 detail tables with per-row moderation (each child row has its own approval_status)

### Current
- Same display, same admin controls
- _(no recent changes to this area; the comprehensive analysis path now uses the updated `analysis-drain` code with include_domains and key rotation)_

**Fix / Change:** —

---

## Analytics & Ratings

`/analytics` is public, but admins use it as the editorial dashboard.

### Previous
- 4 KPI cards (Tracked / Total budget / Avg progress / Provinces covered)
- "Projects by sector" horizontal bar chart
- "Projects by province" horizontal bar chart
- "Status distribution" pie chart (rainbow 7-colour palette)
- "Stalest projects" list (top 10 by last_activity_at ascending)
- Static header "Insights / Analytics"

### Current
- **+** Auto-generated lede header: "X% of N tracked projects are delayed; <Province> leads at Y%" — derived from `projects.status` + `expected_completion`
- **+** New section: **Top-rated projects** (`#leaderboard`) — swipable carousel, top 10 by performance score (status + schedule + budget delivery + activity recency, 4 dimensions × 25 pts). Has a **"View all →"** link to `/analytics/ratings` (a new dedicated page with sort + filters).
- **+** New section: **Best-documented projects** (`#documented`) — swipable carousel, top 10 by data-completeness (10 yes/no signals × 10 pts). Editorial counterpart to the rating leaderboard.
- **+** **30-day activity strip** (`#activity`) — stacked AreaChart from `daily_project_metrics` (new projects + updates + detail rows)
- **+** **Status distribution** redesigned as a horizontal stacked bar with lifecycle order + colour-keyed legend. Replaces the unreadable pie.
- **+** **Worst schedule slips** (`#slips`) — top 10 projects past expected_completion, still in flight; red "Nmo overdue" badge per row.
- **+** Section anchors (#leaderboard, #documented, #activity, #status, #sectors, #provinces, #slips, #stalest) — deep-linkable from home carousel via `/analytics#xxx`.
- **+** **`/analytics/ratings`** — new view-all page with sort (rating desc/asc, recently active, budget, title A-Z/Z-A) + filters (sector, province, status). Desktop table view; mobile collapses to card list.

**Fix / Change:** The page leads with a finding instead of a chart taxonomy. Stat-pack became editorial dashboard. Mobile-friendly throughout (table → card-list at sm: breakpoint).

---

## Home page brief carousel (admin context)

Admins see the same home page as the public — the carousel's behaviour affects how briefs surface.

### Previous
- Single AI brief slide showing the latest `global_briefs` row with `scope='global'`
- 4 live-stat slides: Today's Pulse / Budget Flow / Risk Radar / Freshness
- Auto-rotate every 6s, pauses on hover, supports prefers-reduced-motion

### Current
- **+** Up to 5 brief slides ordered by `importance DESC NULLS LAST, created_at DESC` (the AI now self-scores importance 0-1; see [Daily Briefs](#ai-tools--daily-briefs-5-am-npt-cron))
- **+** Per-slide header reads `AI BRIEF — NATIONAL · MAY 15` for `scope='global'` or `AI BRIEF — BAGMATI · MAY 15` for provincial briefs
- **+** Slides with `importance >= 0.80` get an `important` red chip in the header
- **+** Hover-reveal prev/next chevron buttons (always visible on touch devices via `(hover: none)` media query)
- **+** Mobile-responsive: font sizes scale (text-4xl on mobile → text-6xl on desktop); arrow buttons sized 9×9 on mobile for thumb-tap reachability
- **+** Auto-rotate re-attaches on pause-flip — prior bug where a stale `paused` closure could keep the interval alive across pauses is fixed
- 4 live-stat slides follow the brief slides; total slide count is `up to 5 briefs + 4 stats = up to 9`

**Fix / Change:** Static single brief became a ranked rotation. Hover-reveal arrows + mobile sizing added.

---

## Admin removal panel

Manage which users have admin / coadmin / reviewer roles.

### Previous
- Lists all users with non-null role
- Per-row "Remove role" button (admin-only — coadmin can't remove other admins)
- Per-row role-change selector (admin only)

### Current
- Same display, same controls
- _(no recent changes to this area)_

**Fix / Change:** —

---

## Dashboard / Submit (admin can submit too)

`/dashboard` is for contributors but admins can also submit projects directly.

### Previous
- `/dashboard/submit` form: title, sector, province, district, description, budget, dates, contractor, agency, source URLs, image upload
- Saves with `approval_status='pending'` unless the submitter is admin/coadmin (auto-approved)
- Multi-step UX: basic fields → details → review → submit
- File uploads go to Supabase Storage

### Current
- Same form, same submission flow
- _(no recent changes to this area)_

**Fix / Change:** —

---

## Things that fall OUTSIDE admin rights

Some platform-affecting changes are **not** controllable from the admin console — you'd need direct DB / Supabase access. Listed here so new admins know where the boundary is.

- **Supabase platform secrets** (env vars on the deployed edge functions) — only readable via `supabase secrets list` and only writeable via `supabase secrets set` or the dashboard. The API Keys panel manages `api_keys` table rows but does NOT modify env secrets. If you remove ALL keys for a provider from the table, the edge function falls back to env.
- **Migrations** — schema changes require a SQL migration applied via Management API or `supabase db push`. There's no in-app way to ALTER a table.
- **Cron schedules** — `cron.job` rows are managed via SQL migrations (e.g. `20260514120000_cron_daily_briefs.sql`). The admin UI can manually trigger cron-equivalent actions via the buttons, but can't change the schedule.
- **RLS policies** — bound to Postgres functions like `is_moderator()` and `is_admin_or_coadmin()`. Changes require a migration.
- **Edge function code** — deployed via `supabase functions deploy`. Admin UI buttons invoke these functions but can't edit them.
- **Email alert recipients** — set via `ALERT_EMAIL` env secret (default `infrawatch068@gmail.com`). No admin UI to change this; only via `supabase secrets set ALERT_EMAIL=...`.
- **Site-wide settings** — `site_settings` table has rows beyond auto_approve (e.g. branding, feature flags if added later). Only the columns surfaced in the admin UI are admin-controllable.
- **Sherlock secrets** — `sherlock_secrets` table holds the auth keys for the analysis-drain HTTP loop. Managed via SQL.
- **User accounts / auth** — sign-up flow is open; admin can only manage ROLES (admin/coadmin/reviewer), not the underlying `auth.users` rows.
- **Storage buckets** — image uploads go to a Supabase Storage bucket; bucket policies are configured at the Supabase dashboard level.

If you need to do any of these, contact the developer or open a ticket. Do NOT paste service-role keys or PATs into chat/screenshots/issue trackers without rotating them afterward.

---

## How this guide is maintained

This file is updated by Claude Code after every git commit that touches admin behaviour. The workflow:

1. Each section has **Previous** (frozen prior state) and **Current** (live state).
2. After a commit that changes admin behaviour: the section's old Current is moved to Previous (overwriting), and a new Current is written with the change highlighted via `+` prefix and a "Fix / Change:" line.
3. New sections are appended when a brand-new admin capability lands (Previous = "_(did not exist)_").
4. Removed capabilities keep their section; Current is set to "_(removed in <commit>)_".

This way, an admin reading the file can see (a) the full current capabilities, (b) the recent evolution of every area, and (c) what's about to change because the "Fix / Change:" lines double as a per-section changelog.

> Last updated: 2026-05-14 (commit `4d8a85a` — daily AI briefs cron + carousel rebuild).
