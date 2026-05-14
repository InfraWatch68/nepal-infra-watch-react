// Robust JSON repair for LLM responses.
//
// LLM-generated JSON breaks in characteristic ways: preamble prose ("Sure,
// here is the JSON:"), markdown code fences, trailing commas, and — most
// commonly when output token limits are hit — truncation in the middle of
// a string, array, or object. The Mistral free-tier output cap was the
// original culprit (e.g. response cut off as `"sectors": ["` mid-array).
//
// Repair stages, applied in order; first parse that succeeds wins:
//   1. Strip code fences and any prose outside the outermost `{ ... }`.
//   2. Drop trailing commas before `}` or `]`.
//   3. Walk the candidate as a state-machine tokenizer, tracking string /
//      array / object depth + escape state. If parsing fails, rewind to
//      the last value-completion boundary (a `,` outside any string),
//      then close any open string, arrays, and braces.
//
// Anything still unparseable returns { ok: false, reason }. Callers should
// treat `ai_skipped` (model returned literal "null") and `empty` as soft
// skips, and everything else as a genuine parse failure worth logging.

export const stripFences = (s: string): string =>
  s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

export type ParseResult<T = any> =
  | { ok: true; value: T }
  | { ok: false; reason: "empty" | "ai_skipped" | "unparseable" };

const tryParse = <T = any>(s: string): T | null => {
  try { return JSON.parse(s) as T; } catch { return null; }
};

// Result of a one-pass scan over the candidate. `lastSafeIdx` is the byte
// offset just after the most recent value-completion boundary (a `,` outside
// strings at any depth, or a closing `}`/`]`). We compute this once, then
// derive both the "naive close" and "rewind to last safe boundary" repairs
// without re-scanning.
type ScanState = {
  inString: boolean;
  stack: ("{" | "[")[];
  lastSafeIdx: number;
};

function scan(candidate: string): ScanState {
  let inString = false;
  let escape = false;
  const stack: ("{" | "[")[] = [];
  let lastSafeIdx = -1;
  for (let i = 0; i < candidate.length; i++) {
    const c = candidate[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{" || c === "[") { stack.push(c); continue; }
    if (c === "}" || c === "]") {
      stack.pop();
      lastSafeIdx = i + 1;
      continue;
    }
    if (c === "," && stack.length >= 1) {
      lastSafeIdx = i + 1;
    }
  }
  return { inString, stack, lastSafeIdx };
}

// Close any open string + containers on a candidate that already ends at a
// structurally meaningful position. Strips a single trailing `,` first (since
// it would otherwise force JSON.parse to expect another value).
function appendClosers(candidate: string, state: ScanState): string {
  let out = candidate;
  if (state.inString) out += '"';
  out = out.replace(/[,\s]+$/, "");
  for (let i = state.stack.length - 1; i >= 0; i--) {
    out += state.stack[i] === "{" ? "}" : "]";
  }
  return out;
}

// Aggressive rewind: cut at the last safe boundary, then close. Used when
// the naive close fails — typically because the trailing fragment is a
// partial number, bare-word, or otherwise non-string primitive.
function rewindAndClose(candidate: string): string | null {
  const state = scan(candidate);
  if (!state.inString && state.stack.length === 0) return candidate;
  let cut: string;
  if (state.lastSafeIdx > 0) cut = candidate.slice(0, state.lastSafeIdx);
  else {
    const firstBrace = candidate.indexOf("{");
    if (firstBrace < 0) return null;
    cut = candidate.slice(0, firstBrace + 1);
  }
  cut = cut.replace(/[,\s]+$/, "");
  // Re-scan the cut to figure out which containers are still open after
  // the rewind (the original stack reflected the truncation point, not
  // the cut point).
  const after = scan(cut);
  let out = cut;
  if (after.inString) out += '"';
  out = out.replace(/,\s*$/, "");
  for (let i = after.stack.length - 1; i >= 0; i--) {
    out += after.stack[i] === "{" ? "}" : "]";
  }
  return out;
}

// Tries to extract a parseable JSON object from a Mistral/Gemini response
// that may include preamble prose, fenced code, trailing-comma typos, or
// brace-unbalanced truncation. See module header for stage list.
export function tryParseJsonObject<T = any>(rawText: string): ParseResult<T> {
  const stripped = stripFences(rawText);
  if (!stripped) return { ok: false, reason: "empty" };
  if (stripped === "null" || stripped === '"null"') return { ok: false, reason: "ai_skipped" };

  // Stage 1: bracket-extract — drop any prose before the first `{` or after
  // the last `}`. Covers the "Sure, here is the JSON: { ... }" pattern.
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  let candidate = (first >= 0 && last > first) ? stripped.slice(first, last + 1) : stripped;
  // If there's no closing brace at all (truncated mid-object), keep the
  // prefix from the first `{` onward so rewindAndClose can salvage it.
  if (first >= 0 && last < first) candidate = stripped.slice(first);

  let parsed = tryParse<T>(candidate);
  if (parsed) return { ok: true, value: parsed };

  // Stage 2: strip trailing commas before `}` or `]`.
  const noTrailingCommas = candidate.replace(/,(\s*[}\]])/g, "$1");
  parsed = tryParse<T>(noTrailingCommas);
  if (parsed) return { ok: true, value: parsed };

  // Stage 3a: keep the whole candidate, close any open string + containers.
  // Optimistic — preserves a complete trailing field that has no trailing
  // comma yet. Fails for partial primitives (e.g. truncated number).
  const naive = appendClosers(noTrailingCommas, scan(noTrailingCommas));
  parsed = tryParse<T>(naive.replace(/,(\s*[}\]])/g, "$1"));
  if (parsed) return { ok: true, value: parsed };

  // Stage 3b: aggressive rewind to last safe boundary, then close.
  const repaired = rewindAndClose(noTrailingCommas);
  if (repaired) {
    const cleaned = repaired.replace(/,(\s*[}\]])/g, "$1");
    parsed = tryParse<T>(cleaned);
    if (parsed) return { ok: true, value: parsed };
  }

  return { ok: false, reason: "unparseable" };
}
