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
2. [Admin Guide page (this page)](#admin-guide-page-this-page)
3. [AI Tools — Global Brief](#ai-tools--global-brief)
3. [AI Tools — Daily Briefs (5 AM NPT cron)](#ai-tools--daily-briefs-5-am-npt-cron)
3. [AI Tools — Local AI tools panel](#ai-tools--local-ai-tools-panel)
4. [AI Tools — Auto-approve & Auto-analysis](#ai-tools--auto-approve--auto-analysis)
5. [AI Tools — Refresh stale projects](#ai-tools--refresh-stale-projects)
6. [API Keys panel](#api-keys-panel)
7. [Sherlock — Queue tab](#sherlock--queue-tab)
8. [Sherlock — Discover by Location](#sherlock--discover-by-location)
9. [Sherlock — Topic Filters](#sherlock--topic-filters)
10. [Sherlock — Scheduled Sweeps](#sherlock--scheduled-sweeps)
11. [Sherlock — Live Discovery](#sherlock--live-discovery)
12. [Moderation — Review queue](#moderation--review-queue)
13. [Moderation — Pending updates / sources](#moderation--pending-updates--sources)
13. [Moderation — Bulk enrich coordinates & fiscal year](#moderation--bulk-enrich-coordinates--fiscal-year)
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

Where to find it: `/admin` (this is the whole page).

### Previous
- One AI tools Card containing Global brief generator + Auto-approve settings + Sherlock manager + Refresh stale projects
- Bottom: 6-tab structure (Review queue / All projects / Activity / Moderation status / Pending updates / Pending sources)
- Below the AI tools card sits a separate API Keys panel (two columns: Tavily / Mistral). See [API Keys panel](#api-keys-panel).
- A second button "Run daily briefs now" sits next to "Generate global brief" — triggers the daily-briefs orchestrator manually.

### Current
- Same layout, same tabs, same AI tools card + API Keys panel
- **+ (added 2026-05-14)** Hero strip now has an **"Admin guide"** button on the right side that opens the in-app guide at `/admin/guide`. See [Admin Guide page](#admin-guide-page-this-page).
- **+ (added 2026-05-15)** New **Local AI tools** card sits between API Keys and the bottom tabs — collapsed by default, click to expand. Runs the website's seven AI workflows in the moderator's own Claude.ai / ChatGPT subscription instead of the server's Tavily+Mistral. See [AI Tools — Local AI tools panel](#ai-tools--local-ai-tools-panel).
- **+ (added 2026-05-15)** "All projects" tab now paginates at 20 rows per page (was infinite scroll). Filter chips (approved / changes-requested / pending / rejected) above the list reset to page 1 on switch.
- **+ (added 2026-05-15)** Two AI-tools-card buttons (`Generate global brief` + `Run daily briefs now`) collapsed into a single **`Generate AI briefs`** button that always fans out across all 8 scopes — no per-scope dropdowns. See [Daily Briefs](#ai-tools--daily-briefs-5-am-npt-cron).
- **+** Hero typography scales down on mobile (`text-3xl` instead of `text-4xl` below `sm:` breakpoint) so the title + guide button fit on narrow screens.

**Fix / Change:** New admins now have a discoverable entry point to documentation directly from the console header. The button reads "Admin guide" with a BookOpen icon; clicking opens the comprehensive reference in-app (no need to find the file on GitHub or in the repo).

---

## Admin Guide page (this page)

The in-app rendering of this guide, served at `/admin/guide`.

Where to find it: `/admin` → top-right of the hero strip → "Admin guide" button. Or direct URL `/admin/guide`.

### Previous
_(did not exist — the guide lived only as `docs/ADMIN_GUIDE.md` in the repo, viewable via GitHub or local clone)_

### Current
- Route: `/admin/guide` (no auth gate — public read; discoverable via the "Admin guide" button on `/admin`).
- Rendered from the same `docs/ADMIN_GUIDE.md` source via Vite `?raw` import + `react-markdown` (with `remark-gfm` for GFM tables and `rehype-slug` for heading anchors). The markdown file is the single source of truth — the rendered page automatically reflects the latest content on every deploy.
- Layout: SiteHeader → hero strip with breadcrumb back to `/admin`, page title, intro, "View on GitHub" external link → markdown article with prose typography (`@tailwindcss/typography` plugin's `prose` class with custom overrides for headings, tables, code blocks, links).
- Mobile-friendly: `prose-sm` on small viewports → `prose-base` on `sm:` and up; tables flow naturally because GFM tables render as scrollable HTML; long line-length capped to `max-w-4xl`.
- Heading anchors (e.g. `/admin/guide#api-keys-panel`) work because `rehype-slug` adds `id` attributes to every heading.
- Includes a footer-level GitHub link so admins who prefer the raw markdown view can jump to the repo.

**Fix / Change:** The guide is now usable inside the website without needing repo access. Admins can read on a phone, click section anchors from the TOC, and stay in the admin context throughout.

---

## AI Tools — Global Brief

Manually generate aggregate AI briefs from approved projects. Writes to `global_briefs` table; appears on home page carousel.

Where to find it: `/admin` → "AI tools" card (red-tinted, near top of page).

### Previous
- "Global brief" sub-section with scope dropdown (All projects / By province / By sector) and a Generate button
- Each click produced ONE brief for the selected scope
- AI scored `importance` 0.00–1.00 per brief; home carousel picked top 5 across scopes by importance
- Retention: keeps 5 most-recent per scope
- Two separate buttons: `Generate global brief` + `Run daily briefs now`

### Current
- **Per-scope dropdown removed.** Single `Generate AI briefs` button always fans across all 8 scopes (national + 7 provinces).
- **Each scope now produces a BATCH of 3–10 distinct briefs** instead of one. AI is prompted for "different angles" (sector-wide delay pattern / single flagship slip / funding-commitment shift / status churn / critical-risk cluster / audit finding / completion milestone / geographic concentration / contractor concentration). Each brief in the batch gets its own importance score.
- **`global_briefs` gained `batch_id` (UUID) + `display_eligible` (boolean).** Threshold for display: importance ≥ 0.65. Anything below is archived but invisible.
- **New batch demotes the prior batch's `display_eligible=true` rows for the same scope to false** — the carousel always reflects the latest run, no manual cleanup needed.
- **Retention bumped from 5 → 30 per scope.** With 3–10 briefs per run × 8 scopes × daily cron, the previous limit of 5 wiped a day's worth in hours.
- Migrations: `20260514150000_global_briefs_batch.sql` (adds the columns).
- Multi-brief prompt asks the AI to be honest about scores — most "quiet day in a small province" briefs land at 0.20–0.35 and stay invisible, which is fine.

**Fix / Change:** Old flow produced one brief per click → carousel was thin. New flow produces a diverse batch per scope, importance-filters to display, so the homepage carousel has real content variety every day.

---

## AI Tools — Daily Briefs (5 AM NPT cron)

Automated daily fan-out. Generates batches of 3–10 briefs per scope across 1 national + 7 provincial = 8 scopes every morning at 5:00 NPT, then emails a digest.

Where to find it: `/admin` → "AI tools" card → **`Generate AI briefs`** button. Cron triggers automatically every day at 05:00 NPT regardless.

### Previous
- Cron `daily-briefs-5am-nepal` (15 23 * * * UTC = 05:00 NPT) → `/functions/v1/generate-daily-briefs`
- Orchestrator iterated 8 scopes sequentially with 4s pacing
- Each scope produced **ONE** brief
- Digest email sorted by importance DESC, sent via Resend to `ALERT_EMAIL`
- Subject: `Nepal Infra Watch — Daily briefs YYYY-MM-DD (8/8 generated, top 0.94 Bagmati)`
- Two admin buttons: `Generate global brief` (per-scope, dropdowns) and `Run daily briefs now` (all 8 scopes)

### Current
- Same cron, same orchestrator, same email
- **+** Each scope now produces a **batch of 3–10 distinct briefs** instead of one (see [Global Brief](#ai-tools--global-brief)). 8 scopes × ~5 briefs ≈ 40 briefs/day total.
- **+** Orchestrator generates a single `batch_id` UUID at the start and threads it through every child `ai-generate-global-brief` call. The whole day's run is grouped.
- **+** Digest email subject reformatted: `Nepal Infra Watch — AI briefs YYYY-MM-DD (N display-eligible of M across S/8 scopes)`. Body shows per-scope counts + top 3 headlines per scope (★ marker on the display-eligible ones).
- **+** Two admin buttons collapsed into one **`Generate AI briefs`** button — no per-scope dropdowns. Always fans across all 8 scopes; matches the cron's behaviour 1:1.
- **+** Toast on click reports `Generated N briefs across X/8 scopes · M display-eligible`.

**Fix / Change:** Old flow gave a thin home carousel (8 briefs/day, only ones above threshold visible — often only 2–3 made it). New flow gives a diverse batch per scope; carousel shows up to 12 display-eligible briefs at a time.

---

## AI Tools — Local AI tools panel

Run the website's AI workflows in the moderator's own Claude.ai / ChatGPT subscription instead of the server's Tavily + Mistral quota. Designed for when Tavily / Mistral free-tier credits are exhausted, or when the moderator wants higher-quality output (Claude > Mistral) for stakes work.

Where to find it: `/admin` → scroll past API Keys → **`Local AI tools`** card (collapsed by default; click to expand).

### Previous
- Two credential inputs at top (service-role JWT key + optional PAT), placeholder + intro paragraph corrected
- **Eight workflow rows** (Tool menu, Discover, Go Live, Analyze deep, Live Check, Refresh Stale, Generate briefs, Fetch news, Verify)
- Per-cell target / follow-up-query semantics on Discover + Go Live
- Live Check inputs: just **Max cycles** + **Poll every (sec)**. No cap on # of projects analyzed in a session — if 50 approvals landed at once, Live Check would burn through them all, behaving like a backlog processor and saturating AI quota in one go
- Prompts spelled out enum lists and table schemas, but **missing several real values:**
  - All 7 detail tables have `other` as a valid enum value (verified against `information_schema`), but the prompt didn't surface it. AIs hit constraint violations or had to map to "closest available" wrong value
  - `project_documents.doc_type` was missing `legal` in the prompt's list
  - `project_analysis_runs.status` accepts `{queued, running, succeeded, failed, cancelled}` only. Both ChatGPT and Claude wrote `status: "done"` on the close PATCH and hit HTTP 400 `violates check constraint`
  - `project_analysis_runs.gaps_and_contradictions` is `text[] NOT NULL DEFAULT '{}'`. Prompt described it as "short bullet flags" with prose examples — ambiguous about whether it's a string or array. AIs sometimes wrote a paragraph (which Postgres accepts then breaks the rendering downstream) or `null` (NOT NULL violation)
- Go Live: if the resume checkpoint was the LAST cell in the grid (e.g. Tourism × Sudurpashchim in default order), the AI still claimed the session, did an empty walk, and released it — wasted round-trip with no actual work
- No prompt-level guidance about shell-escape pitfalls. Multiple sessions broke on typographic apostrophes (`'`) and em-dashes (`—`) in prose interpolated into PowerShell here-strings, and on PowerShell's default UTF-16 encoding which Supabase rejects

### Current
- **+ Live Check Max projects field** (default 20, 0 = unlimited). Exits the moment N `succeeded` `project_analysis_runs` rows have closed, even if cycle budget remains. Layout grid changed from `grid-cols-2` → `grid-cols-2 sm:grid-cols-3` to fit. Helper text now also flags the **watcher-vs-backlog** distinction: if the first cycle finds many candidates immediately, stop and use Refresh Stale instead.
- **+ project_analysis_runs schema notes** as a new section in `DETAIL_TABLES_SCHEMA`. Spells out: `status` is `{queued, running, succeeded, failed, cancelled}` (use `succeeded`, NOT `done`); `gaps_and_contradictions` is `text[] NOT NULL DEFAULT '{}'` — JSON array of strings, never prose, never `null`; omit on INSERT to get the default, supply an array on close PATCH; same rule for `errors`, `bucket_status`, `inserted_per_table`, `deduped_per_table`.
- **+ All 7 detail-table enum lists now include `other`** (it was always valid at the DB level; the prompt was just hiding it). `project_documents.doc_type` also picked up the missing `legal`. AIs no longer have to map to wrong-but-close values when the article describes something unusual.
- **+ Go Live end-of-grid detection.** When the resume checkpoint exactly matches the last cell of the current grid (`sectors[sectors.length-1]` × `provinces[provinces.length-1]`), the prompt now says: GRID COMPLETE — exit without claiming the session, tell the admin to toggle Start Fresh or narrow scope. Prevents the empty round-trip ChatGPT hit.
- **+ Shell-escape gotcha section in the header.** Tells the AI to build JSON objects in the runtime and serialise with the language's encoder (`ConvertTo-Json` / `json.dumps` / `JSON.stringify`) rather than interpolating prose into shell strings. Specifically calls out: typographic apostrophe + em-dash + Unicode punctuation breaking here-strings; PowerShell 5.1's default UTF-16 encoding requiring explicit `[System.Text.Encoding]::UTF8.GetBytes` before `Invoke-RestMethod -Body`.
- **+ (added 2026-05-18) New `enrich-coords-fy` workflow row** — "Enrich coordinates + fiscal year". Two checkboxes inside the row (Coordinates / Fiscal year, both checked by default) + "Copy prompt" button. Self-contained prompt fetches approved projects where the selected field(s) are NULL, web-searches authoritative sources (`.gov.np`, ppmo, bolpatra, news), applies the same ≥ 0.75 confidence + Nepal bounds (lat 26.3–30.5, lng 80.0–88.2) + Nepali FY (`YYYY/YY`) rubric as the server function, and PATCHes only the requested null fields via REST. Mirrors the new server-side bulk-enrich panel on the Moderation status tab.
- All previous behaviour preserved: two credential slots, Per-cell target semantics, portability hardening, reviewed_at trigger fix, batch rollback, kill switch + heartbeat, cross-mode integration with server Sherlock Live, paste-back fallback.

**Fix / Change:** Two retrospectives' worth of real session failures rolled into the prompts. (1) Schema accuracy — `succeeded` not `done`, `text[]` not prose, `other` is valid everywhere — eliminates the most common HTTP 400s the AI was hitting. (2) Resource discipline — Max projects cap stops Live Check from accidentally chewing through a backlog when a burst of approvals lands; watcher-vs-backlog hint steers admins to the right tool. (3) Operational hygiene — end-of-grid detection avoids empty Go Live sessions; shell-escape notes preempt a class of PowerShell-specific failures.
- **Multi-prompt detection** is baked into every prompt — paste two prompts together into Claude Code and it auto-spawns one subagent per prompt (parallel); paste into ChatGPT / plain Claude.ai and it tells you to use separate windows.
- **Per-workflow mutex** (not panel-wide): Go Live and Live Check can run in parallel because they claim separate session columns (`sherlock_live_state.golive_session_id` vs `livecheck_session_id`). Same-workflow second-starts are locked. Discover / Analyze (one-shot) / Brief / Fetch news / Verify never claim a session and never lock.
- **Kill switch:** Stop button next to each running session. Sets the corresponding session column to null; the AI's pre-cell/pre-cycle GET sees the change and exits gracefully (~5–60s latency depending on what step it's on).
- **Heartbeat-based stale detection:** if the AI dies externally (terminal kill, tab close, host crash) and never reaches its release step, the panel detects heartbeat-older-than-5min and auto-clears the claim with a toast.
- **Embedded Go Live log** — mirrors the Sherlock Queue tab UI (status badge / kind / params summary / +inserted/skipped / heartbeat trail / errors) filtered to local-golive rows, with a "local only" toggle to optionally also show server cron rows. Updates in realtime.
- **Cross-mode integration with Sherlock Live Discovery:** local Go Live and server Sherlock Live share the same cursor on `sherlock_live_state` so resume hands off cleanly between modes. Banners on both cards show "last advanced by [server/local] · X ago" + warn when the other mode has an active session.
- **Resume from checkpoint:** Go Live row shows a green banner "Will resume from cursor at Gandaki / Urban Development · 294 cells processed this run" — pulled from shared `sherlock_live_state`. Toggle "Start fresh" to ignore the cursor.
- **Batch rollback:** every Copy-prompt click records a `claude-local-<8hex>` batch id in localStorage with timestamp. The "Recent batches" section at the bottom of the panel shows the last 20 with one-click Rollback per batch. Rollback bulk-rejects every row across all 12 AI-writeable tables (projects + 7 detail + 3 timeline + global_briefs) tagged with that batch, deletes the corresponding `sherlock_jobs` rows, and (for Go Live batches) restores the pre-session `sherlock_live_state` cursor snapshot captured at copy time.
- **Paste-back fallback:** for hosts without HTTPS-capability (free ChatGPT, restricted Claude.ai), the AI can emit JSON and the admin pastes it into a textarea at the bottom of the panel — the website inserts using the moderator session.
- **Sherlock Queue tab parity:** Local AI runs write to `sherlock_jobs` with `params.ai_source = "claude-local-<workflow>-<batch>"` so they appear alongside Tavily+Mistral runs in the regular Sherlock Queue. A `local` badge differentiates.

**Backing tables / migrations:**
- `20260514170000_sherlock_live_state_shared.sql` — adds `last_advanced_by`, `last_advanced_at`
- `20260514180000_per_workflow_session.sql` — adds `golive_session_id`, `livecheck_session_id` + started_at columns
- `20260514190000_local_ai_heartbeat.sql` — adds `golive_heartbeat_at`, `livecheck_heartbeat_at`
- `20260514200000_ai_tag_on_detail_tables.sql` — adds `ai_tag` to all 10 detail/timeline tables for rollback queries

**Fix / Change:** Previously every AI feature cost Tavily + Mistral credits. With this panel, moderators can spend their own Claude.ai / ChatGPT quota for the same result, freeing the server-side budget for autonomous Sherlock sweeps. Output quality is also better — Claude doesn't produce the date hallucinations (`2026-03-00`) or JSON-parse failures that Mistral occasionally does.

---

## AI Tools — Auto-approve & Auto-analysis

Two related toggles. **Auto-approve** promotes high-confidence AI submissions from `pending` to `approved`. **Auto-analysis** fires a comprehensive analysis the moment a project becomes approved (cascades through the analysis-drain pipeline that burns Tavily + Mistral). The pair lets moderators opt all the way out of automated AI spend.

Where to find it: `/admin` → "AI tools" card → "Auto-approve high-confidence AI submissions" panel + the **Auto-analysis on approval** toggle inside the Local AI panel.

### Previous
- Auto-approve toggle + threshold (default 85%)
- Auto-analysis on approval toggle (default ON) controls `site_settings.auto_analysis_on_approval_enabled`; when OFF, the `queue_analysis_on_approval()` trigger short-circuits and Local-AI Live Check is expected to handle analysis instead
- Confidence rubric harmonised between server and local-AI paths
- **Silent bug**: the auto-approve trigger set `approval_status='approved'` but never stamped `reviewed_at`. Manual moderator approvals didn't stamp it either. Result: Local-AI Live Check's `reviewed_at > session_start` poll always returned zero, even when 13+ projects had been auto-approved during the session. The whole "auto-approve + Live Check" pipeline had never actually worked end-to-end.

### Current
- Auto-approve toggle + threshold unchanged
- Auto-analysis on approval toggle unchanged
- **+ `reviewed_at` is now stamped on every approval transition** — both the auto-approve BEFORE INSERT trigger and a new `trg_stamp_reviewed_at_on_approval` BEFORE INSERT/UPDATE trigger cover their respective paths. `reviewed_by` stays null on the auto-approve path (no human user in the SECURITY DEFINER context); consumers can use `submitted_by_ai=true AND reviewed_by IS NULL` to distinguish auto vs. human reviewers.
- **+ Backfill**: existing approved-but-`reviewed_at`-null rows got their `reviewed_at` set to `created_at` (NOT `now()`), so the backlog stays invisible to fresh Live Check sessions. The backlog should be processed by the new **Local AI → Refresh stale (backlog sweep)** task, not by Live Check.
- Migration `20260515000000_auto_approve_stamps_reviewed_at.sql` adds the new trigger function and runs the backfill.

**Fix / Change:** Local-AI Live Check actually catches auto-approved projects now. Run **Auto-approve ON** + **Auto-analysis on approval OFF** + **Local AI → Live Check** to fully opt out of server Tavily/Mistral spend while still getting analysis on every auto-approval.

---

## AI Tools — Refresh stale projects

Batch trigger for the comprehensive-analysis pipeline on approved projects that haven't been analysed in 30+ days.

Where to find it: `/admin` → "AI tools" card → bottom of the card → "Refresh stale approved projects" button (with a "Stale count" badge alongside).

### Previous
- One way to refresh stale projects: the server-side **"Refresh stale approved projects"** button in the AI tools card
- Caps at 10 projects per run, paces invocations ~6s apart for Mistral RPM
- Burns Tavily + Mistral quota per project (~5 web searches × ~2KB Mistral response × 10 projects = sizeable hit)
- No way to chew through the backlog using moderator's own Claude.ai / ChatGPT quota — the Local AI panel's existing **Analyze (deep)** task required manual project picking

### Current
- Server-side **"Refresh stale approved projects"** button unchanged (still caps at 10, still burns server quota)
- **+ Local AI → Refresh stale (backlog sweep)** — same DB query, but the moderator's AI tool runs it. Caps at 20 by default (configurable up to 200), 30-day staleness window (configurable 1–365 days). Oldest-first ordering (`asc.nullsfirst`). Per-project guard against in-flight analysis_jobs (skips with `23505` if a row's already queued/running). No session-slot claim — multiple Refresh-stale runs can target different projects in parallel because the per-row `analysis_jobs` partial unique index prevents collisions.
- Pulls candidate list from one DB GET (`approval_status=eq.approved & or=(last_comprehensive_analysis_at.is.null, last_comprehensive_analysis_at.lt.<ISO>)`) and processes through the same 10-table Analyze pipeline used by Analyze (deep) and Live Check.

**Fix / Change:** Two ways to drain the backlog now — server-side button burns Tavily/Mistral, Local-AI task burns moderator's AI quota. Pick whichever budget is more flush.

---

## API Keys panel

Manage Tavily + Mistral API keys with rotation, exhaustion tracking, and credit visibility.

Where to find it: `/admin` → scroll below the "AI tools" card → "API Keys" panel with two columns (Tavily on the left, Mistral on the right).

### Previous
_(did not exist — keys lived only as Supabase platform secrets; admins had no way to see or rotate them through the UI)_

### Previous
- Section below the AI tools card with two-column layout (Tavily / Mistral)
- Per-column: `N alive · M exhausted`, `+ Add key` modal, `Check all` button
- Per-row: masked key, label, position, status badge, credits progress bar **`X/1000`**, last-ok / last-fail timestamps, Check / Delete buttons, exhausted reason inline
- Backed by `api_keys` table (`20260514100000_api_keys.sql`); edge functions read this first, fall back to env vars
- Auto-rotation: exhaustion code flips `is_exhausted=true`, sinks position to `max+1000`
- New keys land at bottom; Tavily seeded with `credits_total=1000`
- **Bug:** Credits always showed `0/1000` for every Tavily key. Cause: `check-api-key` was POSTing to Tavily's `/usage` endpoint with body-based `api_key` (Tavily replies 405 Method Not Allowed), so the credit fetch silently failed and rows kept their seeded defaults forever.

### Current
- Same two-column layout, real credits display, scroll-capped column heights — all unchanged
- **+ Reshuffle button** per provider column (next to "Check all"). After several add/exhaust cycles the `position` column gets gappy — alive keys at {1, 4, 8}, exhausted at {2, 3, 5, 6, 7} — which makes the panel confusing to read and means a newly-revived alive key sits behind older alive keys by position. Reshuffle recompacts: alive keys to positions 1..N, exhausted to N+1..M, preserving current display order within each group. One-shot operation, disabled while in flight, mutually exclusive with "Check all" so the two operations don't race.
  - **Why position numbering matters even though edge functions try alive-first:** the edge-function key reader does `order('is_exhausted', { ascending: true }).order('position', { ascending: true })`. Alive keys ARE tried first regardless of their `position`. But within the alive group, position decides order — so a revived key at position 8 sits behind alive keys at positions 1–5, and gets called later. Reshuffle equalises that.
- **Note on key format:** the table accepts both legacy JWT-format keys (`eyJ...`) and new `sb_secret_` keys. For server-side use (edge functions, drainer) both work. **For Local AI panel use**, the JWT-format is required — see [Local AI tools panel](#ai-tools--local-ai-tools-panel) for the reason.

**Fix / Change:** Until now the only way to influence rotation order was to delete + re-add keys (which loses credit history). Reshuffle compacts in place without dropping rows.

---

## Sherlock — Queue tab

The discovery job queue. Each row is one `sherlock_jobs` entry.

Where to find it: `/admin` → scroll past API Keys → "Sherlock — autonomous discovery" panel → "Queue" tab (default tab).

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

Where to find it: `/admin` → "Sherlock" panel → "Discover by Location" tab.

### Previous
- Province dropdown (required) → District (optional, cascades) → Municipality (optional, cascades)
- Sectors: 9 checkboxes, all selected by default
- **"Per-sector max"** dropdown (1–10, default 3) — interpreted as a hard ceiling on insertions per sector. Tavily was called with `max_results = perSectorMax` exactly, so if 5 articles came back and 3 got rejected by extraction, the sector ended with 2 inserts and no recovery effort. Cells consistently produced 1–3 inserts even when set to 5.
- Helper text: "Enqueues N jobs (one per sector, M articles/job)" — described the article count as a 1:1 with the configured max
- "Enqueue" button → INSERTs one `sherlock_jobs` row per selected sector with `kind='geo', priority=10`

### Current
- Same UI controls (dropdown, sector checkboxes, location pickers, Enqueue button)
- **"Per-sector max"** renamed to **"Per-sector target"** with a tooltip explaining the asymmetric extraction model
- **Tavily candidate budget** changed from `max_results = target` to `max_results = clamp(target * 2, 5, 10)`. Same Tavily credit cost (1 per call regardless of `max_results` up to 20), but the AI now has more candidates to extract from when some get rejected for non-Nepal-specific content, JSON parse failure, dedupe, or content-too-short
- **Per-cell `localInserted` counter** tracks insertions for the current sector. Inner extraction loop early-breaks when `localInserted >= target`, so we don't make extra AI calls when the target is already met (asymmetric: pay extra Mistral cost only when the first candidates failed)
- Helper text now reads "targeting M viable projects/sector (Sherlock pulls X candidates from Tavily and early-stops when target met)"
- Same include_domains whitelist, same `days: 730` recency, same dry-cell guard, same robust JSON parse

**Fix / Change:** Before this, a cell set to "max 5" routinely produced 1–3 inserts and stopped — the AI ran one Tavily call, processed whatever it got, and never recovered when extraction failed on a few articles. Now the cell pulls a bigger Tavily candidate pool (free quota-wise), extracts until the target is hit, and reports an accurate `skipped` count for the rejected candidates. Deployed as edge function version 59.

---

## Sherlock — Topic Filters

Saved presets for topic-based (non-geo) discovery.

Where to find it: `/admin` → "Sherlock" panel → "Topic Filters" tab.

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

Where to find it: `/admin` → "Sherlock" panel → "Scheduled Sweeps" tab → top half of the tab is the sweep table.

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

Where to find it: `/admin` → "Sherlock" panel → "Scheduled Sweeps" tab → scroll down to the "Live Discovery" section (red-bordered when running, with the Go Live / Stop Live toggle).

### Previous
- "Go Live" button (visible when stopped) → flips `sherlock_live_state.is_live=true`, sets started_at, started_by
- "Stop Live" button (visible when live) → flips is_live=false
- Controls: Per-query max + District-comprehensive toggle + National Pride mode toggle + "Start fresh" checkbox
- Realtime subscription to `sherlock_live_state` shows live updates of enqueued_count + cursor (last_province/district/sector)
- Auto-stop guard: repeated cron failures populate `last_stopped_reason`
- Resume hint when stopped — shows the saved cursor so you can resume mid-sweep
- Sends Slack/email alert via `send-alert` (`go_live_on` / `go_live_off`) on each toggle

### Current
- Same Go Live / Stop controls, same alerts, same auto-stop guard, same cursor display
- **+ Cross-mode integration with Local AI Go Live.** `sherlock_live_state` now has shared columns `last_advanced_by` ('server' | 'local') + `last_advanced_at` so both modes write to the same cursor row.
- **+** Resume banner now shows a `last advanced by [server/local] · timestamp` pill — orange-tinted for server, blue-tinted for local. You can tell which mode last touched the cursor at a glance.
- **+ Two new banners directly above the Go Live button:**
  - **Loud blue** (with spinner) when `golive_session_id` is set on the state row → a local Go Live session is in flight. Server cron would collide with it; the banner explicitly warns "Don't click Go Live until it releases".
  - **Quiet grey** when `livecheck_session_id` is set → a local Live Check is running in parallel. Informational only; Live Check doesn't write to the cursor so no conflict with server Go Live.
- Migrations: `20260514170000_sherlock_live_state_shared.sql`, `20260514180000_per_workflow_session.sql`.

**Fix / Change:** Server Sherlock Live and local Go Live now share state instead of running blind to each other. Switching between modes (because Tavily ran out / Claude.ai is preferred / etc.) preserves progress.

---

## Moderation — Review queue

Pending project moderation. The default tab when opening `/admin`.

Where to find it: `/admin` → bottom of page → tab bar → "Review queue" tab (first tab, with pending count badge).

### Previous
- Same display, same buttons, same flow on individual rows
- **+ Pagination on the All Projects tab.** Was infinite scroll on the full list (~500 rows); now renders 20 per page with a prev / `1 2 3 … N` / next pager at the bottom. Pinned-first-and-last with ±2 around current page; ellipses fill the gaps.
- **+ Status filter chips** above the list (Approved / Reviewed / Pending / Rejected) reset to page 1 on switch; counts shown on each chip.
- **+ Clamping logic** — if the underlying list shrinks past the current page (filter change, bulk-delete), the visible slice and pager both clamp to page 1 without crashing.
- Review queue tab itself (pending / changes_requested only) inherits the same pagination but typically fits on a single page.

### Current
- Same pagination, same status chips, same per-row Approve / Reject
- **+ Inline "Edit progress" popover** on each row (reviewer-only). Shadcn `Popover` with two inputs — number 0–100 for `progress_percent` and a 60-char text input for `progress_stage` — pre-filled from the row. Save PATCHes `projects` directly and updates the row in place; **does NOT touch `approval_status` or `published_at`**, so quick progress fixes on approved projects don't bounce them back into the review queue.
- The moderation row data now joins to `projects.progress_percent` + `projects.progress_stage` (the RPC view `project_moderation_summary` doesn't carry these, so a secondary `projects` SELECT runs alongside the RPC).
- Mobile: popover inputs use `grid-cols-1 sm:grid-cols-2` so the two fields stack at ≤640px.

**Fix / Change:** Previously the only path to update a project's progress was the full `/dashboard/submit?edit=<id>` form, which on save re-set `approval_status='pending'` and dropped `published_at` even for moderator edits to approved rows. The inline popover lets reviewers tick the number forward (e.g., "site visit confirmed 60%") without un-publishing the row.

---

## Moderation — Pending updates / sources

Two separate tabs for moderating AI-discovered child rows.

Where to find it: `/admin` → tab bar → "Pending updates (N)" and "Pending sources (N)" tabs (rightmost in the tab bar, each with a count badge).

### Previous
- Same Approve / Reject buttons, same fetch (joins to `projects(title, slug)`)
- **+ Project name promoted to the top of each pending-sources row.** Previously the project title sat in 12px muted text below the status badges and was easy to miss when scanning. Now each row leads with `FOR PROJECT → <linked title>` in bold accent colour; if `projects.slug` is null (orphan row), shows `(orphan — project_id <N>)` in muted italic so the broken FK is visible instead of just showing "—".
- Source's own title moves below the badges (status / AI / type / created date) — same data, clearer hierarchy.

### Current
- Same layout, same Approve / Reject flow
- **+ Three new columns on `project_sources` AND `project_updates`:** `progress_percent` (smallint 0–100, CHECK-constrained), `cited_at` (date), `progress_note` (text). Migration `20260516081858_source_cited_progress.sql` adds them with `IF NOT EXISTS` so it's re-runnable.
- **+ AI-extracted source rows now carry these citations automatically.** When `analysis-drain` extracts a `reported_progress_percent` from a discovered article, the matching `project_sources` insert row receives `progress_percent` + `cited_at` (sourced from `reported_progress_as_of`). The legacy single-field `projects.reported_progress_*` columns are still written for backwards-compatibility.
- Pending-sources moderation rows can surface the new fields when a moderator opens the inline detail view (no UI change to the queue list itself this pass — fields render in `DetailRowDialog` when present).

**Fix / Change:** Previously source citations were stored as flat URL/title/type, and progress percentages lived in a single `reported_progress_percent` on the project row. A project with three articles all citing different percentages would only retain the latest. Per-source `progress_percent + cited_at` lets the front-end pick the newest dated citation and lets moderators see the full history.

---

## Moderation — Bulk enrich coordinates & fiscal year

Bulk AI lookup that fills missing `projects.coordinates` and `projects.fiscal_year` on approved rows. Lives on the Moderation status tab as a collapsible card above the existing per-project moderation list.

Where to find it: `/admin` → tab bar → "Moderation status" tab → top of the tab → **"Bulk enrich missing fields"** card.

### Previous
_(did not exist — coordinates and fiscal_year were only filled when (a) the submitter typed them, (b) `analysis-drain`'s extraction prompt happened to include them in its `basic_updates` block, or (c) a moderator edited the row manually)_

### Current
- Card with two checkboxes — **Coordinates** and **Fiscal year** — both checked by default. Live missing-counts next to each checkbox (counted via `select(id, head:true, count:'exact').eq('approval_status','approved').is(<field>, null)`).
- **Run enrichment** button calls the new `ai-enrich-coords-fy` edge function with `{ fields: <checked> }`. Disabled when no field is selected or both counts are zero.
- Server function (reviewer+ gated) iterates approved projects missing at least one requested field, runs one Tavily search per project scoped to `.gov.np` / `ppmo.gov.np` / `bolpatra.gov.np`, asks the chat model (Mistral → Google → Lovable fallback chain with the existing `api_keys` rotation) to return strict JSON `{ coordinates: "lat, lng" | null, fiscal_year: "YYYY/YY" | null, confidence: 0.00–1.00, sources: [...] }`.
- **Validation**: coordinates must fall inside Nepal bounds (lat 26.3–30.5, lng 80.0–88.2); fiscal_year must match Nepali FY format `YYYY/YY`. Values outside the bounds are dropped, not written.
- **Writes**: direct PATCH to `projects` when `confidence ≥ site_settings.auto_approve_threshold` (default 0.75), and only for requested fields that are currently NULL and that the AI returned non-null. No pending-state staging, no overwrites of existing values.
- Returns `{ ok, processed, enriched_coords, enriched_fy, skipped_low_conf, skipped_no_data }` → surfaced in a toast on the admin card. Counts re-fetch after the run.
- Mirror feature in the **Local AI tools** panel as the `enrich-coords-fy` workflow row — same checkboxes, same rubric, runs in the moderator's own AI tool quota.

**Backing function:**
- `supabase/functions/ai-enrich-coords-fy/index.ts` — reviewer+ auth, CORS preflight, Tavily search, Mistral/Google/Lovable chat fallback, Nepal bounds + Nepali FY validation, null-only direct writes.

**Fix / Change:** Previously the only way to backfill missing coordinates and fiscal years was per-project manual editing or hoping `analysis-drain`'s extraction prompt picked them up (it inconsistently did, since its prompt is optimised for the seven detail tables not the basic columns). The new panel makes it a one-click bulk action with the same key-rotation, confidence threshold, and value-validation discipline as the rest of the AI pipeline.

---

## Activity dashboard

Tab showing platform activity over time.

Where to find it: `/admin` → tab bar → "Activity" tab (middle of the tab row).

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

Where to find it: `/projects` (public URL). When signed in as moderator, the approval_status filter dropdown appears in the filter bar; AI-discovered projects show "Sherlock" / "AI" pills; pending projects show inline Approve/Reject buttons.

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

Where to find it: `/projects/<slug>` for any project. Admin-only controls appear in the header (Approve / Reject / Edit / Run analysis) and inline on each child-row in the detail tabs (Funding / Documents / Risks / etc.).

### Previous
- Same display, same admin controls
- _(no recent changes to this area; the comprehensive analysis path now uses the updated `analysis-drain` code with include_domains and key rotation)_

### Current
- Same hero, same 7 detail tables, same admin header controls
- **+ Source-cited progress is now the top-priority signal in the hero `ProgressBreakdown`.** The priority chain is now:
  1. **Source-cited** — newest `project_sources` row with a non-null `progress_percent` (sort by `cited_at DESC`, tiebreak on `created_at DESC`; approval_status must be `approved` or null)
  2. **Reported (AI)** — `projects.reported_progress_percent` with `reported_progress_as_of`. Wins over source-cited iff its `as_of` is strictly newer than the source's `cited_at`.
  3. **Manual** — `projects.progress_percent`
  4. **Milestones** — completed / total ratio
  5. **Status** — fallback heuristic
- **+ One-line summary directly under the hero progress bar:** "X/Y milestones done · last source: N% on YYYY-MM-DD" (each half renders only when its data exists). Replaces the previous behaviour where milestones drove the bar even when a fresher article cited a different percentage.
- **+ "Source-cited" appears in the All-signals modal** with an external link to the source URL (same pattern as the AI-reported signal).
- The detail page now passes the already-loaded `sources` array into `ProgressBreakdown` (single extra prop; no extra query).

**Fix / Change:** The bar was being driven by milestone completion ratio even when a recent news article cited a different percentage. Mismatches looked sloppy on highly-tracked projects. Source-cited progress with date-aware priority means the freshest dated signal wins, and the supporting evidence (citation date + URL) is visible to admins without opening the breakdown modal.

---

## Analytics & Ratings

`/analytics` is public, but admins use it as the editorial dashboard.

Where to find it: `/analytics` (main page with auto-lede, leaderboards, charts) → "View all →" on the rating card → `/analytics/ratings` (full sortable / filterable table).

### Previous
- **+** Auto-generated lede header: "X% of N tracked projects are delayed; <Province> leads at Y%" — derived from `projects.status` + `expected_completion`
- **+** New section: **Top-rated projects** (`#leaderboard`) — swipable carousel, top 10 by performance score (status + schedule + budget delivery + activity recency, 4 dimensions × 25 pts). Has a **"View all →"** link to `/analytics/ratings` (a new dedicated page with sort + filters).
- **+** New section: **Best-documented projects** (`#documented`) — swipable carousel, top 10 by data-completeness (10 yes/no signals × 10 pts). Editorial counterpart to the rating leaderboard.
- **+** **30-day activity strip** (`#activity`) — stacked AreaChart from `daily_project_metrics` (new projects + updates + detail rows)
- **+** **Status distribution** redesigned as a horizontal stacked bar with lifecycle order + colour-keyed legend. Replaces the unreadable pie.
- **+** **Worst schedule slips** (`#slips`) — top 10 projects past expected_completion, still in flight; red "Nmo overdue" badge per row.
- **+** Section anchors (#leaderboard, #documented, #activity, #status, #sectors, #provinces, #slips, #stalest) — deep-linkable from home carousel via `/analytics#xxx`.
- **+** **`/analytics/ratings`** — new view-all page with sort (rating desc/asc, recently active, budget, title A-Z/Z-A) + filters (sector, province, status). Desktop table view; mobile collapses to card list.
- **+** FY filter pill on the Total budget KPI (`all` / `__untagged__` / literal "YYYY/YY" — filters the KPI sum and the per-row count) + a **"Budget by fiscal year"** stacked bar chart.

### Current
- Same leaderboards, same KPI cards, same activity strip, same FY filter pill, same Budget-by-FY chart
- **+ FY backfill ran in production.** The `nepal_fy_from_date(date)` SQL function (immutable, pure SQL) derives a BS fiscal year label (e.g. "2081/82") from any AD date using a Shrawan-1 / July-16 cutover. The backfill `UPDATE` populated `projects.fiscal_year` for every approved row that had a non-null `start_date` and a null `fiscal_year`. **Verified on production: 122 rows now have FY, 507 remain untagged (no `start_date` to derive from).**
- **+ BEFORE INSERT/UPDATE trigger `trg_set_fiscal_year`** auto-fills `projects.fiscal_year` when `NEW.fiscal_year IS NULL` and `start_date` is set. New submissions therefore land with FY populated without contributor effort.
- **+ Subtitle below the FY chart** ("Derived from start_date when fiscal_year wasn't set. N projects still untagged.") — renders only when `untaggedCount > 0` (projects with no `fiscal_year` AND no `start_date`).
- **Note for admins:** the trigger only fires when `NEW.fiscal_year IS NULL`. Contributors / reviewers who explicitly set FY in the form override the derivation — the trigger never silently overwrites a user-chosen value.

**Fix / Change:** Before the backfill, ~95% of rows had `fiscal_year=NULL` and the FY chart collapsed into one giant "Untagged" bar — useless for editorial. The trigger keeps the column populated going forward; the migration backfill makes the chart immediately useful. Sanity check: `nepal_fy_from_date('2024-07-15') = '2080/81'`, `nepal_fy_from_date('2024-07-16') = '2081/82'` (Shrawan-1 cutover).

---

## Home page brief carousel (admin context)

Admins see the same home page as the public — the carousel's behaviour affects how briefs surface.

Where to find it: `/` (home) → hero strip → right column on desktop, full-width on mobile → swipable card with dots indicator at top.

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

Where to find it: `/admin` → tab bar → "Activity" tab → scroll to the bottom (admin-only; coadmin sees read-only view; reviewer doesn't see it at all).

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

Where to find it: header nav → "Dashboard" link → opens `/dashboard`. From there, "Submit project" button → multi-step form at `/dashboard/submit`.

### Previous
- Same form, same submission flow, same hydration on edit
- **+ Physical progress (%)** input — number 0–100, optional. Maps to `projects.progress_percent`. Hint text clarifies this is the manual entry; the AI-extracted equivalent (`reported_progress_percent`) is a separate field that carries a quote + source URL.
- **+ Progress stage label** input — short free text up to 60 chars, optional. Maps to `projects.progress_stage`. For human-readable labels like "Foundation poured", "50% structural", "Punch-list".
- Both fields are loaded on edit because the form hydration uses `select('*')`, and saved on submit because the insert/update payload already spreads `parsed.data` from the zod schema. No additional plumbing was needed beyond the schema + UI.

### Current
- Same project-level form, same physical-progress + stage-label inputs at the project level
- **+ Per-source progress inputs in the Sources row grid.** Each source row now has two extra inputs alongside URL / title / type:
  - `progress_percent` (number 0–100, optional) — what percentage this source cites
  - `cited_at` (date, optional) — when the source's reading was taken
  Empty strings coerce to `null`; the percent coerces to a number on insert. The 4-column row layout collapses to single-column on mobile (`sm:` breakpoint, ≤640px).
- **+ Backwards-compatible storage.** Both inputs map to the new `project_sources` columns (`progress_percent`, `cited_at`, `progress_note`). Old rows without these fields keep working — `null` means "this source didn't cite progress."
- On edit, hydration replaces the user's own pending source rows (existing behaviour); approved source rows stay in moderator-only queue.

**Fix / Change:** Manual contributors who paste in a citation like "Kantipur · 2026-04-12 · 65% complete" previously lost the percentage and the date — only the URL + title made it into the DB. Now both numbers ride with the source, and the front-end's `ProgressBreakdown` picks the most recent dated citation when computing the progress bar. Combined with the moderation inline-edit popover, reviewers no longer have to choose between "trust the contributor's number" and "wait for AI to extract it."

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

> Last updated: 2026-05-14 (in-app guide page at /admin/guide).
