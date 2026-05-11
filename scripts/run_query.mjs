// One-shot SQL runner via Supabase Management API.
// Usage: node scripts/run_query.mjs "SELECT count(*) FROM …;"

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const sql = process.argv[2];
if (!sql) { console.error('Usage: node scripts/run_query.mjs "<SQL>"'); process.exit(2); }

const env = Object.fromEntries(
  readFileSync(resolve(repoRoot, '.env'), 'utf8').split(/\r?\n/)
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const ref = readFileSync(resolve(repoRoot, 'supabase/config.toml'), 'utf8').match(/project_id\s*=\s*"([^"]+)"/)[1];

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.SUPABASE_API}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await r.text();
if (!r.ok) { console.error(`HTTP ${r.status}:`, text); process.exit(1); }
try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
catch { console.log(text); }
