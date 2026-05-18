// Shared key-rotation helper for AI provider keys (Tavily, Mistral, etc).
//
// Backed by the `api_keys` table. Edge functions call:
//   - getKeys(admin, 'tavily')        → ordered list of key values
//   - markExhausted(admin, 'tavily', key, '432 plan-limit')
//   - markSucceeded(admin, 'tavily', key)
//
// Behaviour:
//   - Returns keys ordered by (is_exhausted ASC, position ASC). Non-exhausted
//     keys are tried first; exhausted ones still get tried IF all non-
//     exhausted ones fail, but they sink to the bottom on each exhaustion.
//   - Falls back to env vars if the table is empty for a provider, so this
//     module is a drop-in over the legacy parseMistralKeys/parseTavilyKeys
//     approach.
//   - markExhausted bumps the row's position to (current max + 1000) so it
//     ends up at the bottom no matter where it was. Cheap UPDATE.
//
// Note: env-fallback paths return strings only — they can't be marked as
// exhausted since they have no row in the table. If the admin wants
// rotation persistence, they must add keys to the table via the admin UI.

// deno-lint-ignore-file no-explicit-any
type SupabaseAdmin = any;

export type ProviderName = 'tavily' | 'mistral' | 'google' | 'lovable';

// Parse a comma-separated env var, plus an optional single-value sibling
// (MISTRAL_API_KEY + MISTRAL_API_KEYS). De-duplicates.
function parseEnvFallback(envSingle: string, envMulti: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const s = (Deno.env.get(envSingle) ?? '').trim();
  if (s) { out.push(s); seen.add(s); }
  const m = envMulti ? (Deno.env.get(envMulti) ?? '').split(',').map(k => k.trim()).filter(Boolean) : [];
  for (const k of m) if (!seen.has(k)) { out.push(k); seen.add(k); }
  return out;
}

const ENV_MAP: Record<ProviderName, { single: string; multi: string }> = {
  tavily:  { single: 'TAVILY_API_KEY',  multi: 'TAVILY_API_KEYS'  },
  mistral: { single: 'MISTRAL_API_KEY', multi: 'MISTRAL_API_KEYS' },
  google:  { single: 'GOOGLE_AI_API_KEY', multi: '' },
  lovable: { single: 'LOVABLE_API_KEY',   multi: '' },
};

export type KeyEntry = {
  id: string | null;     // null if from env fallback
  value: string;
  position: number;
  isExhausted: boolean;
};

export async function getKeyEntries(admin: SupabaseAdmin, provider: ProviderName): Promise<KeyEntry[]> {
  try {
    const { data, error } = await admin
      .from('api_keys')
      .select('id, key_value, position, is_exhausted')
      .eq('provider', provider)
      .order('is_exhausted', { ascending: true })
      .order('position', { ascending: true });
    if (!error && data && data.length > 0) {
      return data.map((r: any) => ({
        id: r.id,
        value: r.key_value,
        position: r.position,
        isExhausted: r.is_exhausted,
      }));
    }
  } catch { /* fall through to env */ }

  // Env fallback. ENV_MAP carries the right secret names per provider.
  const cfg = ENV_MAP[provider];
  const env = parseEnvFallback(cfg.single, cfg.multi);
  return env.map((value, i) => ({ id: null, value, position: i, isExhausted: false }));
}

// Convenience: just the key strings, ordered.
export async function getKeys(admin: SupabaseAdmin, provider: ProviderName): Promise<string[]> {
  const entries = await getKeyEntries(admin, provider);
  return entries.map(e => e.value);
}

// Mark a key as exhausted: flip is_exhausted=true, bump position to bottom.
// Falls silent if the key isn't in the table (env-fallback case).
export async function markExhausted(
  admin: SupabaseAdmin,
  provider: ProviderName,
  keyValue: string,
  reason: string,
): Promise<void> {
  try {
    // Find current max position for this provider.
    const { data: maxRow } = await admin
      .from('api_keys')
      .select('position')
      .eq('provider', provider)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const newPosition = ((maxRow?.position ?? 0) as number) + 1000;
    await admin.from('api_keys').update({
      is_exhausted: true,
      exhausted_reason: reason.slice(0, 200),
      last_exhausted_at: new Date().toISOString(),
      position: newPosition,
    }).eq('provider', provider).eq('key_value', keyValue);
  } catch (e) {
    console.warn('markExhausted failed:', e instanceof Error ? e.message : String(e));
  }
}

// Mark a key as having succeeded recently — used for visibility, doesn't
// change ordering. Best-effort.
export async function markSucceeded(
  admin: SupabaseAdmin,
  provider: ProviderName,
  keyValue: string,
): Promise<void> {
  try {
    await admin.from('api_keys').update({
      last_succeeded_at: new Date().toISOString(),
    }).eq('provider', provider).eq('key_value', keyValue);
  } catch { /* best-effort */ }
}

// Status-code classification for each provider. Matches the legacy
// rotation logic in ai-discover-projects and analysis-drain.
export function isExhaustionStatus(provider: ProviderName, status: number, bodySnippet?: string): boolean {
  if (provider === 'tavily') {
    // Only true quota signals mark a key exhausted. 401 unauthorized means
    // the key is invalid/revoked — callers should rotate without marking.
    // 429 rate, 432 plan-limit, 433 paygo are real quota responses.
    return status === 429 || status === 432 || status === 433;
  }
  if (provider === 'mistral') {
    // 402 credits exhausted; 429 if body contains free_tier or RESOURCE_EXHAUSTED
    if (status === 402) return true;
    if (status === 429 && bodySnippet) {
      return bodySnippet.includes('free_tier') || bodySnippet.includes('RESOURCE_EXHAUSTED');
    }
    return false;
  }
  // Google / Lovable — they're single-key fallbacks; mark on 402/429-with-free-tier.
  if (status === 402) return true;
  if (status === 429 && bodySnippet) {
    return bodySnippet.includes('RESOURCE_EXHAUSTED') || bodySnippet.includes('free_tier');
  }
  return false;
}
