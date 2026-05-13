You are doing **local project discovery** for Nepal Infra Watch — finding new infrastructure projects via WebSearch/WebFetch and inserting them into the `projects` table for moderator review. This replaces the deployed `ai-discover-projects` edge function for manual runs.

Arguments: `[sector] [province]` — both optional. If neither is given, discover broadly across all sectors. If only `sector`, search nationally. If only `province`, fan out across sectors within that province.

## Step 0 — Load credentials

```bash
SUPABASE_URL=$(grep '^VITE_SUPABASE_URL' .env | head -1 | cut -d= -f2- | tr -d ' "')
SRK=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | head -1 | cut -d= -f2- | tr -d ' "')
```

If `SRK` is empty: STOP. Tell the user to paste it into `.env` first.

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
