You are doing a live health check of the Nepal Infra Watch application. Execute every step yourself using your tools — no excuses, no asking the user to do it.

## Step 1 — Frontend pages

Use Bash/curl to hit every route on the local dev server (http://localhost:8080) and report the HTTP status code for each:

- / (Home)
- /projects (Browse)
- /map
- /analytics
- /compare
- /dashboard
- /admin

If any route returns non-200, flag it as FAIL. If the dev server is not running, say so clearly and start it with `npm run dev` in background.

## Step 2 — Supabase edge functions

Use curl to hit the deployed function endpoint and confirm it is reachable and auth-gating correctly. Expected response for a bad token is `UNAUTHORIZED_INVALID_JWT_FORMAT` — that means the function is live. Use this base URL: `https://vlioybqqswbohdhpnjym.supabase.co/functions/v1/`

Check all 6 functions:
- ai-discover-projects
- ai-fetch-project-news
- ai-fetch-news-all
- ai-project-insights
- ai-generate-brief
- ai-generate-global-brief

Send a POST with `-H "Authorization: Bearer bad_token"` and `-d '{}'`. Confirm each returns the UNAUTHORIZED response (not a network error or 404).

## Step 3 — Supabase secrets

Run `npx supabase secrets list --project-ref vlioybqqswbohdhpnjym` and confirm `GOOGLE_AI_API_KEY` and `TAVILY_API_KEY` are present in the list.

## Step 4 — Report

Print a clean summary table:

```
FRONTEND
  200  /
  200  /projects
  ...

EDGE FUNCTIONS
  LIVE  ai-discover-projects
  ...

SECRETS
  ✓  GOOGLE_AI_API_KEY
  ✓  TAVILY_API_KEY

OVERALL: PASS / FAIL
```

Mark OVERALL as PASS only if all pages are 200, all functions return UNAUTHORIZED (meaning they're live), and both required secrets are present. Otherwise mark it FAIL and list what needs fixing.

## Step 5 — AI Discover Projects deep check

### 5a — Auth gate
Send three curl requests to `https://vlioybqqswbohdhpnjym.supabase.co/functions/v1/ai-discover-projects`:

1. No Authorization header at all → expect `UNAUTHORIZED_NO_AUTH_HEADER`
2. `Authorization: Bearer not.a.jwt` → expect `UNAUTHORIZED_INVALID_JWT_FORMAT`
3. CORS OPTIONS preflight → expect HTTP 200

Flag any deviation as FAIL.

### 5b — Edge function source audit
Read `supabase/functions/ai-discover-projects/index.ts` and verify all four of the following are true. Flag each separately:

| Check | What to look for |
|-------|-----------------|
| Model name (Lovable path) | `model` in the `else if (lovable)` branch must NOT be `"google/gemini-3-flash-preview"` — that model does not exist |
| Retry sleep duration | The `setTimeout` inside `callChatModel` must be ≤ 5000 ms — a 30 s sleep will blow the edge function wall-clock timeout |
| maxResults cap | `Math.min(Math.max(...), 10)` — confirm upper bound is 10 |
| Rollback on source failure | After a failed `project_sources` insert, a compensating `projects.delete()` must be present |

### 5c — Admin UI source audit
Read `src/pages/Admin.tsx` and verify:

| Check | What to look for |
|-------|-----------------|
| maxResults not hardcoded | The `supabase.functions.invoke('ai-discover-projects', ...)` call must NOT pass `maxResults: 2` as a literal — it should reference a state variable |
| Errors surfaced in UI | After the invoke, errors must be rendered in JSX (not just `console.warn`) |
| Enter key support | The Topic and Region `<Input>` elements must have an `onKeyDown` handler that calls `runDiscover` on Enter |

### 5d — Report section

Append to the summary table:

```
AI DISCOVER PROJECTS
  PASS/FAIL  auth gate — no header → UNAUTHORIZED_NO_AUTH_HEADER
  PASS/FAIL  auth gate — bad JWT → UNAUTHORIZED_INVALID_JWT_FORMAT
  PASS/FAIL  CORS preflight → 200
  PASS/FAIL  model name valid (not gemini-3-flash-preview)
  PASS/FAIL  retry sleep ≤ 5000 ms
  PASS/FAIL  maxResults cap present
  PASS/FAIL  rollback on source failure
  PASS/FAIL  maxResults uses state variable (not hardcoded 2)
  PASS/FAIL  errors rendered in UI
  PASS/FAIL  Enter key handler on inputs
```

Mark OVERALL as FAIL if any AI Discover Projects check fails.
