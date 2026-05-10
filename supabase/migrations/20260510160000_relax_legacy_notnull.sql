-- The remote schema was bootstrapped with the legacy Lovable schema where
-- sector_id, province, district, short_description on projects are NOT NULL.
-- The new self-hosted code path uses `sector text`, `description` etc. and
-- does not populate the legacy columns, so AI-discovered project inserts fail
-- with a NOT NULL violation. Drop those constraints — no app code reads them.

ALTER TABLE public.projects ALTER COLUMN sector_id          DROP NOT NULL;
ALTER TABLE public.projects ALTER COLUMN province           DROP NOT NULL;
ALTER TABLE public.projects ALTER COLUMN district           DROP NOT NULL;
ALTER TABLE public.projects ALTER COLUMN short_description  DROP NOT NULL;
