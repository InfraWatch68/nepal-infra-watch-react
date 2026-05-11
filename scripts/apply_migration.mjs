// Posts a SQL migration to the Supabase Management API.
// Usage: node scripts/apply_migration.mjs supabase/migrations/<file>.sql
//
// Reads SUPABASE_API (personal access token) from .env. The project ref lives
// in supabase/config.toml. Output is the JSON response from /database/query.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const migrationPath = process.argv[2];
if (!migrationPath) {
  console.error('Usage: node scripts/apply_migration.mjs <path-to-sql>');
  process.exit(2);
}

const envText = readFileSync(resolve(repoRoot, '.env'), 'utf8');
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const token = env.SUPABASE_API;
if (!token) { console.error('SUPABASE_API missing from .env'); process.exit(2); }

const configText = readFileSync(resolve(repoRoot, 'supabase/config.toml'), 'utf8');
const refMatch = configText.match(/project_id\s*=\s*"([^"]+)"/);
if (!refMatch) { console.error('Could not read project_id from supabase/config.toml'); process.exit(2); }
const ref = refMatch[1];

const sql = readFileSync(resolve(repoRoot, migrationPath), 'utf8');
console.log(`Applying ${migrationPath} (${sql.length} bytes) to project ${ref} …`);

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const text = await r.text();
if (!r.ok) {
  console.error(`HTTP ${r.status}:`);
  console.error(text.slice(0, 4000));
  process.exit(1);
}
console.log('OK.', text.slice(0, 500));
