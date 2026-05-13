You are running a **local comprehensive analysis** on one Nepal Infra Watch project, using your own WebSearch/WebFetch + reasoning instead of the deployed Tavily+Mistral pipeline. Output goes into the same Supabase tables (`project_analysis_runs`, the 7 `project_*` detail tables, optionally `project_sources`) so the existing moderation UI handles approval.

Argument: `<slug-or-id>` of the project to analyze. If missing, ask the user for it once, then continue.

## Step 0 — Load credentials

```bash
SUPABASE_URL=$(grep '^VITE_SUPABASE_URL' .env | head -1 | cut -d= -f2- | tr -d ' "')
SRK=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | head -1 | cut -d= -f2- | tr -d ' "')
```

If `SRK` is empty: STOP. Tell the user "I need the Supabase service-role key in `.env` as `SUPABASE_SERVICE_ROLE_KEY=sb_secret_…` before I can write rows." Do not proceed.

Never echo `$SRK` in any output. Pass it only via `-H "Authorization: Bearer $SRK"` and `-H "apikey: $SRK"`.

## Step 1 — Resolve the project

```bash
# Try by slug first, fall back to id (numeric).
ARG="<from user>"
RESP=$(curl -s -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  "$SUPABASE_URL/rest/v1/projects?or=(slug.eq.$ARG,id.eq.$ARG)&select=id,slug,title,sector,sectors,province,district,municipality,description,status")
```

Parse the single row. If empty: STOP and report "no project found for `<arg>`". Capture `id`, `title`, `sector`, `province`, `district`.

## Step 2 — Open an analysis run row

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/project_analysis_runs" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "project_id": <id>,
    "status": "running",
    "started_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "bucket_status": {"news":{"state":"queued"},"government":{"state":"queued"},"procurement":{"state":"queued"},"audit":{"state":"queued"},"international":{"state":"queued"}},
    "ai_tag": "claude-code-local"
  }'
```

Capture the returned `id` as `RUN_ID`.

## Step 3 — Run 5 bucket searches (use WebSearch)

Run these five searches. They're independent — fire them as parallel WebSearch tool calls in a single message.

| Bucket | Query template |
|---|---|
| news | `"<title>" Nepal infrastructure` |
| government | `"<title>" site:gov.np` |
| procurement | `"<title>" (site:ppmo.gov.np OR site:bolpatra.gov.np)` |
| audit | `"<title>" (site:oag.gov.np OR site:ciaa.gov.np)` |
| international | `"<title>" (site:worldbank.org OR site:adb.org OR site:jica.go.jp)` |

For each bucket, after WebSearch returns, pick the top 2–3 most relevant URLs and `WebFetch` them (in parallel) to get article body text. If a bucket returns zero relevant hits, mark it `state=empty` later — don't fabricate.

Update `bucket_status` on the run row after each bucket completes (best effort — one PATCH per bucket is fine):

```bash
curl -s -X PATCH "$SUPABASE_URL/rest/v1/project_analysis_runs?id=eq.$RUN_ID" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" \
  -d '{"bucket_status": {"news":{"state":"done","hits":3}, ...}}'
```

## Step 4 — Extract candidate rows per detail table

For each detail table below, scan the article bodies and emit candidate JSON rows. Apply the authority hierarchy when sources conflict: **`.gov.np` > worldbank/adb/jica > local news > other**. Newer facts override older.

Every row needs the common fields:
- `project_id: <id>`
- `approval_status: "pending"`
- `submitted_by_ai: true`
- `confidence_score: 0.00–1.00` (rubric below)
- `sources: [{"url": "...", "title": "...", "bucket": "news|government|..."}]`

**Confidence rubric** (matches `analysis-drain`):
- `1.00` — multiple .gov.np or intl-org sources, recent (<6 months), all fields concrete
- `0.80` — one high-authority source OR multiple medium sources, mostly concrete
- `0.60` — one medium source, some fields inferred
- `0.40` — single low-authority mention, fields ambiguous
- Below 0.40 → **skip the row**, don't insert noise

### Table schemas

```
project_funding:       source_name (req), source_type, amount_npr, amount_usd,
                       committed_at, disbursed_amount, lender_terms
project_documents:     title (req), doc_type, url, source_org, language,
                       published_at, file_size_bytes
project_stakeholders:  role (req), org_name (req), contact_name, contact_email,
                       contact_phone, website, country
project_risks:         title (req), category, severity (low|medium|high|critical),
                       status (open|mitigated|closed|escalated), reported_at, resolved_at
project_impact:        metric_type (req), metric_value, baseline_value,
                       target_value, measured_at, methodology
project_procurement:   tender_title (req), tender_id_external, tender_url,
                       bid_open_at, contract_awarded_at, awardee_name,
                       contract_value_npr, contract_type, status
project_compliance:    item_type (req), status, authority, decided_at, finding
```

## Step 5 — Dedupe each candidate against existing rows

For each candidate, query the table for already-existing rows on this project where the match-key matches. Skip the candidate on a hit; tally into `dedupedPerTable`.

| Table | Match key (case-insensitive) |
|---|---|
| project_funding | `source_name` |
| project_documents | `url` (normalised — strip `https?://(www\.)?`, lower) OR `title` |
| project_stakeholders | `org_name` + `role` |
| project_risks | `title` |
| project_impact | `metric_type` + `measured_at` |
| project_procurement | `tender_id_external` OR `tender_title` |
| project_compliance | `item_type` + `authority` |

Query template:
```bash
curl -s -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  "$SUPABASE_URL/rest/v1/project_documents?project_id=eq.$ID&approval_status=in.(approved,pending)&select=url,title"
```

## Step 6 — Insert non-duplicate rows

Bulk-insert per table (one POST per table, body is a JSON array):

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/project_funding" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '[{...}, {...}]'
```

Tally `insertedPerTable` from the response array lengths. On any 4xx/5xx, log the error to a local `errors[]` array; don't abort the whole run.

## Step 7 — Compose narrative + gaps

Write:
- `narrative_summary`: 200–400 words, plain prose, no markdown. Lead with **current status** (status + most-recent dated fact), then **context** (what the project is, scope, who runs it), then **open questions**. Use only what the sources say; if a fact is missing, say so explicitly rather than inventing.
- `gaps_and_contradictions`: array of short strings. Examples: `"No procurement record found despite status=in_progress"`, `"MoPIT site says NPR 8B budget; OAG report says NPR 6.2B — discrepancy not reconciled"`. Empty array if no flags.

## Step 8 — Close the run row

```bash
curl -s -X PATCH "$SUPABASE_URL/rest/v1/project_analysis_runs?id=eq.$RUN_ID" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "succeeded",
    "finished_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "narrative_summary": "...",
    "gaps_and_contradictions": ["..."],
    "inserted_per_table": {"project_funding": 2, "project_documents": 5, ...},
    "deduped_per_table":  {"project_funding": 0, "project_documents": 3, ...},
    "bucket_status": {<final per-bucket state>}
  }'
```

If the run threw partway through, instead set `status: "failed"` and put a short message in `errors`.

## Step 9 — Report to the user

Print a tight summary:

```
ANALYSIS COMPLETE — <project title>
  Run ID: <run_id>
  Buckets: news=3, government=2, procurement=0, audit=1, international=2

  Inserted    project_funding: 2
              project_documents: 5
              project_stakeholders: 3
              project_risks: 1
              project_impact: 0
              project_procurement: 0
              project_compliance: 1

  Deduped     <table>: N skipped

  Narrative:
  <paste the 200-400 word summary>

  Gaps:
  - <each gap on its own line>

  All rows are approval_status='pending' with ai_tag='claude-code-local' — they
  appear in the existing Admin moderation queue alongside Mistral-generated rows.
```
