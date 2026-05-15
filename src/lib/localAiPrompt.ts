// Prompt builders for the Local-AI workflow.
//
// Background: Tavily + Mistral free tiers are precious. When a moderator
// already has a Claude.ai or ChatGPT subscription they can spend that quota
// instead, by pasting a self-contained prompt into their AI tool and letting
// it do the web research + Supabase writes directly.
//
// One builder per workflow returns a string ready to paste. The string
// includes only the schemas/enums/rubrics the chosen task uses, so each
// prompt stays under ~3KB and the AI can hold the whole context easily.
//
// Tool-agnostic by design — works in Claude Code (Bash + WebSearch /
// WebFetch), Claude.ai web (web search + computer use), ChatGPT Plus
// (browsing + code interpreter). The prompt tells the AI what HTTPS calls
// to make but not HOW; the AI picks whichever HTTPS-capable tool it has,
// or falls back to returning a JSON block for the admin to paste back.

export type LocalAiTask = "menu" | "discover" | "go-live" | "analyze" | "live-check" | "refresh-stale" | "brief" | "fetch-news" | "verify";

// One project's row passed into the multi-select-driven workflows. The
// admin's Local-AI panel pre-fetches this metadata from the DB so the AI
// doesn't have to do N GET round-trips just to resolve slug → title.
export type LocalAiProjectRef = {
  id: number | string;
  slug: string;
  title: string;
  sector?: string | null;
  province?: string | null;
  district?: string | null;
};

export type LocalAiInput = {
  // The runtime-supplied service-role key. Stored in browser localStorage by
  // the admin UI; never bundled with the SPA build. Substituted into the
  // prompt's <SERVICE_ROLE_KEY> placeholder right before clipboard copy.
  serviceRoleKey?: string;
  // Per-Copy session batch id (8-hex). The panel generates a fresh one on
  // every Copy-prompt click and remembers it in localStorage so the admin
  // can roll back a bad session by ai_tag prefix.
  batchId?: string;
  // Single-project workflows (legacy slot, kept for fetch-news / verify).
  projectSlugOrId?: string;
  // Multi-project workflows (analyze).
  projects?: LocalAiProjectRef[];
  // Discover single-cell.
  sector?: string;
  province?: string;
  // Brief.
  scope?: "global" | "province" | "sector";
  scopeValue?: string;
  // Go Live multi-cell sweep.
  goLiveProvinces?: string[];
  goLiveSectors?: string[];
  goLivePerCellMax?: number;
  goLiveBudget?: number;
  goLiveIncludeDistricts?: boolean;
  goLiveNationalPride?: boolean;
  // Live Check loop bounds.
  liveCheckCycles?: number;       // 0 = one-shot pass; N>0 = poll N times
  liveCheckIntervalSec?: number;  // seconds between polls (e.g. 60)
  // Refresh Stale (one-shot batch over the backlog).
  refreshStaleMax?: number;       // hard cap on projects processed in one run
  refreshStaleDays?: number;      // "stale" threshold in days (default 30)
  // Go Live resume — when set, the prompt tells the AI to start AFTER this
  // (sector, province) cell in column-major order, skipping everything up
  // through it. The panel populates this from the most recent local Go Live
  // sherlock_jobs row with status=done and inserted>0.
  goLiveResumeFrom?: { sector: string; province: string } | null;
};

const SUPABASE_URL = "https://vlioybqqswbohdhpnjym.supabase.co";

function buildHeader(batchId: string): string {
  return `# Nepal Infra Watch — Local AI Workflow

You are an AI assistant for the Nepal Infra Watch admin team. The website is a
public tracker of Nepal's infrastructure projects across 7 provinces and 77
districts. The admin pastes this prompt into you to run an AI task that would
otherwise consume the website's Tavily + Mistral free-tier credits.

## Credentials (treat as a secret — never echo, never quote outside this run)

\`\`\`
SUPABASE_URL              = ${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY = <SERVICE_ROLE_KEY>
\`\`\`

**REQUIRED — JWT-format key.** Use the legacy \`service_role\` key that
starts with \`eyJ...\` (JWT format). The newer \`sb_secret_...\` keys are
rejected with HTTP 401 ("Forbidden use of secret API key in browser") by
PostgREST when the request comes from anything browser-like — Claude.ai,
ChatGPT, and most subagent runtimes hit this guard. If \`<SERVICE_ROLE_KEY>\`
above starts with \`sb_secret_\`, STOP and tell the admin to paste the
JWT-format key instead (from Supabase Dashboard → Project Settings → API
→ service_role, the one that starts with \`eyJ\`).

Every REST call needs these headers:

\`\`\`http
apikey:        <SERVICE_ROLE_KEY>
Authorization: Bearer <SERVICE_ROLE_KEY>
Content-Type:  application/json
Prefer:        return=representation
\`\`\`

## Bulk-insert gotcha (PGRST102)

PostgREST array-inserts require **every object in the array to have
identical JSON keys**. If you POST \`[{a:1,b:2},{a:3}]\` it errors with
PGRST102 "All object keys must match". Always include every column in
every row of a bulk-insert; use explicit \`null\` for missing fields.

## Multi-prompt detection — CHECK THIS BEFORE YOU START

Scan your current input for OTHER blocks that start with the heading
\`# Nepal Infra Watch — Local AI Workflow\` (other batch ids, other tasks).
The admin sometimes pastes Go Live and Live Check together to run both
in parallel.

- **You see only ONE such block (just this one):** skip this section,
  proceed normally to the Task section below.

- **You see TWO OR MORE blocks AND you have a Task / subagent tool**
  (Claude Code, Claude.ai with computer use): spawn ONE subagent per
  block. Each subagent treats its own block as its complete context and
  executes end-to-end. They run in parallel — that's the point of pasting
  them together. After dispatching, await all subagents and report a
  combined summary. Do NOT execute any prompt yourself in the main
  thread; subagent everything.

- **You see TWO OR MORE blocks AND you do NOT have a subagent tool**
  (plain Claude.ai web, ChatGPT, code-interpreter-only environments):
  STOP. Reply to the admin verbatim:
  > "I see N Local AI prompts pasted together but my current host has no
  > Task / subagent tool to run them in parallel. Paste each prompt into
  > its own separate chat or terminal window — they're designed for
  > independent execution and the website's panel will track each
  > session via its own batch id."
  Do NOT pick one and run it silently — that drops the others on the floor.

## Batch tag — REQUIRED on every row you write

This run's batch id is **\`${batchId}\`**.

Stamp **every** \`projects\`, \`project_sources\`, \`project_updates\`,
\`project_milestones\`, \`project_funding\`, \`project_documents\`,
\`project_stakeholders\`, \`project_risks\`, \`project_impact\`,
\`project_procurement\`, \`project_compliance\` row you insert with:

\`\`\`json
"ai_tag": "claude-local-${batchId}"
\`\`\`

For \`global_briefs\`: use \`"created_by": null\` and append the same tag to
\`sources\`'s first element if you can (don't break schema otherwise).

For \`sherlock_jobs\` and \`project_analysis_runs\` rows you open: write
\`params.ai_source = "claude-local-${batchId}"\` (sherlock) or
\`ai_tag = "claude-local-${batchId}"\` (analysis runs).

**Why:** the admin's panel keeps a history of recent batches and lets them
roll back a whole session with one click by filtering on this tag prefix.
Without the tag the admin would have to delete rows by hand.

## Portability — this prompt is self-contained, do NOT read local files

This prompt was copied from the admin panel and is designed to run on **any
device**: the admin's laptop, a phone, a teammate's machine, a fresh sandbox.
Everything you need is either (a) inside this prompt text, or (b) pullable
from Supabase via the REST endpoints below.

**Do NOT look for credentials, configuration, or project data in any local
folder, \`.env\` file, working-directory file, mounted volume, or repository
checkout — even if your host has filesystem access (Claude Code, code
interpreter, Cursor, etc.). The service role key above is the only key you
need; the Supabase URL is the only host you need. If \`<SERVICE_ROLE_KEY>\`
above still reads as a literal angle-bracket placeholder, the admin forgot
to paste the key into their panel — STOP and ask them to fix it (don't try
to find it elsewhere).**

If you need project metadata that isn't already in this prompt, GET it from
\`${SUPABASE_URL}/rest/v1/projects?...\` using the credentials above. Same for
\`sherlock_jobs\`, \`sherlock_live_state\`, \`project_analysis_runs\`, and the
detail / timeline tables.

## How to research

Use whichever web-search / browsing / fetch tool you have. For news queries,
prefer Nepali sources: kathmandupost.com, ekantipur.com, nepalitimes.com,
onlinekhabar.com, myrepublica.nagariknetwork.com, setopati.com,
risingnepaldaily.com. For government sources: *.gov.np (especially mof,
mopit, moewri, mohp, moe, ppmo, oag, ciaa). For funder coverage:
worldbank.org, adb.org, jica.go.jp, undp.org, who.int.

## If you cannot make HTTPS calls

(No web/HTTP tool, no code interpreter, browse-only sandbox.) STOP after
extraction and emit the result as a single JSON code block matching the
shape this task's instructions describe. The admin will paste it into the
website's Local-AI panel which will write the rows with the right batch tag.
`;
}

// Subagent guidance — included in Go Live and Live Check, which are the
// long-running multi-cell / multi-project sweeps where parallelism matters.
const SUBAGENT_NOTE = `## Concurrency hint

If you are running in **Claude Code** or another host with a Task /
subagent tool, you MAY spawn parallel subagents — one per cell (Go Live)
or one per project (Live Check) — as long as they target **different
projects** (no two subagents writing to the same project_id row).

**The website's mutex is per-workflow, not panel-wide.** Two long-running
local workflows — Go Live and Live Check — each claim their own session
column on \`sherlock_live_state\` (\`golive_session_id\` /
\`livecheck_session_id\`), so they can run simultaneously without colliding.
What's locked out is a second instance of the **same** workflow: starting
another Go Live while Go Live is in flight, or another Live Check while
one is running. Discover, Analyze (one-shot), Brief, Fetch news, and
Verify don't claim a session at all and never lock.

Subagents inside a single workflow are fine because they share the same
workflow's session column and queue rows. Pace yourself regardless:
web-search quota is the bottleneck, not your parallelism. Hard cap on
simultaneous subagents: 3.

If you are in a single-threaded host (Claude.ai web, ChatGPT), just do
the work sequentially.
`;

const ENUMS_FULL = `## Canonical enums (must match exactly — case-sensitive)

\`\`\`
SECTORS   = ["Transport","Energy","Water & Sanitation","Agriculture & Irrigation",
             "Health","Education","Telecom","Urban Development","Tourism"]
PROVINCES = ["Koshi","Madhesh","Bagmati","Gandaki","Lumbini","Karnali","Sudurpashchim"]
STATUS    = ["proposed","approved","in_progress","delayed","completed","cancelled"]
ESIA      = ["not_started","in_progress","iee_approved","eia_approved","rejected","exempt"]
PROJECT_TYPES = ["Road","Bridge","Tunnel","Cable car","Airport","Railway",
                 "Hydropower","Solar","Wind","Transmission line","Substation",
                 "Drinking water","Sewerage","Treatment plant","Reservoir","Irrigation canal",
                 "Hospital","School","Stadium","Market","Office building","Telecom tower","Other"]
\`\`\`

Unit conversion: 1 lakh = 100,000 NPR; 1 crore = 10,000,000 NPR. Always
write raw NPR (no commas, no suffixes) in numeric columns.
`;

const PROJECT_SCHEMA = `## projects table (bigint PK id)

\`\`\`jsonc
{
  "title": "string ≤200",                    // required, project's actual name
  "slug": "kebab-case-with-4hex-suffix",     // required, unique; "<slug>-<4hex>"
  "description": "string, 250–500 words",
  "sector": "<SECTOR>",                      // primary
  "sectors": ["<SECTOR>", "..."],            // primary at [0]
  "project_type": "<PROJECT_TYPE> or null",
  "province": "<PROVINCE> or null",
  "provinces": ["<PROVINCE>", "..."],        // primary at [0], max 7
  "district": "string or null",
  "districts": ["string", "..."],            // max 10
  "municipality": "string or null",
  "municipalities": ["string", "..."],       // max 15
  "ward": 0-99 or null,
  "location_text": "free text or null",
  "contractor": "string or null",
  "implementing_agency": "string or null",
  "budget_npr": "number or null",
  "funding_committed_npr": "number or null",
  "estimated_beneficiaries": "number or null",
  "procurement_method": "string or null",
  "esia_status": "<ESIA> or null",
  "start_date": "YYYY-MM-DD or null",        // MUST be a real calendar date
  "expected_completion": "YYYY-MM-DD or null",
  "status": "<STATUS>",                       // required, use rubric below
  "approval_status": "pending",               // always 'pending' — the BEFORE INSERT trigger flips qualifying rows to 'approved' and stamps reviewed_at
  "submitted_by": null,
  "submitted_by_ai": true,
  "ai_tag": "claude-local-<batchId>",         // see Batch tag section for the literal value
  "national_pride": false,
  "image_urls": [],
  "cover_image_url": null,
  "confidence_score": 0.00-1.00
}
\`\`\`
`;

const CONFIDENCE_AND_STATUS = `## Confidence rubric (required, 0.00–1.00; skip rows < 0.40)

This matches the rubric the server-side Sherlock pipeline uses in
\`ai-discover-projects\` so your scoring distribution is comparable —
which matters because the auto-approve trigger fires on the same
threshold for both Sherlock and local-AI rows.

- 0.95–1.00: article unambiguously names a specific Nepali project with budget / agency / dates / location all stated.
- 0.80–0.94: article names the project clearly and gives 3+ concrete fields (sector, location, agency, or budget).
- 0.60–0.79: article mentions the project by name but key fields (location/budget) are inferred or vague.
- 0.40–0.59: project mentioned in passing; significant fields guessed.
- < 0.40: don't emit the row at all.

**Per-article scoring** — each row's confidence is judged on the single
source article it came from, not on cross-source corroboration. A clear,
field-rich news piece scores 0.80+ even if there's only one source.

## Status rubric (use the LATEST evidence in the article)

- \`proposed\` — announced/studied, no formal sanction ("feasibility study", "DPR in preparation", "concept stage").
- \`approved\` — sanctioned/budgeted/tender awarded, no physical work yet.
- \`in_progress\` — construction or implementation actively underway.
- \`delayed\` — should-be-in-progress-or-done but explicit slippage reported (require explicit delay language; don't infer).
- \`completed\` — inaugurated/operational/handed over/commissioned.
- \`cancelled\` — scrapped/abandoned/terminated.

## Description rules (identity field, NOT a status report)

3–5 paragraphs (~250–500 words), plain prose, no markdown. Cover scope/scale,
geography, sector + project type, intent, stakeholders, procurement model.
Do NOT include progress %, current contractor activity, recent delays, or
any "as of <recent year>" framing. Use ONLY facts in the source article;
do not pull in outside knowledge about real-world Nepali projects with
similar names.
`;

const SHERLOCK_PARITY = `## Queue-tab parity (for /discover only)

The admin's Queue tab reads from \`sherlock_jobs\`. Before any web search,
INSERT a row so the run shows up alongside Tavily + Mistral runs:

\`\`\`http
POST ${SUPABASE_URL}/rest/v1/sherlock_jobs
{
  "kind": "geo",
  "params": { "province":"<P>", "sectors":["<S>"], "maxResults":5, "ai_source":"claude-local" },
  "priority": 1,
  "status": "running",
  "started_at": "<ISO-8601>",
  "enqueued_by": null,
  "last_diagnostic": { "ts":"...", "label":"start", "phases":["       0ms start"], "elapsed_ms":0 }
}
\`\`\`

Capture the returned \`id\` as JOB_ID. At the end, PATCH the row to
\`status:"done"\` with final \`inserted\` and \`skipped\` counts. If the run
errors, PATCH to \`status:"failed"\` and put the message + last 20 phases
into \`error_text\`. Counter semantics: \`inserted\` = NEW projects rows
written; \`skipped\` = articles processed but not inserted (AI-said-null,
dedupe hit, or content too short).
`;

const TIMELINE_TABLES_SCHEMA = `## 3 Trace-History timeline tables (uuid PK id, FK project_id bigint)

These mirror what the website's "Trace History" / "Run AI Analysis" button
populates alongside the 7 detail tables. Write them as part of the SAME
analysis_runs cycle so the project's Milestones / Updates / Sources tabs
fill up at the same time the detail tabs do.

### project_milestones
\`\`\`jsonc
{
  "project_id": <bigint>,
  "title": "string",
  "description": "string or null",
  "milestone_date": "YYYY-MM-DD or null",
  "stage": "planning|approval|tendering|construction|operation|closure or null",
  "status": "pending|in_progress|completed|missed",  // default "pending" if uncertain
  "order_index": 0,                                   // 0-based, in chronological order
  "sources": [{"url":"...","title":"...","bucket":"news|government|..."}],
  "submitted_by_ai": true,
  "approval_status": "pending",
  "confidence_score": 0.00-1.00
}
\`\`\`
Dedupe key: \`title\` (fuzzy) + \`milestone_date\` against existing rows.

### project_updates
\`\`\`jsonc
{
  "project_id": <bigint>,
  "title": "≤120 chars headline",
  "content": "1–3 short paragraphs plain prose",
  "update_text": "<same as content>",
  "update_date": "YYYY-MM-DD or null",
  "update_type": "news|status|progress|issue|completion|funding|legal",
  "submitted_by_ai": true,
  "approval_status": "pending",
  "sources": [{"url":"...","title":"...","bucket":"..."}],
  "confidence_score": 0.00-1.00
}
\`\`\`
Dedupe key: \`title\` (fuzzy) + \`update_date\` against existing rows.

### project_sources (additional citations beyond the per-row sources jsonb)
\`\`\`jsonc
{
  "project_id": <bigint>,
  "title": "string",
  "url": "https://...",
  "source_type": "news|government|audit|procurement|donor|academic|other|article",
  "published_at": "YYYY-MM-DD or null",
  "verified": false,
  "submitted_by_ai": true,
  "approval_status": "pending",
  "confidence_score": 0.00-1.00
}
\`\`\`
Dedupe key: normalised \`url\` (strip \`https?://(www\\.)?\`, lowercase).
`;

const DETAIL_TABLES_SCHEMA = `## 7 detail tables (uuid PK id, FK project_id bigint)

Every row needs: \`project_id\`, \`approval_status:"pending"\`, \`submitted_by_ai:true\`,
\`confidence_score:0.00–1.00\`, \`sources:[{"url":"...","title":"...","bucket":"news|government|..."}]\`.

| Table | Required | Notable optional columns |
|---|---|---|
| project_funding | source_name | source_type ∈ **{government, multilateral, bilateral, private, loan, grant, equity, ppp}** — note: \`government\` is the valid value, **not** \`govt\`. Other cols: amount_npr, amount_usd, committed_at (date), disbursed_amount |
| project_documents | title | doc_type (eia/iee/contract/tender/audit/progress_report/completion_report/blueprint/financial/press_release), url, source_org, published_at (date) |
| project_stakeholders | role, org_name | role: implementing_agency / executing_ministry / contractor / sub_contractor / consultant / donor / beneficiary / regulator / community |
| project_risks | title, severity, status | severity: low/medium/high/critical; status: open/mitigated/closed/escalated; category: financial/legal/environmental/social/political/technical/schedule/audit/corruption; reported_at, resolved_at (dates) |
| project_impact | metric_type | metric_type: beneficiaries/jobs_temporary/jobs_permanent/displacement/area_served_sq_km/households_served/co2_reduction_t/revenue_generated_npr/energy_capacity_mw/water_capacity_mld; metric_value, baseline_value, target_value, measured_at (date) |
| project_procurement | tender_title | contract_type: epc/design_build/itb/icb/ncb/limited/direct/framework/ppp; status: planned/published/bidding/evaluation/awarded/cancelled/disputed; tender_published_at, bid_open_at, contract_awarded_at (dates) |
| project_compliance | item_type | item_type: eia/iee/land_acquisition/right_of_way/forest_clearance/social_impact/audit_oag/audit_ciaa/blacklist/court_case; status: not_started/in_progress/approved/rejected/conditional/blacklisted/dismissed/pending; decided_at (date) |

ALL dates MUST be real ISO calendar dates (YYYY-MM-DD). Postgres rejects
\`2026-03-00\`, \`2026-02-30\`, \`2026-13-05\`, etc. If you're not sure of the
day, use null — never fabricate "00".
`;

// Generate a fresh 8-hex batch id. Used when the caller didn't supply one
// (e.g. unit tests, or a future caller that doesn't go through the panel).
function genBatchId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

function buildMenu(input: LocalAiInput): string {
  const batchId = input.batchId ?? genBatchId();
  return `${buildHeader(batchId)}
## What you can do — Local AI tools menu

The admin pastes this prompt to start a session. Ask which task to run:

**Discovery / ingest**
1. **Discover** — find new infrastructure projects via web search.
   Inputs: sector (optional), province (optional).
   Output: rows in \`projects\` + \`project_sources\` as \`approval_status:"pending"\`.
2. **Go Live (multi-cell sweep)** — walk a province × sector grid and run
   Discover for each cell. Long-running; claims \`golive_session_id\` on
   \`sherlock_live_state\` so the panel can stop you mid-run. Mirrors the
   server-side Sherlock Live cron — heaviest Tavily/Mistral consumer.

**Analysis**
3. **Analyze (deep)** — multi-source research on a moderator-picked list of
   existing projects. Inputs: project ids or slugs. Output: rows across
   7 detail tables + 3 timeline tables + a \`project_analysis_runs\` row
   per project with \`narrative_summary\` and \`gaps_and_contradictions\`.
4. **Live Check (on-approval analysis)** — polls every ~60s for newly
   approved projects (manual OR auto-approve-trigger approvals, both stamp
   \`reviewed_at\`) and runs Analyze on each. Claims \`livecheck_session_id\`;
   runs alongside Go Live (separate session columns). Turn the website's
   "Auto-analysis on approval" toggle OFF before starting.
5. **Refresh Stale (backlog sweep)** — one-shot batch over approved projects
   whose analysis is missing or older than N days. Pulls the candidate list
   from a DB query; processes each through the same Analyze pipeline. Does
   NOT claim a session — finite batch, exits when done.

**Content / audit**
6. **Brief** — compose homepage briefs from approved projects. Inputs:
   scope (global / province:X / sector:Y). Output: rows in \`global_briefs\`
   with importance scoring.
7. **Fetch news** — Tavily-style news scan for one project. Inputs: project
   slug or id. Output: rows in \`project_updates\` + \`project_sources\`.
8. **Verify** — read-only audit pass that compares the website's existing
   project record against fresh web sources. Inputs: project slug or id.
   Output: a structured verification report in chat (no DB writes).

After the admin picks one, follow the workflow they describe. Each workflow
has its own prompt the admin can paste from the Local-AI panel, OR you can
run it from this menu if the admin gives you the inputs directly.

**House rules for every workflow that writes to the DB:**
- Stamp \`ai_tag:"claude-local-<batchId>"\` on every row so the admin can
  bulk-roll-back a bad session in one click.
- Write \`submitted_by_ai:true\`, \`approval_status:"pending"\`. Never write
  \`approval_status:"approved"\` directly — the BEFORE INSERT trigger
  \`trg_auto_approve_high_confidence\` will flip qualifying rows to approved
  (and stamp \`reviewed_at\`) automatically based on \`confidence_score\` +
  the \`site_settings.auto_approve_threshold\`.
- Apply the confidence rubric to every row; skip anything < 0.40.
- Honour the kill switch for long-running workflows (Go Live, Live Check):
  GET \`sherlock_live_state\` before each unit of work, exit cleanly if the
  session id column doesn't match your batch id.
`;
}

function buildDiscover(input: LocalAiInput): string {
  const batchId = input.batchId ?? genBatchId();
  const sectorPart = input.sector ? `\n- Sector: **${input.sector}**` : "";
  const provincePart = input.province ? `\n- Province: **${input.province}**` : "";
  const filterDescription = (input.sector || input.province)
    ? `Run targeted discovery for:${sectorPart}${provincePart}`
    : "Run open discovery — no sector or province filter.";

  return `${buildHeader(batchId)}
${ENUMS_FULL}
${PROJECT_SCHEMA}
${CONFIDENCE_AND_STATUS}
${SHERLOCK_PARITY}
## Task: Discover new projects

${filterDescription}

### Steps

1. **Open the queue row.** POST a \`sherlock_jobs\` row per the Queue-tab
   Parity section. Save the returned id as JOB_ID.
2. **Build the search query.** Templates:
   - both: \`Nepal <sector> project OR program <province>\`
   - sector only: \`Nepal <sector> project OR program\`
   - province only: \`Nepal infrastructure project <province>\`
   - neither: \`Nepal infrastructure project\`
   Soft sectors (Health, Education) deliberately drop the word "infrastructure".
3. **Web-search + fetch.** Top 5–8 results. For each, fetch the article body.
   Skip results with <50 chars of content.
4. **Extract one project record per article** matching the \`projects\` schema
   above. Apply the confidence rubric (skip < 0.40). Apply the status rubric
   based on the article's latest dated evidence. Apply the description rules.
5. **Dedupe by case-insensitive title**:
   \`\`\`http
   GET ${SUPABASE_URL}/rest/v1/projects?title=ilike.<escaped-title>&select=id,provinces,districts,municipalities
   \`\`\`
   On match: PATCH the existing row to union geo arrays (provinces / districts /
   municipalities, dedupe case-insensitively, cap at 7/10/15). Do NOT insert a
   duplicate. Also POST a \`project_sources\` row for the new citation.
6. **Slug**: lowercase, strip non-\`[\\w\\s-]\`, spaces → \`-\`, truncate 80, append
   \`-<4hexchars>\` for uniqueness.
7. **Insert the project** via POST \`/rest/v1/projects\`. Capture the returned id.
8. **Insert the source row** via POST \`/rest/v1/project_sources\`:
   \`\`\`jsonc
   {
     "project_id": <new-id>,
     "added_by": null,
     "source_type": "article",
     "title": "<article title or hostname>",
     "url": "<article url>",
     "verified": false,
     "approval_status": "pending",
     "submitted_by_ai": true,
     "confidence_score": <same as project>
   }
   \`\`\`
   If this fails, DELETE the orphan project to keep the DB clean.
9. **Close the queue row.** PATCH \`/rest/v1/sherlock_jobs?id=eq.<JOB_ID>\` with
   \`status:"done"\`, final \`inserted\` and \`skipped\` counts.
10. **Summarize for the admin.** End with a plain-text block:
    \`\`\`
    DISCOVERY COMPLETE
      Query: <query>
      Fetched: <N> URLs
      Inserted: <N> new projects
        - "Title" → /projects/<slug>
      Merged into existing: <M> projects had new geo signals
      Skipped: <K> below confidence or not Nepal-specific
    \`\`\`

If you have no HTTPS tool, skip step 1 and 7-9 and instead emit:
\`\`\`json
{
  "task": "discover",
  "projects_to_insert": [<project rows>],
  "sources_to_insert": [<source rows, indexed by project order>],
  "queue_row": { "kind":"geo", "params":{...}, "status":"done", "inserted":N, "skipped":K }
}
\`\`\`
The admin will paste this into the website's Local-AI panel.

Begin.`;
}

function buildAnalyze(input: LocalAiInput): string {
  const batchId = input.batchId ?? genBatchId();
  // The panel pre-fetches selected projects' metadata so the AI doesn't have
  // to do N GET-by-slug round-trips. Single-project legacy mode (slug-or-id
  // typed into a textbox) is still supported as a fallback.
  const list = input.projects && input.projects.length > 0
    ? input.projects
    : (input.projectSlugOrId
      ? [{ id: input.projectSlugOrId, slug: input.projectSlugOrId, title: "<resolve from DB>" }]
      : []);

  const targetSection = list.length === 0
    ? `### Projects\nNone provided. Ask the admin which projects to analyze before continuing.`
    : `### Projects to analyze (${list.length})\n\n` +
      list.map((p, i) => `${i + 1}. id=\`${p.id}\` · slug=\`${p.slug}\` · "${p.title}"${p.sector ? ` · ${p.sector}` : ""}${p.province ? ` · ${p.province}` : ""}`).join("\n");

  return `${buildHeader(batchId)}
${ENUMS_FULL}
${DETAIL_TABLES_SCHEMA}
${TIMELINE_TABLES_SCHEMA}
${CONFIDENCE_AND_STATUS}
## Task: Analyze projects (batch loop, deep analysis per project)

This task replaces TWO buttons on the website: **Run AI Analysis** (the
\`analysis-drain\` pipeline that fills the 7 detail tables) and **Trace
History** (the same pipeline; populates milestones / updates / sources
timeline tables and the project's image gallery). One run = one project,
covers everything both buttons would.

${targetSection}

### Process EACH project in order, sequentially. For each:

1. **Open an analysis run row.**
   \`\`\`http
   POST ${SUPABASE_URL}/rest/v1/project_analysis_runs
   {
     "project_id": <id>,
     "status": "running",
     "started_at": "<ISO-8601>",
     "bucket_status": { "news":{"state":"queued"},"government":{"state":"queued"},"procurement":{"state":"queued"},"audit":{"state":"queued"},"international":{"state":"queued"} },
     "ai_tag": "claude-local"
   }
   \`\`\`
   Capture returned id as RUN_ID.
2. **Run 5 web searches in parallel** for that project's title:
   | Bucket | Query |
   |---|---|
   | news | \`"<title>" Nepal infrastructure\` (last 90 days preferred) |
   | government | \`"<title>" site:gov.np\` |
   | procurement | \`"<title>" (site:ppmo.gov.np OR site:bolpatra.gov.np)\` |
   | audit | \`"<title>" (site:oag.gov.np OR site:ciaa.gov.np)\` |
   | international | \`"<title>" (site:worldbank.org OR site:adb.org OR site:jica.go.jp)\` |
   Fetch top 2–3 URLs per bucket. After each bucket completes, PATCH
   \`project_analysis_runs.bucket_status\` with \`{state:"done"|"empty"|"error", hits:N}\`.
3. **Authority hierarchy when sources conflict** (highest first):
   .gov.np → international orgs → procurement portals → audit institutions →
   established Nepali media → other. Within a tier, newer date wins.
4. **Extract candidate rows** for ALL ten tables (7 detail + 3 timeline):
   - **Detail tables** (the \`Run AI Analysis\` side):
     project_funding, project_documents, project_stakeholders, project_risks,
     project_impact, project_procurement, project_compliance.
   - **Timeline tables** (the \`Trace History\` side):
     project_milestones (≤10), project_updates (≤8), project_sources (≤12).
   Apply the confidence rubric to each row. Skip < 0.40.
5. **Dedupe each candidate** against existing approved+pending rows on this
   project. Match keys:
   - project_funding: \`source_name\`
   - project_documents: normalised \`url\` OR \`title\`
   - project_stakeholders: \`org_name\` + \`role\`
   - project_risks: \`title\`
   - project_impact: \`metric_type\` + \`measured_at\`
   - project_procurement: \`tender_id_external\` OR \`tender_title\`
   - project_compliance: \`item_type\` + \`authority\`
   - project_milestones: fuzzy \`title\` + \`milestone_date\`
   - project_updates: fuzzy \`title\` + \`update_date\`
   - project_sources: normalised \`url\` (strip \`https?://(www\\.)?\`, lowercase)
   Tally duplicates into \`deduped_per_table\`.
6. **Bulk-insert non-duplicates.** One POST per table. Use
   \`Prefer: return=representation\` and tally \`inserted_per_table\`.
7. **Compose narrative + gaps.**
   - \`narrative_summary\`: 200–400 words. Lead with current status + latest
     dated fact, then context (scope, who runs it), then open questions.
   - \`gaps_and_contradictions\`: short bullet flags. Examples:
     "No procurement record despite status=in_progress",
     "MoPIT says NPR 8B; OAG says NPR 6.2B — not reconciled".
8. **Close the run row.**
   \`\`\`http
   PATCH ${SUPABASE_URL}/rest/v1/project_analysis_runs?id=eq.<RUN_ID>
   {
     "status": "succeeded",
     "finished_at": "<ISO-8601>",
     "narrative_summary": "...",
     "gaps_and_contradictions": [...],
     "inserted_per_table": {...},
     "deduped_per_table": {...},
     "bucket_status": {<final state per bucket>}
   }
   \`\`\`
9. **Brief checkpoint message** so the admin can watch progress:
   \`\`\`
   [N/T] <project title> — Inserted: funding 2 · documents 5 · risks 1 · milestones 3 · updates 4 · sources 6 · ...  · Deduped: …
   \`\`\`
   Then move to the NEXT project.

### After ALL projects done, emit a final batch summary:

\`\`\`
ANALYSIS BATCH COMPLETE — ${list.length} project(s)
  Total inserted across all 10 tables: <N>
  Total deduped:                       <M>
  Highest-confidence finding: <bullet>
  Lowest-confidence finding:  <bullet>
  Common gaps observed:       <bullet>
\`\`\`

### Pacing

Web search is the slow step. Run the 5 buckets per project in parallel, but
do projects **sequentially** — running all of them in parallel would saturate
the AI tool's web-search quota in seconds. Sleep ~5s between projects.

If you have no HTTPS tool, emit per-project JSON blocks instead and let the
admin paste them back one at a time:
\`\`\`json
{ "task":"analyze", "project_id":<id>, "rows": { "project_funding":[...], "project_documents":[...], "project_stakeholders":[...], "project_risks":[...], "project_impact":[...], "project_procurement":[...], "project_compliance":[...], "project_milestones":[...], "project_updates":[...], "project_sources":[...] }, "narrative_summary":"...", "gaps_and_contradictions":[...] }
\`\`\`

Begin with project 1 of ${list.length}.`;
}

function buildBrief(input: LocalAiInput): string {
  const batchId = input.batchId ?? genBatchId();
  const scope = input.scope ?? "global";
  const scopeValue = input.scopeValue ?? "";
  const scopeLabel = scope === "global"
    ? "all approved projects (national)"
    : scope === "province"
      ? `${scopeValue} province`
      : `the ${scopeValue} sector`;
  return `${buildHeader(batchId)}
${ENUMS_FULL}
## Task: Generate briefs for ${scopeLabel}

The website's homepage carousel shows briefs where \`display_eligible = true\`.
A brief becomes display-eligible when its \`importance >= 0.65\`. Generate a
batch of 3–10 distinct briefs covering different angles; the website filters
them automatically.

### Schema (\`global_briefs\`)

\`\`\`jsonc
{
  "scope": "global | province:<P> | sector:<S>",
  "scope_province": "<P> or null",
  "scope_sector": "<S> or null",
  "headline": "≤140 chars, one factual observation",
  "body": "2–4 paragraphs plain prose, no markdown",
  "sources": [{"id":<bigint>,"title":"...","slug":"..."}],
  "importance": 0.00-1.00,
  "display_eligible": <bool: importance >= 0.65>,
  "batch_id": "<UUID — generate once per run>",
  "created_by": null
}
\`\`\`

### Importance rubric

- 0.90–1.00: high-stakes — flagship project slipped, major audit finding, large budget shift, critical risk opened, National-Pride completion.
- 0.70–0.89: notable shift — sector saw multiple status changes, several delays clustered in one province, funder disbursement.
- 0.50–0.69: moderate signal — sector overview with 1–2 meaningful new facts.
- 0.30–0.49: low signal — mostly stable data, few changes.
- < 0.30: filler. Score honestly; the website would rather show 2 important briefs than 10 filler ones.

### Steps

1. **Pull source projects** (up to 30 most-recent approved):
   \`\`\`http
   GET ${SUPABASE_URL}/rest/v1/projects?approval_status=eq.approved&order=created_at.desc&limit=30&select=id,slug,title,sector,province,district,status,progress_percent,budget_npr,implementing_agency,contractor,start_date,expected_completion,description${
     scope === "province" ? `&province=eq.${scopeValue}` :
     scope === "sector" ? `&sector=eq.${scopeValue}` : ""
   }
   \`\`\`
   If fewer than 3 returned: STOP. Tell the admin "not enough approved projects in scope".
2. **Compose 3–10 distinct briefs** covering DIFFERENT angles (sector-wide delay pattern, single flagship slip with budget impact, funding-commitment shift, status churn cluster, critical-risk cluster, audit finding, completion milestone, geographic concentration, contractor concentration). Use ONLY facts in the returned rows; treat titles as opaque labels.
3. **Generate a single \`batch_id\` UUID** for this run; thread it through every row.
4. **Demote prior display rows for this scope:**
   \`\`\`http
   PATCH ${SUPABASE_URL}/rest/v1/global_briefs?scope=eq.${scope === "global" ? "global" : `${scope}:${scopeValue}`}&display_eligible=eq.true
   { "display_eligible": false }
   \`\`\`
5. **Insert the new batch:** one POST with the full array.
6. **Summarize.**
   \`\`\`
   BRIEFS PUBLISHED — scope: <scope>
     Batch: <UUID>
     Generated: N briefs
     Display-eligible: M of N
     Highest importance: 0.XX — "<headline>"
   \`\`\`

If no HTTPS tool, emit:
\`\`\`json
{ "task":"brief", "scope":"...", "batch_id":"...", "briefs":[ ... ] }
\`\`\`

Begin.`;
}

function buildFetchNews(input: LocalAiInput): string {
  const batchId = input.batchId ?? genBatchId();
  const target = input.projectSlugOrId ?? "<paste slug or id>";
  return `${buildHeader(batchId)}
## Task: Fetch news for project ${target}

### Schema (\`project_updates\`)

\`\`\`jsonc
{
  "project_id": <bigint>,
  "author_id": null,
  "title": "headline, ≤120 chars",
  "content": "1–2 short paragraphs plain prose, ending with:\\n\\nSources:\\n[1] <url>",
  "update_type": "news",
  "published": false,
  "approval_status": "pending",
  "submitted_by_ai": true
}
\`\`\`

Also insert a \`project_sources\` row per cited URL:

\`\`\`jsonc
{
  "project_id": <bigint>,
  "added_by": null,
  "source_type": "news",
  "title": "<article title or hostname>",
  "url": "<url>",
  "verified": false,
  "approval_status": "pending",
  "submitted_by_ai": true
}
\`\`\`

### Steps

1. **Resolve the project** (same as Analyze step 1). Capture \`id, title, sector, province\`.
2. **Web-search** for: \`"<title>" Nepal <sector>\` — last 30 days preferred. Top 3 results.
3. For each article, fetch the body. Skip < 50 chars of content.
4. **Compose one project_update per article.** Title = ≤120 chars factual; content = 1–2 short paragraphs ending with a \`Sources:\\n[1] <url>\` footer. Do NOT invent facts.
5. **Insert** each update via POST \`/rest/v1/project_updates\`. Insert each source via POST \`/rest/v1/project_sources\` (skip if a row with this \`(project_id, url)\` already exists — GET first).
6. **PATCH the project's \`last_news_fetched_at\` timestamp** to mark it deprioritised for 7 days:
   \`\`\`http
   PATCH ${SUPABASE_URL}/rest/v1/projects?id=eq.<id>
   { "last_news_fetched_at": "<ISO-8601>" }
   \`\`\`
7. **Summarize.**
   \`\`\`
   NEWS FETCH COMPLETE — <title>
     Articles scanned: N
     Updates inserted: M
     Sources inserted: K
   \`\`\`

If no HTTPS tool:
\`\`\`json
{ "task":"fetch-news", "project_id":<id>, "updates":[...], "sources":[...] }
\`\`\`

Begin.`;
}

function buildGoLive(input: LocalAiInput): string {
  const batchId = input.batchId ?? genBatchId();
  const provinces = (input.goLiveProvinces && input.goLiveProvinces.length > 0)
    ? input.goLiveProvinces
    : ["Koshi", "Madhesh", "Bagmati", "Gandaki", "Lumbini", "Karnali", "Sudurpashchim"];
  const sectors = (input.goLiveSectors && input.goLiveSectors.length > 0)
    ? input.goLiveSectors
    : ["Transport", "Energy", "Water & Sanitation", "Agriculture & Irrigation",
       "Health", "Education", "Telecom", "Urban Development", "Tourism"];
  const perCellMax = input.goLivePerCellMax ?? 3;
  const budget = input.goLiveBudget ?? 30;
  const includeDistricts = !!input.goLiveIncludeDistricts;
  const nationalPride = !!input.goLiveNationalPride;
  const cellCount = provinces.length * sectors.length;
  const resume = input.goLiveResumeFrom;

  // When resuming we tell the AI to skip cells through the checkpoint in
  // column-major order. Column-major = "sector A across all provinces, then
  // sector B across all provinces". The checkpoint cell IS included in the
  // skip set (we already completed it), so we resume from the NEXT cell.
  const resumeSection = resume
    ? `### RESUME FROM CHECKPOINT

The admin's previous Go Live run got through the cell:
  **sector=\`${resume.sector}\` × province=\`${resume.province}\`**

In column-major order — sector A across all provinces, sector B across all
provinces, … — that cell is at index <find it in the grid above>. Skip
every cell up to and through it (no queue row, no web search) and resume
on the very next cell.

If the checkpoint cell isn't in the current grid (the admin narrowed
provinces or sectors since), restart from cell 1.

`
    : "";

  return `${buildHeader(batchId)}
${ENUMS_FULL}
${PROJECT_SCHEMA}
${CONFIDENCE_AND_STATUS}
${SHERLOCK_PARITY}
${SUBAGENT_NOTE}
## Task: Go Live (multi-cell sweep — replaces server-side Sherlock Live)

The website normally has a "Go Live" button that drives a once-a-minute cron
through every (province × sector) cell, dropping a job into the Sherlock
queue each tick. That continuous loop is the heaviest consumer of Tavily +
Mistral credits. **This task runs the same sweep in your AI tool** —
you walk the cell grid in one session and insert projects directly.

### Shared state with the server cron — REQUIRED

Both modes use the same singleton row \`sherlock_live_state\` (id=1) as their
cursor and counter. Read it AT THE START to know where the cursor currently
sits (the server cron may have advanced it since your last local session),
and WRITE BACK after every cell so the next session — whether server or
local — picks up exactly where you stopped.

#### Step 0 (BEFORE walking any cells) — claim the Go Live session

\`\`\`http
PATCH ${SUPABASE_URL}/rest/v1/sherlock_live_state?id=eq.1
{
  "golive_session_id": "${batchId}",
  "golive_started_at": "<ISO-8601 now>",
  "golive_heartbeat_at": "<ISO-8601 now>"
}
\`\`\`

This claims the **Go Live slot specifically** — a Local Live-Check session
(which uses \`livecheck_session_id\`) can still run alongside you without
fighting for the same flag.

#### After EVERY successful cell — advance the cursor AND heartbeat

\`\`\`http
PATCH ${SUPABASE_URL}/rest/v1/sherlock_live_state?id=eq.1
{
  "last_province": "<P just completed>",
  "last_district": "<D just completed or null>",
  "last_sector":   "<S just completed>",
  "last_advanced_by": "local",
  "last_advanced_at": "<ISO-8601 now>",
  "enqueued_count": <existing enqueued_count + 1>,
  "golive_heartbeat_at": "<ISO-8601 now>",
  "updated_at":     "<ISO-8601 now>"
}
\`\`\`

(GET the row first to get the current \`enqueued_count\`, then PATCH with the
incremented value. The counter is shared across modes — both server cron and
local sessions add to it.)

**Heartbeat is critical.** The panel auto-clears your claim if
\`golive_heartbeat_at\` is older than 5 minutes — that's how it recovers
when the admin kills your process externally (terminal close, host crash).
Update the heartbeat at LEAST every cell; if a cell is taking longer than
4 minutes for any reason, PATCH a fresh heartbeat mid-cell so the panel
doesn't think you're dead.

#### At the END (final summary step) — release the Go Live session

\`\`\`http
PATCH ${SUPABASE_URL}/rest/v1/sherlock_live_state?id=eq.1
{
  "golive_session_id": null,
  "updated_at": "<ISO-8601 now>"
}
\`\`\`

Do this even if you bailed early on the budget cap. The cursor stays where
you left it; only the Go Live in-flight flag clears (the Live Check column
is untouched).

${resumeSection}### Grid

- **Provinces (${provinces.length}):** ${provinces.map(p => `\`${p}\``).join(", ")}
- **Sectors (${sectors.length}):** ${sectors.map(s => `\`${s}\``).join(", ")}
- Total cells: **${cellCount}** (province × sector)
- District-comprehensive: **${includeDistricts ? "ON — also rotate through each province's districts (77 districts × " + sectors.length + " sectors)" : "off — province granularity only"}**
- National Pride mode: **${nationalPride ? "ON — rotate through the 24 Rastra Gaurab projects instead of generic province/sector queries" : "off"}**

### Caps (be honest — don't try to do everything in one session)

- Per-query max: **${perCellMax}** (max distinct projects inserted from one cell)
- Stop after (total): **${budget}** projects inserted across all cells, even if cells remain
- Wall-time budget: aim for ≤30 minutes total; the AI tool's quota will throttle you before you exceed this.

### Kill switch — REQUIRED BEFORE EACH CELL

The admin can stop you mid-run by clicking the **Stop Go Live** button in
the panel, which nulls out \`sherlock_live_state.golive_session_id\`.
**Before starting each cell**, GET the row and check:

\`\`\`http
GET ${SUPABASE_URL}/rest/v1/sherlock_live_state?id=eq.1&select=golive_session_id
\`\`\`

If \`golive_session_id\` is null **or** doesn't equal \`"${batchId}"\` (your
batch), STOP IMMEDIATELY. Don't start the next cell, don't write anything
else to the database. Write the Final-summary block, and exit. The admin
wants to stop — respect that.

Note: only check the **Go Live** column. A concurrent Live Check session
flagging \`livecheck_session_id\` is fine — that's not your concern.

This check costs one cheap GET per cell (~5KB response, ~100ms). Do it.

### Loop

For each cell in **column-major order** (sector A across all provinces, then sector B across all provinces, …):

1. **Pre-check the dry-cell guard.** GET the last 3 \`sherlock_jobs\` rows
   for this cell's params; if all three have \`inserted=0\` (no projects ever
   found here), skip this cell unless the admin manually re-armed it. Write
   a row anyway:
   \`\`\`jsonc
   { "kind":"geo", "params":{ "province":"<P>", "sectors":["<S>"], "maxResults":${perCellMax}, "ai_source":"claude-local-golive-${batchId}" },
     "priority": 5, "status":"done", "inserted":0, "skipped":0,
     "error_text":"Dry cell skipped: <P> × <S> — last 3 same-cell runs all returned 0 inserts. Force a recheck by manually running Discover.",
     "started_at":"<ISO>", "finished_at":"<ISO>", "enqueued_by":null }
   \`\`\`
2. **Open a queue row** (status=running) with the same \`ai_source\`
   \`"claude-local-golive-${batchId}"\` so the panel's resume query can find
   you later.
3. **Run the Discover workflow** for this cell exactly as the Discover task
   describes (build query, web-search top 5-8, extract per-article, dedupe by
   title, slug, insert project + source row). Cap at ${perCellMax} insertions
   for the cell.
4. **Close the queue row** with \`status:"done"\`, final \`inserted\` and \`skipped\` counts.
5. **Pace ~5s between cells** so the AI tool's web-search quota lasts.
6. **After each cell, check the total budget.** If you've inserted ${budget}
   or more projects across all cells, STOP — write a final summary message
   and exit. The next session can resume from where you stopped.

### Final summary

\`\`\`
GO LIVE BATCH COMPLETE
  Cells walked:     <X> of ${cellCount}
  Cells skipped:    <Y> (dry-cell guard)
  Projects inserted: <Z>
  Top sectors:      <Sector>: <count>, ...
  Top provinces:    <Province>: <count>, ...
  Last cell completed: <Sector> × <Province>   (← the admin's panel reads this to set the next session's checkpoint)
\`\`\`

If you have no HTTPS tool, emit per-cell JSON blocks identical to the
Discover task's no-HTTPS shape; the admin will paste them back one cell at
a time via the website's Local-AI panel.

Begin with ${resume ? `the cell AFTER \`${resume.sector}\` × \`${resume.province}\` in column-major order` : `cell 1 of ${cellCount}: **${sectors[0]}** × **${provinces[0]}**`}.`;
}

function buildLiveCheck(input: LocalAiInput): string {
  const batchId = input.batchId ?? genBatchId();
  const cycles = input.liveCheckCycles ?? 60;       // 60 polls × 60s ≈ 1 hour
  const intervalSec = input.liveCheckIntervalSec ?? 60;
  return `${buildHeader(batchId)}
${ENUMS_FULL}
${DETAIL_TABLES_SCHEMA}
${TIMELINE_TABLES_SCHEMA}
${CONFIDENCE_AND_STATUS}
${SUBAGENT_NOTE}
## Task: Live Check (continuous analysis of newly-approved projects)

This task replaces the server-side trigger \`queue_analysis_on_approval()\`
which fires when a project's \`approval_status\` flips to \`'approved'\`.
With the admin's "Auto-analysis on approval" toggle OFF in the website
settings, that trigger no longer enqueues anything — instead, **you** poll
the database every ${intervalSec}s for newly-approved projects that lack a
comprehensive analysis and run the full Analyze pipeline (7 detail tables +
3 timeline tables) on each.

### Loop bounds

- **Poll interval:** ${intervalSec} seconds between cycles.
- **Max cycles:** ${cycles} (after which you exit cleanly; the admin can paste the prompt again to keep watching).
- **One project per cycle**, sequentially. If multiple projects need analysis, queue them up and process one per cycle — this keeps the workload steady and avoids saturating your web-search quota.

### Kill switch — REQUIRED BEFORE EACH CYCLE

The admin can stop you mid-loop by nulling \`sherlock_live_state.livecheck_session_id\`
from the panel. **At the start of every cycle**:

\`\`\`http
GET ${SUPABASE_URL}/rest/v1/sherlock_live_state?id=eq.1&select=livecheck_session_id
\`\`\`

If \`livecheck_session_id\` is null or doesn't equal \`"${batchId}"\`, STOP.
Write the Final-summary block and exit without starting another project
analysis. Don't touch \`golive_session_id\` — a concurrent local Go Live
session may be using that column.

Claim the Live-Check slot at the very start (Step 0):

\`\`\`http
PATCH ${SUPABASE_URL}/rest/v1/sherlock_live_state?id=eq.1
{
  "livecheck_session_id": "${batchId}",
  "livecheck_started_at": "<ISO now>",
  "livecheck_heartbeat_at": "<ISO now>"
}
\`\`\`

**Update \`livecheck_heartbeat_at\` at the start of EVERY cycle** (right after
the kill-switch check). The panel auto-clears your claim if the heartbeat
is older than 5 minutes — that's how it recovers when the admin kills your
process externally (terminal close, host crash). Failing to heartbeat
silently revokes your session within ~5 min.

\`\`\`http
PATCH ${SUPABASE_URL}/rest/v1/sherlock_live_state?id=eq.1
{ "livecheck_heartbeat_at": "<ISO now>", "updated_at": "<ISO now>" }
\`\`\`

Release it at the end (after final summary):

\`\`\`http
PATCH ${SUPABASE_URL}/rest/v1/sherlock_live_state?id=eq.1
{ "livecheck_session_id": null }
\`\`\`

### Each cycle

1. **Poll for candidates.** This task mirrors the server-side trigger
   \`queue_analysis_on_approval()\` which fires when a project transitions
   to \`approval_status='approved'\` — so look ONLY at projects approved
   AFTER you claimed your session, and that don't yet have an analysis:

   \`\`\`http
   GET ${SUPABASE_URL}/rest/v1/projects?approval_status=eq.approved&reviewed_at=gt.<your livecheck_started_at ISO>&last_comprehensive_analysis_at=is.null&order=reviewed_at.asc&limit=1&select=id,slug,title,sector,province,district,description
   \`\`\`

   **Important — column name is \`reviewed_at\`**, not \`approved_at\`
   (that column doesn't exist). It bumps in TWO situations:
   - a human moderator flips approval to 'approved' in the admin UI, OR
   - the \`auto_approve_high_confidence_project\` BEFORE INSERT trigger
     auto-approves an AI submission (confidence ≥ site_settings threshold).
   Both paths now stamp \`reviewed_at\` so Live Check catches them. Order
   \`asc\` so the oldest-of-the-newly-approved goes first (FIFO within
   this session).

   If the result is empty → log "no new approvals this cycle, sleeping
   ${intervalSec}s" and wait. The goal is to **not** back-fill old stale
   projects — that's what the **Refresh stale** local-AI workflow is for.
   Your job is to react to fresh approvals only, like the server trigger
   does.
2. **Skip if an analysis is already queued/running** for the project (the
   partial unique index on \`analysis_jobs\` would 23505 your insert anyway):
   \`\`\`http
   GET ${SUPABASE_URL}/rest/v1/analysis_jobs?project_id=eq.<id>&status=in.(queued,running)&limit=1
   \`\`\`
   If a row comes back → log and sleep.
3. **Run the full Analyze pipeline** on the one project:
   - Open \`project_analysis_runs\` row with \`status="running", ai_tag="claude-local-${batchId}"\`.
   - 5-bucket parallel web search (news, government, procurement, audit, international).
   - Extract candidate rows for ALL 10 tables (7 detail + 3 timeline), apply
     the confidence rubric, dedupe against existing pending+approved rows.
   - Bulk-insert non-duplicates with the batch tag.
   - Compose \`narrative_summary\` + \`gaps_and_contradictions\`, close the run row.
4. **Sleep ${intervalSec}s** before the next cycle. Use whichever sleep
   primitive your environment supports (\`setTimeout\` in JS, \`time.sleep\`
   in Python interpreter, \`sleep\` shell).

### After ${cycles} cycles OR the admin stops the chat

Emit a final summary:

\`\`\`
LIVE CHECK BATCH COMPLETE — ${batchId}
  Cycles run:        <N> of ${cycles}
  Projects analyzed: <M>
  Skipped (already queued): <K>
  Idle cycles (no candidates): <I>
\`\`\`

### If you have no HTTPS tool

Live Check fundamentally requires HTTPS GETs to poll. If your environment
can't make them, STOP and tell the admin "Live Check requires a host with
HTTPS GET capability (Claude.ai with computer use, Claude Code, ChatGPT
Plus with code interpreter). The website-side auto-analysis trigger is the
fallback — flip the toggle back ON."

Begin cycle 1 of ${cycles}.`;
}

function buildRefreshStale(input: LocalAiInput): string {
  const batchId = input.batchId ?? genBatchId();
  const maxProjects = Math.max(1, Math.min(200, input.refreshStaleMax ?? 20));
  const staleDays = Math.max(1, Math.min(365, input.refreshStaleDays ?? 30));
  return `${buildHeader(batchId)}
${ENUMS_FULL}
${DETAIL_TABLES_SCHEMA}
${TIMELINE_TABLES_SCHEMA}
${CONFIDENCE_AND_STATUS}
## Task: Refresh Stale (back-fill analysis for the approved backlog)

This task mirrors the admin panel's **"Refresh stale approved projects"**
button — the one that enqueues comprehensive analysis for approved projects
whose last analysis is missing or older than ${staleDays} days. It runs the
same Analyze pipeline you'd run from the "Analyze projects (deep)" workflow,
but the project list is **pulled from a DB query** instead of admin
multi-select, so the AI can chew through the backlog without the moderator
hand-picking each row.

Unlike Live Check, this task does **not** poll — it processes a finite list
once, in oldest-first order, and exits. Unlike Go Live, it does **not**
claim a session slot on \`sherlock_live_state\` — multiple Refresh Stale
runs can safely target different projects in parallel because the per-row
analysis_jobs partial unique index prevents collisions.

### Caps

- **Hard cap:** ${maxProjects} projects per run. The AI exits after that
  many \`project_analysis_runs\` rows have been closed with \`status=succeeded\`,
  even if more stale projects remain. The admin can paste the prompt again
  to chew through the next batch.
- **Staleness window:** ${staleDays} days. A project is "stale" when
  \`last_comprehensive_analysis_at IS NULL\` (never analyzed) OR
  \`last_comprehensive_analysis_at < now() - INTERVAL '${staleDays} days'\`.
- **Pacing:** sleep ~5s between projects so the AI tool's web-search quota
  lasts.

### Step 0 — Pull the candidate list

\`\`\`http
GET ${SUPABASE_URL}/rest/v1/projects?approval_status=eq.approved&or=(last_comprehensive_analysis_at.is.null,last_comprehensive_analysis_at.lt.<ISO ${staleDays} days ago>)&order=last_comprehensive_analysis_at.asc.nullsfirst&limit=${maxProjects}&select=id,slug,title,sector,province,district,description,last_comprehensive_analysis_at
\`\`\`

Compute the ISO threshold as \`now() − ${staleDays} days\` in your tool.
Order \`asc.nullsfirst\` so never-analyzed rows come before old-analyzed ones,
and old-analyzed rows come before recently-analyzed-but-still-past-window.

If the list is empty → STOP. Tell the admin "no stale projects in scope
(staleness window: ${staleDays} days)" and exit.

### Step 1 — Per-project guard (before each analysis)

For each project in the list, check whether an analysis is already in flight:

\`\`\`http
GET ${SUPABASE_URL}/rest/v1/analysis_jobs?project_id=eq.<id>&status=in.(queued,running)&limit=1
\`\`\`

If a row comes back → log "skipped (already queued)" and move to next project.
The partial unique index on \`analysis_jobs\` would 23505 your insert anyway.

### Step 2 — Run the full Analyze pipeline on the project

This is the SAME pipeline the "Analyze projects (deep)" workflow runs.
Do it for every project in the candidate list, sequentially:

1. **Open the analysis run row.**
   \`\`\`http
   POST ${SUPABASE_URL}/rest/v1/project_analysis_runs
   {
     "project_id": <id>,
     "status": "running",
     "started_at": "<ISO-8601>",
     "bucket_status": { "news":{"state":"queued"},"government":{"state":"queued"},"procurement":{"state":"queued"},"audit":{"state":"queued"},"international":{"state":"queued"} },
     "ai_tag": "claude-local-${batchId}"
   }
   \`\`\`
   Capture returned id as RUN_ID.

2. **5-bucket parallel web search** for the project title:
   | Bucket | Query |
   |---|---|
   | news | \`"<title>" Nepal\` (last 90 days preferred) |
   | government | \`"<title>" site:gov.np\` |
   | procurement | \`"<title>" (site:ppmo.gov.np OR site:bolpatra.gov.np)\` |
   | audit | \`"<title>" (site:oag.gov.np OR site:ciaa.gov.np)\` |
   | international | \`"<title>" (site:worldbank.org OR site:adb.org OR site:jica.go.jp)\` |
   Fetch top 2–3 URLs per bucket. After each bucket, PATCH
   \`project_analysis_runs.bucket_status\` with
   \`{state:"done"|"empty"|"error", hits:N}\`.

3. **Authority hierarchy when sources conflict** (highest first):
   .gov.np → international orgs → procurement portals → audit institutions →
   established Nepali media → other. Within a tier, newer date wins.

4. **Extract candidate rows for ALL ten tables** (7 detail + 3 timeline).
   Apply the confidence rubric (skip < 0.40). All rows MUST include
   \`"ai_tag": "claude-local-${batchId}"\`, \`approval_status:"pending"\`,
   \`submitted_by_ai:true\`.

5. **Dedupe each candidate** against existing approved+pending rows on this
   project. Match keys:
   - project_funding: \`source_name\`
   - project_documents: normalised \`url\` OR \`title\`
   - project_stakeholders: \`org_name\` + \`role\`
   - project_risks: \`title\`
   - project_impact: \`metric_type\` + \`measured_at\`
   - project_procurement: \`tender_id_external\` OR \`tender_title\`
   - project_compliance: \`item_type\` + \`authority\`
   - project_milestones: fuzzy \`title\` + \`milestone_date\`
   - project_updates: fuzzy \`title\` + \`update_date\`
   - project_sources: normalised \`url\` (strip \`https?://(www\\.)?\`, lowercase)

6. **Bulk-insert non-duplicates.** One POST per table. Tally
   \`inserted_per_table\` and \`deduped_per_table\`.

7. **Compose narrative + gaps.**
   - \`narrative_summary\`: 200–400 words. Lead with current status + latest
     dated fact, then context, then open questions.
   - \`gaps_and_contradictions\`: short bullet flags ("No procurement record
     despite status=in_progress", "MoPIT says NPR 8B; OAG says NPR 6.2B —
     not reconciled").

8. **Close the analysis run row.**
   \`\`\`http
   PATCH ${SUPABASE_URL}/rest/v1/project_analysis_runs?id=eq.<RUN_ID>
   {
     "status": "succeeded",
     "finished_at": "<ISO-8601>",
     "narrative_summary": "...",
     "gaps_and_contradictions": [...],
     "inserted_per_table": {...},
     "deduped_per_table": {...},
     "bucket_status": {<final state per bucket>}
   }
   \`\`\`
   (The website's analysis-drain trigger will update
   \`projects.last_comprehensive_analysis_at\` automatically when the run
   transitions to succeeded — you don't need to set it yourself.)

9. **Checkpoint message** so the admin can watch progress:
   \`\`\`
   [N/${maxProjects}] <title> — Inserted: funding F · docs D · stakeholders S · risks R · impact I · procurement P · compliance C · milestones M · updates U · sources X  · Deduped: total Z
   \`\`\`

### Final summary (after ${maxProjects} done OR list exhausted)

\`\`\`
REFRESH STALE BATCH COMPLETE — ${batchId}
  Candidates pulled:  <N>
  Projects analyzed:  <M>
  Skipped (already queued): <K>
  Total inserted across 10 tables: <I>
  Total deduped:                   <D>
  Highest-importance finding:  <bullet>
  Common gaps observed:        <bullet>
\`\`\`

### If you have no HTTPS tool

Refresh Stale needs the GET in Step 0 to know which projects to analyze.
If your environment can't make HTTPS calls, STOP and tell the admin
"Refresh Stale requires a host with HTTPS GET capability (Claude Code,
Claude.ai with computer use, ChatGPT Plus with code interpreter)."

Begin Step 0 now.`;
}

function buildVerify(input: LocalAiInput): string {
  const batchId = input.batchId ?? genBatchId();
  const target = input.projectSlugOrId ?? "<paste slug or id>";
  return `${buildHeader(batchId)}
## Task: Verify project ${target} (READ-ONLY — no DB writes)

### Steps

1. **Resolve the project.**
   \`\`\`http
   GET ${SUPABASE_URL}/rest/v1/projects?or=(slug.eq.${target},id.eq.${target})&select=id,title,sector,province,district,description,implementing_agency,contractor,budget_npr,start_date,expected_completion
   \`\`\`
   If empty: STOP.
2. **Web-search 2 buckets in parallel:**
   - news: \`"<title>" Nepal\` — last 90 days
   - government: \`"<title>" site:gov.np\`
   Take top 3 per bucket. Fetch each body.
3. **For every claim in the website's existing description**, label it:
   - \`supported\` — a fetched source confirms the claim
   - \`unsupported\` — no fetched source mentions it
   - \`contradicted\` — a fetched source explicitly says otherwise
4. **List \`missing_data\`** — facts the website's record lacks that the fresh sources reveal.
5. **Compose an overall \`confidence\`**: \`high\` / \`medium\` / \`low\`. Use \`high\` only when most claims are supported by .gov.np or international-org sources.
6. **Report (READ-ONLY):**
   \`\`\`json
   {
     "task": "verify",
     "project_id": <id>,
     "confidence": "high|medium|low",
     "summary": "1–2 sentence overall judgement",
     "supported": [{"claim":"...","source":"<url>"}],
     "unsupported": [{"claim":"..."}],
     "contradicted": [{"claim":"<from site>","source_says":"...","source":"<url>"}],
     "missing_data": [{"fact":"...","source":"<url>"}],
     "sources_checked": <N>
   }
   \`\`\`

Verify never writes to the DB — return only the JSON report. The admin
reads it and decides whether to edit the project record manually.

Begin.`;
}

export function buildLocalAiPrompt(task: LocalAiTask, input: LocalAiInput = {}): string {
  const builders: Record<LocalAiTask, (i: LocalAiInput) => string> = {
    menu: buildMenu,
    discover: buildDiscover,
    "go-live": buildGoLive,
    analyze: buildAnalyze,
    "live-check": buildLiveCheck,
    "refresh-stale": buildRefreshStale,
    brief: buildBrief,
    "fetch-news": buildFetchNews,
    verify: buildVerify,
  };
  const raw = builders[task](input);
  // Substitute the runtime service-role key only here, never in the source.
  // If the admin hasn't saved their key in the panel yet, leave the literal
  // placeholder so they notice and fill it manually before pasting.
  const key = input.serviceRoleKey?.trim();
  return key ? raw.replaceAll("<SERVICE_ROLE_KEY>", key) : raw;
}

// Labels used by the admin UI to name the workflow rows.
export const LOCAL_AI_TASKS: Array<{ key: LocalAiTask; label: string; blurb: string }> = [
  { key: "menu", label: "Tool menu", blurb: "Open prompt — the AI replies with its list of supported tasks. Start here if you're unsure." },
  { key: "discover", label: "Discover projects", blurb: "Single-cell web search → extract project records → insert with submitted_by_ai=true, approval_status=pending. Mirrors ai-discover-projects." },
  { key: "go-live", label: "Go Live (multi-cell sweep)", blurb: "Walks a (province × sector) grid running Discover for each cell. Replaces the server-side Sherlock Live cron — the heaviest consumer of Tavily + Mistral credits." },
  { key: "analyze", label: "Analyze projects (deep)", blurb: "Loops over selected projects. Each one gets the full Run-AI-Analysis + Trace-History pipeline: 5-bucket research, 7 detail tables, 3 timeline tables (milestones / updates / sources), narrative summary, gaps." },
  { key: "live-check", label: "Live Check (on-approval analysis)", blurb: "Polls Supabase every 60s for newly-approved projects that lack a comprehensive analysis. Runs the full Analyze pipeline on each. Catches BOTH manual-moderator approvals and auto-approve-trigger approvals (both now stamp reviewed_at). Mirrors the server-side auto-analysis trigger — turn the website toggle OFF when you're using this." },
  { key: "refresh-stale", label: "Refresh stale (backlog sweep)", blurb: "Pulls approved projects with no analysis (or analysis older than 30 days) and runs the full Analyze pipeline on each. One-shot batch — not a polling loop. Mirrors the admin panel's \"Refresh stale approved projects\" button. Use this to chew through the backlog Live Check won't touch." },
  { key: "brief", label: "Generate briefs", blurb: "Multi-brief batch over approved projects in a scope → write to global_briefs with importance scoring. Mirrors generate-daily-briefs." },
  { key: "fetch-news", label: "Fetch news", blurb: "Recent news for one project → write project_updates + project_sources. Mirrors ai-fetch-project-news." },
  { key: "verify", label: "Verify project", blurb: "Read-only audit of one project against fresh web sources → returns a JSON report. Mirrors ai-verify-project." },
];
