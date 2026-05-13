You are generating a **local global brief** for Nepal Infra Watch — composing a headline + body from approved projects and inserting it into `global_briefs`, the same table the deployed `ai-generate-global-brief` writes to. The HomeBriefCarousel on the home page picks it up on next page load.

Argument: `[scope]` — optional. Forms:
- (omitted) → `scope=global`, no province/sector filter
- `province:<Province>` → e.g. `province:Bagmati`
- `sector:<Sector>` → e.g. `sector:Hydropower`

If the user gave just a bare word, ask whether they meant province or sector.

## Step 0 — Load credentials

```bash
SUPABASE_URL=$(grep '^VITE_SUPABASE_URL' .env | head -1 | cut -d= -f2- | tr -d ' "')
SRK=$(grep '^SUPABASE_SERVICE_ROLE_KEY' .env | head -1 | cut -d= -f2- | tr -d ' "')
```

If `SRK` is empty: STOP.

## Step 1 — Pull source projects

Up to 30 most-recent approved projects matching the scope:

```bash
# global
curl -s -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  "$SUPABASE_URL/rest/v1/projects?approval_status=eq.approved&order=created_at.desc&limit=30&select=id,slug,title,sector,province,district,status,progress_percent,budget_npr,implementing_agency,contractor,start_date,expected_completion,description"

# province
"$SUPABASE_URL/rest/v1/projects?approval_status=eq.approved&province=eq.<Province>&order=created_at.desc&limit=30&select=..."

# sector
"$SUPABASE_URL/rest/v1/projects?approval_status=eq.approved&sector=eq.<Sector>&order=created_at.desc&limit=30&select=..."
```

If fewer than 3 rows return, STOP and tell the user "not enough approved projects in this scope to write a meaningful brief".

## Step 2 — Compose

Use **only** the fields in the returned rows. **Do not invent facts.** No outside knowledge of real-world Nepali projects with similar names.

- **`headline`** — ≤140 chars. One factual observation drawn from the rows. No surrounding quotes (the carousel adds them). Examples of good form:
  - `"Hydropower delays widen as 4 of 9 Bagmati projects miss Q2 dates"`
  - `"Three Sudurpashchim health programs cleared in May add 380K beneficiaries"`
  - `"Transport sector adds NPR 18.4B in tracked spend across 6 new projects this week"`
- **`body`** — 2–4 short paragraphs of plain prose. No markdown headings, no bullets, no `*emphasis*`. Aim for "at-a-glance read suitable for a homepage hero card." Cover: dominant theme, supporting figure(s), notable outlier(s) or gap(s).
- **`sources`** — array of `{id, title, slug}` references, one entry per project that informed the brief (typically 5–15 of the 30 fetched).

## Step 3 — Insert

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/global_briefs" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{
    "scope": "<global | province:X | sector:Y>",
    "scope_province": "<Province or null>",
    "scope_sector": "<Sector or null>",
    "headline": "...",
    "body": "...",
    "sources": [{"id": 42, "title": "...", "slug": "..."}, ...],
    "created_by": null
  }'

# Migration 20260510180000_global_briefs_scope_columns.sql was applied to the
# live DB on 2026-05-13. The structured scope_province / scope_sector columns
# exist alongside the legacy `scope` text column — write both for forward
# compatibility (legacy code still reads `scope`, new code reads structured).
```

Capture the returned `id`.

## Step 4 — Prune older briefs in the same scope

Mirror the edge function: keep only the 10 most recent per scope.

```bash
# Find the 11th-most-recent and delete everything older
SCOPE="global"
OLD_IDS=$(curl -s -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  "$SUPABASE_URL/rest/v1/global_briefs?scope=eq.$SCOPE&order=created_at.desc&offset=10&select=id" \
  | python3 -c "import sys,json; print(','.join(str(r['id']) for r in json.load(sys.stdin)))")

if [ -n "$OLD_IDS" ]; then
  curl -s -X DELETE "$SUPABASE_URL/rest/v1/global_briefs?id=in.($OLD_IDS)" \
    -H "apikey: $SRK" -H "Authorization: Bearer $SRK"
fi
```

## Step 5 — Report

```
BRIEF PUBLISHED
  Scope: <global | province:X | sector:Y>
  Brief ID: <id>
  Sources cited: <N> of 30 fetched

  HEADLINE:
  <the headline>

  BODY:
  <the body>

  Pruned <K> older briefs in this scope.

  The HomeBriefCarousel will pick this up on next /home page load.
```
