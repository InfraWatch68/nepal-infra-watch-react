-- Heartbeat column for ai-discover-projects so a function that gets
-- hard-killed by the platform still leaves a trail of what it was doing.
--
-- Symptom: Madhesh / Saptari / Energy reaped at 300s with `error_text =
-- "Reaped by sherlock_reap_stuck_jobs..."` and no phase trail attached.
-- The function was hung inside a fetch() call (no built-in timeout in
-- Deno), so the wall-time guard at iteration boundaries never fired and
-- no writeback happened before the platform killed it.
--
-- The function now (1) wraps every Tavily / Mistral fetch with an
-- AbortController timeout and (2) writes a heartbeat to last_diagnostic
-- before/after each fetch. The reaper trigger doesn't touch this column,
-- so it survives "Reaped by..." being slapped onto error_text and gives
-- the operator one place to see "function died here".
--
-- Shape: { ts: timestamptz-iso, label: text, phases: text[],
--          elapsed_ms: int }

alter table public.sherlock_jobs
  add column if not exists last_diagnostic jsonb;

create index if not exists idx_sherlock_jobs_last_diagnostic_ts
  on public.sherlock_jobs ((last_diagnostic->>'ts'))
  where last_diagnostic is not null;
