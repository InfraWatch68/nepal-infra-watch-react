// Strict ISO-date validator for AI-extracted date strings.
//
// The naive shape check (`/^\d{4}-\d{2}-\d{2}$/`) lets through values that
// LOOK like dates but Postgres rejects with "date/time field value out of
// range" — e.g. "2026-03-00" (day 00), "2026-02-30" (Feb doesn't have a
// 30th), "2026-13-05" (no 13th month). Mistral emits these when the source
// article only specifies "March 2026" and the model fabricates the day, or
// when it transcribes a typo.
//
// The fix is to round-trip the candidate through `new Date(…)` and verify
// the parsed UTC date stringifies back to the exact input. JavaScript Date
// silently rolls over invalid components (`new Date("2026-02-30")` becomes
// March 2), so the round-trip catches every malformed combination.
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}

// Coerce a value to a valid ISO date string or null. Convenience wrapper so
// callers can write `start_date: safeIsoDate(parsed.start_date)` instead of
// `isValidIsoDate(parsed.start_date) ? parsed.start_date : null`.
export function safeIsoDate(value: unknown): string | null {
  return isValidIsoDate(value) ? value : null;
}
