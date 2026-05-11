// Builds a 753-row SQL INSERT for the public.municipalities table from the
// AC17dollars/nepal-local-level dataset (English names, official 2017 federal
// re-organization). Run from repo root:
//   node scripts/build_municipalities_sql.mjs
//
// Validates against DISTRICTS_BY_PROVINCE in src/lib/constants.ts before
// writing supabase/migrations/20260512120000_sherlock_municipalities.sql.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Raw source: const localLevel = [ … ]; export default localLevel;
const raw = readFileSync(resolve(__dirname, 'nepal_data_ts.ts'), 'utf8');
// Extract just the array literal between `const localLevel = [...]`.
const start = raw.indexOf('[');
const end = raw.lastIndexOf(']');
const jsonText = raw.slice(start, end + 1);
const rows = JSON.parse(jsonText);

// Constants.ts is the source of truth for the spelling of provinces &
// districts we accept in the DB. Mirror its DISTRICTS_BY_PROVINCE here.
const DISTRICTS_BY_PROVINCE = {
  Koshi: ['Bhojpur','Dhankuta','Ilam','Jhapa','Khotang','Morang','Okhaldhunga','Panchthar','Sankhuwasabha','Solukhumbu','Sunsari','Taplejung','Terhathum','Udayapur'],
  Madhesh: ['Bara','Dhanusha','Mahottari','Parsa','Rautahat','Saptari','Sarlahi','Siraha'],
  Bagmati: ['Bhaktapur','Chitwan','Dhading','Dolakha','Kathmandu','Kavrepalanchok','Lalitpur','Makwanpur','Nuwakot','Ramechhap','Rasuwa','Sindhuli','Sindhupalchok'],
  Gandaki: ['Baglung','Gorkha','Kaski','Lamjung','Manang','Mustang','Myagdi','Nawalpur','Parbat','Syangja','Tanahun'],
  Lumbini: ['Arghakhanchi','Banke','Bardiya','Dang','Eastern Rukum','Gulmi','Kapilvastu','Palpa','Parasi','Pyuthan','Rolpa','Rupandehi'],
  Karnali: ['Dailekh','Dolpa','Humla','Jajarkot','Jumla','Kalikot','Mugu','Salyan','Surkhet','Western Rukum'],
  Sudurpashchim: ['Achham','Baitadi','Bajhang','Bajura','Dadeldhura','Darchula','Doti','Kailali','Kanchanpur'],
};

// Province field in the source is sometimes "1".."7" (older entries) and
// sometimes the English name (later entries). Map both to our canonical form.
const PROVINCE_BY_CODE = {
  '1': 'Koshi',
  '2': 'Madhesh',
  '3': 'Bagmati',
  '4': 'Gandaki',
  '5': 'Lumbini',
  '6': 'Karnali',
  '7': 'Sudurpashchim',
  'Province 1': 'Koshi',
  'Province 2': 'Madhesh',
  'Province No 1': 'Koshi',
  'Bagmati': 'Bagmati',
  'Gandaki': 'Gandaki',
  'Lumbini': 'Lumbini',
  'Karnali': 'Karnali',
  'Sudurpaschim': 'Sudurpashchim',  // source spelling -> ours
  'Sudurpashchim': 'Sudurpashchim',
  'Province No 2': 'Madhesh',
  'Madhesh': 'Madhesh',
  'Madhesh Pradesh': 'Madhesh',
  'Province No. 1': 'Koshi',
};

// District names in source are uppercase; constants.ts uses Title Case but
// also has some quirks (Kavrepalanchok, Sindhupalchok, Kavre, etc).
// Map only the divergences; everything else is .toLowerCase + first-letter caps.
const DISTRICT_ALIASES = {
  'KAVRE': 'Kavrepalanchok',
  'KAVREPALANCHOWK': 'Kavrepalanchok',
  'KAVREPALANCHOK': 'Kavrepalanchok',
  'SINDHUPALCHOWK': 'Sindhupalchok',
  'SINDHUPALCHOK': 'Sindhupalchok',
  'TERATHUM': 'Terhathum',
  'TERHATHUM': 'Terhathum',
  'NAWALPARASI EAST': 'Nawalpur',
  'NAWALPARASI WEST': 'Parasi',
  'NAWALPUR': 'Nawalpur',
  'PARASI': 'Parasi',
  'RUKUM EAST': 'Eastern Rukum',
  'RUKUM WEST': 'Western Rukum',
  'EASTERN RUKUM': 'Eastern Rukum',
  'WESTERN RUKUM': 'Western Rukum',
  'DHANUSA': 'Dhanusha',
  'DHANUSHA': 'Dhanusha',
  'TANAHU': 'Tanahun',
  'TANAHUN': 'Tanahun',
  'KAPILBASTU': 'Kapilvastu',
  'KAPILVASTU': 'Kapilvastu',
};

function titleCase(s) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeDistrict(raw) {
  const up = raw.trim().toUpperCase();
  if (DISTRICT_ALIASES[up]) return DISTRICT_ALIASES[up];
  return titleCase(up);
}

const TYPE_MAP = {
  'Metropolitan City': 'metropolitan',
  'Sub-Metropolitan City': 'sub_metropolitan',
  'Sub Metropolitan City': 'sub_metropolitan',
  'Submetropolitan City': 'sub_metropolitan',
  'Municipality': 'municipality',
  'Rural Municipality': 'rural_municipality',
};

const out = [];
const errors = [];
const districtsLookup = new Set();
for (const [prov, ds] of Object.entries(DISTRICTS_BY_PROVINCE)) {
  for (const d of ds) districtsLookup.add(`${prov}::${d}`);
}

for (const row of rows) {
  const provRaw = row.Province ?? row.province;
  const distRaw = row.District ?? row.district;
  const nameRaw = row['Local Level Name'] ?? row.name;
  const typeRaw = row.Type ?? row.type;

  const province = PROVINCE_BY_CODE[String(provRaw).trim()];
  if (!province) { errors.push(`Unknown province: ${JSON.stringify(provRaw)}`); continue; }
  const district = normalizeDistrict(distRaw);
  if (!districtsLookup.has(`${province}::${district}`)) {
    errors.push(`Unknown (province, district) pair: ${province} / ${district} (raw: ${distRaw})`);
    continue;
  }
  const kind = TYPE_MAP[typeRaw.trim()];
  if (!kind) { errors.push(`Unknown type: ${JSON.stringify(typeRaw)}`); continue; }
  out.push({ name: nameRaw.trim(), district, province, kind });
}

if (errors.length) {
  console.error(`Validation errors (${errors.length}):`);
  for (const e of errors.slice(0, 30)) console.error('  -', e);
  if (errors.length > 30) console.error(`  …and ${errors.length - 30} more`);
  process.exit(1);
}

if (out.length !== 753) {
  console.error(`Expected 753 rows, got ${out.length}. Aborting.`);
  process.exit(1);
}

// Dedupe — protect against accidentally including duplicates.
const seen = new Set();
const deduped = [];
for (const r of out) {
  const k = `${r.province}::${r.district}::${r.name}`;
  if (seen.has(k)) { console.warn(`Duplicate: ${k}`); continue; }
  seen.add(k);
  deduped.push(r);
}

console.log(`Validated ${deduped.length} municipalities across ${new Set(deduped.map(r => r.province)).size} provinces and ${new Set(deduped.map(r => `${r.province}::${r.district}`)).size} districts.`);

// Summary by kind:
const byKind = {};
for (const r of deduped) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
console.log('By kind:', byKind);

const esc = (s) => s.replace(/'/g, "''");

const valuesSql = deduped
  .map((r) => `  ('${esc(r.name)}', '${esc(r.district)}', '${esc(r.province)}', '${r.kind}')`)
  .join(',\n');

const migration = `-- F1 follow-up: municipalities reference table seeded with Nepal's 753 local-level units.
-- Source: https://github.com/AC17dollars/nepal-local-level (MIT, English names,
-- aligned with the 2017 federal restructure). Province / district spellings
-- normalised to match src/lib/constants.ts DISTRICTS_BY_PROVINCE.
--
-- Prerequisite for Sherlock v2's geo-seeded discovery: the admin UI cascades
-- Province -> District -> Municipality from this table.

CREATE TABLE IF NOT EXISTS public.municipalities (
  id        bigserial PRIMARY KEY,
  name      text NOT NULL,
  district  text NOT NULL,
  province  text NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('metropolitan','sub_metropolitan','municipality','rural_municipality')),
  UNIQUE (province, district, name)
);

CREATE INDEX IF NOT EXISTS idx_municipalities_pdn ON public.municipalities(province, district, name);

ALTER TABLE public.municipalities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read municipalities" ON public.municipalities;
CREATE POLICY "Anyone can read municipalities" ON public.municipalities FOR SELECT USING (true);
DROP POLICY IF EXISTS "Moderators manage municipalities" ON public.municipalities;
CREATE POLICY "Moderators manage municipalities" ON public.municipalities FOR ALL
  USING (public.is_moderator(auth.uid()))
  WITH CHECK (public.is_moderator(auth.uid()));

-- Seed. 753 rows total: 6 metropolitan, 11 sub_metropolitan, 276 municipality,
-- 460 rural_municipality (validated at build time, see scripts/build_municipalities_sql.mjs).
INSERT INTO public.municipalities (name, district, province, kind) VALUES
${valuesSql}
ON CONFLICT (province, district, name) DO NOTHING;
`;

const outPath = resolve(repoRoot, 'supabase/migrations/20260512120000_sherlock_municipalities.sql');
writeFileSync(outPath, migration, 'utf8');
console.log(`Wrote ${outPath}`);
