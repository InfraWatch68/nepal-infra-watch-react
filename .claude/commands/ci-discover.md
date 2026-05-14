You are doing **local project discovery** for Nepal Infra Watch — finding new infrastructure projects via WebSearch/WebFetch and inserting them into the `projects` table for moderator review. This replaces the deployed `ai-discover-projects` edge function for manual runs.

Arguments: `[sector] [province]` — both optional. If neither is given, discover broadly across all sectors. If only `sector`, search nationally. If only `province`, fan out across sectors within that province.

## Step 0 — Load credentials

```bash
SUPABASE_URL=$(grep '^VITE_SUPABASE_URL' .env | head -1 | cut -d= -f2- | tr -d ' "')
SRK=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | head -1 | cut -d= -f2- | tr -d ' "')
```

If `SRK` is empty: STOP. Tell the user to paste it into `.env` first.

## Step 0.5 — Open a sherlock_jobs queue row (REQUIRED for queue-tab parity)

The admin Queue tab reads from `sherlock_jobs`. This run must appear there alongside Tavily+Mistral runs. INSERT a row BEFORE doing any web search:

```bash
JOB_ID=$(curl -s -X POST "$SUPABASE_URL/rest/v1/sherlock_jobs" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "kind": "geo",                                  # or "topic" — see Step 1
    "params": {
      "province":   "<Province>",                   # geo only; omit for topic mode
      "district":   "<District>",                   # geo only, optional
      "sectors":    ["<Sector>"],                   # geo: single-element array
      "topic":      "<...>",                        # topic only
      "region":     "<...>",                        # topic only, optional
      "maxResults": 5,
      "ai_source":  "claude-code-local"             # marker for the queue UI
    },
    "priority": 1,
    "status":   "running",
    "started_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "enqueued_by": null,
    "last_diagnostic": {
      "ts": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "label": "start",
      "phases": ["       0ms start"],
      "elapsed_ms": 0
    }
  }' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)[0].id))")
```

Track this `JOB_ID` for heartbeats and final write-back. Maintain a `phases[]` array in-memory; append a line at each milestone:

```
"<elapsed_ms>ms <label>"   # e.g. "    1240ms tavily-start sector=Energy"
```

After each major milestone, fire-and-forget update the row:

```bash
curl -s -X PATCH "$SUPABASE_URL/rest/v1/sherlock_jobs?id=eq.$JOB_ID" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" \
  -d '{"last_diagnostic": {"ts": "...", "label": "...", "phases": [<last 40>], "elapsed_ms": ...}}'
```

Use these labels (mirror the deployed pipeline so the trail reads identically):
- `start` — handler entry
- `searches built (N)` — query plan built
- `tavily-start sector=<S>` — beginning web search for sector (substitute `WebSearch` for `tavily` in your label if you want, but `tavily` matches deployed)
- `tavily-done sector=<S> results=<N>` — search complete
- `ai-start sec=<S> idx=<N> <hostname>` — beginning AI extraction for article N
- `ai-done sec=<S> idx=<N> ok=<bool>` — AI extraction complete
- `dry-skip sector=<S>` — dry-cell guard fired (see §17 of memory)
- `loop-done inserted=<X> skipped=<Y> errors=<Z>` — end of articles loop

## Step 1 — Build the search query

Canonical Nepal sectors: `Transport`, `Energy`, `Water & Sanitation`, `Agriculture & Irrigation`, `Health`, `Education`, `Telecom`, `Urban Development`, `Tourism`.
Canonical provinces: `Koshi`, `Madhesh`, `Bagmati`, `Gandaki`, `Lumbini`, `Karnali`, `Sudurpashchim`.

Reject input that isn't on these lists; tell the user the allowed values.

Query template:
- `Nepal <sector> project OR program <province>` — when both given
- `Nepal <sector> project OR program` — sector only
- `Nepal infrastructure project <province>` — province only
- `Nepal infrastructure project` — neither

Soft sectors (Health, Education) deliberately omit "infrastructure" — they surface programs/campaigns better that way (matches `ai-discover-projects/index.ts` rationale).

## Step 2 — WebSearch + WebFetch

Run one `WebSearch` with the query. Take the top 5–8 results. For each, run `WebFetch` (parallel) to read the body. If a result has no fetchable body or <50 chars of content, skip it.

## Step 3 — Extract one project record per article

For each fetched article, produce a single project record matching this schema. **Return `null` (skip) if confidence < 0.40 or the article isn't about a specific Nepal project/program.**

```json
{
  "title": "string ≤200 chars — the project's actual name, not the headline",
  "sector": "<one of canonical sectors> — PRIMARY sector",
  "sectors": ["<sector>", "..."],  // priority order; primary at [0]
  "project_type": "Road|Bridge|Tunnel|Cable car|Airport|Railway|Hydropower|Solar|Wind|Transmission line|Substation|Drinking water|Sewerage|Treatment plant|Reservoir|Irrigation canal|Hospital|School|Stadium|Market|Office building|Telecom tower|Other or null",
  "province": "<one of canonical provinces or null>",
  "provinces": ["<province>", "..."],  // geographic order; primary at [0]
  "district": "string or null",
  "districts": ["...", "..."],         // max 10
  "municipality": "string or null",
  "municipalities": ["...", "..."],    // max 15
  "ward": 0-99 or null,
  "location_text": "free-text like 'Kalanki–Naubise section, 27 km' or null",
  "description": "3–5 paragraphs, ~250–500 words. WHAT the project IS (scope, geography, intent, stakeholders, procurement model, significance) — NOT current status, % complete, or recent news. No markdown. Use only facts in the article.",
  "contractor": "string or null",
  "implementing_agency": "string or null",
  "budget_npr": "number (raw NPR, no commas) or null. Convert: 1 lakh=100000, 1 crore=10000000",
  "funding_committed_npr": "number or null",
  "estimated_beneficiaries": "number or null",
  "procurement_method": "ICB / NCB / Direct / PPP / etc. or null",
  "esia_status": "not_started|in_progress|iee_approved|eia_approved|rejected|exempt or null",
  "start_date": "YYYY-MM-DD or null",
  "expected_completion": "YYYY-MM-DD or null",
  "status": "proposed|approved|in_progress|delayed|completed|cancelled",
  "confidence_score": 0.00-1.00,
  "source_url": "the article URL — separate, used to populate project_sources"
}
```

**Status rubric** (extreme importance — pick using LATEST evidence in the article):
- `proposed` — announced/studied/DPR-in-prep, no formal sanction
- `approved` — sanctioned/budgeted/tender awarded, no physical work yet
- `in_progress` — construction or implementation actively underway
- `delayed` — should-be-in-progress-or-done but explicit slippage reported (require explicit delay language — don't infer)
- `completed` — inaugurated/operational/handed over
- `cancelled` — scrapped/abandoned/terminated

## Step 4 — Dedupe by title

For each candidate, check the `projects` table for case-insensitive title match:

```bash
SAFE_TITLE=$(echo "$TITLE" | sed 's/[\\%_]/\\&/g')
curl -s -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  "$SUPABASE_URL/rest/v1/projects?title=ilike.$SAFE_TITLE&select=id,provinces,districts,municipalities"
```

**On match** — don't insert a duplicate. Instead, merge new geo signals into the existing row (union the `provinces` / `districts` / `municipalities` arrays, dedupe case-insensitively, cap at 7/10/15). Only PATCH if at least one array grew. Also append the article to `project_sources` if not already cited.

**On no match** — proceed to insert.

## Step 5 — Slug + national-pride flag

Slug: lowercase, strip non-`[\w\s-]`, replace spaces with `-`, truncate 80 chars, append `-<4hexchars>` to avoid collisions.

National Pride: check the title against the 24-name list at `supabase/functions/_shared/national_pride.ts` (read that file if needed). If a fuzzy match, set `national_pride: true`.

## Step 6 — Insert the project

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/projects" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "title": "...",
    "slug": "...",
    "description": "...",
    "sector": "...",
    "sectors": [...],
    "province": "...",
    "provinces": [...],
    "district": "...",
    "districts": [...],
    "municipality": "...",
    "municipalities": [...],
    "ward": null,
    "location_text": "...",
    "contractor": "...",
    "implementing_agency": "...",
    "budget_npr": null,
    "funding_committed_npr": null,
    "estimated_beneficiaries": null,
    "procurement_method": null,
    "esia_status": null,
    "start_date": null,
    "expected_completion": null,
    "status": "proposed",
    "approval_status": "pending",
    "submitted_by": null,
    "submitted_by_ai": true,
    "ai_tag": "claude-code-local",
    "national_pride": false,
    "image_urls": [],
    "cover_image_url": null,
    "confidence_score": 0.85
  }'
```

Capture the returned `id`.

## Step 7 — Insert the project_sources row

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/project_sources" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": <new-id>,
    "added_by": null,
    "source_type": "article",
    "title": "<article title or hostname>",
    "url": "<article url>",
    "verified": false,
    "approval_status": "pending",
    "submitted_by_ai": true,
    "confidence_score": <same as project>
  }'
```

**If the sources insert fails, DELETE the orphan project** to keep the DB clean (mirror the rollback in `ai-discover-projects:828`):

```bash
curl -s -X DELETE "$SUPABASE_URL/rest/v1/projects?id=eq.$NEW_ID" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK"
```

## Step 7.5 — Close the sherlock_jobs queue row (REQUIRED for queue-tab parity)

After all candidate articles processed (or web-search fallback exhausted), close the queue row with final counts:

```bash
curl -s -X PATCH "$SUPABASE_URL/rest/v1/sherlock_jobs?id=eq.$JOB_ID" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" \
  -d '{
    "status":      "done",
    "inserted":    <count of NEW projects inserted>,
    "skipped":     <count of articles processed but not inserted: AI-said-null + dedupe-hit + content-too-short>,
    "error_text":  "<optional, ≤2000 chars: collected errors joined with newlines>",
    "finished_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "last_diagnostic": { "ts": "...", "label": "loop-done inserted=N skipped=M errors=K", "phases": [<final trail, last 40>], "elapsed_ms": <total> }
  }'
```

If the run threw mid-way, set `status: "failed"` instead and put the message + last 20 phases in `error_text` (prefix with `"phase trail (last N):\n"`). Don't leave rows stuck in `status='running'` — the admin queue would show them as hanging.

**Counter semantics — must match the deployed pipeline:**
- `inserted` = new `projects` rows you actually wrote.
- `skipped` = articles processed but NOT inserted (AI returned null + dedupe matched + content too short). JSON-parse failures go into `error_text`, NOT the skipped count.
- `inserted + skipped ≤ articles fetched`.

## Step 8 — Report

```
DISCOVERY COMPLETE
  Query: <the query>
  Searched: <N> URLs fetched

  Inserted: <N> new projects
    - "Title 1" → /projects/<slug>
    - "Title 2" → /projects/<slug>
    ...

  Merged into existing: <M> projects had new geo signals
    - "Existing title" — added districts: [Bara, Parsa]

  Skipped: <K> below confidence threshold or not Nepal-specific

  All rows are approval_status='pending' with ai_tag='claude-code-local'.
```
