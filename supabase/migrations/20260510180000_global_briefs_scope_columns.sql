-- Add structured scope columns alongside the existing scope string.
-- The scope string stays for backwards compat; new code writes both.

ALTER TABLE global_briefs
  ADD COLUMN IF NOT EXISTS scope_province TEXT,
  ADD COLUMN IF NOT EXISTS scope_sector   TEXT;

-- Backfill from existing scope strings ('province:Bagmati' → 'Bagmati', etc.)
UPDATE global_briefs
SET
  scope_province = CASE WHEN scope LIKE 'province:%' THEN SUBSTRING(scope FROM 10) ELSE NULL END,
  scope_sector   = CASE WHEN scope LIKE 'sector:%'   THEN SUBSTRING(scope FROM 8)  ELSE NULL END;
