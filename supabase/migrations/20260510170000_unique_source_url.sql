-- Remove duplicate (project_id, url) rows keeping the earliest insert,
-- then enforce uniqueness with a partial index (excludes NULL urls).

DELETE FROM project_sources
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY project_id, url
             ORDER BY created_at
           ) AS rn
    FROM project_sources
    WHERE url IS NOT NULL
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS project_sources_project_url_unique
  ON project_sources (project_id, url)
  WHERE url IS NOT NULL;
